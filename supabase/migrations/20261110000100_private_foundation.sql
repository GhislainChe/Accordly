-- Stage 1C.1. Apply only through an authorized migration connection.
-- No passwords, tokens, service-role clients or exposed domain RPCs.
begin;

do $roles$
declare r text; existing record;
begin
  foreach r in array array['accordly_owner','accordly_executor','accordly_authorizer','accordly_identity','accordly_integrity','accordly_gateway'] loop
    select * into existing from pg_roles where rolname = r;
    if found then
      if existing.rolsuper or existing.rolinherit or existing.rolcreatedb or existing.rolcreaterole or existing.rolreplication or existing.rolbypassrls
        or (r <> 'accordly_gateway' and existing.rolcanlogin)
        or exists (select 1 from pg_auth_members where member = existing.oid)
        or exists (select 1 from pg_auth_members m join pg_roles member_role on member_role.oid = m.member where m.roleid = existing.oid and member_role.rolname <> current_user) then
        raise exception 'Unsafe reserved Accordly role: %. Review privileges before migrating.', r;
      end if;
    else
      execute format('create role %I nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls', r);
    end if;
    -- The migration operator needs membership to assign object ownership.
    execute format('grant %I to %I', r, current_user);
  end loop;
end $roles$;
do $connect$ begin execute format('grant connect on database %I to accordly_gateway',current_database()); end $connect$;
-- Provision a password or supported external authentication separately, over TLS.
alter role accordly_gateway login;

create schema accordly authorization accordly_owner;
create schema accordly_commands authorization accordly_owner;
revoke all on schema accordly, accordly_commands from public, anon, authenticated, service_role;
grant usage on schema accordly to accordly_executor, accordly_authorizer, accordly_identity, accordly_integrity;
grant usage on schema accordly_commands to accordly_executor, accordly_authorizer, accordly_identity, accordly_integrity, accordly_gateway;
revoke create on schema public from public, anon, authenticated;

-- Create the Auth FK as the migration operator, whose Supabase-managed Auth
-- REFERENCES grant cannot necessarily be delegated. Reassign all domain tables
-- to the NOLOGIN owner before committing; runtime roles get no Auth table access.
alter default privileges for role accordly_owner in schema accordly revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role accordly_owner in schema accordly revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role accordly_owner in schema accordly_commands revoke execute on functions from public, anon, authenticated, service_role;

create table accordly.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  numeric_code text not null check (numeric_code ~ '^[0-9]{3}$'),
  minor_unit_exponent smallint not null check (minor_unit_exponent between 0 and 4),
  enabled_for_issuance boolean not null default false,
  metadata_revision integer not null default 1 check (metadata_revision > 0),
  source_date date not null
);
insert into accordly.currencies values ('XAF','950',0,true,1,'2026-11-10');

create table accordly.principals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('registered','guest','system')),
  status text not null default 'active' check (status in ('active','disabled','tombstoned')),
  auth_user_id uuid unique references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  disabled_at timestamptz,
  check ((kind = 'registered' and (status <> 'active' or auth_user_id is not null)) or (kind <> 'registered' and auth_user_id is null)),
  check ((status = 'active') = (disabled_at is null))
);
create table accordly.profiles (
  principal_id uuid primary key references accordly.principals(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  preferred_locale text not null default 'en' check (preferred_locale ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  updated_at timestamptz not null default clock_timestamp()
);
create table accordly.organizations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('individual','business')),
  name text not null check (length(btrim(name)) between 1 and 200),
  status text not null default 'active' check (status in ('active','suspended')),
  created_by uuid not null references accordly.principals(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp()
);
create table accordly.organization_memberships (
  organization_id uuid not null references accordly.organizations(id) on delete restrict,
  principal_id uuid not null references accordly.principals(id) on delete restrict,
  role text not null check (role in ('owner','admin','editor','viewer')),
  active boolean not null default true,
  authority_revision bigint not null default 1 check (authority_revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  primary key (organization_id, principal_id),
  check (active = (revoked_at is null))
);
create index memberships_actor_active on accordly.organization_memberships(principal_id,organization_id) where active;

create table accordly.agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references accordly.organizations(id) on delete restrict,
  created_by uuid not null references accordly.principals(id) on delete restrict,
  title text not null check (length(btrim(title)) between 1 and 300),
  lifecycle text not null default 'preparing' check (lifecycle in ('preparing','awaiting_signatures','active')),
  effective_version_id uuid,
  pending_initial_proposal_id uuid,
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,id),
  check ((lifecycle = 'active') = (effective_version_id is not null)),
  check ((lifecycle = 'awaiting_signatures') = (pending_initial_proposal_id is not null))
);
create index agreements_tenant on accordly.agreements(organization_id,created_at,id);
create index agreements_creator on accordly.agreements(created_by);

