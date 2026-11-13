-- Additive Stage 1C.2. Earlier migrations remain unchanged.
begin;
-- Schema-local default REVOKEs do not subtract PostgreSQL's global PUBLIC
-- function EXECUTE default. Fix that additively and revoke actual ACLs below.
alter default privileges for role accordly_owner revoke execute on functions from public;
alter default privileges revoke execute on functions from public;
do $$ declare r record; begin
  select * into r from pg_roles where rolname='accordly_freezer';
  if found then
    if r.rolcanlogin or r.rolsuper or r.rolinherit or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication
      or exists(select 1 from pg_auth_members where member=r.oid)
      or exists(select 1 from pg_auth_members m join pg_roles p on p.oid=m.member where m.roleid=r.oid and p.rolname<>current_user) then raise exception 'Unsafe freezer role'; end if;
  else create role accordly_freezer nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication; end if;
  execute format('grant accordly_freezer to %I',current_user);
end $$;
grant usage on schema accordly,accordly_commands to accordly_freezer;
grant create on schema accordly_commands to accordly_executor,accordly_authorizer;
set local role accordly_owner;

create table accordly.command_receipts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references accordly.organizations(id) on delete restrict,
  agreement_id uuid not null, actor_principal_id uuid not null references accordly.principals(id) on delete restrict,
  operation text not null check (operation in ('create_draft','update_draft','set_parties','set_access','freeze')),
  resource_id uuid not null, idempotency_key uuid not null, request_digest bytea not null check (octet_length(request_digest)=32),
  outcome jsonb not null check (jsonb_typeof(outcome)='object' and octet_length(outcome::text)<=1048576),
  committed_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null default clock_timestamp()+interval '30 days',
  unique(actor_principal_id,operation,resource_id,idempotency_key), unique(organization_id,agreement_id,id),
  foreign key(organization_id,agreement_id) references accordly.agreements(organization_id,id) on delete restrict,
  check(expires_at>committed_at), check((operation='create_draft' and resource_id=organization_id) or (operation<>'create_draft' and resource_id=agreement_id))
);
create index receipts_scope on accordly.command_receipts(organization_id,agreement_id);
create index receipts_expiry on accordly.command_receipts(expires_at);

create table accordly.audit_events (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,agreement_id uuid not null,
  sequence bigint not null check(sequence>0),receipt_id uuid not null,
  actor_principal_id uuid not null references accordly.principals(id) on delete restrict,
  event_type text not null check(event_type in ('create_draft','update_draft','set_parties','set_access','freeze')),
  occurred_at timestamptz not null default clock_timestamp(),
  canonical_event bytea not null check(octet_length(canonical_event)<=10000),
  prior_event_hash bytea not null check(octet_length(prior_event_hash)=32),
  event_hash bytea generated always as (sha256(prior_event_hash||canonical_event)) stored,
  unique(agreement_id,sequence),unique(receipt_id,event_type),
  foreign key(organization_id,agreement_id,receipt_id) references accordly.command_receipts(organization_id,agreement_id,id) on delete restrict
);
create index audit_scope on accordly.audit_events(organization_id,agreement_id,sequence);
create index audit_actor on accordly.audit_events(actor_principal_id);
create table accordly.outbox_events (
  id uuid primary key default gen_random_uuid(),organization_id uuid not null,agreement_id uuid not null,
  deduplication_key uuid not null unique,
  event_type text not null check(event_type='proposal_frozen'),
  references_json jsonb not null check(jsonb_typeof(references_json)='object' and octet_length(references_json::text)<=2000),
  status text not null default 'pending' check(status in ('pending','leased','delivered','failed')),
  attempts integer not null default 0 check(attempts>=0),lease_owner uuid,lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),next_attempt_at timestamptz not null default clock_timestamp(),
  foreign key(organization_id,agreement_id) references accordly.agreements(organization_id,id) on delete restrict,
  foreign key(organization_id,agreement_id,deduplication_key) references accordly.command_receipts(organization_id,agreement_id,id) on delete restrict,
  check((status='leased' and lease_owner is not null and lease_expires_at is not null) or (status<>'leased' and lease_owner is null and lease_expires_at is null))
);
create index outbox_ready on accordly.outbox_events(status,next_attempt_at,id);
create index outbox_scope on accordly.outbox_events(organization_id,agreement_id);

