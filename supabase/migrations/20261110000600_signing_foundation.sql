-- Initial signing only. Gateway assertions remain a trusted server boundary.
begin;
do $$ declare n text; r record; begin
  foreach n in array array['accordly_signer','accordly_credentials'] loop
    select * into r from pg_roles where rolname=n;
    if found then
      if r.rolcanlogin or r.rolsuper or r.rolinherit or r.rolbypassrls or r.rolcreatedb or r.rolcreaterole or r.rolreplication or exists(select 1 from pg_auth_members where member=r.oid) or exists(select 1 from pg_auth_members m join pg_roles p on p.oid=m.member where m.roleid=r.oid and p.rolname<>current_user) then raise exception 'Unsafe signing role'; end if;
    else execute format('create role %I nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication',n); end if;
    execute format('grant %I to %I',n,current_user);
  end loop;
end $$;
grant usage on schema accordly,accordly_commands to accordly_signer,accordly_credentials;
grant create on schema accordly_commands to accordly_signer,accordly_credentials;
set local role accordly_owner;

create table accordly.invitations (
 id uuid primary key, organization_id uuid not null, agreement_id uuid not null, proposal_id uuid not null, slot_id uuid not null,
 intended_email text not null check(length(intended_email) between 3 and 320), purpose text not null default 'initial_signing' check(purpose='initial_signing'),
 token_digest bytea not null unique check(octet_length(token_digest)=32), hash_version integer not null default 1 check(hash_version=1),
 issued_by uuid not null references accordly.principals(id), issued_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 consumed_at timestamptz, revoked_at timestamptz,
 unique(organization_id,agreement_id,id),
 foreign key(organization_id,agreement_id,proposal_id,slot_id) references accordly.proposal_participants(organization_id,agreement_id,proposal_id,id),
 check(expires_at>issued_at and expires_at<=issued_at+interval '72 hours')
);
create index invitation_slot on accordly.invitations(organization_id,agreement_id,slot_id);
create index invitation_expiry on accordly.invitations(expires_at);
create table accordly.guest_sessions (
 id uuid primary key, organization_id uuid not null, agreement_id uuid not null, invitation_id uuid not null,
 principal_id uuid not null references accordly.principals(id), representative_id uuid not null,
 secret_digest bytea not null unique check(octet_length(secret_digest)=32), authority_revision bigint not null,
 auth_session_id uuid, issued_at timestamptz not null default clock_timestamp(), last_seen_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null, revoked_at timestamptz,
 unique(organization_id,agreement_id,id),
 foreign key(organization_id,agreement_id,invitation_id) references accordly.invitations(organization_id,agreement_id,id),
 foreign key(organization_id,agreement_id,representative_id) references accordly.party_representatives(organization_id,agreement_id,id),
 check(expires_at>issued_at and expires_at<=issued_at+interval '12 hours')
);
create index session_scope on accordly.guest_sessions(organization_id,agreement_id,invitation_id);
create index session_expiry on accordly.guest_sessions(expires_at);
create index session_principal on accordly.guest_sessions(principal_id);
create table accordly.email_challenges (
 id uuid primary key, organization_id uuid not null, agreement_id uuid not null, invitation_id uuid not null, session_id uuid,
 purpose text not null check(purpose in ('access','initial_signature')),
 code_hmac bytea not null check(octet_length(code_hmac)=32), key_id text not null check(length(key_id) between 1 and 64),
 issued_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
 failed_attempts integer not null default 0 check(failed_attempts between 0 and 5), consumed_at timestamptz, revoked_at timestamptz,
 unique(organization_id,agreement_id,id),
 foreign key(organization_id,agreement_id,invitation_id) references accordly.invitations(organization_id,agreement_id,id),
 foreign key(organization_id,agreement_id,session_id) references accordly.guest_sessions(organization_id,agreement_id,id),
 check((purpose='access')=(session_id is null)), check(expires_at>issued_at and expires_at<=issued_at+interval '10 minutes')
);
create index challenges_scope on accordly.email_challenges(organization_id,agreement_id,invitation_id);
create index challenges_session on accordly.email_challenges(organization_id,agreement_id,session_id);
create index challenges_expiry on accordly.email_challenges(expires_at);
create table accordly.verification_proofs (
 id uuid primary key, organization_id uuid not null, agreement_id uuid not null, session_id uuid not null, challenge_id uuid not null unique,
 proposal_id uuid not null, version_id uuid not null, principal_id uuid not null references accordly.principals(id),
 version_digest bytea not null check(octet_length(version_digest)=32), action text not null default 'initial_signature' check(action='initial_signature'),
 secret_digest bytea not null unique check(octet_length(secret_digest)=32), verified_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null, consumed_at timestamptz, revoked_at timestamptz,
 unique(organization_id,agreement_id,id),
 foreign key(organization_id,agreement_id,session_id) references accordly.guest_sessions(organization_id,agreement_id,id),
 foreign key(organization_id,agreement_id,challenge_id) references accordly.email_challenges(organization_id,agreement_id,id),
 foreign key(organization_id,agreement_id,proposal_id,version_id) references accordly.agreement_proposals(organization_id,agreement_id,id,candidate_version_id),
 check(expires_at>verified_at and expires_at<=verified_at+interval '5 minutes')
);
create index proofs_scope on accordly.verification_proofs(organization_id,agreement_id,session_id);
create index proofs_proposal on accordly.verification_proofs(organization_id,agreement_id,proposal_id,version_id);
create index proofs_expiry on accordly.verification_proofs(expires_at);
create table accordly.consent_decisions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, agreement_id uuid not null, proposal_id uuid not null, version_id uuid not null,
 slot_id uuid not null, principal_id uuid not null references accordly.principals(id), proof_id uuid not null unique,
 receipt_id uuid not null, decision text not null check(decision='approve'), action text not null check(action='initial_signature'),
 version_digest bytea not null check(octet_length(version_digest)=32), typed_name text not null check(length(btrim(typed_name)) between 1 and 200),
 consent_text text not null, disclosure_version text not null, affirmative boolean not null check(affirmative),
 signed_at timestamptz not null default clock_timestamp(), evidence_bytes bytea not null check(octet_length(evidence_bytes) between 2 and 20000),
 evidence_digest bytea generated always as (sha256(evidence_bytes)) stored,
 unique(proposal_id,slot_id),
 foreign key(organization_id,agreement_id,proposal_id,slot_id) references accordly.proposal_participants(organization_id,agreement_id,proposal_id,id),
 foreign key(organization_id,agreement_id,proposal_id,version_id) references accordly.agreement_proposals(organization_id,agreement_id,id,candidate_version_id),
 foreign key(organization_id,agreement_id,proof_id) references accordly.verification_proofs(organization_id,agreement_id,id),
 foreign key(organization_id,agreement_id,receipt_id) references accordly.command_receipts(organization_id,agreement_id,id) deferrable initially deferred
);
create index decisions_scope on accordly.consent_decisions(organization_id,agreement_id,proposal_id);
create table accordly.abuse_counters (
 bucket text not null check(length(bucket) between 1 and 200), window_at timestamptz not null,
 count integer not null check(count>0), expires_at timestamptz not null, primary key(bucket,window_at)
);
create index abuse_expiry on accordly.abuse_counters(expires_at);

