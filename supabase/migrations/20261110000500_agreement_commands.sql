begin;
grant create on schema accordly_commands to accordly_executor,accordly_freezer;
set local role accordly_owner;

create function accordly_commands.authorize_operation(p_auth uuid,p_operation text,p_resource uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid; org uuid; permitted boolean:=false;
begin
  actor:=accordly_commands.set_registered_actor(p_auth);
  if p_operation='create_draft' then
    org:=p_resource;
    permitted:=accordly_commands.org_role(org) in ('owner','admin','editor');
  else
    select organization_id into org from accordly.agreements where id=p_resource;
    if p_operation='read' then permitted:=accordly_commands.can_access_agreement(org,p_resource,'read');
    elsif p_operation='freeze' then permitted:=accordly_commands.can_access_agreement(org,p_resource,'issue');
    elsif p_operation='set_access' then permitted:=accordly_commands.org_role(org) in ('owner','admin');
    elsif p_operation in ('update_draft','set_parties') then permitted:=accordly_commands.can_access_agreement(org,p_resource,'edit');
    end if;
  end if;
  if org is null then raise exception using errcode='P4040',message='Agreement not found'; end if;
  if not coalesce(permitted,false) then raise exception using errcode='42501',message='Operation not authorized'; end if;
  if p_operation<>'read' and not exists(select 1 from accordly.organizations where id=org and status='active') then raise exception using errcode='42501',message='Organization is not active'; end if;
  perform set_config('accordly.actor_id','',true);
  return org;
end $$;

create function accordly_commands.freeze_candidate(p_org uuid,p_agreement uuid,p_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d accordly.agreement_drafts; a accordly.agreements; party record; rep record; m jsonb;
  version uuid:=gen_random_uuid(); proposal uuid:=gen_random_uuid(); n bigint; submitted timestamptz:=clock_timestamp();
  snapshot jsonb; parties jsonb:='[]'; representatives jsonb; milestones jsonb:='[]'; consent text; canonical text; ordinal integer:=0; provider uuid;
begin
  select * into a from accordly.agreements where organization_id=p_org and id=p_agreement for update;
  if not found or a.lifecycle<>'preparing' or not coalesce(accordly_commands.can_access_agreement(p_org,p_agreement,'issue'),false) then raise exception using errcode='P4090',message='Agreement cannot be frozen'; end if;
  select * into d from accordly.agreement_drafts where organization_id=p_org and agreement_id=p_agreement and kind='initial';
  if not found then raise exception using errcode='23514',message='Initial draft required'; end if;
  perform accordly_commands.validate_draft(d.payload);
  if (select count(*) from accordly.agreement_parties where organization_id=p_org and agreement_id=p_agreement)<>2 then raise exception using errcode='23514',message='Both parties are required'; end if;
  if exists(select 1 from accordly.agreement_versions where organization_id=p_org and agreement_id=p_agreement) then raise exception using errcode='P4090',message='Replacement issuance is not enabled'; end if;
  if (select count(distinct lower(contact_email)) from accordly.agreement_parties where organization_id=p_org and agreement_id=p_agreement)<>2 then raise exception using errcode='23514',message='Distinct party mailboxes required'; end if;
  if exists(select 1 from accordly.party_representatives x join accordly.agreement_parties xp on xp.id=x.party_id
    join accordly.party_representatives y on y.organization_id=x.organization_id and y.agreement_id=x.agreement_id
    join accordly.agreement_parties yp on yp.id=y.party_id
    where x.organization_id=p_org and x.agreement_id=p_agreement and xp.side<>yp.side and x.revoked_at is null and y.revoked_at is null and x.can_sign and y.can_sign
      and (lower(x.normalized_email)=lower(y.normalized_email) or (x.principal_id is not null and x.principal_id=y.principal_id))) then
    raise exception using errcode='23514',message='One identity cannot represent both parties';
  end if;
  consent:=case d.payload->>'content_language' when 'fr' then 'En signant, je consens explicitement à cette version exacte de l’accord.' else 'By signing, I explicitly consent to this exact agreement version.' end;
  for party in select * from accordly.agreement_parties where organization_id=p_org and agreement_id=p_agreement order by (side='provider') desc loop
    representatives:='[]';
    for rep in select * from accordly.party_representatives where organization_id=p_org and agreement_id=p_agreement and party_id=party.id and revoked_at is null and can_sign order by id loop
      if not rep.can_review or not rep.can_propose then raise exception using errcode='23514',message='Signer authority incomplete'; end if;
      if party.side='provider' and (rep.principal_id is null or accordly_commands.target_org_role(p_org,rep.principal_id) is null) then raise exception using errcode='23514',message='Active provider membership required'; end if;
      if party.side='provider' and rep.principal_id=accordly_commands.actor_id() and rep.normalized_email<>accordly_commands.normalized_email(p_email) then raise exception using errcode='23514',message='Provider email binding changed'; end if;
      representatives:=representatives||jsonb_build_array(jsonb_build_object('id',rep.id,'principal_id',rep.principal_id,'expected_email',rep.normalized_email,'display_name',rep.display_name,'authority_source',rep.authority_source,'required',true));
    end loop;
    if jsonb_array_length(representatives)=0 then raise exception using errcode='23514',message='Each party requires a designated signer'; end if;
    parties:=parties||jsonb_build_array(jsonb_build_object('id',party.id,'side',party.side,'legal_name',party.legal_name,'contact_email',party.contact_email,'representatives',representatives));
    if party.side='provider' then provider:=party.id; end if;
  end loop;
  for m in select value from jsonb_array_elements(d.payload->'milestones') loop
    ordinal:=ordinal+1; milestones:=milestones||jsonb_build_array(m||jsonb_build_object('ordinal',ordinal));
  end loop;
  select coalesce(max(version_number),0)+1 into n from accordly.agreement_versions where organization_id=p_org and agreement_id=p_agreement;
  snapshot:=d.payload||jsonb_build_object('schema_version',1,'canonicalization_version',1,'organization_id',p_org,'agreement_id',p_agreement,'version_id',version,'version_number',n::text,'title',a.title,'parties',parties,'milestones',milestones,'consent_text',consent,'disclosure_version','accordly-consent-v1');
  canonical:=accordly_commands.canonical_json(snapshot);
  insert into accordly.agreement_versions(id,organization_id,agreement_id,version_number,kind,origin_draft_id,origin_draft_revision,canonical_bytes,amount_minor,currency_code,currency_exponent,content_language,deadline_date,deadline_at,deadline_timezone)
  values(version,p_org,p_agreement,n,'initial',d.id,d.revision,convert_to(canonical,'UTF8'),(d.payload->>'amount_minor')::bigint,d.payload->>'currency_code',(d.payload->>'currency_exponent')::smallint,d.payload->>'content_language',(d.payload->'deadline'->>'date')::date,(d.payload->'deadline'->>'at')::timestamptz,d.payload->'deadline'->>'timezone');
  for m in select value from jsonb_array_elements(milestones) loop
    insert into accordly.version_milestones(organization_id,agreement_id,version_id,ordinal,description,amount_minor,deadline_date,deadline_at,deadline_timezone,acceptance_terms)
    values(p_org,p_agreement,version,(m->>'ordinal')::integer,m->>'description',(m->>'amount_minor')::bigint,(m->'deadline'->>'date')::date,(m->'deadline'->>'at')::timestamptz,m->'deadline'->>'timezone',m->>'acceptance_terms');
  end loop;
  submitted:=clock_timestamp();
  insert into accordly.agreement_proposals(id,organization_id,agreement_id,kind,candidate_version_id,proposer_principal_id,proposer_party_id,submitted_at,expires_at)
  values(proposal,p_org,p_agreement,'initial',version,accordly_commands.actor_id(),provider,submitted,submitted+interval '7 days');
  insert into accordly.proposal_participants(organization_id,agreement_id,proposal_id,version_id,party_id,representative_id,expected_email,identity_snapshot,consent_text,disclosure_version,content_language)
  select p_org,p_agreement,proposal,version,(p->>'id')::uuid,(r->>'id')::uuid,r->>'expected_email',r,consent,'accordly-consent-v1',d.payload->>'content_language'
    from jsonb_array_elements(parties) p cross join lateral jsonb_array_elements(p->'representatives') r;
  return jsonb_build_object('version_id',version,'proposal_id',proposal,'expires_at',submitted+interval '7 days','snapshot',snapshot,'canonical_text',canonical,'digest',encode(sha256(convert_to(canonical,'UTF8')),'hex'));
end $$;

create function accordly_commands.execute_preparation(p_auth uuid,p_operation text,p_resource uuid,p_key uuid,p_input jsonb,p_verified_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; org uuid; aid uuid; a accordly.agreements; d accordly.agreement_drafts;
  previous accordly.command_receipts; request_hash bytea; result jsonb; receipt uuid:=gen_random_uuid();
  party uuid; representative accordly.party_representatives; contact jsonb; side text; email text; target uuid; grant_kind text; make_active boolean;
  seq bigint; prior bytea; event uuid:=gen_random_uuid(); event_body jsonb; event_time timestamptz;
begin
  if p_key is null or p_resource is null or p_input is null or octet_length(p_input::text)>131072 then raise exception using errcode='22023',message='Bounded command and idempotency key required'; end if;
  org:=accordly_commands.authorize_operation(p_auth,p_operation,p_resource);
  actor:=accordly_commands.set_registered_actor(p_auth);
  perform 1 from accordly.organizations where id=org and status='active' for share;
  if not found then raise exception using errcode='42501',message='Organization inactive'; end if;
  if p_operation<>'create_draft' then
    aid:=p_resource;
    select * into a from accordly.agreements where id=aid and organization_id=org for update;
    if not found then raise exception using errcode='P4040',message='Agreement not found'; end if;
  end if;
  -- Authorization is repeated after locks, before looking at cached outcomes.
  perform accordly_commands.authorize_operation(p_auth,p_operation,p_resource);
  actor:=accordly_commands.set_registered_actor(p_auth);
  perform pg_advisory_xact_lock(hashtextextended(actor::text||'/'||p_operation||'/'||p_resource::text||'/'||p_key::text,0));
  request_hash:=sha256(convert_to(accordly_commands.canonical_json(jsonb_build_object('actor_principal_id',actor,'operation',p_operation,'resource_id',p_resource,'input',p_input,'verified_provider_email',case when p_operation='set_parties' then accordly_commands.normalized_email(p_verified_email) else null end)),'UTF8'));
  select * into previous from accordly.command_receipts where actor_principal_id=actor and operation=p_operation and resource_id=p_resource and idempotency_key=p_key;
  if found then
    if previous.request_digest<>request_hash or previous.expires_at<=clock_timestamp() then raise exception using errcode='P4090',message='Idempotency conflict or expired key'; end if;
    perform set_config('accordly.actor_id','',true); return previous.outcome;
  end if;
  if p_operation<>'create_draft' then
    if coalesce(p_input->>'expected_revision','') !~ '^[1-9][0-9]{0,17}$' or (p_input->>'expected_revision')::bigint<>a.revision then raise exception using errcode='P4090',message='Stale agreement revision'; end if;
    if p_operation<>'set_access' and a.lifecycle<>'preparing' then raise exception using errcode='P4090',message='Agreement is already frozen'; end if;
  end if;
  if p_operation='create_draft' then
    perform accordly_commands.assert_keys(p_input,array['title','draft']);
    perform accordly_commands.validate_draft(p_input->'draft');
    aid:=accordly_commands.create_agreement(p_auth,org,accordly_commands.require_text(p_input,'title',300));
    actor:=accordly_commands.set_registered_actor(p_auth);
    insert into accordly.agreement_drafts(organization_id,agreement_id,kind,author_principal_id,payload) values(org,aid,'initial',actor,p_input->'draft');
    result:=jsonb_build_object('agreement_id',aid,'revision','1');
  elsif p_operation='update_draft' then
    perform accordly_commands.assert_keys(p_input,array['expected_revision','draft']);
    perform accordly_commands.validate_draft(p_input->'draft');
    update accordly.agreement_drafts set payload=p_input->'draft',revision=revision+1,updated_at=clock_timestamp() where organization_id=org and agreement_id=aid and kind='initial';
    if not found then raise exception using errcode='23514',message='Initial draft required'; end if;
  elsif p_operation='set_parties' then
    perform accordly_commands.assert_keys(p_input,array['expected_revision','provider','client']);
    perform accordly_commands.assert_keys(p_input->'provider',array['legal_name','representative_name']);
    perform accordly_commands.assert_keys(p_input->'client',array['legal_name','representative_name','email']);
    if exists(select 1 from accordly.agreement_versions where organization_id=org and agreement_id=aid) then raise exception using errcode='P4090',message='Issued party identity cannot change'; end if;
    foreach side in array array['provider','client'] loop
      contact:=p_input->side;
      email:=accordly_commands.normalized_email(case when side='provider' then p_verified_email else contact->>'email' end);
      perform accordly_commands.require_text(contact,'legal_name',300); perform accordly_commands.require_text(contact,'representative_name',200);
      insert into accordly.agreement_parties(organization_id,agreement_id,side,legal_name,contact_email) values(org,aid,side,contact->>'legal_name',email)
      on conflict on constraint agreement_parties_agreement_id_side_key do update set legal_name=excluded.legal_name,contact_email=excluded.contact_email returning id into party;
      if (select count(*) from accordly.party_representatives where organization_id=org and agreement_id=aid and party_id=party and revoked_at is null)>1 then raise exception using errcode='23514',message='Use a reviewed multi-representative management flow'; end if;
      select * into representative from accordly.party_representatives where organization_id=org and agreement_id=aid and party_id=party and revoked_at is null;
      if found then
        if side='client' and representative.principal_id is not null and (representative.normalized_email<>email or representative.display_name<>contact->>'representative_name') then raise exception using errcode='23514',message='Verified client identity cannot be reassigned'; end if;
        update accordly.party_representatives set principal_id=case when side='provider' then actor else principal_id end,entered_email=email,normalized_email=email,display_name=contact->>'representative_name',authority_source=case when side='provider' then 'registered_provider_self_designation' else authority_source end,can_review=true,can_propose=true,can_sign=true,authority_revision=authority_revision+1 where id=representative.id;
      else
        insert into accordly.party_representatives(organization_id,agreement_id,party_id,principal_id,entered_email,normalized_email,display_name,authority_source,can_review,can_propose,can_sign)
        values(org,aid,party,case when side='provider' then actor else null end,email,email,contact->>'representative_name',case when side='provider' then 'registered_provider_self_designation' else 'client_designation_pending_verification' end,true,true,true);
      end if;
    end loop;
  elsif p_operation='set_access' then
    perform accordly_commands.assert_keys(p_input,array['expected_revision','principal_id','grant_type','active']);
    target:=(p_input->>'principal_id')::uuid; grant_kind:=p_input->>'grant_type';
    if jsonb_typeof(p_input->'active') is distinct from 'boolean' or target is null then raise exception using errcode='22023',message='Explicit grant decision required'; end if;
    make_active:=(p_input->>'active')::boolean;
    if grant_kind in ('provider_read','provider_edit','provider_issue') then
      if make_active and (accordly_commands.target_org_role(org,target) is null or (grant_kind<>'provider_read' and accordly_commands.target_org_role(org,target) not in ('owner','admin','editor'))) then raise exception using errcode='42501',message='Provider grant target has no eligible membership'; end if;
    elsif grant_kind='client_review' then
      if a.lifecycle='active' or (make_active and not exists(select 1 from accordly.party_representatives r join accordly.agreement_parties p on p.id=r.party_id where r.organization_id=org and r.agreement_id=aid and r.principal_id=target and r.revoked_at is null and r.can_review and p.side='client')) then raise exception using errcode='42501',message='Verified existing client binding required'; end if;
    else raise exception using errcode='22023',message='Unknown grant type'; end if;
    if make_active then
      insert into accordly.agreement_access_grants(organization_id,agreement_id,principal_id,grant_type,issued_by) values(org,aid,target,grant_kind,actor) on conflict(agreement_id,principal_id,grant_type) where revoked_at is null do nothing;
    else update accordly.agreement_access_grants set revoked_at=clock_timestamp() where organization_id=org and agreement_id=aid and principal_id=target and grant_type=grant_kind and revoked_at is null; end if;
  elsif p_operation='freeze' then
    perform accordly_commands.assert_keys(p_input,array['expected_revision']);
    result:=accordly_commands.freeze_candidate(org,aid,p_verified_email);
    update accordly.agreements set lifecycle='awaiting_signatures',pending_initial_proposal_id=(result->>'proposal_id')::uuid where organization_id=org and id=aid;
  else raise exception using errcode='22023',message='Unsupported operation'; end if;
  if p_operation<>'create_draft' then
    update accordly.agreements set revision=revision+1,updated_at=clock_timestamp() where organization_id=org and id=aid returning revision into a.revision;
    result:=coalesce(result,'{}')||jsonb_build_object('agreement_id',aid,'revision',a.revision::text);
  end if;
  insert into accordly.command_receipts(id,organization_id,agreement_id,actor_principal_id,operation,resource_id,idempotency_key,request_digest,outcome)
    values(receipt,org,aid,actor,p_operation,p_resource,p_key,request_hash,result);
  select coalesce(max(sequence),0)+1 into seq from accordly.audit_events where organization_id=org and agreement_id=aid;
  select event_hash into prior from accordly.audit_events where organization_id=org and agreement_id=aid order by sequence desc limit 1;
  prior:=coalesce(prior,decode(repeat('00',32),'hex'));
  event_time:=clock_timestamp();
  event_body:=jsonb_build_object('id',event,'organization_id',org,'agreement_id',aid,'sequence',seq::text,'actor_principal_id',actor,'operation',p_operation,'receipt_id',receipt,'request_digest',encode(request_hash,'hex'),'revision',result->>'revision','version_id',result->>'version_id','version_digest',result->>'digest','occurred_at',to_char(event_time at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'));
  insert into accordly.audit_events(id,organization_id,agreement_id,sequence,receipt_id,actor_principal_id,event_type,occurred_at,canonical_event,prior_event_hash)
    values(event,org,aid,seq,receipt,actor,p_operation,event_time,convert_to(accordly_commands.canonical_json(event_body),'UTF8'),prior);
  if p_operation='freeze' then
    insert into accordly.outbox_events(organization_id,agreement_id,deduplication_key,event_type,references_json)
      values(org,aid,receipt,'proposal_frozen',jsonb_build_object('proposal_id',result->>'proposal_id','version_id',result->>'version_id','digest',result->>'digest'));
  end if;
  perform set_config('accordly.actor_id','',true);
  return result;
end $$;

create function accordly_commands.agreement_details(p_auth uuid,p_agreement uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; result jsonb; draft jsonb; parties jsonb; versions jsonb;
begin
  org:=accordly_commands.authorize_operation(p_auth,'read',p_agreement);
  perform accordly_commands.set_registered_actor(p_auth);
  select jsonb_build_object('id',id,'organization_id',organization_id,'title',title,'lifecycle',lifecycle,'revision',revision::text) into result from accordly.agreements where organization_id=org and id=p_agreement;
  select jsonb_build_object('id',id,'revision',revision::text,'payload',payload) into draft from accordly.agreement_drafts where organization_id=org and agreement_id=p_agreement and kind='initial';
  select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'side',p.side,'legal_name',p.legal_name,'contact_email',p.contact_email) order by p.side),'[]') into parties from accordly.agreement_parties p where p.organization_id=org and p.agreement_id=p_agreement;
  select coalesce(jsonb_agg(v.body order by v.n),'[]') into versions from (select version_number as n,jsonb_build_object('id',id,'version_number',version_number::text,'digest',encode(digest,'hex'),'snapshot',convert_from(canonical_bytes,'UTF8')::jsonb) as body from accordly.agreement_versions where organization_id=org and agreement_id=p_agreement order by version_number desc limit 100) v;
  perform set_config('accordly.actor_id','',true);
  return result||jsonb_build_object('draft',draft,'parties',parties,'versions',versions);
end $$;

reset role;
alter function accordly_commands.authorize_operation(uuid,text,uuid) owner to accordly_executor;
alter function accordly_commands.execute_preparation(uuid,text,uuid,uuid,jsonb,text) owner to accordly_executor;
alter function accordly_commands.agreement_details(uuid,uuid) owner to accordly_executor;
alter function accordly_commands.freeze_candidate(uuid,uuid,text) owner to accordly_freezer;
revoke all on function accordly_commands.authorize_operation(uuid,text,uuid),accordly_commands.execute_preparation(uuid,text,uuid,uuid,jsonb,text),accordly_commands.agreement_details(uuid,uuid),accordly_commands.freeze_candidate(uuid,uuid,text) from public,anon,authenticated,service_role,accordly_gateway;
grant execute on function accordly_commands.authorize_operation(uuid,text,uuid),accordly_commands.execute_preparation(uuid,text,uuid,uuid,jsonb,text),accordly_commands.agreement_details(uuid,uuid) to accordly_gateway;
grant execute on function accordly_commands.authorize_operation(uuid,text,uuid),accordly_commands.freeze_candidate(uuid,uuid,text) to accordly_executor;
grant execute on function accordly_commands.assert_keys(jsonb,text[]),accordly_commands.require_text(jsonb,text,integer),accordly_commands.validate_deadline(jsonb) to accordly_freezer;
revoke create on schema accordly_commands from accordly_executor,accordly_authorizer,accordly_freezer;
commit;