do $$ declare t text; begin
  foreach t in array array['command_receipts','audit_events','outbox_events'] loop
    execute format('alter table accordly.%I enable row level security',t);
    execute format('alter table accordly.%I force row level security',t);
    execute format('revoke all on accordly.%I from public,anon,authenticated,service_role',t);
  end loop;
  foreach t in array array['command_receipts','audit_events'] loop
    execute format('create trigger append_only before update or delete or truncate on accordly.%I for each statement execute function accordly_commands.deny_history_mutation()',t);
  end loop;
end $$;
create policy receipt_self on accordly.command_receipts for select to accordly_executor using(actor_principal_id=accordly_commands.actor_id() and accordly_commands.can_access_agreement(organization_id,agreement_id,'read'));
create policy receipt_insert on accordly.command_receipts for insert to accordly_executor with check(actor_principal_id=accordly_commands.actor_id() and accordly_commands.can_access_agreement(organization_id,agreement_id,'read'));
create policy audit_read on accordly.audit_events for select to accordly_executor using(accordly_commands.can_access_agreement(organization_id,agreement_id,'read'));
create policy audit_append on accordly.audit_events for insert to accordly_executor with check(actor_principal_id=accordly_commands.actor_id() and accordly_commands.can_access_agreement(organization_id,agreement_id,'read'));
create policy outbox_append on accordly.outbox_events for insert to accordly_executor with check(accordly_commands.can_access_agreement(organization_id,agreement_id,'issue'));
-- No worker read/update grants exist until a reviewed delivery implementation.

create function accordly_commands.canonical_json(p_value jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare t text:=jsonb_typeof(p_value); result text; n numeric;
begin
  if t in ('null','boolean','string') then return p_value::text; end if;
  if t='number' then
    n:=p_value::text::numeric;
    if n<>trunc(n) or abs(n)>9007199254740991 then raise exception using errcode='22023',message='Only safe integer JSON numbers are supported'; end if;
    return n::bigint::text;
  end if;
  if t='array' then
    select '['||coalesce(string_agg(accordly_commands.canonical_json(v),',' order by pos),'')||']' into result from jsonb_array_elements(p_value) with ordinality as a(v,pos);
    return result;
  end if;
  if t='object' then
    -- Contract/request keys are fixed ASCII identifiers. C ordering equals JCS
    -- UTF-16 ordering on that alphabet; Unicode VALUES are preserved unchanged.
    if exists(select 1 from jsonb_object_keys(p_value) k where k !~ '^[a-z_]+$') then raise exception using errcode='22023',message='Unsupported canonical property'; end if;
    select '{'||coalesce(string_agg(to_jsonb(k)::text||':'||accordly_commands.canonical_json(v),',' order by k collate "C"),'')||'}' into result from jsonb_each(p_value) as a(k,v);
    return result;
  end if;
  raise exception using errcode='22023',message='Unsupported JSON value';
end $$;

create function accordly_commands.assert_keys(p_value jsonb,p_keys text[]) returns void
language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p_value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_value) k where not (k=any(p_keys))) then
    raise exception using errcode='22023',message='Unknown or invalid command fields';
  end if;
end $$;
create function accordly_commands.require_text(p_value jsonb,p_key text,p_max integer) returns text
language plpgsql immutable set search_path='' as $$
declare v text:=p_value->>p_key;
begin
  if jsonb_typeof(p_value->p_key) is distinct from 'string' or length(btrim(v)) not between 1 and p_max then raise exception using errcode='22023',message='Invalid required text'; end if;
  return v;