create function accordly_commands.signing_scope(p_org uuid,p_agreement uuid) returns boolean language sql stable set search_path='' as $$
 select p_org=nullif(current_setting('accordly.signing_org',true),'')::uuid and p_agreement=nullif(current_setting('accordly.signing_agreement',true),'')::uuid
$$;
do $$ declare t text; begin
 foreach t in array array['invitations','guest_sessions','email_challenges','verification_proofs','consent_decisions','abuse_counters'] loop
   execute format('alter table accordly.%I enable row level security',t);
   execute format('alter table accordly.%I force row level security',t);
   execute format('revoke all on accordly.%I from public,anon,authenticated,service_role,accordly_gateway',t);
   execute format('create policy integrity_validation on accordly.%I for select to accordly_integrity using(true)',t);
   if t<>'abuse_counters' then
     execute format('create policy signing_scope on accordly.%I to accordly_signer using(accordly_commands.signing_scope(organization_id,agreement_id)) with check(accordly_commands.signing_scope(organization_id,agreement_id))',t);
   end if;
 end loop;
 foreach t in array array['invitations','guest_sessions','email_challenges'] loop
   execute format('create policy credential_lookup on accordly.%I for select to accordly_credentials using(id=nullif(current_setting(''accordly.lookup_id'',true),'''')::uuid)',t);
 end loop;
 foreach t in array array['agreements','agreement_parties','party_representatives','agreement_versions','agreement_proposals','proposal_participants','command_receipts','audit_events','outbox_events'] loop
   execute format('create policy signing_scope on accordly.%I to accordly_signer using(accordly_commands.signing_scope(organization_id,%I)) with check(accordly_commands.signing_scope(organization_id,%I))',t,case when t='agreements' then 'id' else 'agreement_id' end,case when t='agreements' then 'id' else 'agreement_id' end);
 end loop;
end $$;
create policy signing_principal_read on accordly.principals for select to accordly_signer using(id=nullif(current_setting('accordly.signing_principal',true),'')::uuid);
create policy signing_principal_insert on accordly.principals for insert to accordly_signer with check(kind='guest' and status='active' and id=nullif(current_setting('accordly.signing_principal',true),'')::uuid);
create policy signing_org_read on accordly.organizations for select to accordly_signer using(id=nullif(current_setting('accordly.signing_org',true),'')::uuid);
create policy signing_org_lock on accordly.organizations for update to accordly_signer using(id=nullif(current_setting('accordly.signing_org',true),'')::uuid);
create policy abuse_bucket on accordly.abuse_counters to accordly_credentials using(bucket=current_setting('accordly.rate_bucket',true)) with check(bucket=current_setting('accordly.rate_bucket',true));
create trigger append_only before update or delete or truncate on accordly.consent_decisions for each statement execute function accordly_commands.deny_history_mutation();
create trigger fixed_identity before update on accordly.invitations for each row execute function accordly_commands.prevent_identity_change('id','organization_id','agreement_id','proposal_id','slot_id','intended_email','purpose','token_digest','issued_by','issued_at','expires_at');
create trigger fixed_identity before update on accordly.guest_sessions for each row execute function accordly_commands.prevent_identity_change('id','organization_id','agreement_id','invitation_id','principal_id','representative_id','secret_digest','authority_revision','auth_session_id','issued_at','expires_at');
create trigger fixed_identity before update on accordly.email_challenges for each row execute function accordly_commands.prevent_identity_change('id','organization_id','agreement_id','invitation_id','session_id','purpose','code_hmac','key_id');
create trigger fixed_identity before update on accordly.verification_proofs for each row execute function accordly_commands.prevent_identity_change('id','organization_id','agreement_id','session_id','challenge_id','proposal_id','version_id','principal_id','version_digest','action','secret_digest');

alter table accordly.command_receipts drop constraint command_receipts_operation_check;
alter table accordly.command_receipts add check(operation in ('create_draft','update_draft','set_parties','set_access','freeze','invite','revoke_invitation','verify_access','verify_consent','initial_signature'));
alter table accordly.audit_events drop constraint audit_events_event_type_check;
alter table accordly.audit_events add check(event_type in ('create_draft','update_draft','set_parties','set_access','freeze','invite','revoke_invitation','verify_access','verify_consent','initial_signature'));
alter table accordly.outbox_events drop constraint outbox_events_event_type_check;
alter table accordly.outbox_events add check(event_type in ('proposal_frozen','initial_signature_recorded'));

-- Only this internal lookup role sees one supplied credential locator, never documents.
create function accordly_commands.resolve_signing_credential(p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare r jsonb; begin
 perform set_config('accordly.lookup_id',p_id::text,true);
 if p_kind='invitation' then select to_jsonb(i) into r from accordly.invitations i where id=p_id;
 elsif p_kind='session' then select to_jsonb(s) into r from accordly.guest_sessions s where id=p_id;
 elsif p_kind='challenge' then select to_jsonb(c) into r from accordly.email_challenges c where id=p_id;
 end if;
 perform set_config('accordly.lookup_id','',true); return r;
end $$;

-- Counters commit in a separate short gateway transaction before any domain work.
-- The local-only deployment shares one conservative IP bucket; no forwarded header is trusted.
create function accordly_commands.signing_rate_limit(p_buckets text[],p_send boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare b text; n integer; lim integer; allowed boolean:=true; w timestamptz:=date_trunc('hour',clock_timestamp()); begin
 if cardinality(p_buckets) not between 1 and 6 then return false; end if;
 for b in select distinct unnest(p_buckets) order by 1 loop
   if length(b)>200 or b !~ '^(global|ip|recipient|invitation):[a-zA-Z0-9_-]+$' then return false; end if;
   lim:=case when b like 'recipient:%' or b like 'invitation:%' then 5 when b like 'ip:%' and p_send then 20 when p_send then 200 else 500 end;
   b:=case when p_send then 'send/' else 'request/' end||b;
   perform set_config('accordly.rate_bucket',b,true);
   insert into accordly.abuse_counters(bucket,window_at,count,expires_at) values(b,w,1,w+interval '2 hours')
     on conflict(bucket,window_at) do update set count=least(accordly.abuse_counters.count+1,1000000) returning count into n;
   allowed:=allowed and n<=lim;
 end loop;
 perform set_config('accordly.rate_bucket','',true); return allowed;
end $$;

-- Activation remains forbidden outside the dedicated signing command role.
create or replace function accordly_commands.workflow_boundary() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_table_name='agreements' then
   if (new.lifecycle='active' or new.effective_version_id is not null) and (tg_op='INSERT' or old.lifecycle is distinct from new.lifecycle or old.effective_version_id is distinct from new.effective_version_id) and current_user<>'accordly_signer' then raise exception using errcode='23514',message='Activation requires authorized signing'; end if;
   if tg_op='UPDATE' and old.lifecycle='active' and (new.lifecycle<>old.lifecycle or new.effective_version_id is distinct from old.effective_version_id) then raise exception using errcode='23514',message='Effective contract cannot be replaced'; end if;
 else
   if new.state='effective' and current_user<>'accordly_signer' then raise exception using errcode='23514',message='Effectiveness requires authorized signing'; end if;
   if tg_op='UPDATE' and (old.state<>'pending' or new.state='pending') and new is distinct from old then raise exception using errcode='23514',message='Terminal proposals cannot reopen and pending content cannot change'; end if;
 end if; return new;
end $$;
create function accordly_commands.validate_signing_activation() returns trigger language plpgsql security definer set search_path='' as $$
declare p accordly.agreement_proposals; a accordly.agreements; begin
 if tg_table_name='agreements' then select * into a from accordly.agreements where id=new.id;
 else select * into a from accordly.agreements where id=new.agreement_id; end if;
 if a.lifecycle<>'active' then return null; end if;
 select * into p from accordly.agreement_proposals where agreement_id=a.id and candidate_version_id=a.effective_version_id and state='effective' and kind='initial';
 if not found or a.pending_initial_proposal_id is not null or
    not exists(select 1 from accordly.proposal_participants where proposal_id=p.id) or
    exists(select 1 from accordly.proposal_participants s where s.proposal_id=p.id and not exists(
      select 1 from accordly.consent_decisions d join accordly.agreement_versions v on v.id=d.version_id
      join accordly.verification_proofs f on f.id=d.proof_id
      where d.proposal_id=p.id and d.slot_id=s.id and d.version_id=p.candidate_version_id and d.version_digest=v.digest
        and d.affirmative and d.consent_text=s.consent_text and d.disclosure_version=s.disclosure_version and f.consumed_at=d.signed_at
        and f.principal_id=d.principal_id and f.version_digest=d.version_digest and f.verified_at<=d.signed_at and f.expires_at>d.signed_at
    )) then raise exception using errcode='23514',message='Unanimous verified consent required'; end if;
 return null;
end $$;
create constraint trigger signing_activation after insert or update on accordly.agreements deferrable initially deferred for each row execute function accordly_commands.validate_signing_activation();
create constraint trigger signing_activation after insert or update on accordly.agreement_proposals deferrable initially deferred for each row execute function accordly_commands.validate_signing_activation();

reset role;
alter function accordly_commands.resolve_signing_credential(text,uuid) owner to accordly_credentials;
alter function accordly_commands.signing_rate_limit(text[],boolean) owner to accordly_credentials;
grant create on schema accordly_commands to accordly_integrity;
alter function accordly_commands.validate_signing_activation() owner to accordly_integrity;
revoke create on schema accordly_commands from accordly_integrity;
grant select on accordly.invitations,accordly.guest_sessions,accordly.email_challenges to accordly_credentials;
grant select,insert,update on accordly.abuse_counters to accordly_credentials;
grant select on accordly.invitations,accordly.guest_sessions,accordly.email_challenges,accordly.verification_proofs,accordly.consent_decisions,accordly.abuse_counters to accordly_integrity;
grant select,insert on accordly.principals to accordly_signer;
grant select on accordly.organizations,accordly.agreements,accordly.agreement_parties,accordly.party_representatives,accordly.agreement_versions,accordly.agreement_proposals,accordly.proposal_participants,accordly.command_receipts,accordly.audit_events to accordly_signer;
grant update(id) on accordly.organizations to accordly_signer;
grant update(lifecycle,effective_version_id,pending_initial_proposal_id,revision,updated_at) on accordly.agreements to accordly_signer;
grant update(state,terminal_at) on accordly.agreement_proposals to accordly_signer;
grant update(principal_id) on accordly.party_representatives to accordly_signer;
grant select,insert on accordly.invitations,accordly.guest_sessions,accordly.email_challenges,accordly.verification_proofs,accordly.consent_decisions,accordly.command_receipts,accordly.audit_events to accordly_signer;
grant insert on accordly.outbox_events to accordly_signer;
grant update(consumed_at,revoked_at) on accordly.invitations to accordly_signer;
grant update(last_seen_at,revoked_at) on accordly.guest_sessions to accordly_signer;
grant update(failed_attempts,consumed_at,revoked_at) on accordly.email_challenges to accordly_signer;
grant update(consumed_at,revoked_at) on accordly.verification_proofs to accordly_signer;
grant execute on function accordly_commands.signing_scope(uuid,uuid),accordly_commands.resolve_signing_credential(text,uuid),accordly_commands.set_registered_actor(uuid),accordly_commands.authorize_operation(uuid,text,uuid),accordly_commands.target_org_role(uuid,uuid),accordly_commands.canonical_json(jsonb),accordly_commands.assert_keys(jsonb,text[]),accordly_commands.require_text(jsonb,text,integer) to accordly_signer;
grant execute on function accordly_commands.signing_rate_limit(text[],boolean) to accordly_gateway;
revoke all on function accordly_commands.resolve_signing_credential(text,uuid),accordly_commands.signing_scope(uuid,uuid),accordly_commands.validate_signing_activation(),accordly_commands.signing_rate_limit(text[],boolean) from public,anon,authenticated,service_role;
commit;
