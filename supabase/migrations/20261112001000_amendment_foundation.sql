-- Stage 2A: additive amendment model; original versions/decisions remain immutable.
begin;
grant create on schema accordly_commands to accordly_signer,accordly_freezer,accordly_authorizer,accordly_integrity,accordly_executor;
set local role accordly_owner;
alter table accordly.agreement_versions drop constraint agreement_versions_schema_version_check;
alter table accordly.agreement_versions add check(schema_version in (1,2));
alter table accordly.invitations drop constraint invitations_purpose_check;
alter table accordly.invitations add check(purpose in ('initial_signing','amendment_approval','agreement_access'));
alter table accordly.email_challenges drop constraint email_challenges_purpose_check;
alter table accordly.email_challenges add check(purpose in ('access','initial_signature','amendment_approval','amendment_rejection'));
alter table accordly.email_challenges add column proposal_id uuid,add column version_id uuid,add column version_digest bytea;
-- One-time backfill uses the migration administrator: FORCE RLS deliberately
-- denies the NOLOGIN table owner access to existing credential rows.
reset role;
update accordly.email_challenges c set proposal_id=i.proposal_id,version_id=s.version_id,version_digest=v.digest
 from accordly.invitations i join accordly.proposal_participants s on s.id=i.slot_id join accordly.agreement_versions v on v.id=s.version_id
 where c.invitation_id=i.id and c.purpose<>'access';
set local role accordly_owner;
alter table accordly.email_challenges add foreign key(organization_id,agreement_id,proposal_id,version_id) references accordly.agreement_proposals(organization_id,agreement_id,id,candidate_version_id);
alter table accordly.email_challenges add check((purpose='access' and proposal_id is null and version_id is null and version_digest is null) or (purpose<>'access' and proposal_id is not null and version_id is not null and octet_length(version_digest)=32));
create trigger fixed_challenge_target before update on accordly.email_challenges for each row execute function accordly_commands.prevent_identity_change('proposal_id','version_id','version_digest');
alter table accordly.verification_proofs drop constraint verification_proofs_action_check;
alter table accordly.verification_proofs add check(action in ('initial_signature','amendment_approval','amendment_rejection'));
alter table accordly.consent_decisions drop constraint consent_decisions_decision_check;
alter table accordly.consent_decisions drop constraint consent_decisions_action_check;
alter table accordly.consent_decisions drop constraint consent_decisions_affirmative_check;
alter table accordly.consent_decisions alter column typed_name drop not null;
alter table accordly.consent_decisions add check(decision in ('approve','reject'));
alter table accordly.consent_decisions add check(action in ('initial_signature','amendment_approval'));
alter table accordly.consent_decisions add check((decision='approve' and affirmative and typed_name is not null) or (decision='reject' and not affirmative and typed_name is null and action='amendment_approval'));

alter table accordly.command_receipts drop constraint command_receipts_operation_check;
alter table accordly.command_receipts add check(operation in ('create_draft','update_draft','set_parties','set_access','freeze','invite','revoke_invitation','verify_access','verify_consent','initial_signature','invite_access','invite_amendment','amendment_create','amendment_save','amendment_submit','amendment_revisions','amendment_withdraw','amendment_approval','amendment_reject'));
alter table accordly.audit_events drop constraint audit_events_event_type_check;
alter table accordly.audit_events add check(event_type in ('create_draft','update_draft','set_parties','set_access','freeze','invite','revoke_invitation','verify_access','verify_consent','initial_signature','invite_access','invite_amendment','amendment_create','amendment_save','amendment_submit','amendment_revisions','amendment_withdraw','amendment_approval','amendment_reject'));
alter table accordly.outbox_events drop constraint outbox_events_event_type_check;
alter table accordly.outbox_events add check(event_type in ('proposal_frozen','initial_signature_recorded','amendment_recorded'));