create table accordly.agreement_parties (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, agreement_id uuid not null,
  side text not null check (side in ('provider','client')),
  legal_name text not null check (length(btrim(legal_name)) between 1 and 300),
  contact_email text not null check (length(contact_email) between 3 and 320 and position('@' in contact_email) > 1),
  created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,agreement_id,id), unique (agreement_id,side),
  foreign key (organization_id,agreement_id) references accordly.agreements(organization_id,id) on delete restrict
);
create table accordly.party_representatives (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, agreement_id uuid not null, party_id uuid not null,
  principal_id uuid references accordly.principals(id) on delete restrict,
  entered_email text not null check (length(entered_email) between 3 and 320),
  normalized_email text not null check (length(normalized_email) between 3 and 320),
  email_normalization_version integer not null default 1 check (email_normalization_version = 1),
  display_name text not null check (length(btrim(display_name)) between 1 and 200),
  authority_source text not null check (length(btrim(authority_source)) between 1 and 500),
  can_review boolean not null default true, can_propose boolean not null default false, can_sign boolean not null default false,
  authority_revision bigint not null default 1 check (authority_revision > 0),
  revoked_at timestamptz, created_at timestamptz not null default clock_timestamp(),
  unique (organization_id,agreement_id,id), unique (organization_id,agreement_id,party_id,id),
  foreign key (organization_id,agreement_id,party_id) references accordly.agreement_parties(organization_id,agreement_id,id) on delete restrict,
  check (not can_sign or (can_review and can_propose))
);
create index representatives_actor on accordly.party_representatives(principal_id,agreement_id,party_id) where revoked_at is null;
create index representatives_party on accordly.party_representatives(organization_id,agreement_id,party_id);

create table accordly.agreement_access_grants (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, agreement_id uuid not null,
  principal_id uuid not null references accordly.principals(id) on delete restrict,
  grant_type text not null check (grant_type in ('provider_read','provider_edit','provider_issue','client_review')),
  issued_by uuid not null references accordly.principals(id) on delete restrict,
  issued_at timestamptz not null default clock_timestamp(), expires_at timestamptz, revoked_at timestamptz,
  foreign key (organization_id,agreement_id) references accordly.agreements(organization_id,id) on delete restrict,
  check (expires_at is null or expires_at > issued_at)
);
create unique index access_grants_unique_live on accordly.agreement_access_grants(agreement_id,principal_id,grant_type) where revoked_at is null;
create index access_grants_actor on accordly.agreement_access_grants(principal_id,agreement_id) where revoked_at is null;
create index access_grants_tenant on accordly.agreement_access_grants(organization_id,agreement_id);
create index access_grants_issuer on accordly.agreement_access_grants(issued_by);

create table accordly.agreement_drafts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, agreement_id uuid not null,
  kind text not null check (kind in ('initial','amendment')), base_version_id uuid,
  author_principal_id uuid not null references accordly.principals(id) on delete restrict,
  author_party_id uuid, author_representative_id uuid,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 1048576),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id,agreement_id,id),
  foreign key (organization_id,agreement_id) references accordly.agreements(organization_id,id) on delete restrict,
  foreign key (organization_id,agreement_id,author_party_id,author_representative_id) references accordly.party_representatives(organization_id,agreement_id,party_id,id) on delete restrict,
  check ((kind = 'initial' and base_version_id is null) or (kind = 'amendment' and base_version_id is not null and author_party_id is not null and author_representative_id is not null)),
  check ((author_party_id is null) = (author_representative_id is null))
);
create unique index drafts_initial on accordly.agreement_drafts(agreement_id) where kind = 'initial';
create index drafts_scope on accordly.agreement_drafts(organization_id,agreement_id);
create index drafts_author on accordly.agreement_drafts(author_principal_id);