end $$;
create function accordly_commands.validate_deadline(p_value jsonb) returns void
language plpgsql stable set search_path='' as $$
declare d date; t timestamptz;
begin
  if p_value->>'kind'='date' then
    perform accordly_commands.assert_keys(p_value,array['kind','date']);
    if (p_value->>'date') !~ '^\d{4}-\d{2}-\d{2}$' or p_value->>'date' is null then raise exception using errcode='22023',message='Invalid date'; end if;
    d:=(p_value->>'date')::date;
  elsif p_value->>'kind'='instant' then
    perform accordly_commands.assert_keys(p_value,array['kind','at','timezone']);
    if coalesce(p_value->>'at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_value->>'timezone') then raise exception using errcode='22023',message='Invalid timestamp or timezone'; end if;
    t:=(p_value->>'at')::timestamptz;
  else raise exception using errcode='22023',message='Invalid deadline kind'; end if;
end $$;
create function accordly_commands.validate_draft(p_value jsonb) returns void
language plpgsql stable set search_path='' as $$
declare m jsonb; total numeric:=0;
begin
  perform accordly_commands.assert_keys(p_value,array['scope','terms','amount_minor','currency_code','currency_exponent','content_language','deadline','milestones','attachments']);
  perform accordly_commands.require_text(p_value,'scope',20000); perform accordly_commands.require_text(p_value,'terms',40000);
  if jsonb_typeof(p_value->'amount_minor') is distinct from 'string' or coalesce(p_value->>'amount_minor','') !~ '^[1-9][0-9]{0,15}$' or (p_value->>'amount_minor')::numeric>9000000000000000
    or p_value->>'currency_code' is distinct from 'XAF' or p_value->'currency_exponent' is distinct from '0'::jsonb or coalesce(p_value->>'content_language','') not in ('en','fr') then raise exception using errcode='22023',message='Invalid money, currency or language'; end if;
  perform accordly_commands.validate_deadline(p_value->'deadline');
  if jsonb_typeof(p_value->'milestones') is distinct from 'array' or jsonb_array_length(p_value->'milestones')>50 or p_value->'attachments' is distinct from '[]'::jsonb or octet_length(p_value::text)>131072 then raise exception using errcode='22023',message='Invalid milestones or unsupported attachments'; end if;
  for m in select value from jsonb_array_elements(p_value->'milestones') loop
    perform accordly_commands.assert_keys(m,array['description','amount_minor','deadline','acceptance_terms']);
    perform accordly_commands.require_text(m,'description',10000); perform accordly_commands.require_text(m,'acceptance_terms',20000);
    if jsonb_typeof(m->'amount_minor') is distinct from 'string' or coalesce(m->>'amount_minor','') !~ '^(0|[1-9][0-9]{0,15})$' or (m->>'amount_minor')::numeric>9000000000000000 then raise exception using errcode='22023',message='Invalid milestone money'; end if;
    total:=total+(m->>'amount_minor')::numeric;
    perform accordly_commands.validate_deadline(m->'deadline');
  end loop;
  if jsonb_array_length(p_value->'milestones')>0 and total<>(p_value->>'amount_minor')::numeric then raise exception using errcode='23514',message='Milestone sum mismatch'; end if;
end $$;
create function accordly_commands.normalized_email(p_email text) returns text
language plpgsql immutable set search_path='' as $$
begin
  if p_email is null or length(p_email)>320 or p_email !~ '^[^@[:space:]]+@[A-Za-z0-9.-]+$' then raise exception using errcode='22023',message='Invalid contact email'; end if;
  return split_part(p_email,'@',1)||'@'||lower(split_part(p_email,'@',2));
end $$;

create function accordly_commands.target_org_role(p_org uuid,p_principal uuid) returns text
language sql stable security definer set search_path='' as $$
 select m.role from accordly.organization_memberships m join accordly.principals p on p.id=m.principal_id
 where m.organization_id=p_org and m.principal_id=p_principal and m.active and p.status='active' and p.kind='registered'
$$;
-- Read/write rights remain RLS constrained. No table grant goes to the gateway.
grant select,insert on accordly.command_receipts,accordly.audit_events to accordly_executor;
grant insert on accordly.outbox_events to accordly_executor;
grant insert,update(payload,revision,updated_at) on accordly.agreement_drafts to accordly_executor;
grant insert,update(legal_name,contact_email) on accordly.agreement_parties to accordly_executor;
grant insert,update(principal_id,entered_email,normalized_email,display_name,authority_source,can_review,can_propose,can_sign,authority_revision) on accordly.party_representatives to accordly_executor;
grant update(revoked_at) on accordly.agreement_access_grants to accordly_executor;
grant update(revision,updated_at,lifecycle,pending_initial_proposal_id) on accordly.agreements to accordly_executor;
-- The ordinary executor STILL has no INSERT on frozen rows. Only an internal
-- NOLOGIN freezer can construct them, preserving the Stage 1C.1 boundary.
grant select on accordly.agreements,accordly.agreement_drafts,accordly.agreement_parties,accordly.party_representatives,accordly.agreement_versions,accordly.version_milestones,accordly.agreement_proposals,accordly.proposal_participants to accordly_freezer;
grant insert on accordly.agreement_versions,accordly.version_milestones,accordly.agreement_proposals,accordly.proposal_participants to accordly_freezer;
grant update(id) on accordly.agreements to accordly_freezer;
do $$ declare t text; begin
  foreach t in array array['agreement_drafts','agreement_parties','party_representatives','agreement_versions','version_milestones','agreement_proposals','proposal_participants'] loop
    execute format('create policy freezer_read on accordly.%I for select to accordly_freezer using(accordly_commands.can_access_agreement(organization_id,agreement_id,''issue''))',t);
  end loop;
end $$;
create policy freezer_root_read on accordly.agreements for select to accordly_freezer using(accordly_commands.can_access_agreement(organization_id,id,'issue'));
create policy freezer_root_lock on accordly.agreements for update to accordly_freezer using(accordly_commands.can_access_agreement(organization_id,id,'issue')) with check(accordly_commands.can_access_agreement(organization_id,id,'issue'));
create policy agreement_prepare on accordly.agreements for update to accordly_executor using(accordly_commands.can_access_agreement(organization_id,id,'edit') or accordly_commands.can_access_agreement(organization_id,id,'issue') or accordly_commands.org_role(organization_id) in ('owner','admin')) with check(accordly_commands.can_access_agreement(organization_id,id,'edit') or accordly_commands.can_access_agreement(organization_id,id,'issue') or accordly_commands.org_role(organization_id) in ('owner','admin'));
create policy draft_insert on accordly.agreement_drafts for insert to accordly_executor with check(author_principal_id=accordly_commands.actor_id() and accordly_commands.can_access_agreement(organization_id,agreement_id,'edit') and kind='initial');
create policy draft_update on accordly.agreement_drafts for update to accordly_executor using(accordly_commands.can_access_agreement(organization_id,agreement_id,'edit')) with check(accordly_commands.can_access_agreement(organization_id,agreement_id,'edit'));
create policy party_insert on accordly.agreement_parties for insert to accordly_executor with check(accordly_commands.can_access_agreement(organization_id,agreement_id,'edit'));
create policy party_update on accordly.agreement_parties for update to accordly_executor using(accordly_commands.can_access_agreement(organization_id,agreement_id,'edit')) with check(accordly_commands.can_access_agreement(organization_id,agreement_id,'edit'));
create policy rep_insert on accordly.party_representatives for insert to accordly_executor with check(accordly_commands.can_access_agreement(organization_id,agreement_id,'edit'));
create policy rep_update on accordly.party_representatives for update to accordly_executor using(accordly_commands.can_access_agreement(organization_id,agreement_id,'edit')) with check(accordly_commands.can_access_agreement(organization_id,agreement_id,'edit'));
create policy managed_grant_insert on accordly.agreement_access_grants for insert to accordly_executor with check(accordly_commands.org_role(organization_id) in ('owner','admin'));
create policy managed_grant_update on accordly.agreement_access_grants for update to accordly_executor using(accordly_commands.org_role(organization_id) in ('owner','admin')) with check(accordly_commands.org_role(organization_id) in ('owner','admin'));
create policy candidate_insert on accordly.agreement_versions for insert to accordly_freezer with check(accordly_commands.can_access_agreement(organization_id,agreement_id,'issue'));
create policy milestone_insert on accordly.version_milestones for insert to accordly_freezer with check(accordly_commands.can_access_agreement(organization_id,agreement_id,'issue'));
create policy proposal_insert on accordly.agreement_proposals for insert to accordly_freezer with check(accordly_commands.can_access_agreement(organization_id,agreement_id,'issue'));
create policy slot_insert on accordly.proposal_participants for insert to accordly_freezer with check(accordly_commands.can_access_agreement(organization_id,agreement_id,'issue'));
reset role;
alter function accordly_commands.target_org_role(uuid,uuid) owner to accordly_authorizer;
revoke all on function accordly_commands.target_org_role(uuid,uuid) from public,anon,authenticated,service_role,accordly_gateway;
grant execute on function accordly_commands.target_org_role(uuid,uuid) to accordly_executor;
grant execute on function accordly_commands.canonical_json(jsonb),accordly_commands.assert_keys(jsonb,text[]),accordly_commands.require_text(jsonb,text,integer),accordly_commands.validate_deadline(jsonb),accordly_commands.validate_draft(jsonb),accordly_commands.normalized_email(text) to accordly_executor;
grant execute on function accordly_commands.actor_id(),accordly_commands.org_role(uuid),accordly_commands.can_access_agreement(uuid,uuid,text),accordly_commands.target_org_role(uuid,uuid),accordly_commands.canonical_json(jsonb),accordly_commands.validate_draft(jsonb),accordly_commands.normalized_email(text) to accordly_freezer;
-- Existing SQL entry points are retained for Stage 1C.1 compatibility/fixtures;
-- HTTP exposes only the new persistent-idempotency preparation path.
grant execute on function accordly_commands.create_agreement(uuid,uuid,text) to accordly_executor;
revoke all on all functions in schema accordly_commands from public,anon,authenticated,service_role;
commit;
