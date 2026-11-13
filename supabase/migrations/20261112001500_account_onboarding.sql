begin;
grant create on schema accordly_commands to accordly_identity,accordly_executor,accordly_credentials;
-- Retain the approved gateway trust boundary: p_auth is asserted only after
-- live Auth/email verification by server-only services, never by public RPC.
set local role accordly_owner;
create table accordly.account_onboarding (
 principal_id uuid primary key references accordly.principals(id),full_name text check(length(btrim(full_name)) between 1 and 200),
 work_kind text check(work_kind in ('individual','business')),purpose text check(purpose in ('create','review','both')),
 revision bigint not null default 1 check(revision>0),completed_at timestamptz,
 initial_organization_id uuid references accordly.organizations(id),last_organization_id uuid references accordly.organizations(id),
 completion_digest bytea check(octet_length(completion_digest)=32),origin text not null default 'guided' check(origin in ('guided','existing_member')),
 updated_at timestamptz not null default clock_timestamp(),
 check((work_kind is null)=(purpose is null)),
 check((completed_at is null and initial_organization_id is null and completion_digest is null) or (completed_at is not null and full_name is not null and work_kind is not null and purpose is not null and initial_organization_id is not null and completion_digest is not null))
);
create index onboarding_last on accordly.account_onboarding(last_organization_id);
create table accordly.account_receipts (
 principal_id uuid not null references accordly.principals(id),operation text not null check(operation in ('preferences','complete','use_existing','select_workspace')),
 idempotency_key uuid not null,request_digest bytea not null check(octet_length(request_digest)=32),outcome jsonb not null check(octet_length(outcome::text)<8192),
 committed_at timestamptz not null default clock_timestamp(),primary key(principal_id,operation,idempotency_key)
);
create table accordly.account_recovery_grants (
 id uuid primary key,principal_id uuid not null references accordly.principals(id),auth_session_id uuid not null,
 secret_digest bytea not null unique check(octet_length(secret_digest)=32),issued_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,consumed_at timestamptz,
 check(expires_at>issued_at and expires_at<=issued_at+interval '10 minutes')
);
create index recovery_actor on accordly.account_recovery_grants(principal_id,auth_session_id);
create table accordly.account_rate_buckets (
 bucket text not null check(bucket ~ '^(signup|resend|verify|recover|reset)/(global|ingress|target)/[a-f0-9]{64}$'),
 window_at timestamptz not null,count integer not null check(count>0),expires_at timestamptz not null,primary key(bucket,window_at)
);
create index account_rate_expiry on accordly.account_rate_buckets(expires_at);
do $$ declare t text; begin
 foreach t in array array['account_onboarding','account_receipts','account_recovery_grants','account_rate_buckets'] loop
  execute format('alter table accordly.%I enable row level security',t); execute format('alter table accordly.%I force row level security',t);
  execute format('revoke all on accordly.%I from public,anon,authenticated,service_role,accordly_gateway',t);
 end loop;
 foreach t in array array['account_onboarding','account_receipts','account_recovery_grants'] loop
  execute format('create policy account_self on accordly.%I to accordly_executor using(principal_id=accordly_commands.actor_id()) with check(principal_id=accordly_commands.actor_id())',t);
 end loop;
end $$;
create policy rate_scope on accordly.account_rate_buckets to accordly_credentials using(bucket=current_setting('accordly.account_rate_bucket',true)) with check(bucket=current_setting('accordly.account_rate_bucket',true));
create trigger fixed_account before update on accordly.account_onboarding for each row execute function accordly_commands.prevent_identity_change('principal_id');
create function accordly_commands.protect_completed_account() returns trigger language plpgsql set search_path='' as $$ begin
 if old.completed_at is not null and (to_jsonb(new)-array['last_organization_id','updated_at']) is distinct from (to_jsonb(old)-array['last_organization_id','updated_at']) then raise exception using errcode='23514',message='Completed onboarding cannot be rewritten'; end if; return new;
end $$;
create trigger completed_account before update on accordly.account_onboarding for each row execute function accordly_commands.protect_completed_account();
create trigger account_receipt_history before update or delete or truncate on accordly.account_receipts for each statement execute function accordly_commands.deny_history_mutation();
create trigger fixed_recovery before update on accordly.account_recovery_grants for each row execute function accordly_commands.prevent_identity_change('id','principal_id','auth_session_id','secret_digest','issued_at','expires_at');