-- Feedback is an immutable negotiation record, not a second proposal state machine.
create table accordly.proposal_feedback (
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,agreement_id uuid not null,proposal_id uuid not null,slot_id uuid not null,
 actor_principal_id uuid not null references accordly.principals(id),actor_name text not null check(length(actor_name) between 1 and 200),
 kind text not null check(kind in ('revision_requested','rejected','withdrawn')),reason text not null check(length(btrim(reason)) between 1 and 2000),
 receipt_id uuid not null,occurred_at timestamptz not null default clock_timestamp(),
 foreign key(organization_id,agreement_id,proposal_id,slot_id) references accordly.proposal_participants(organization_id,agreement_id,proposal_id,id),
 foreign key(organization_id,agreement_id,receipt_id) references accordly.command_receipts(organization_id,agreement_id,id) deferrable initially deferred
);
create index feedback_scope on accordly.proposal_feedback(organization_id,agreement_id,proposal_id,occurred_at);
alter table accordly.proposal_feedback enable row level security;
alter table accordly.proposal_feedback force row level security;
revoke all on accordly.proposal_feedback from public,anon,authenticated,service_role,accordly_gateway;
create policy feedback_scope on accordly.proposal_feedback to accordly_signer using(accordly_commands.signing_scope(organization_id,agreement_id)) with check(accordly_commands.signing_scope(organization_id,agreement_id));
create policy integrity_validation on accordly.proposal_feedback for select to accordly_integrity using(true);
create trigger append_only before update or delete or truncate on accordly.proposal_feedback for each statement execute function accordly_commands.deny_history_mutation();
grant select,insert on accordly.proposal_feedback to accordly_signer;
grant select on accordly.proposal_feedback to accordly_integrity;

create policy amendment_author on accordly.agreement_drafts to accordly_signer using(kind='amendment' and author_principal_id=accordly_commands.actor_id() and accordly_commands.signing_scope(organization_id,agreement_id)) with check(kind='amendment' and author_principal_id=accordly_commands.actor_id() and accordly_commands.signing_scope(organization_id,agreement_id));
grant select,insert on accordly.agreement_drafts to accordly_signer;
grant update(payload,revision,updated_at) on accordly.agreement_drafts to accordly_signer;
create function accordly_commands.protect_submitted_draft() returns trigger language plpgsql security definer set search_path='' as $$ begin
 if exists(select 1 from accordly.agreement_versions where origin_draft_id=old.id) then raise exception using errcode='23514',message='Submitted draft cannot be changed'; end if; return new;
end $$;
create trigger submitted_draft before update on accordly.agreement_drafts for each row execute function accordly_commands.protect_submitted_draft();
create trigger fixed_draft_base before update on accordly.agreement_drafts for each row execute function accordly_commands.prevent_identity_change('kind','base_version_id');
do $$ declare t text; begin
 foreach t in array array['agreements','agreement_parties','party_representatives','agreement_versions','version_milestones','agreement_proposals','proposal_participants','agreement_drafts'] loop
   execute format('create policy amendment_freezer_read on accordly.%I for select to accordly_freezer using(accordly_commands.signing_scope(organization_id,%I))',t,case when t='agreements' then 'id' else 'agreement_id' end);
 end loop;
 foreach t in array array['agreement_versions','version_milestones','agreement_proposals','proposal_participants'] loop
   execute format('create policy amendment_freezer_insert on accordly.%I for insert to accordly_freezer with check(accordly_commands.signing_scope(organization_id,agreement_id))',t);
 end loop;
end $$;

create function accordly_commands.principal_active(p_principal uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from accordly.principals where id=p_principal and status='active') $$;

