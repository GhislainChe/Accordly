begin;
grant create on schema accordly_commands to accordly_executor, accordly_authorizer, accordly_identity;
set local role accordly_owner;

create function accordly_commands.actor_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(current_setting('accordly.actor_id',true),'')::uuid
$$;
revoke all on function accordly_commands.actor_id() from public;
grant execute on function accordly_commands.actor_id() to accordly_executor, accordly_authorizer, accordly_identity;

create function accordly_commands.org_role(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from accordly.organization_memberships m join accordly.principals p on p.id = m.principal_id
  where m.organization_id = p_org and m.principal_id = accordly_commands.actor_id()
    and m.active and p.status = 'active' and p.kind = 'registered'
$$;

create function accordly_commands.can_access_agreement(p_org uuid,p_agreement uuid,p_action text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from accordly.principals p where p.id = accordly_commands.actor_id() and p.kind = 'registered' and p.status = 'active') and (
    accordly_commands.org_role(p_org) in ('owner','admin')
    or exists (
      select 1 from accordly.agreement_access_grants g
      where g.organization_id = p_org and g.agreement_id = p_agreement and g.principal_id = accordly_commands.actor_id()
        and g.revoked_at is null and (g.expires_at is null or g.expires_at > statement_timestamp())
        and (
          (accordly_commands.org_role(p_org) is not null and (
            (p_action in ('read','draft_read') and g.grant_type in ('provider_read','provider_edit','provider_issue'))
            or (p_action = 'edit' and accordly_commands.org_role(p_org) = 'editor' and g.grant_type = 'provider_edit')
            or (p_action = 'issue' and accordly_commands.org_role(p_org) = 'editor' and g.grant_type = 'provider_issue')
          ))
          or (p_action = 'read' and g.grant_type = 'client_review' and exists (
            select 1 from accordly.party_representatives r join accordly.agreement_parties party on party.id = r.party_id
            where r.organization_id = p_org and r.agreement_id = p_agreement and r.principal_id = g.principal_id
              and r.revoked_at is null and r.can_review and party.side = 'client'
          ) and exists (select 1 from accordly.agreements a where a.organization_id = p_org and a.id = p_agreement and a.lifecycle in ('awaiting_signatures','active')))
        )
    )
  )
$$;

create function accordly_commands.shared_version(p_org uuid,p_agreement uuid,p_version uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select accordly_commands.can_access_agreement(p_org,p_agreement,'draft_read') or (
    accordly_commands.can_access_agreement(p_org,p_agreement,'read') and exists (
      select 1 from accordly.agreement_proposals where organization_id = p_org and agreement_id = p_agreement and candidate_version_id = p_version
    )
  )
$$;

create function accordly_commands.set_registered_actor(p_auth_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  perform set_config('accordly.actor_id','',true);
  perform set_config('accordly.verified_auth_id',coalesce(p_auth_user::text,''),true);
  -- Only the private gateway may supply this assertion after live Auth + email
  -- verification. The FK validates existence, not a live session or mailbox.
  if p_auth_user is null then raise exception using errcode = '42501', message = 'Verified registered identity required'; end if;
  insert into accordly.principals(kind,auth_user_id) values ('registered',p_auth_user) on conflict (auth_user_id) do nothing;
  select id into actor from accordly.principals where auth_user_id = p_auth_user and status = 'active' and kind = 'registered';
  if actor is null then raise exception using errcode = '42501', message = 'Principal is disabled'; end if;
  perform set_config('accordly.verified_auth_id','',true);
  perform set_config('accordly.actor_id',actor::text,true);
  return actor;
end $$;

-- RLS applies to every domain table, including non-exposed tables and owners.
do $rls$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'accordly' loop
    execute format('alter table accordly.%I enable row level security',t.tablename);
    execute format('alter table accordly.%I force row level security',t.tablename);
    execute format('revoke all on accordly.%I from public,anon,authenticated,service_role',t.tablename);
  end loop;
end $rls$;

create policy currency_read on accordly.currencies for select to accordly_executor using (true);
create policy principal_self on accordly.principals for select to accordly_executor using (id = accordly_commands.actor_id() and status = 'active');
create policy identity_lookup on accordly.principals for select to accordly_identity using (auth_user_id = nullif(current_setting('accordly.verified_auth_id',true),'')::uuid);
create policy identity_register on accordly.principals for insert to accordly_identity with check (kind = 'registered' and status = 'active' and auth_user_id = nullif(current_setting('accordly.verified_auth_id',true),'')::uuid);
create policy profile_self on accordly.profiles for select to accordly_executor using (principal_id = accordly_commands.actor_id());
create policy organization_read on accordly.organizations for select to accordly_executor using (
  accordly_commands.org_role(id) is not null or (created_by = accordly_commands.actor_id() and id = nullif(current_setting('accordly.bootstrap_org',true),'')::uuid)
);
create policy organization_create on accordly.organizations for insert to accordly_executor with check (
  created_by = accordly_commands.actor_id() and status = 'active' and id = nullif(current_setting('accordly.bootstrap_org',true),'')::uuid
);
-- Locking SELECT FOR UPDATE needs UPDATE privilege AND an UPDATE policy.
create policy organization_lock on accordly.organizations for update to accordly_executor using (accordly_commands.org_role(id) is not null) with check (accordly_commands.org_role(id) is not null);
create policy membership_read on accordly.organization_memberships for select to accordly_executor using (
  principal_id = accordly_commands.actor_id() or accordly_commands.org_role(organization_id) in ('owner','admin')
);
create policy membership_insert on accordly.organization_memberships for insert to accordly_executor with check (
  (organization_id = nullif(current_setting('accordly.bootstrap_org',true),'')::uuid and principal_id = accordly_commands.actor_id() and role = 'owner' and active)
  or accordly_commands.org_role(organization_id) = 'owner'
  or (accordly_commands.org_role(organization_id) = 'admin' and role in ('editor','viewer'))
);
create policy membership_update on accordly.organization_memberships for update to accordly_executor using (
  accordly_commands.org_role(organization_id) = 'owner' or (accordly_commands.org_role(organization_id) = 'admin' and role in ('editor','viewer'))
) with check (
  accordly_commands.org_role(organization_id) = 'owner' or (accordly_commands.org_role(organization_id) = 'admin' and role in ('editor','viewer'))
);

create policy agreement_read on accordly.agreements for select to accordly_executor using (accordly_commands.can_access_agreement(organization_id,id,'read'));
create policy agreement_create on accordly.agreements for insert to accordly_executor with check (
  accordly_commands.org_role(organization_id) in ('owner','admin','editor') and created_by = accordly_commands.actor_id() and lifecycle = 'preparing'
  and effective_version_id is null and pending_initial_proposal_id is null
);
create policy grant_read on accordly.agreement_access_grants for select to accordly_executor using (principal_id = accordly_commands.actor_id() or accordly_commands.org_role(organization_id) in ('owner','admin'));
create policy creator_grant on accordly.agreement_access_grants for insert to accordly_executor with check (
  agreement_id = nullif(current_setting('accordly.bootstrap_agreement',true),'')::uuid and issued_by = accordly_commands.actor_id()
  and principal_id = accordly_commands.actor_id() and grant_type in ('provider_read','provider_edit','provider_issue')
  and accordly_commands.org_role(organization_id) in ('owner','admin','editor') and revoked_at is null and expires_at is null
);
create policy party_read on accordly.agreement_parties for select to accordly_executor using (accordly_commands.can_access_agreement(organization_id,agreement_id,'read'));
create policy representative_read on accordly.party_representatives for select to accordly_executor using (accordly_commands.can_access_agreement(organization_id,agreement_id,'read'));
create policy draft_read on accordly.agreement_drafts for select to accordly_executor using (accordly_commands.can_access_agreement(organization_id,agreement_id,'draft_read'));
create policy version_read on accordly.agreement_versions for select to accordly_executor using (accordly_commands.shared_version(organization_id,agreement_id,id));
create policy milestone_read on accordly.version_milestones for select to accordly_executor using (accordly_commands.shared_version(organization_id,agreement_id,version_id));
create policy proposal_read on accordly.agreement_proposals for select to accordly_executor using (accordly_commands.can_access_agreement(organization_id,agreement_id,'read'));
create policy participant_read on accordly.proposal_participants for select to accordly_executor using (accordly_commands.can_access_agreement(organization_id,agreement_id,'read'));
create policy artifact_read on accordly.document_artifacts for select to accordly_executor using (state = 'sealed' and accordly_commands.can_access_agreement(organization_id,agreement_id,'read') and (version_id is null or accordly_commands.shared_version(organization_id,agreement_id,version_id)));
create policy organization_event_read on accordly.organization_events for select to accordly_executor using (accordly_commands.org_role(organization_id) in ('owner','admin'));
create policy organization_event_append on accordly.organization_events for insert to accordly_executor with check (actor_principal_id = accordly_commands.actor_id() and accordly_commands.org_role(organization_id) is not null);

-- Nonrecursive authority helpers can read ONLY metadata. They have no contract
-- payload, canonical byte, artifact-path or credential-table grants.
do $metadata$
declare t text;
begin
  foreach t in array array['principals','organizations','organization_memberships','agreement_access_grants','party_representatives','agreement_parties','agreements','agreement_proposals'] loop
    execute format('create policy authority_metadata on accordly.%I for select to accordly_authorizer using (true)',t);
  end loop;
end $metadata$;

grant select(id,kind,status) on accordly.principals to accordly_authorizer;
grant select(id,status) on accordly.organizations to accordly_authorizer;
grant select(organization_id,principal_id,role,active) on accordly.organization_memberships to accordly_authorizer;
grant select(organization_id,agreement_id,principal_id,grant_type,expires_at,revoked_at) on accordly.agreement_access_grants to accordly_authorizer;
grant select(organization_id,agreement_id,party_id,principal_id,revoked_at,can_review) on accordly.party_representatives to accordly_authorizer;
grant select(id,side) on accordly.agreement_parties to accordly_authorizer;
grant select(id,organization_id,lifecycle) on accordly.agreements to accordly_authorizer;
grant select(organization_id,agreement_id,candidate_version_id) on accordly.agreement_proposals to accordly_authorizer;
grant select,insert on accordly.principals to accordly_identity;
-- Constraint triggers must also run after a command has cleared actor context.
-- This isolated NOLOGIN validator cannot be reached as a query API.
grant select on all tables in schema accordly to accordly_integrity;
grant update(id) on accordly.organizations to accordly_integrity;
do $integrity$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'accordly' loop
    execute format('create policy integrity_validation on accordly.%I for select to accordly_integrity using (true)',t.tablename);
  end loop;
end $integrity$;
create policy integrity_lock on accordly.organizations for update to accordly_integrity using (true) with check (true);
grant select on all tables in schema accordly to accordly_executor;
grant insert on accordly.organizations,accordly.organization_memberships,accordly.agreements,accordly.agreement_access_grants,accordly.organization_events to accordly_executor;
grant update(role,active,revoked_at,authority_revision) on accordly.organization_memberships to accordly_executor;
-- This privilege exists only to take row locks; no runtime command updates ID.
grant update(id) on accordly.organizations to accordly_executor;

create function accordly_commands.register_principal(p_verified_auth_user_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  actor := accordly_commands.set_registered_actor(p_verified_auth_user_id);
  perform set_config('accordly.actor_id','',true);
  return actor;
end $$;

create function accordly_commands.create_organization(p_verified_auth_user_id uuid,p_name text,p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid; org uuid := gen_random_uuid();
begin
  actor := accordly_commands.set_registered_actor(p_verified_auth_user_id);
  perform set_config('accordly.bootstrap_org',org::text,true);
  insert into accordly.organizations(id,kind,name,created_by) values (org,p_kind,p_name,actor);
  insert into accordly.organization_memberships(organization_id,principal_id,role) values (org,actor,'owner');
  insert into accordly.organization_events(organization_id,actor_principal_id,event_type,subject_principal_id) values (org,actor,'organization_created',actor);
  perform set_config('accordly.bootstrap_org','',true);
  perform set_config('accordly.actor_id','',true);
  return org;
end $$;

create function accordly_commands.set_membership(p_verified_auth_user_id uuid,p_organization_id uuid,p_principal_id uuid,p_role text,p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid; actor_role text; old_role text; owners bigint;
begin
  actor := accordly_commands.set_registered_actor(p_verified_auth_user_id);
  perform 1 from accordly.organizations where id = p_organization_id and status = 'active' for update;
  if not found then raise exception using errcode = '42501', message = 'Organization not accessible'; end if;
  actor_role := accordly_commands.org_role(p_organization_id);
  select role into old_role from accordly.organization_memberships where organization_id = p_organization_id and principal_id = p_principal_id;
  if actor_role is null or actor_role not in ('owner','admin') or p_role is null or p_active is null
    or (actor_role = 'admin' and (p_role not in ('editor','viewer') or coalesce(old_role,'viewer') not in ('editor','viewer')))
    or (actor = p_principal_id and p_role is distinct from old_role and p_role in ('owner','admin')) then
    raise exception using errcode = '42501', message = 'Membership change not authorized';
  end if;
  if old_role = 'owner' and (not p_active or p_role <> 'owner') then
    select count(*) into owners from accordly.organization_memberships where organization_id = p_organization_id and active and role = 'owner';
    if owners <= 1 then raise exception using errcode = '23514', message = 'Last owner cannot be removed or demoted'; end if;
  end if;
  -- Audit while the actor's pre-change authority is still visible. If the actor
  -- revokes its own membership, a post-change policy must not block a valid
  -- audited handoff. Any later failure rolls this event back atomically.
  insert into accordly.organization_events(organization_id,actor_principal_id,event_type,subject_principal_id,details)
    values (p_organization_id,actor,'membership_changed',p_principal_id,jsonb_build_object('role',p_role,'active',p_active));
  insert into accordly.organization_memberships(organization_id,principal_id,role,active,revoked_at)
    values (p_organization_id,p_principal_id,p_role,p_active,case when p_active then null else clock_timestamp() end)
  on conflict (organization_id,principal_id) do update set role = excluded.role,active = excluded.active,revoked_at = excluded.revoked_at;
  perform set_config('accordly.actor_id','',true);
end $$;

create function accordly_commands.create_agreement(p_verified_auth_user_id uuid,p_organization_id uuid,p_title text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid; aid uuid := gen_random_uuid();
begin
  actor := accordly_commands.set_registered_actor(p_verified_auth_user_id);
  perform 1 from accordly.organizations where id = p_organization_id and status = 'active' for share;
  if not found or coalesce(accordly_commands.org_role(p_organization_id),'') not in ('owner','admin','editor') then
    raise exception using errcode = '42501', message = 'Agreement creation not authorized';
  end if;
  perform set_config('accordly.bootstrap_agreement',aid::text,true);
  insert into accordly.agreements(id,organization_id,created_by,title) values (aid,p_organization_id,actor,p_title);
  insert into accordly.agreement_access_grants(organization_id,agreement_id,principal_id,grant_type,issued_by)
    select p_organization_id,aid,actor,t,actor from unnest(array['provider_read','provider_edit','provider_issue']) t;
  insert into accordly.organization_events(organization_id,actor_principal_id,event_type,agreement_id) values (p_organization_id,actor,'agreement_created',aid);
  perform set_config('accordly.bootstrap_agreement','',true);
  perform set_config('accordly.actor_id','',true);
  return aid;
end $$;

create function accordly_commands.list_agreements(p_verified_auth_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform accordly_commands.set_registered_actor(p_verified_auth_user_id);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'organization_id',organization_id,'title',title,'lifecycle',lifecycle) order by created_at,id),'[]'::jsonb)
    into result from accordly.agreements;
  perform set_config('accordly.actor_id','',true);
  return result;
end $$;

create function accordly_commands.read_version(p_verified_auth_user_id uuid,p_version_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform accordly_commands.set_registered_actor(p_verified_auth_user_id);
  select jsonb_build_object('id',id,'agreement_id',agreement_id,'digest',encode(digest,'hex'),'snapshot',convert_from(canonical_bytes,'UTF8')::jsonb)
    into result from accordly.agreement_versions where id = p_version_id;
  perform set_config('accordly.actor_id','',true);
  return result; -- NULL for both missing and unauthorized IDs.
end $$;

reset role;
alter function accordly_commands.org_role(uuid) owner to accordly_authorizer;
alter function accordly_commands.can_access_agreement(uuid,uuid,text) owner to accordly_authorizer;
alter function accordly_commands.shared_version(uuid,uuid,uuid) owner to accordly_authorizer;
alter function accordly_commands.set_registered_actor(uuid) owner to accordly_identity;
alter function accordly_commands.register_principal(uuid) owner to accordly_executor;
alter function accordly_commands.create_organization(uuid,text,text) owner to accordly_executor;
alter function accordly_commands.set_membership(uuid,uuid,uuid,text,boolean) owner to accordly_executor;
alter function accordly_commands.create_agreement(uuid,uuid,text) owner to accordly_executor;
alter function accordly_commands.list_agreements(uuid) owner to accordly_executor;
alter function accordly_commands.read_version(uuid,uuid) owner to accordly_executor;
-- Revoke defaults even after changing SECURITY DEFINER owners.
revoke all on all functions in schema accordly_commands from public,anon,authenticated,service_role,accordly_gateway;
grant execute on function accordly_commands.actor_id() to accordly_executor,accordly_authorizer,accordly_identity;
grant execute on function accordly_commands.org_role(uuid),accordly_commands.can_access_agreement(uuid,uuid,text),accordly_commands.shared_version(uuid,uuid,uuid) to accordly_executor,accordly_authorizer;
grant execute on function accordly_commands.set_registered_actor(uuid) to accordly_executor;
grant execute on function accordly_commands.register_principal(uuid),accordly_commands.create_organization(uuid,text,text),accordly_commands.set_membership(uuid,uuid,uuid,text,boolean),accordly_commands.create_agreement(uuid,uuid,text),accordly_commands.list_agreements(uuid),accordly_commands.read_version(uuid,uuid) to accordly_gateway;
-- Ownership changes require temporary CREATE; runtime roles cannot create code.
revoke create on schema accordly_commands from accordly_executor,accordly_authorizer,accordly_identity;
commit;

