begin;
set local role accordly_owner;

create function accordly_commands.validate_amendment(p_payload jsonb,p_base uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v accordly.agreement_versions; total numeric; begin
 perform accordly_commands.assert_keys(p_payload,array['draft','requested_change','reason','delta_minor','revises_proposal_id']);
 perform accordly_commands.require_text(p_payload,'requested_change',4000); perform accordly_commands.require_text(p_payload,'reason',2000);
 if coalesce(p_payload->>'delta_minor','') !~ '^(0|-?[1-9][0-9]{0,15})$' or abs((p_payload->>'delta_minor')::numeric)>9000000000000000 then raise exception using errcode='22023',message='Exact bounded price difference required'; end if;
 perform accordly_commands.validate_draft(p_payload->'draft');
 select * into v from accordly.agreement_versions where id=p_base;
 if not found then raise exception using errcode='42501',message='Base version unavailable'; end if;
 total:=v.amount_minor::numeric+(p_payload->>'delta_minor')::numeric;
 if total<1 or total>9000000000000000 or (p_payload->'draft'->>'amount_minor')::numeric<>total or p_payload->'draft'->>'currency_code' is distinct from v.currency_code or (p_payload->'draft'->>'currency_exponent')::smallint is distinct from v.currency_exponent or p_payload->'draft'->>'content_language' is distinct from v.content_language then raise exception using errcode='23514',message='Revised total, currency and language must match the base'; end if;
 if p_payload->>'revises_proposal_id' is not null and not exists(select 1 from accordly.agreement_proposals where id=(p_payload->>'revises_proposal_id')::uuid and agreement_id=v.agreement_id and kind='amendment' and state in ('rejected','withdrawn','superseded','expired')) then raise exception using errcode='23514',message='Revision must reference a closed amendment'; end if;
end $$;

create function accordly_commands.freeze_amendment(p_org uuid,p_agreement uuid,p_draft uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d accordly.agreement_drafts; base accordly.agreement_versions; a accordly.agreements; oldp accordly.agreement_proposals;
 v uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); n bigint; snapshot jsonb; canonical text; consent text; milestones jsonb:='[]'; m jsonb; ordinal integer:=0; now_at timestamptz:=clock_timestamp();
begin
 select * into a from accordly.agreements where id=p_agreement and organization_id=p_org;
 select * into d from accordly.agreement_drafts where id=p_draft and agreement_id=p_agreement and kind='amendment' and author_principal_id=accordly_commands.actor_id();
 if d.id is null or a.lifecycle<>'active' or d.base_version_id is distinct from a.effective_version_id or exists(select 1 from accordly.agreement_versions where origin_draft_id=d.id) then raise exception using errcode='P4090',message='Current unsubmitted amendment required'; end if;
 perform accordly_commands.validate_amendment(d.payload,d.base_version_id);
 select * into base from accordly.agreement_versions where id=d.base_version_id;
 select * into oldp from accordly.agreement_proposals where candidate_version_id=base.id and state='effective';
 if oldp.id is null or (select count(distinct party_id) from accordly.proposal_participants where proposal_id=oldp.id)<>2 or exists(
   select 1 from accordly.proposal_participants s join accordly.party_representatives r on r.id=s.representative_id join accordly.agreement_parties ap on ap.id=r.party_id
   where s.proposal_id=oldp.id and (r.revoked_at is not null or not r.can_review or not r.can_sign or not r.can_propose or r.normalized_email<>s.expected_email or r.principal_id is null or not accordly_commands.principal_active(r.principal_id) or (ap.side='provider' and accordly_commands.target_org_role(p_org,r.principal_id) is null))
 ) then raise exception using errcode='23514',message='The complete existing required quorum must remain authorized'; end if;
 consent:=case base.content_language when 'fr' then 'En signant, je consens explicitement à cette modification exacte de l’accord.' else 'By signing, I explicitly consent to this exact agreement amendment.' end;
 for m in select value from jsonb_array_elements(d.payload->'draft'->'milestones') loop ordinal:=ordinal+1; milestones:=milestones||jsonb_build_array(m||jsonb_build_object('ordinal',ordinal)); end loop;
 select coalesce(max(version_number),0)+1 into n from accordly.agreement_versions where agreement_id=p_agreement;
 snapshot:=d.payload->'draft'||jsonb_build_object('schema_version',2,'canonicalization_version',1,'organization_id',p_org,'agreement_id',p_agreement,'version_id',v,'version_number',n::text,'title',a.title,'parties',convert_from(base.canonical_bytes,'UTF8')::jsonb->'parties','milestones',milestones,'consent_text',consent,'disclosure_version','accordly-amendment-v1','amendment',jsonb_build_object('base_version_id',base.id,'base_digest',encode(base.digest,'hex'),'requested_change',d.payload->>'requested_change','reason',d.payload->>'reason','delta_minor',d.payload->>'delta_minor','author_principal_id',d.author_principal_id,'author_representative_id',d.author_representative_id,'author_display_name',(select display_name from accordly.party_representatives where id=d.author_representative_id),'revises_proposal_id',d.payload->>'revises_proposal_id'));
 canonical:=accordly_commands.canonical_json(snapshot);
 insert into accordly.agreement_versions(id,organization_id,agreement_id,version_number,kind,parent_version_id,origin_draft_id,origin_draft_revision,schema_version,canonical_bytes,amount_minor,currency_code,currency_exponent,content_language,deadline_date,deadline_at,deadline_timezone)
 values(v,p_org,p_agreement,n,'amendment',base.id,d.id,d.revision,2,convert_to(canonical,'UTF8'),(d.payload->'draft'->>'amount_minor')::bigint,base.currency_code,base.currency_exponent,base.content_language,(d.payload->'draft'->'deadline'->>'date')::date,(d.payload->'draft'->'deadline'->>'at')::timestamptz,d.payload->'draft'->'deadline'->>'timezone');
 for m in select value from jsonb_array_elements(milestones) loop
 insert into accordly.version_milestones(organization_id,agreement_id,version_id,ordinal,description,amount_minor,deadline_date,deadline_at,deadline_timezone,acceptance_terms)
 values(p_org,p_agreement,v,(m->>'ordinal')::integer,m->>'description',(m->>'amount_minor')::bigint,(m->'deadline'->>'date')::date,(m->'deadline'->>'at')::timestamptz,m->'deadline'->>'timezone',m->>'acceptance_terms'); end loop;
 insert into accordly.agreement_proposals(id,organization_id,agreement_id,kind,candidate_version_id,base_version_id,proposer_principal_id,proposer_party_id,submitted_at,expires_at,explanation,frozen_diff)
 values(p,p_org,p_agreement,'amendment',v,base.id,d.author_principal_id,d.author_party_id,now_at,now_at+interval '7 days',d.payload->>'reason',jsonb_build_object('requested_change',d.payload->>'requested_change','delta_minor',d.payload->>'delta_minor','before_amount_minor',base.amount_minor::text,'after_amount_minor',d.payload->'draft'->>'amount_minor','revises_proposal_id',d.payload->>'revises_proposal_id'));
 insert into accordly.proposal_participants(organization_id,agreement_id,proposal_id,version_id,party_id,representative_id,expected_email,identity_snapshot,consent_text,disclosure_version,content_language)
 select p_org,p_agreement,p,v,party_id,representative_id,expected_email,identity_snapshot,consent,'accordly-amendment-v1',content_language from accordly.proposal_participants where proposal_id=oldp.id;
 return jsonb_build_object('proposal_id',p,'version_id',v,'snapshot',snapshot,'canonical_text',canonical,'digest',encode(sha256(convert_to(canonical,'UTF8')),'hex'));
end $$;

create function accordly_commands.amendment_command_impl(p_auth uuid,p_email text,p_session uuid,p_operation text,p_input jsonb,p_internal jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ctx jsonb; org uuid; aid uuid:=(p_input->>'agreement_id')::uuid; actor uuid; d accordly.agreement_drafts; prop accordly.agreement_proposals; slot accordly.proposal_participants;
 result jsonb; previous accordly.command_receipts; h bytea; rid uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid(); seq bigint; prior bytea; body jsonb; now_at timestamptz:=clock_timestamp();
begin
 if p_input is null or octet_length(p_input::text)>131072 or p_operation not in ('amendment_list','amendment_review','amendment_create','amendment_save','amendment_submit','amendment_revisions','amendment_withdraw') then raise exception using errcode='22023',message='Invalid amendment command'; end if;
 ctx:=accordly_commands.amendment_actor(p_auth,p_email,p_session,aid,p_internal,p_operation not in ('amendment_list','amendment_review'));
 org:=(ctx->>'organization_id')::uuid; actor:=(ctx->>'actor_id')::uuid;
 if p_operation='amendment_list' then
   return ctx||jsonb_build_object('effective',(select jsonb_build_object('version_id',id,'digest',encode(digest,'hex'),'snapshot',convert_from(canonical_bytes,'UTF8')::jsonb) from accordly.agreement_versions where id=(ctx->>'effective_version_id')::uuid),
   'drafts',(select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'revision',q.revision::text,'base_version_id',q.base_version_id,'payload',q.payload) order by q.created_at desc),'[]') from (select * from accordly.agreement_drafts x where x.agreement_id=aid and x.kind='amendment' and x.author_principal_id=actor and not exists(select 1 from accordly.agreement_versions where origin_draft_id=x.id) order by x.created_at desc limit 50) q),
   'proposals',(select coalesce(jsonb_agg(q.body order by q.n desc),'[]') from (select v.version_number n,jsonb_build_object('id',p.id,'version_id',v.id,'version_number',v.version_number::text,'base_version_id',p.base_version_id,'state',case when p.state='pending' and p.expires_at<=clock_timestamp() then 'expired' else p.state end,'expires_at',p.expires_at,'submitted_at',p.submitted_at,'proposer_principal_id',p.proposer_principal_id,'proposer_name',convert_from(v.canonical_bytes,'UTF8')::jsonb->'amendment'->>'author_display_name','diff',p.frozen_diff,'digest',encode(v.digest,'hex')) body from accordly.agreement_proposals p join accordly.agreement_versions v on v.id=p.candidate_version_id where p.agreement_id=aid and (p_input->>'before_version_number' is null or v.version_number<(p_input->>'before_version_number')::bigint) order by v.version_number desc limit 50) q));
 elsif p_operation='amendment_review' then
   select * into prop from accordly.agreement_proposals where agreement_id=aid and id=(p_input->>'proposal_id')::uuid;
   if not found then raise exception using errcode='P4040',message='Proposal unavailable'; end if;
   select * into slot from accordly.proposal_participants where proposal_id=prop.id and representative_id=(ctx->>'representative_id')::uuid;
   return jsonb_build_object('proposal_id',prop.id,'kind',prop.kind,'state',case when prop.state='pending' and prop.expires_at<=clock_timestamp() then 'expired' else prop.state end,'proposer_principal_id',prop.proposer_principal_id,'reason',prop.explanation,'own_slot_id',slot.id,'diff',prop.frozen_diff,
   'candidate',(select jsonb_build_object('version_id',id,'snapshot',convert_from(canonical_bytes,'UTF8')::jsonb,'digest',encode(digest,'hex')) from accordly.agreement_versions where id=prop.candidate_version_id),
   'base',(select jsonb_build_object('version_id',id,'snapshot',convert_from(canonical_bytes,'UTF8')::jsonb,'digest',encode(digest,'hex')) from accordly.agreement_versions where id=prop.base_version_id),
   'slots',(select coalesce(jsonb_agg(jsonb_build_object('slot_id',s.id,'display_name',s.identity_snapshot->>'display_name','expected_email',s.expected_email,'decision',cd.decision,'signed_at',cd.signed_at) order by s.id),'[]') from accordly.proposal_participants s left join accordly.consent_decisions cd on cd.slot_id=s.id where s.proposal_id=prop.id),
   'feedback',(select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'reason',reason,'actor_name',actor_name,'occurred_at',occurred_at) order by occurred_at),'[]') from accordly.proposal_feedback where proposal_id=prop.id));
 end if;
 if p_input->>'idempotency_key' is null then raise exception using errcode='22023',message='Idempotency key required'; end if;
 h:=sha256(convert_to(accordly_commands.canonical_json(p_input),'UTF8'));
 select * into previous from accordly.command_receipts where actor_principal_id=actor and operation=p_operation and resource_id=aid and idempotency_key=(p_input->>'idempotency_key')::uuid;
 if found then if previous.request_digest<>h or previous.expires_at<=clock_timestamp() then raise exception using errcode='P4090',message='Idempotency conflict or expired key'; end if; return previous.outcome; end if;
 if p_operation in ('amendment_create','amendment_save') then
   if p_input->>'base_version_id' is distinct from ctx->>'effective_version_id' then raise exception using errcode='P4090',message='Stale amendment base'; end if;
   perform accordly_commands.validate_amendment(p_input->'payload',(ctx->>'effective_version_id')::uuid);
   if p_operation='amendment_create' then
     insert into accordly.agreement_drafts(organization_id,agreement_id,kind,base_version_id,author_principal_id,author_party_id,author_representative_id,payload)
     values(org,aid,'amendment',(ctx->>'effective_version_id')::uuid,actor,(ctx->>'party_id')::uuid,(ctx->>'representative_id')::uuid,p_input->'payload') returning * into d;
   else
     update accordly.agreement_drafts set payload=p_input->'payload',revision=revision+1,updated_at=clock_timestamp() where id=(p_input->>'draft_id')::uuid and agreement_id=aid and kind='amendment' and author_principal_id=actor and base_version_id=(ctx->>'effective_version_id')::uuid and revision=(p_input->>'expected_revision')::bigint returning * into d;
     if not found then raise exception using errcode='P4090',message='Stale or unavailable draft'; end if;
   end if;
   result:=jsonb_build_object('draft_id',d.id,'revision',d.revision::text);
 elsif p_operation='amendment_submit' then
   select * into d from accordly.agreement_drafts where id=(p_input->>'draft_id')::uuid and agreement_id=aid and author_principal_id=actor and kind='amendment' for update;
   if d.id is null or d.revision is distinct from (p_input->>'expected_revision')::bigint then raise exception using errcode='P4090',message='Stale or unavailable draft'; end if;
   result:=accordly_commands.freeze_amendment(org,aid,d.id);
 else
   perform accordly_commands.require_text(p_input,'reason',2000);
   select * into prop from accordly.agreement_proposals where agreement_id=aid and id=(p_input->>'proposal_id')::uuid and kind='amendment' for update;
   select * into slot from accordly.proposal_participants where proposal_id=prop.id and representative_id=(ctx->>'representative_id')::uuid;
   if prop.id is null or slot.id is null or prop.state<>'pending' or prop.expires_at<=clock_timestamp() or prop.base_version_id is distinct from (ctx->>'effective_version_id')::uuid then raise exception using errcode='P4090',message='Current pending amendment required'; end if;
   if p_operation='amendment_withdraw' then
     if prop.proposer_principal_id<>actor then raise exception using errcode='42501',message='Only the author may withdraw'; end if;
   elsif exists(select 1 from accordly.consent_decisions where slot_id=slot.id) then raise exception using errcode='P4090',message='Existing decisions cannot be retracted'; end if;
   update accordly.agreement_proposals set state=case when p_operation='amendment_withdraw' then 'withdrawn' else 'rejected' end,terminal_at=clock_timestamp() where id=prop.id;
   insert into accordly.proposal_feedback(organization_id,agreement_id,proposal_id,slot_id,actor_principal_id,actor_name,kind,reason,receipt_id)
   values(org,aid,prop.id,slot.id,actor,ctx->>'actor_name',case when p_operation='amendment_withdraw' then 'withdrawn' else 'revision_requested' end,p_input->>'reason',rid);
   update accordly.verification_proofs set revoked_at=clock_timestamp() where proposal_id=prop.id and consumed_at is null and revoked_at is null;
   update accordly.invitations set revoked_at=clock_timestamp() where proposal_id=prop.id and consumed_at is null and revoked_at is null;
   result:=jsonb_build_object('proposal_id',prop.id,'closed',true);
 end if;
 insert into accordly.command_receipts(id,organization_id,agreement_id,actor_principal_id,operation,resource_id,idempotency_key,request_digest,outcome)
 values(rid,org,aid,actor,p_operation,aid,(p_input->>'idempotency_key')::uuid,h,result);
 select coalesce(max(sequence),0)+1 into seq from accordly.audit_events where agreement_id=aid;
 select event_hash into prior from accordly.audit_events where agreement_id=aid order by sequence desc limit 1;
 body:=jsonb_build_object('id',eid,'organization_id',org,'agreement_id',aid,'sequence',seq::text,'actor_principal_id',actor,'operation',p_operation,'receipt_id',rid,'request_digest',encode(h,'hex'),'draft_id',result->>'draft_id','proposal_id',result->>'proposal_id','version_id',result->>'version_id','version_digest',result->>'digest','occurred_at',to_char(now_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
 insert into accordly.audit_events(id,organization_id,agreement_id,sequence,receipt_id,actor_principal_id,event_type,occurred_at,canonical_event,prior_event_hash)
 values(eid,org,aid,seq,rid,actor,p_operation,now_at,convert_to(accordly_commands.canonical_json(body),'UTF8'),coalesce(prior,decode(repeat('00',32),'hex')));
 insert into accordly.outbox_events(organization_id,agreement_id,deduplication_key,event_type,references_json) values(org,aid,rid,'amendment_recorded',body);
 return result;
end $$;

create function accordly_commands.amendment_command(p_auth uuid,p_email text,p_session uuid,p_operation text,p_input jsonb,p_internal jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$ declare result jsonb; k text; begin
 foreach k in array array['accordly.actor_id','accordly.signing_org','accordly.signing_agreement','accordly.signing_principal','accordly.lookup_id'] loop perform set_config(k,'',true); end loop;
 result:=accordly_commands.amendment_command_impl(p_auth,p_email,p_session,p_operation,p_input,p_internal);
 foreach k in array array['accordly.actor_id','accordly.signing_org','accordly.signing_agreement','accordly.signing_principal','accordly.lookup_id'] loop perform set_config(k,'',true); end loop;
 return result;
end $$;
reset role;
alter function accordly_commands.validate_amendment(jsonb,uuid) owner to accordly_freezer;
alter function accordly_commands.freeze_amendment(uuid,uuid,uuid) owner to accordly_freezer;
alter function accordly_commands.amendment_command_impl(uuid,text,uuid,text,jsonb,jsonb) owner to accordly_signer;
alter function accordly_commands.amendment_command(uuid,text,uuid,text,jsonb,jsonb) owner to accordly_signer;
revoke all on function accordly_commands.validate_amendment(jsonb,uuid),accordly_commands.freeze_amendment(uuid,uuid,uuid),accordly_commands.amendment_command_impl(uuid,text,uuid,text,jsonb,jsonb),accordly_commands.amendment_command(uuid,text,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role,accordly_gateway;
grant execute on function accordly_commands.amendment_command(uuid,text,uuid,text,jsonb,jsonb) to accordly_gateway;
grant execute on function accordly_commands.freeze_amendment(uuid,uuid,uuid),accordly_commands.validate_amendment(jsonb,uuid) to accordly_signer;
grant execute on function accordly_commands.validate_draft(jsonb),accordly_commands.target_org_role(uuid,uuid) to accordly_freezer;
commit;