-- These are immutable candidate foundations, NOT an issuance/signature API.
create table accordly.agreement_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, agreement_id uuid not null,
  version_number bigint not null check (version_number > 0), kind text not null check (kind in ('initial','amendment')), parent_version_id uuid,
  origin_draft_id uuid not null, origin_draft_revision bigint not null check (origin_draft_revision > 0),
  schema_version integer not null default 1 check (schema_version = 1), canonicalization_version integer not null default 1 check (canonicalization_version = 1),
  canonical_bytes bytea not null check (octet_length(canonical_bytes) between 2 and 1048576),
  digest bytea generated always as (sha256(canonical_bytes)) stored,
  digest_algorithm text not null default 'SHA-256' check (digest_algorithm = 'SHA-256'),
  amount_minor bigint not null check (amount_minor between 1 and 9000000000000000),
  currency_code text not null references accordly.currencies(code) on delete restrict,
  currency_exponent smallint not null check (currency_exponent between 0 and 4),
  content_language text not null check (content_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  deadline_date date, deadline_at timestamptz, deadline_timezone text,
  created_at timestamptz not null default clock_timestamp(), frozen_at timestamptz not null default clock_timestamp(),
  unique (organization_id,agreement_id,id), unique (agreement_id,version_number),
  foreign key (organization_id,agreement_id) references accordly.agreements(organization_id,id) on delete restrict,
  foreign key (organization_id,agreement_id,origin_draft_id) references accordly.agreement_drafts(organization_id,agreement_id,id) on delete restrict,
  foreign key (organization_id,agreement_id,parent_version_id) references accordly.agreement_versions(organization_id,agreement_id,id) on delete restrict,
  check ((kind = 'initial') = (parent_version_id is null)), check (parent_version_id is distinct from id),
  check ((deadline_date is not null and deadline_at is null and deadline_timezone is null) or (deadline_date is null and deadline_at is not null and deadline_timezone is not null))
);
create index versions_scope on accordly.agreement_versions(organization_id,agreement_id,version_number desc);
create index versions_origin on accordly.agreement_versions(organization_id,agreement_id,origin_draft_id);
create index versions_parent on accordly.agreement_versions(organization_id,agreement_id,parent_version_id);
create index versions_currency on accordly.agreement_versions(currency_code);
alter table accordly.agreement_drafts add foreign key (organization_id,agreement_id,base_version_id) references accordly.agreement_versions(organization_id,agreement_id,id) on delete restrict;
create index drafts_base on accordly.agreement_drafts(organization_id,agreement_id,base_version_id);

create table accordly.version_milestones (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, agreement_id uuid not null, version_id uuid not null,
  ordinal integer not null check (ordinal > 0), description text not null check (length(btrim(description)) between 1 and 10000),
  amount_minor bigint not null check (amount_minor between 0 and 9000000000000000),
  deadline_date date, deadline_at timestamptz, deadline_timezone text,
  acceptance_terms text not null check (length(acceptance_terms) <= 20000),
  unique (version_id,ordinal),
  foreign key (organization_id,agreement_id,version_id) references accordly.agreement_versions(organization_id,agreement_id,id) on delete restrict,
  check ((deadline_date is not null and deadline_at is null and deadline_timezone is null) or (deadline_date is null and deadline_at is not null and deadline_timezone is not null))
);
create index milestones_scope on accordly.version_milestones(organization_id,agreement_id,version_id);

create table accordly.agreement_proposals (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, agreement_id uuid not null,
  kind text not null check (kind in ('initial','amendment')), candidate_version_id uuid not null unique, base_version_id uuid,
  proposer_principal_id uuid not null references accordly.principals(id) on delete restrict, proposer_party_id uuid not null,
  state text not null default 'pending' check (state in ('pending','effective','rejected','withdrawn','expired','superseded')),
  submitted_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null, terminal_at timestamptz,
  explanation text not null default '' check (length(explanation) <= 20000), frozen_diff jsonb not null default '{}' check (octet_length(frozen_diff::text) <= 1048576),
  unique (organization_id,agreement_id,id), unique (organization_id,agreement_id,id,candidate_version_id),
  foreign key (organization_id,agreement_id) references accordly.agreements(organization_id,id) on delete restrict,
  foreign key (organization_id,agreement_id,candidate_version_id) references accordly.agreement_versions(organization_id,agreement_id,id) on delete restrict,
  foreign key (organization_id,agreement_id,base_version_id) references accordly.agreement_versions(organization_id,agreement_id,id) on delete restrict,
  foreign key (organization_id,agreement_id,proposer_party_id) references accordly.agreement_parties(organization_id,agreement_id,id) on delete restrict,
  check ((kind = 'initial') = (base_version_id is null)),
  check (expires_at > submitted_at and expires_at <= submitted_at + interval '7 days'),
  check ((state = 'pending') = (terminal_at is null)), check (terminal_at is null or terminal_at >= submitted_at),
  check (kind <> 'initial' or state <> 'superseded')
);
create unique index proposal_initial_pending on accordly.agreement_proposals(agreement_id) where kind = 'initial' and state = 'pending';
create index proposals_scope on accordly.agreement_proposals(organization_id,agreement_id,state,base_version_id);
create index proposals_party on accordly.agreement_proposals(organization_id,agreement_id,proposer_party_id);
create index proposals_actor on accordly.agreement_proposals(proposer_principal_id);
create index proposals_base on accordly.agreement_proposals(organization_id,agreement_id,base_version_id);
alter table accordly.agreements add foreign key (organization_id,id,effective_version_id) references accordly.agreement_versions(organization_id,agreement_id,id) on delete restrict deferrable initially deferred;
alter table accordly.agreements add foreign key (organization_id,id,pending_initial_proposal_id) references accordly.agreement_proposals(organization_id,agreement_id,id) on delete restrict deferrable initially deferred;

