begin;
set local role accordly_owner;

create function accordly_commands.prevent_identity_change() returns trigger
language plpgsql set search_path = '' as $$
declare k text;
begin
  foreach k in array tg_argv loop
    if (to_jsonb(new)->k) is distinct from (to_jsonb(old)->k) then
      raise exception using errcode = '23514', message = 'Record identity and tenant ownership are immutable';
    end if;
  end loop;
  return new;
end $$;

create function accordly_commands.deny_history_mutation() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514', message = 'Frozen history is append-only';
end $$;

create function accordly_commands.validate_registered_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from accordly.principals p where p.id = new.principal_id and p.kind = 'registered' and (not new.active or p.status = 'active')) then
    raise exception using errcode = '23514', message = 'Organization members must be active registered principals';
  end if;
  if tg_op = 'UPDATE' then
    new.authority_revision := old.authority_revision + 1;
  end if;
  return new;
end $$;

create function accordly_commands.require_organization_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare org uuid;
begin
  org := coalesce(new.organization_id,old.organization_id);
  -- All membership commands take the organization lock before changing rows.
  perform 1 from accordly.organizations where id = org for update;
  if not exists (select 1 from accordly.organization_memberships where organization_id = org and active and role = 'owner') then
    raise exception using errcode = '23514', message = 'An organization must retain an active owner';
  end if;
  return null;
end $$;
create constraint trigger membership_requires_owner after insert or update or delete on accordly.organization_memberships
deferrable initially deferred for each row execute function accordly_commands.require_organization_owner();

create function accordly_commands.require_bootstrap_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from accordly.organization_memberships where organization_id = new.id and active and role = 'owner') then
    raise exception using errcode = '23514', message = 'Organization creation and owner membership must commit together';
  end if;
  return null;
end $$;
create constraint trigger organization_requires_owner after insert on accordly.organizations
deferrable initially deferred for each row execute function accordly_commands.require_bootstrap_owner();

create function accordly_commands.validate_version() returns trigger
language plpgsql security definer set search_path = '' as $$
declare body jsonb; exponent smallint;
begin
  if not (convert_from(new.canonical_bytes,'UTF8') is json object with unique keys) then
    raise exception using errcode = '23514', message = 'Snapshot must be a UTF-8 JSON object without duplicate keys';
  end if;
  body := convert_from(new.canonical_bytes,'UTF8')::jsonb;
  if jsonb_typeof(body->'amount_minor') is distinct from 'string' or body->>'amount_minor' !~ '^[1-9][0-9]*$' then
    raise exception using errcode = '23514', message = 'Money must be a decimal integer string in snapshots';
  end if;
  select c.minor_unit_exponent into exponent from accordly.currencies c where c.code = new.currency_code and c.enabled_for_issuance;
  if exponent is null or exponent <> new.currency_exponent then
    raise exception using errcode = '23514', message = 'Unsupported currency or exponent';
  end if;
  if body->>'amount_minor' is distinct from new.amount_minor::text
    or body->>'currency_code' is distinct from new.currency_code
    or body->>'currency_exponent' is distinct from new.currency_exponent::text
    or body->>'content_language' is distinct from new.content_language
    or body->>'agreement_id' is distinct from new.agreement_id::text
    or body->>'organization_id' is distinct from new.organization_id::text then
    raise exception using errcode = '23514', message = 'Snapshot fields and normalized projections disagree';
  end if;
  if new.deadline_timezone is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.deadline_timezone) then
    raise exception using errcode = '23514', message = 'Unknown deadline timezone';
  end if;
  return new;
end $$;
create trigger version_shape before insert on accordly.agreement_versions for each row execute function accordly_commands.validate_version();

create function accordly_commands.validate_milestone_totals() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v uuid; expected bigint; allocated numeric; entries bigint;
begin
  if tg_table_name = 'agreement_versions' then v := new.id; else v := new.version_id; end if;
  if new.deadline_timezone is not null and not exists (select 1 from pg_catalog.pg_timezone_names where name = new.deadline_timezone) then
    raise exception using errcode = '23514', message = 'Unknown deadline timezone';
  end if;
  select amount_minor into expected from accordly.agreement_versions where id = v;
  select count(*),sum(amount_minor) into entries,allocated from accordly.version_milestones where version_id = v;
  if entries > 0 and allocated <> expected then
    raise exception using errcode = '23514', message = 'Milestones must allocate the exact agreement total';
  end if;
  return null;
end $$;
create constraint trigger version_total after insert on accordly.agreement_versions deferrable initially deferred
for each row execute function accordly_commands.validate_milestone_totals();
create constraint trigger milestone_total after insert on accordly.version_milestones deferrable initially deferred
for each row execute function accordly_commands.validate_milestone_totals();