create function accordly_commands.account_rate_limit(p_operation text,p_target text,p_ingress text) returns boolean
language plpgsql security definer set search_path='' as $$
declare scope text; b text; n integer; lim integer; permitted boolean:=true; w timestamptz:=date_trunc('hour',clock_timestamp()); begin
 if p_operation not in ('signup','resend','verify','recover','reset') or coalesce(p_target,'') !~ '^[a-f0-9]{64}$' or coalesce(p_ingress,'') !~ '^[a-f0-9]{64}$' then return false; end if;
 foreach scope in array array['global','ingress','target'] loop
  b:=p_operation||'/'||scope||'/'||case scope when 'target' then p_target when 'ingress' then p_ingress else repeat('0',64) end;
  lim:=case scope when 'global' then 100 when 'ingress' then case when p_operation='verify' then 30 else 10 end else case when p_operation='verify' then 10 when p_operation='reset' then 5 else 3 end end;
  perform set_config('accordly.account_rate_bucket',b,true);
  insert into accordly.account_rate_buckets(bucket,window_at,count,expires_at) values(b,w,1,w+interval '2 hours') on conflict(bucket,window_at) do update set count=least(accordly.account_rate_buckets.count+1,1000000) returning count into n;
  permitted:=permitted and n<=lim;
 end loop;
 perform set_config('accordly.account_rate_bucket','',true); return permitted;
end $$;

create function accordly_commands.account_command(p_auth uuid,p_operation text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; a accordly.account_onboarding; result jsonb; previous accordly.account_receipts; h bytea; intent bytea; org uuid; workspaces jsonb;
begin
 if p_auth is null then raise exception using errcode='42501',message='Verified registered identity assertion required'; end if;
 actor:=accordly_commands.set_registered_actor(p_auth);
 perform pg_advisory_xact_lock(hashtextextended('accordly:account:'||actor::text,0));
 if p_input is null or octet_length(p_input::text)>8192 then raise exception using errcode='22023',message='Bounded account input required'; end if;
 if p_operation in ('recovery_issue','recovery_consume') then
  if p_operation='recovery_issue' then
   perform accordly_commands.assert_keys(p_input,array['id','auth_session_id','secret_digest']);
   insert into accordly.account_recovery_grants(id,principal_id,auth_session_id,secret_digest,expires_at) values((p_input->>'id')::uuid,actor,(p_input->>'auth_session_id')::uuid,decode(p_input->>'secret_digest','hex'),clock_timestamp()+interval '10 minutes'); result:='{"ok":true}';
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
-- Preserve existing memberships, including read-only members. This is a
-- one-time migration adoption, not email-based agreement claiming.
insert into accordly.account_onboarding(principal_id,full_name,work_kind,purpose,completed_at,initial_organization_id,last_organization_id,completion_digest,origin)
 select distinct on(p.id) p.id,coalesce(nullif(btrim(pr.display_name),''),'Existing account'),o.kind,'both',clock_timestamp(),o.id,o.id,sha256(convert_to('legacy:'||p.id::text||':'||o.id::text,'UTF8')),'existing_member'
 from accordly.principals p join accordly.organization_memberships m on m.principal_id=p.id and m.active join accordly.organizations o on o.id=m.organization_id left join accordly.profiles pr on pr.principal_id=p.id
 where p.kind='registered' and p.status='active' order by p.id,o.created_at,o.id;
alter function accordly_commands.account_command(uuid,text,jsonb) owner to accordly_executor;
alter function accordly_commands.account_rate_limit(text,text,text) owner to accordly_credentials;
grant select,insert,update on accordly.account_onboarding to accordly_executor;
grant select,insert on accordly.account_receipts to accordly_executor;
grant select,insert on accordly.account_recovery_grants to accordly_executor;
grant update(consumed_at) on accordly.account_recovery_grants to accordly_executor;
grant select,insert,update on accordly.account_rate_buckets to accordly_credentials;
revoke all on function accordly_commands.account_command(uuid,text,jsonb),accordly_commands.account_rate_limit(text,text,text) from public,anon,authenticated,service_role,accordly_gateway;
revoke all on function accordly_commands.protect_completed_account() from public,anon,authenticated,service_role,accordly_gateway;
grant execute on function accordly_commands.create_organization(uuid,text,text) to accordly_executor;
grant execute on function accordly_commands.account_command(uuid,text,jsonb),accordly_commands.account_rate_limit(text,text,text) to accordly_gateway;
revoke create on schema accordly_commands from accordly_identity,accordly_executor,accordly_credentials;
commit;