create table accordly.proposal_participants (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, agreement_id uuid not null, proposal_id uuid not null, version_id uuid not null,
  party_id uuid not null, representative_id uuid not null,
  expected_email text not null check (length(expected_email) between 3 and 320),
  identity_snapshot jsonb not null check (jsonb_typeof(identity_snapshot) = 'object' and octet_length(identity_snapshot::text) <= 20000),
  consent_text text not null check (length(btrim(consent_text)) between 1 and 20000), disclosure_version text not null check (length(disclosure_version) between 1 and 100),
  content_language text not null check (content_language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  unique (proposal_id,representative_id), unique (organization_id,agreement_id,proposal_id,id),
  foreign key (organization_id,agreement_id,proposal_id,version_id) references accordly.agreement_proposals(organization_id,agreement_id,id,candidate_version_id) on delete restrict,
  foreign key (organization_id,agreement_id,party_id,representative_id) references accordly.party_representatives(organization_id,agreement_id,party_id,id) on delete restrict
);
create index participants_scope on accordly.proposal_participants(organization_id,agreement_id,proposal_id,party_id);
create index participants_rep on accordly.proposal_participants(organization_id,agreement_id,party_id,representative_id);

create table accordly.document_artifacts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, agreement_id uuid not null, version_id uuid,
  kind text not null check (kind in ('attachment','signed_render','translation')),
  bucket_id text not null check (length(bucket_id) between 1 and 100), object_path text not null check (length(object_path) between 1 and 1000),
  source_digest bytea check (octet_length(source_digest) = 32), object_digest bytea check (octet_length(object_digest) = 32),
  size_bytes bigint check (size_bytes between 1 and 52428800), mime_type text check (length(mime_type) between 1 and 200),
  template_version text, content_language text,
  state text not null default 'quarantined' check (state in ('quarantined','verified','sealed','failed')),
  created_at timestamptz not null default clock_timestamp(), sealed_at timestamptz, retention_hold boolean not null default false,
  unique (organization_id,agreement_id,id), unique (bucket_id,object_path),
  foreign key (organization_id,agreement_id) references accordly.agreements(organization_id,id) on delete restrict,
  foreign key (organization_id,agreement_id,version_id) references accordly.agreement_versions(organization_id,agreement_id,id) on delete restrict,
  check (kind = 'attachment' or (version_id is not null and source_digest is not null)),
  check ((state = 'sealed') = (sealed_at is not null)),
  check (state not in ('verified','sealed') or (object_digest is not null and size_bytes is not null and mime_type is not null))
);
create index artifacts_scope on accordly.document_artifacts(organization_id,agreement_id,version_id);
create index artifacts_reconcile on accordly.document_artifacts(state,created_at);

-- Organization bootstrap has no agreement yet: use a separate audit stream,
-- not a nullable/synthetic agreement in the agreement-specific audit table.
create table accordly.organization_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references accordly.organizations(id) on delete restrict,
  actor_principal_id uuid not null references accordly.principals(id) on delete restrict,
  event_type text not null check (event_type in ('organization_created','membership_changed','agreement_created')),
  subject_principal_id uuid references accordly.principals(id) on delete restrict,
  agreement_id uuid, occurred_at timestamptz not null default clock_timestamp(),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 2000),
  foreign key (organization_id,agreement_id) references accordly.agreements(organization_id,id) on delete restrict
);
create index organization_events_scope on accordly.organization_events(organization_id,occurred_at,id);
create index organization_events_actor on accordly.organization_events(actor_principal_id);
create index organization_events_subject on accordly.organization_events(subject_principal_id);
create index organizations_creator on accordly.organizations(created_by);
create index memberships_principal on accordly.organization_memberships(principal_id);
create index representatives_principal_all on accordly.party_representatives(principal_id);
create index grants_principal_all on accordly.agreement_access_grants(principal_id);
create index drafts_author_rep on accordly.agreement_drafts(organization_id,agreement_id,author_party_id,author_representative_id);
create index organization_events_agreement on accordly.organization_events(organization_id,agreement_id);

do $owners$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'accordly' loop
    execute format('alter table accordly.%I owner to accordly_owner',t.tablename);
    execute format('revoke all on accordly.%I from public,anon,authenticated,service_role',t.tablename);
  end loop;
end $owners$;
-- Objects created in later migrations must also have explicit function ACLs.
alter default privileges in schema accordly revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema accordly_commands revoke execute on functions from public, anon, authenticated, service_role;
commit;