create function accordly_commands.check_agreement_graph() returns trigger
language plpgsql security definer set search_path = '' as $$
declare aid uuid; org uuid; a accordly.agreements; p accordly.agreement_proposals; version_kind text; parent uuid;
begin
  if tg_table_name = 'agreements' then aid := new.id; org := new.organization_id;
  else aid := new.agreement_id; org := new.organization_id;
  end if;
  select * into a from accordly.agreements where organization_id = org and id = aid;
  if a.lifecycle = 'awaiting_signatures' and not exists (
    select 1 from accordly.agreement_proposals where organization_id = org and agreement_id = aid and id = a.pending_initial_proposal_id and kind = 'initial' and state = 'pending'
  ) then raise exception using errcode = '23514', message = 'Pending initial pointer must target the current initial proposal'; end if;
  if exists (select 1 from accordly.agreement_proposals where organization_id = org and agreement_id = aid and kind = 'initial' and state = 'pending' and id is distinct from a.pending_initial_proposal_id) then
    raise exception using errcode = '23514', message = 'Initial proposal and agreement state disagree';
  end if;
  for p in select * from accordly.agreement_proposals where organization_id = org and agreement_id = aid loop
    select kind,parent_version_id into version_kind,parent from accordly.agreement_versions where organization_id = org and agreement_id = aid and id = p.candidate_version_id;
    if p.kind is distinct from version_kind or p.base_version_id is distinct from parent then
      raise exception using errcode = '23514', message = 'Proposal and candidate base/kind disagree';
    end if;
    if not exists (select 1 from accordly.proposal_participants s join accordly.agreement_parties party on party.id = s.party_id where s.proposal_id = p.id and party.side = 'provider')
      or not exists (select 1 from accordly.proposal_participants s join accordly.agreement_parties party on party.id = s.party_id where s.proposal_id = p.id and party.side = 'client') then
      raise exception using errcode = '23514', message = 'A frozen proposal requires representatives of both parties';
    end if;
  end loop;
  return null;
end $$;
create constraint trigger agreement_graph after insert or update on accordly.agreements deferrable initially deferred
for each row execute function accordly_commands.check_agreement_graph();
create constraint trigger proposal_graph after insert or update on accordly.agreement_proposals deferrable initially deferred
for each row execute function accordly_commands.check_agreement_graph();

create function accordly_commands.workflow_boundary() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'agreements' then
    if new.lifecycle = 'active' or new.effective_version_id is not null then
      raise exception using errcode = '23514', message = 'Activation requires a future reviewed signing migration';
    end if;
    if tg_op = 'UPDATE' and old.lifecycle = 'active' and new.lifecycle <> old.lifecycle then
      raise exception using errcode = '23514', message = 'Active agreements cannot return to preparation';
    end if;
  else
    if new.state = 'effective' then
      raise exception using errcode = '23514', message = 'Effectiveness requires a future reviewed signing migration';
    end if;
    if tg_op = 'UPDATE' and (old.state <> 'pending' or new.state = 'pending') and new is distinct from old then
      raise exception using errcode = '23514', message = 'Terminal proposals cannot reopen and pending content cannot change';
    end if;
  end if;
  return new;
end $$;
create trigger agreement_workflow before insert or update on accordly.agreements for each row execute function accordly_commands.workflow_boundary();
create trigger proposal_workflow before insert or update on accordly.agreement_proposals for each row execute function accordly_commands.workflow_boundary();

do $triggers$
declare t text;
begin
  foreach t in array array['organizations','organization_memberships','agreements','agreement_access_grants','agreement_parties','party_representatives','agreement_drafts','agreement_proposals','document_artifacts'] loop
    execute format('create trigger fixed_identity before update on accordly.%I for each row execute function accordly_commands.prevent_identity_change(''id'',''organization_id'',''agreement_id'')',t);
  end loop;
  foreach t in array array['agreement_versions','version_milestones','proposal_participants','organization_events'] loop
    execute format('create trigger append_only before update or delete or truncate on accordly.%I for each statement execute function accordly_commands.deny_history_mutation()',t);
  end loop;
end $triggers$;
create trigger fixed_member_principal before update on accordly.organization_memberships for each row execute function accordly_commands.prevent_identity_change('principal_id');
create trigger fixed_agreement_creator before update on accordly.agreements for each row execute function accordly_commands.prevent_identity_change('created_by');
create trigger fixed_draft_author before update on accordly.agreement_drafts for each row execute function accordly_commands.prevent_identity_change('author_principal_id','author_party_id','author_representative_id');
create trigger frozen_proposal_content before update on accordly.agreement_proposals for each row execute function accordly_commands.prevent_identity_change('kind','candidate_version_id','base_version_id','proposer_principal_id','proposer_party_id','submitted_at','expires_at','explanation','frozen_diff');
create trigger registered_member before insert or update on accordly.organization_memberships for each row execute function accordly_commands.validate_registered_membership();

reset role;
grant create on schema accordly_commands to accordly_integrity;
alter function accordly_commands.validate_registered_membership() owner to accordly_integrity;
alter function accordly_commands.require_organization_owner() owner to accordly_integrity;
alter function accordly_commands.require_bootstrap_owner() owner to accordly_integrity;
alter function accordly_commands.validate_version() owner to accordly_integrity;
alter function accordly_commands.validate_milestone_totals() owner to accordly_integrity;
alter function accordly_commands.check_agreement_graph() owner to accordly_integrity;
revoke create on schema accordly_commands from accordly_integrity;
commit;