-- A capability must pass the same stored-source/identity/expiry/authority checks
-- as signing. The static server route chooses session vs registered access.
create function accordly_commands.amendment_actor(p_auth uuid,p_email text,p_auth_session uuid,p_agreement uuid,p_internal jsonb,p_write boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; actor uuid; source jsonb; sess accordly.guest_sessions; inv accordly.invitations; rep accordly.party_representatives; a accordly.agreements; slot accordly.proposal_participants; registered boolean:=false; begin
 if p_internal->>'use_session'='true' then
   source:=accordly_commands.resolve_signing_credential('session',(p_internal->>'session_id')::uuid);
   if source is null or source->>'agreement_id' is distinct from p_agreement::text then raise exception using errcode='42501',message='Verified agreement capability required'; end if;
   org:=(source->>'organization_id')::uuid;
 else org:=accordly_commands.authorize_operation(p_auth,'read',p_agreement); actor:=accordly_commands.set_registered_actor(p_auth); registered:=true; end if;
 perform set_config('accordly.signing_org',org::text,true); perform set_config('accordly.signing_agreement',p_agreement::text,true);
 perform 1 from accordly.organizations where id=org and (not p_write or status='active') for share;
 if not found then raise exception using errcode='42501',message='Organization unavailable'; end if;
 select * into a from accordly.agreements where organization_id=org and id=p_agreement for update;
 if not found then raise exception using errcode='P4040',message='Agreement unavailable'; end if;
 if a.lifecycle<>'active' then raise exception using errcode='P4090',message='An active agreement is required'; end if;
 if not registered then
   select * into sess from accordly.guest_sessions where id=(p_internal->>'session_id')::uuid for update;
   select * into inv from accordly.invitations where id=sess.invitation_id for update;
   select * into rep from accordly.party_representatives where id=sess.representative_id for update;
   if sess.id is null or inv.id is null or rep.id is null or sess.secret_digest is distinct from decode(p_internal->>'session_digest','hex') or sess.revoked_at is not null or sess.expires_at<=clock_timestamp() or sess.last_seen_at+interval '30 minutes'<=clock_timestamp() or inv.revoked_at is not null or inv.consumed_at is null or inv.expires_at<=clock_timestamp() or rep.authority_revision<>sess.authority_revision or rep.principal_id is distinct from sess.principal_id then raise exception using errcode='42501',message='Capability expired or revoked'; end if;
   actor:=sess.principal_id;
 else
   select r.* into rep from accordly.party_representatives r join accordly.proposal_participants s on s.representative_id=r.id join accordly.agreement_proposals p on p.id=s.proposal_id
    where p.candidate_version_id=a.effective_version_id and r.principal_id=actor and r.revoked_at is null order by r.id limit 1 for update of r;
 end if;
 perform set_config('accordly.signing_principal',actor::text,true); perform set_config('accordly.actor_id',actor::text,true);
 if not accordly_commands.principal_active(actor) then raise exception using errcode='42501',message='Principal unavailable'; end if;
 if rep.id is not null then
   select s.* into slot from accordly.proposal_participants s join accordly.agreement_proposals p on p.id=s.proposal_id where p.candidate_version_id=a.effective_version_id and s.representative_id=rep.id;
   if slot.id is null or rep.revoked_at is not null or not rep.can_review or rep.normalized_email<>slot.expected_email then raise exception using errcode='42501',message='Current required authority unavailable'; end if;
   if exists(select 1 from accordly.agreement_parties where id=rep.party_id and side='provider') or exists(select 1 from accordly.principals where id=actor and kind='registered') then
     if p_auth is null or p_auth_session is null or p_email is distinct from slot.expected_email or accordly_commands.set_registered_actor(p_auth) is distinct from actor or (sess.auth_session_id is not null and sess.auth_session_id is distinct from p_auth_session) then raise exception using errcode='42501',message='Live registered identity required'; end if;
     if exists(select 1 from accordly.agreement_parties where id=rep.party_id and side='provider') and accordly_commands.target_org_role(org,actor) is null then raise exception using errcode='42501',message='Active provider membership required'; end if;
     perform set_config('accordly.actor_id',actor::text,true);
   end if;
 end if;
 if p_write and (rep.id is null or not rep.can_propose or not rep.can_sign) then raise exception using errcode='42501',message='Designated party proposal authority required'; end if;
 if sess.id is not null then update accordly.guest_sessions set last_seen_at=clock_timestamp() where id=sess.id; end if;
 return jsonb_build_object('organization_id',org,'agreement_id',a.id,'effective_version_id',a.effective_version_id,'actor_id',actor,'representative_id',rep.id,'party_id',rep.party_id,'actor_name',rep.display_name,'can_propose',coalesce(rep.can_propose and rep.can_sign,false));
end $$;

reset role;
alter function accordly_commands.principal_active(uuid) owner to accordly_authorizer;
alter function accordly_commands.amendment_actor(uuid,text,uuid,uuid,jsonb,boolean) owner to accordly_signer;
alter function accordly_commands.protect_submitted_draft() owner to accordly_integrity;
grant select on accordly.agreement_drafts,accordly.agreement_proposals,accordly.proposal_participants to accordly_freezer;
grant execute on function accordly_commands.signing_scope(uuid,uuid),accordly_commands.principal_active(uuid) to accordly_freezer,accordly_signer,accordly_integrity;
grant execute on function accordly_commands.actor_id() to accordly_signer;
revoke all on function accordly_commands.amendment_actor(uuid,text,uuid,uuid,jsonb,boolean),accordly_commands.principal_active(uuid),accordly_commands.protect_submitted_draft() from public,anon,authenticated,service_role,accordly_gateway;
commit;
