-- Capture one clock value for exact recovery lifetime bounds. Default and
-- explicit volatile clock calls can differ by microseconds; do not widen TTL.
begin;
grant create on schema accordly_commands to accordly_executor;
set local role accordly_executor;
create or replace function accordly_commands.account_command(p_auth uuid,p_operation text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; a accordly.account_onboarding; result jsonb; previous accordly.account_receipts; h bytea; intent bytea; org uuid; workspaces jsonb; grant_time timestamptz;
begin
 if p_auth is null then raise exception using errcode='42501',message='Verified registered identity assertion required'; end if;
 actor:=accordly_commands.set_registered_actor(p_auth);
 perform pg_advisory_xact_lock(hashtextextended('accordly:account:'||actor::text,0));
 if p_input is null or octet_length(p_input::text)>8192 then raise exception using errcode='22023',message='Bounded account input required'; end if;
 if p_operation in ('recovery_issue','recovery_consume') then
  if p_operation='recovery_issue' then
   perform accordly_commands.assert_keys(p_input,array['id','auth_session_id','secret_digest']);
   grant_time:=clock_timestamp();
   insert into accordly.account_recovery_grants(id,principal_id,auth_session_id,secret_digest,issued_at,expires_at) values((p_input->>'id')::uuid,actor,(p_input->>'auth_session_id')::uuid,decode(p_input->>'secret_digest','hex'),grant_time,grant_time+interval '10 minutes'); result:='{"ok":true}';
  else
   perform accordly_commands.assert_keys(p_input,array['id','auth_session_id','secret_digest']);
   update accordly.account_recovery_grants set consumed_at=clock_timestamp() where id=(p_input->>'id')::uuid and principal_id=actor and auth_session_id=(p_input->>'auth_session_id')::uuid and secret_digest=decode(p_input->>'secret_digest','hex') and consumed_at is null and expires_at>clock_timestamp();
   if not found then raise exception using errcode='42501',message='Fresh one-use recovery required'; end if; result:='{"ok":true}';
  end if;
  perform set_config('accordly.actor_id','',true); return result;
 end if;
 insert into accordly.account_onboarding(principal_id) values(actor) on conflict do nothing;
 select * into a from accordly.account_onboarding where principal_id=actor for update;
 if p_operation='status' then
  perform accordly_commands.assert_keys(p_input,array[]::text[]);
  if a.last_organization_id is not null and accordly_commands.org_role(a.last_organization_id) is not null then org:=a.last_organization_id;
  else select o.id into org from accordly.organizations o where accordly_commands.org_role(o.id) is not null order by o.created_at,o.id limit 1; end if;
  if org is distinct from a.last_organization_id then update accordly.account_onboarding set last_organization_id=org,updated_at=clock_timestamp() where principal_id=actor; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'kind',o.kind,'status',o.status,'role',accordly_commands.org_role(o.id)) order by o.created_at,o.id),'[]') into workspaces from accordly.organizations o where accordly_commands.org_role(o.id) is not null;
  result:=jsonb_build_object('full_name',a.full_name,'work_kind',a.work_kind,'purpose',a.purpose,'revision',a.revision::text,'completed',a.completed_at is not null,'selected_workspace_id',org,'workspaces',workspaces,'step',case when a.work_kind is null then 2 else 3 end,'next',case when a.completed_at is null then '/onboarding' when org is null then '/workspace-unavailable' else '/app' end);
 else
  if p_operation not in ('preferences','complete','use_existing','select_workspace') or p_input->>'idempotency_key' is null then raise exception using errcode='22023',message='Supported command and key required'; end if;
  h:=sha256(convert_to(accordly_commands.canonical_json(p_input),'UTF8'));
  if a.completed_at is not null and p_operation in ('complete','use_existing') and accordly_commands.org_role(a.initial_organization_id) is null then raise exception using errcode='42501',message='Workspace access no longer authorized'; end if;
  select * into previous from accordly.account_receipts where principal_id=actor and operation=p_operation and idempotency_key=(p_input->>'idempotency_key')::uuid;
  if found then
   if h<>previous.request_digest then raise exception using errcode='P4090',message='Idempotency conflict'; end if;
   if p_operation='select_workspace' and accordly_commands.org_role((p_input->>'organization_id')::uuid) is null then raise exception using errcode='42501',message='Workspace access revoked'; end if;
   perform set_config('accordly.actor_id','',true); return previous.outcome;
  end if;
  if p_operation='preferences' then
   perform accordly_commands.assert_keys(p_input,array['idempotency_key','expected_revision','full_name','work_kind','purpose']);
   if a.completed_at is not null or p_input->>'expected_revision' is distinct from a.revision::text then raise exception using errcode='P4090',message='Onboarding has changed'; end if;
   perform accordly_commands.require_text(p_input,'full_name',200);
   if coalesce(p_input->>'work_kind','') not in ('individual','business') or coalesce(p_input->>'purpose','') not in ('create','review','both') then raise exception using errcode='22023',message='Choose work preferences'; end if;
   update accordly.account_onboarding set full_name=p_input->>'full_name',work_kind=p_input->>'work_kind',purpose=p_input->>'purpose',revision=revision+1,updated_at=clock_timestamp() where principal_id=actor returning revision into a.revision;
   result:=jsonb_build_object('revision',a.revision::text,'next','/onboarding');
  elsif p_operation in ('complete','use_existing') then
   if p_operation='complete' then perform accordly_commands.assert_keys(p_input,array['idempotency_key','expected_revision','workspace_name']); perform accordly_commands.require_text(p_input,'workspace_name',200);
   else perform accordly_commands.assert_keys(p_input,array['idempotency_key','expected_revision','organization_id']); end if;
   intent:=sha256(convert_to(accordly_commands.canonical_json(jsonb_build_object('operation',p_operation,'workspace_name',p_input->>'workspace_name','organization_id',p_input->>'organization_id','work_kind',a.work_kind,'purpose',a.purpose)),'UTF8'));
   if a.completed_at is not null then
    if intent is distinct from a.completion_digest then raise exception using errcode='P4090',message='Initial workspace is already configured'; end if; org:=a.initial_organization_id;
   else
    if a.full_name is null or a.work_kind is null or a.purpose is null or p_input->>'expected_revision' is distinct from a.revision::text then raise exception using errcode='P4090',message='Complete current work preferences first'; end if;
    if p_operation='complete' then org:=accordly_commands.create_organization(p_auth,p_input->>'workspace_name',a.work_kind); perform accordly_commands.set_registered_actor(p_auth);
    else org:=(p_input->>'organization_id')::uuid; perform 1 from accordly.organizations where id=org for share; if not found or accordly_commands.org_role(org) is null then raise exception using errcode='42501',message='Existing membership required'; end if; end if;
    update accordly.account_onboarding set initial_organization_id=org,last_organization_id=org,completion_digest=intent,completed_at=clock_timestamp(),origin=case when p_operation='use_existing' then 'existing_member' else 'guided' end,revision=revision+1,updated_at=clock_timestamp() where principal_id=actor;
   end if;
   result:=jsonb_build_object('organization_id',org,'next','/app');
  else
   perform accordly_commands.assert_keys(p_input,array['idempotency_key','organization_id']);
   if a.completed_at is null then raise exception using errcode='P4090',message='Finish onboarding first'; end if;
   org:=(p_input->>'organization_id')::uuid; perform 1 from accordly.organizations where id=org for share;
   if not found or accordly_commands.org_role(org) is null then raise exception using errcode='42501',message='Authorized workspace required'; end if;
   update accordly.account_onboarding set last_organization_id=org,updated_at=clock_timestamp() where principal_id=actor;
   result:=jsonb_build_object('organization_id',org,'next','/app');
  end if;
  insert into accordly.account_receipts(principal_id,operation,idempotency_key,request_digest,outcome) values(actor,p_operation,(p_input->>'idempotency_key')::uuid,h,result);
 end if;
 perform set_config('accordly.actor_id','',true); return result;
end $$;
reset role;
revoke create on schema accordly_commands from accordly_executor;
commit;
