begin;
set local role accordly_owner;
create or replace function accordly_commands.workflow_boundary() returns trigger language plpgsql set search_path='' as $$ begin
 if tg_table_name='agreements' then
   if (new.lifecycle='active' or new.effective_version_id is not null) and (tg_op='INSERT' or old.lifecycle is distinct from new.lifecycle or old.effective_version_id is distinct from new.effective_version_id) and current_user<>'accordly_signer' then raise exception using errcode='23514',message='Activation requires authorized signing'; end if;
   if tg_op='UPDATE' and old.lifecycle='active' then
     if new.lifecycle<>old.lifecycle then raise exception using errcode='23514',message='Active agreements cannot return to preparation'; end if;
     if new.effective_version_id is distinct from old.effective_version_id and not exists(select 1 from accordly.agreement_proposals where agreement_id=old.id and candidate_version_id=new.effective_version_id and kind='amendment' and state='effective' and base_version_id=old.effective_version_id) then raise exception using errcode='23514',message='Effective amendments must extend the current base'; end if;
   end if;
 else
   if new.state='effective' and current_user<>'accordly_signer' then raise exception using errcode='23514',message='Effectiveness requires authorized signing'; end if;
   if tg_op='UPDATE' and (old.state<>'pending' or new.state='pending') and new is distinct from old then raise exception using errcode='23514',message='Terminal proposals cannot reopen and pending content cannot change'; end if;
 end if; return new;
end $$;
reset role;
set local role accordly_integrity;
create or replace function accordly_commands.validate_signing_activation() returns trigger language plpgsql security definer set search_path='' as $$
declare p accordly.agreement_proposals; a accordly.agreements; begin
 if tg_table_name='agreements' then select * into a from accordly.agreements where id=new.id;
 else select * into a from accordly.agreements where id=new.agreement_id; end if;
 if a.lifecycle<>'active' then return null; end if;
 if a.pending_initial_proposal_id is not null or not exists(select 1 from accordly.agreement_proposals where agreement_id=a.id and candidate_version_id=a.effective_version_id and state='effective') then raise exception using errcode='23514',message='Effective pointer requires an approved proposal'; end if;
 for p in select * from accordly.agreement_proposals where agreement_id=a.id and state='effective' loop
   if not exists(select 1 from accordly.proposal_participants where proposal_id=p.id) or exists(
    select 1 from accordly.proposal_participants s where s.proposal_id=p.id and not exists(
      select 1 from accordly.consent_decisions d join accordly.agreement_versions v on v.id=d.version_id join accordly.verification_proofs f on f.id=d.proof_id
      where d.proposal_id=p.id and d.slot_id=s.id and d.version_id=p.candidate_version_id and d.version_digest=v.digest and d.decision='approve'
       and d.affirmative and d.consent_text=s.consent_text and d.disclosure_version=s.disclosure_version and f.consumed_at=d.signed_at
       and f.principal_id=d.principal_id and f.version_digest=d.version_digest and f.proposal_id=p.id and f.version_id=v.id and f.revoked_at is null
       and f.action=case when p.kind='initial' then 'initial_signature' else 'amendment_approval' end
       and f.verified_at<=d.signed_at and f.expires_at>d.signed_at
    )) then raise exception using errcode='23514',message='Unanimous verified consent required'; end if;
 end loop;
 return null;
end $$;
reset role;
-- Only the projection columns needed by the provider UI; raw evidence stays private.
grant select(version_id,proposal_id,decision) on accordly.consent_decisions to accordly_executor;
set local role accordly_executor;
create or replace function accordly_commands.provider_agreement_view(p_auth uuid,p_agreement uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare result jsonb; org uuid; effective uuid; begin
 org:=accordly_commands.authorize_operation(p_auth,'read',p_agreement);
 result:=accordly_commands.agreement_details(p_auth,p_agreement);
 perform accordly_commands.set_registered_actor(p_auth);
 select effective_version_id into effective from accordly.agreements where id=p_agreement;
 result:=result||jsonb_build_object('effective_version_id',effective,'effective_version',(select jsonb_build_object('id',id,'version_number',version_number::text,'digest',encode(digest,'hex'),'snapshot',convert_from(canonical_bytes,'UTF8')::jsonb) from accordly.agreement_versions where id=effective),'permissions',jsonb_build_object('edit',coalesce(accordly_commands.can_access_agreement(org,p_agreement,'edit'),false),'issue',coalesce(accordly_commands.can_access_agreement(org,p_agreement,'issue'),false)),
 'representatives',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'party_id',r.party_id,'display_name',r.display_name,'can_sign',r.can_sign) order by r.id),'[]') from accordly.party_representatives r where r.agreement_id=p_agreement and r.revoked_at is null),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'event_type',e.event_type,'occurred_at',e.occurred_at,'sequence',e.sequence::text) order by e.sequence),'[]') from (select * from accordly.audit_events where agreement_id=p_agreement order by sequence desc limit 100) e),
 'signatures',(select coalesce(jsonb_agg(jsonb_build_object('slot_id',d.slot_id,'signed_at',d.signed_at,'digest',encode(d.version_digest,'hex')) order by d.signed_at),'[]') from accordly.consent_decisions d where d.agreement_id=p_agreement and d.decision='approve' and (d.version_id=effective or (effective is null))),
 'slots',(select coalesce(jsonb_agg(jsonb_build_object('slot_id',s.id,'side',p.side,'expected_email',s.expected_email,'proposal_id',s.proposal_id)),'[]') from accordly.proposal_participants s join accordly.agreement_parties p on p.id=s.party_id where s.agreement_id=p_agreement and (s.version_id=effective or s.proposal_id=(select pending_initial_proposal_id from accordly.agreements where id=p_agreement))));
 perform set_config('accordly.actor_id','',true); return result;
end $$;
reset role;
revoke create on schema accordly_commands from accordly_executor,accordly_authorizer,accordly_freezer,accordly_signer,accordly_integrity;
commit;
