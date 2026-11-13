begin;
set local role accordly_owner;
create function accordly_commands.record_verification_event(p_actor uuid,p_org uuid,p_agreement uuid,p_slot uuid,p_version uuid,p_operation text,p_input jsonb,p_result jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare rid uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid(); seq bigint; prior bytea; body jsonb; now_at timestamptz:=clock_timestamp(); request_hash bytea; begin
 if p_operation not in ('verify_access','verify_consent') or not coalesce(accordly_commands.signing_scope(p_org,p_agreement),false) then raise exception using errcode='42501',message='Verified scope required'; end if;
 request_hash:=sha256(convert_to(accordly_commands.canonical_json(p_input),'UTF8'));
 insert into accordly.command_receipts(id,organization_id,agreement_id,actor_principal_id,operation,resource_id,idempotency_key,request_digest,outcome)
 values(rid,p_org,p_agreement,p_actor,p_operation,p_agreement,(p_input->>'challenge_id')::uuid,request_hash,p_result);
 select coalesce(max(sequence),0)+1 into seq from accordly.audit_events where agreement_id=p_agreement;
 select event_hash into prior from accordly.audit_events where agreement_id=p_agreement order by sequence desc limit 1;
 body:=jsonb_build_object('id',eid,'organization_id',p_org,'agreement_id',p_agreement,'sequence',seq::text,'actor_principal_id',p_actor,'operation',p_operation,'receipt_id',rid,'slot_id',p_slot,'version_id',p_version,'version_digest',(select encode(digest,'hex') from accordly.agreement_versions where id=p_version),'request_digest',encode(request_hash,'hex'),'occurred_at',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'outcome',p_result);
 insert into accordly.audit_events(id,organization_id,agreement_id,sequence,receipt_id,actor_principal_id,event_type,occurred_at,canonical_event,prior_event_hash)
 values(eid,p_org,p_agreement,seq,rid,p_actor,p_operation,now_at,convert_to(accordly_commands.canonical_json(body),'UTF8'),coalesce(prior,decode(repeat('00',32),'hex')));
end $$;
create function accordly_commands.signing_command_impl(p_auth uuid,p_email text,p_auth_session uuid,p_operation text,p_input jsonb,p_internal jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; aid uuid; actor uuid; source jsonb; inv accordly.invitations; sess accordly.guest_sessions;
 a accordly.agreements; prop accordly.agreement_proposals; slot accordly.proposal_participants; rep accordly.party_representatives;
 challenge accordly.email_challenges; proof accordly.verification_proofs; version accordly.agreement_versions;
 now_at timestamptz; result jsonb; rid uuid:=gen_random_uuid(); request_hash bytea; old_receipt accordly.command_receipts;
 sid uuid; seq bigint; prior bytea; body jsonb; event_id uuid:=gen_random_uuid(); sign_time timestamptz; decision_id uuid:=gen_random_uuid();
begin
 if p_input is null or p_internal is null or octet_length(p_input::text)>20000 then raise exception using errcode='22023',message='Invalid signing input'; end if;
 -- Derive scope without document access through a locator-only internal resolver.
 if p_operation in ('invite','revoke_invitation','list_slots') then
   org:=accordly_commands.authorize_operation(p_auth,'freeze',(p_input->>'agreement_id')::uuid); aid:=(p_input->>'agreement_id')::uuid;
 elsif p_operation in ('start_access','verify_access') then
   source:=accordly_commands.resolve_signing_credential('invitation',(p_input->>'invitation_id')::uuid);
 else
   source:=accordly_commands.resolve_signing_credential('session',(p_internal->>'session_id')::uuid);
 end if;
 if source is not null then org:=(source->>'organization_id')::uuid; aid:=(source->>'agreement_id')::uuid; end if;
 if org is null or aid is null then return jsonb_build_object('error','invalid_capability'); end if;
 perform set_config('accordly.signing_org',org::text,true); perform set_config('accordly.signing_agreement',aid::text,true);
 perform 1 from accordly.organizations where id=org and (status='active' or p_operation in ('read','logout')) for share;
 if not found then return jsonb_build_object('error','invalid_capability'); end if;
 select * into a from accordly.agreements where id=aid for update;
 if p_operation in ('invite','revoke_invitation','list_slots') then
   perform accordly_commands.authorize_operation(p_auth,'freeze',aid);
   actor:=accordly_commands.set_registered_actor(p_auth);
   if a.lifecycle<>'awaiting_signatures' then raise exception using errcode='P4090',message='Invitation management requires pending initial agreement'; end if;
   if p_operation='list_slots' then return jsonb_build_object('slots',(select jsonb_agg(jsonb_build_object('slot_id',s.id,'side',p.side,'expected_email',s.expected_email,'proposal_id',s.proposal_id)) from accordly.proposal_participants s join accordly.agreement_parties p on p.id=s.party_id where s.proposal_id=a.pending_initial_proposal_id)); end if;
   select * into slot from accordly.proposal_participants where agreement_id=aid and id=(p_input->>'slot_id')::uuid and proposal_id=a.pending_initial_proposal_id;
   if not found then raise exception using errcode='42501',message='Slot unavailable'; end if;
 else
   if p_operation in ('start_access','verify_access') then
     select * into inv from accordly.invitations where id=(p_input->>'invitation_id')::uuid for update;
     if inv.token_digest is distinct from decode(p_internal->>'token_digest','hex') or inv.revoked_at is not null or inv.consumed_at is not null or inv.expires_at<=clock_timestamp() then return jsonb_build_object('error','invalid_capability'); end if;
   else
     select * into sess from accordly.guest_sessions where id=(p_internal->>'session_id')::uuid for update;
     select * into inv from accordly.invitations where id=sess.invitation_id for update;
     if sess.secret_digest is distinct from decode(p_internal->>'session_digest','hex') or sess.revoked_at is not null or sess.expires_at<=clock_timestamp() or sess.last_seen_at+interval '30 minutes'<=clock_timestamp() or inv.revoked_at is not null or inv.expires_at<=clock_timestamp() then return jsonb_build_object('error','invalid_capability'); end if;
   end if;
   select * into slot from accordly.proposal_participants where id=inv.slot_id;
 end if;
 select * into prop from accordly.agreement_proposals where id=slot.proposal_id for update;
 select * into version from accordly.agreement_versions where id=slot.version_id;
 select * into rep from accordly.party_representatives where id=slot.representative_id for update;
 now_at:=clock_timestamp();
 if rep.revoked_at is not null or not rep.can_sign or not rep.can_review or slot.expected_email is distinct from rep.normalized_email then return jsonb_build_object('error','invalid_capability'); end if;
 if p_operation in ('invite','revoke_invitation') then null;
 elsif exists(select 1 from accordly.agreement_parties where id=slot.party_id and side='provider') then
   if rep.principal_id is null or p_auth is null or p_auth_session is null or p_email is distinct from slot.expected_email then return jsonb_build_object('error','invalid_capability'); end if;
   actor:=accordly_commands.set_registered_actor(p_auth);
   if actor<>rep.principal_id or accordly_commands.target_org_role(org,actor) is null then return jsonb_build_object('error','invalid_capability'); end if;
 else actor:=rep.principal_id; end if;
 if p_operation not in ('invite','revoke_invitation') and actor is not null then
   perform set_config('accordly.signing_principal',actor::text,true);
   if exists(select 1 from accordly.principals where id=actor and kind='registered') then
     if p_auth is null or p_auth_session is null or p_email is distinct from slot.expected_email or accordly_commands.set_registered_actor(p_auth)<>actor then return jsonb_build_object('error','invalid_capability'); end if;
   end if;
 end if;
 if p_operation not in ('invite','revoke_invitation','start_access','verify_access') then
   if actor is distinct from sess.principal_id or rep.authority_revision<>sess.authority_revision or (sess.auth_session_id is not null and sess.auth_session_id is distinct from p_auth_session) then return jsonb_build_object('error','invalid_capability'); end if;
   perform set_config('accordly.signing_principal',actor::text,true);
   if not exists(select 1 from accordly.principals where id=actor and status='active') then return jsonb_build_object('error','invalid_capability'); end if;
   update accordly.guest_sessions set last_seen_at=now_at where id=sess.id;
 end if;
 -- Receipts never contain bearer values. Authorize first, replay before consumed proof/state checks.
 if p_operation in ('invite','revoke_invitation','initial_signature') then
   request_hash:=sha256(convert_to(accordly_commands.canonical_json(p_input||jsonb_build_object('session_id',case when p_operation='initial_signature' then sess.id else null end,'proof_digest',case when p_operation='initial_signature' then p_internal->>'proof_digest' else null end)),'UTF8'));
   select * into old_receipt from accordly.command_receipts where actor_principal_id=actor and operation=p_operation and resource_id=aid and idempotency_key=(p_input->>'idempotency_key')::uuid;
   if found then
     if old_receipt.request_digest<>request_hash then raise exception using errcode='P4090',message='Idempotency conflict'; end if;
     return old_receipt.outcome;
   end if;
 end if;
 if p_operation='logout' then update accordly.guest_sessions set revoked_at=now_at where id=sess.id; return jsonb_build_object('ok',true); end if;
 if p_operation='read' then
   if prop.state not in ('pending','effective') or (prop.state='pending' and prop.expires_at<=now_at) then return jsonb_build_object('error','invalid_capability'); end if;
   return jsonb_build_object('agreement_id',aid,'proposal_id',prop.id,'version_id',version.id,'canonical_text',convert_from(version.canonical_bytes,'UTF8'),'digest',encode(version.digest,'hex'),'slot_id',slot.id,'consent_text',slot.consent_text,'disclosure_version',slot.disclosure_version,'lifecycle',a.lifecycle,'decisions',(select coalesce(jsonb_agg(jsonb_build_object('slot_id',slot_id,'signed_at',signed_at,'digest',encode(version_digest,'hex'))),'[]') from accordly.consent_decisions where proposal_id=prop.id));
 end if;
 if prop.kind<>'initial' or prop.state<>'pending' or prop.expires_at<=now_at or a.lifecycle<>'awaiting_signatures' or a.pending_initial_proposal_id<>prop.id then return jsonb_build_object('error','invalid_capability'); end if;
 if p_operation='invite' then
   update accordly.invitations set revoked_at=now_at where agreement_id=aid and slot_id=slot.id and revoked_at is null;
   insert into accordly.invitations(id,organization_id,agreement_id,proposal_id,slot_id,intended_email,token_digest,issued_by,expires_at)
    values((p_internal->>'invitation_id')::uuid,org,aid,prop.id,slot.id,slot.expected_email,decode(p_internal->>'token_digest','hex'),actor,least(now_at+interval '72 hours',prop.expires_at));
   result:=jsonb_build_object('invitation_id',p_internal->>'invitation_id','delivery_email',slot.expected_email,'expires_at',least(now_at+interval '72 hours',prop.expires_at));
 elsif p_operation='revoke_invitation' then
   update accordly.invitations set revoked_at=now_at where agreement_id=aid and slot_id=slot.id and revoked_at is null;
   result:=jsonb_build_object('revoked',true);
 elsif p_operation in ('start_access','start_consent') then
   if p_operation='start_consent' and (p_input->>'digest' is distinct from encode(version.digest,'hex') or p_input->>'proposal_id' is distinct from prop.id::text) then return jsonb_build_object('error','invalid_capability'); end if;
   update accordly.email_challenges set revoked_at=now_at where invitation_id=inv.id and purpose=case when p_operation='start_access' then 'access' else 'initial_signature' end and consumed_at is null and revoked_at is null;
   insert into accordly.email_challenges(id,organization_id,agreement_id,invitation_id,session_id,purpose,code_hmac,key_id,expires_at)
    values((p_internal->>'challenge_id')::uuid,org,aid,inv.id,case when p_operation='start_access' then null else sess.id end,case when p_operation='start_access' then 'access' else 'initial_signature' end,decode(p_internal->>'code_hmac','hex'),p_internal->>'key_id',least(now_at+interval '10 minutes',inv.expires_at,prop.expires_at,coalesce(sess.expires_at,'infinity')));
   return jsonb_build_object('challenge_id',p_internal->>'challenge_id','delivery_email',slot.expected_email,'invitation_id',inv.id);
 elsif p_operation in ('verify_access','verify_consent') then
   select * into challenge from accordly.email_challenges where id=(p_input->>'challenge_id')::uuid and invitation_id=inv.id for update;
   if not found or challenge.purpose<>(case when p_operation='verify_access' then 'access' else 'initial_signature' end) or challenge.session_id is distinct from (case when p_operation='verify_access' then null::uuid else sess.id end) or challenge.revoked_at is not null or challenge.consumed_at is not null or challenge.expires_at<=clock_timestamp() or challenge.failed_attempts>=5 then return jsonb_build_object('error','invalid_challenge'); end if;
   if challenge.code_hmac is distinct from decode(p_internal->>'code_hmac','hex') or challenge.key_id is distinct from p_internal->>'key_id' then
     update accordly.email_challenges set failed_attempts=failed_attempts+1 where id=challenge.id;
     return jsonb_build_object('error','invalid_challenge');
   end if;
   update accordly.email_challenges set consumed_at=now_at where id=challenge.id;
   if p_operation='verify_access' then
     if actor is null then
       actor:=gen_random_uuid(); perform set_config('accordly.signing_principal',actor::text,true);
       insert into accordly.principals(id,kind) values(actor,'guest');
       update accordly.party_representatives set principal_id=actor where id=rep.id and principal_id is null;
     end if;
     perform set_config('accordly.signing_principal',actor::text,true);
     if not exists(select 1 from accordly.principals where id=actor and status='active') then raise exception using errcode='42501',message='Principal disabled'; end if;
     update accordly.invitations set consumed_at=now_at where id=inv.id;
     insert into accordly.guest_sessions(id,organization_id,agreement_id,invitation_id,principal_id,representative_id,secret_digest,authority_revision,auth_session_id,expires_at)
      values((p_internal->>'session_id')::uuid,org,aid,inv.id,actor,rep.id,decode(p_internal->>'session_digest','hex'),rep.authority_revision,case when exists(select 1 from accordly.principals where id=actor and kind='registered') then p_auth_session else null end,least(now_at+interval '12 hours',inv.expires_at,prop.expires_at));
     result:=jsonb_build_object('verified',true,'session_id',p_internal->>'session_id');
     perform accordly_commands.record_verification_event(actor,org,aid,slot.id,version.id,p_operation,p_input,result);
     return result;
   end if;
   insert into accordly.verification_proofs(id,organization_id,agreement_id,session_id,challenge_id,proposal_id,version_id,principal_id,version_digest,secret_digest,expires_at)
    values((p_internal->>'proof_id')::uuid,org,aid,sess.id,challenge.id,prop.id,version.id,actor,version.digest,decode(p_internal->>'proof_digest','hex'),least(now_at+interval '5 minutes',sess.expires_at,inv.expires_at,prop.expires_at));
   result:=jsonb_build_object('verified',true,'proof_id',p_internal->>'proof_id');
   perform accordly_commands.record_verification_event(actor,org,aid,slot.id,version.id,p_operation,p_input,result);
   return result;
 elsif p_operation='initial_signature' then
   if p_input->>'digest' is distinct from encode(version.digest,'hex') or p_input->>'proposal_id' is distinct from prop.id::text or p_input->'affirmative' is distinct from 'true'::jsonb or p_input->>'consent_text' is distinct from slot.consent_text or p_input->>'disclosure_version' is distinct from slot.disclosure_version then raise exception using errcode='P4090',message='Exact affirmative consent required'; end if;
   perform accordly_commands.require_text(p_input,'typed_name',200);
   select * into proof from accordly.verification_proofs where id=(p_input->>'proof_id')::uuid and session_id=sess.id for update;
   sign_time:=clock_timestamp();
   if not found or proof.principal_id<>actor or proof.secret_digest is distinct from decode(p_internal->>'proof_digest','hex') or proof.version_digest<>version.digest or proof.proposal_id<>prop.id or proof.action<>'initial_signature' or proof.revoked_at is not null or proof.consumed_at is not null or proof.expires_at<=sign_time then raise exception using errcode='42501',message='Fresh verification proof required'; end if;
   body:=jsonb_build_object('decision_id',decision_id,'actor_principal_id',actor,'party_id',slot.party_id,'representative_id',rep.id,'slot_id',slot.id,'proposal_id',prop.id,'version_id',version.id,'digest',encode(version.digest,'hex'),'typed_name',p_input->>'typed_name','affirmative',true,'consent_text',slot.consent_text,'disclosure_version',slot.disclosure_version,'content_language',slot.content_language,'channel','mailbox_challenge','verified_at',to_char(proof.verified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'signed_at',to_char(sign_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'expected_email',slot.expected_email,'authority_source',rep.authority_source,'session_id',sess.id,'auth_session_id',sess.auth_session_id,'policy_version','accordly-signing-v1');
   insert into accordly.consent_decisions(id,organization_id,agreement_id,proposal_id,version_id,slot_id,principal_id,proof_id,receipt_id,decision,action,version_digest,typed_name,consent_text,disclosure_version,affirmative,signed_at,evidence_bytes)
    values(decision_id,org,aid,prop.id,version.id,slot.id,actor,proof.id,rid,'approve','initial_signature',version.digest,p_input->>'typed_name',slot.consent_text,slot.disclosure_version,true,sign_time,convert_to(accordly_commands.canonical_json(body),'UTF8'));
   update accordly.verification_proofs set consumed_at=sign_time where id=proof.id;
   if not exists(select 1 from accordly.proposal_participants s where s.proposal_id=prop.id and not exists(select 1 from accordly.consent_decisions d where d.proposal_id=prop.id and d.slot_id=s.id)) then
     update accordly.agreement_proposals set state='effective',terminal_at=sign_time where id=prop.id;
     update accordly.agreements set lifecycle='active',effective_version_id=version.id,pending_initial_proposal_id=null,revision=revision+1,updated_at=sign_time where id=aid;
   end if;
   result:=jsonb_build_object('decision_id',decision_id,'signed_at',sign_time,'digest',encode(version.digest,'hex'),'active',(select lifecycle='active' from accordly.agreements where id=aid));
 else raise exception using errcode='22023',message='Unknown signing command'; end if;
 -- Committed invitations/revocations/signatures join the existing audit chain.
 insert into accordly.command_receipts(id,organization_id,agreement_id,actor_principal_id,operation,resource_id,idempotency_key,request_digest,outcome)
  values(rid,org,aid,actor,p_operation,aid,(p_input->>'idempotency_key')::uuid,request_hash,result);
 if p_operation='initial_signature' then
   insert into accordly.outbox_events(organization_id,agreement_id,deduplication_key,event_type,references_json)
    values(org,aid,rid,'initial_signature_recorded',jsonb_build_object('decision_id',decision_id,'proposal_id',prop.id,'version_id',version.id,'active',result->'active'));
 end if;
 select coalesce(max(sequence),0)+1 into seq from accordly.audit_events where agreement_id=aid;
 select event_hash into prior from accordly.audit_events where agreement_id=aid order by sequence desc limit 1;
 now_at:=clock_timestamp();
 body:=jsonb_build_object('id',event_id,'organization_id',org,'agreement_id',aid,'sequence',seq::text,'actor_principal_id',actor,'operation',p_operation,'receipt_id',rid,'slot_id',slot.id,'version_id',version.id,'version_digest',encode(version.digest,'hex'),'request_digest',encode(request_hash,'hex'),'occurred_at',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'outcome',result);
 insert into accordly.audit_events(id,organization_id,agreement_id,sequence,receipt_id,actor_principal_id,event_type,occurred_at,canonical_event,prior_event_hash)
  values(event_id,org,aid,seq,rid,actor,p_operation,now_at,convert_to(accordly_commands.canonical_json(body),'UTF8'),coalesce(prior,decode(repeat('00',32),'hex')));
 return result;
end $$;
create function accordly_commands.signing_command(p_auth uuid,p_email text,p_auth_session uuid,p_operation text,p_input jsonb,p_internal jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$ declare result jsonb; k text; begin
 foreach k in array array['accordly.actor_id','accordly.signing_org','accordly.signing_agreement','accordly.signing_principal','accordly.lookup_id'] loop perform set_config(k,'',true); end loop;
 result:=accordly_commands.signing_command_impl(p_auth,p_email,p_auth_session,p_operation,p_input,p_internal);
 foreach k in array array['accordly.actor_id','accordly.signing_org','accordly.signing_agreement','accordly.signing_principal','accordly.lookup_id'] loop perform set_config(k,'',true); end loop;
 return result;
end $$;
reset role;
alter function accordly_commands.record_verification_event(uuid,uuid,uuid,uuid,uuid,text,jsonb,jsonb) owner to accordly_signer;
revoke all on function accordly_commands.record_verification_event(uuid,uuid,uuid,uuid,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role,accordly_gateway;
alter function accordly_commands.signing_command_impl(uuid,text,uuid,text,jsonb,jsonb) owner to accordly_signer;
alter function accordly_commands.signing_command(uuid,text,uuid,text,jsonb,jsonb) owner to accordly_signer;
revoke all on function accordly_commands.signing_command_impl(uuid,text,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role,accordly_gateway;
revoke all on function accordly_commands.signing_command(uuid,text,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function accordly_commands.signing_command(uuid,text,uuid,text,jsonb,jsonb) to accordly_gateway;
revoke create on schema accordly_commands from accordly_signer,accordly_credentials;
commit;
