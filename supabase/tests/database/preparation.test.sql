begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
grant usage on schema extensions to accordly_gateway;
select no_plan();
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','prepare-a@example.test'),
 ('10000000-0000-4000-8000-000000000002','prepare-b@example.test'),
 ('10000000-0000-4000-8000-000000000003','prepare-viewer@example.test'),
 ('10000000-0000-4000-8000-000000000004','prepare-client@example.test');
set local role accordly_gateway;
do $$ begin
 perform set_config('prep.a',accordly_commands.register_principal('10000000-0000-4000-8000-000000000001')::text,true);
 perform set_config('prep.b',accordly_commands.register_principal('10000000-0000-4000-8000-000000000002')::text,true);
 perform set_config('prep.viewer',accordly_commands.register_principal('10000000-0000-4000-8000-000000000003')::text,true);
 perform set_config('prep.client',accordly_commands.register_principal('10000000-0000-4000-8000-000000000004')::text,true);
 perform set_config('prep.org',accordly_commands.create_organization('10000000-0000-4000-8000-000000000001','Preparation','business')::text,true);
 perform set_config('prep.other_org',accordly_commands.create_organization('10000000-0000-4000-8000-000000000002','Other tenant','individual')::text,true);
 perform set_config('prep.other_agreement',accordly_commands.create_agreement('10000000-0000-4000-8000-000000000002',current_setting('prep.other_org')::uuid,'Other engagement')::text,true);
 perform accordly_commands.set_membership('10000000-0000-4000-8000-000000000001',current_setting('prep.org')::uuid,current_setting('prep.viewer')::uuid,'viewer',true);
 perform set_config('prep.payload','{"scope":"Scope exact é","terms":"Terms","amount_minor":"1000","currency_code":"XAF","currency_exponent":0,"content_language":"en","deadline":{"kind":"date","date":"2027-01-31"},"milestones":[],"attachments":[]}',true);
 perform set_config('prep.create_key',gen_random_uuid()::text,true);
 perform set_config('prep.freeze_key',gen_random_uuid()::text,true);
end $$;
select lives_ok($$select accordly_commands.authorize_operation('10000000-0000-4000-8000-000000000001','create_draft',current_setting('prep.org')::uuid)$$,'gateway preflight permits owner');
select throws_ok($$select accordly_commands.authorize_operation('10000000-0000-4000-8000-000000000002','create_draft',current_setting('prep.org')::uuid)$$,'42501',null,'cross-tenant preflight rejects creation');
do $$ declare r jsonb; begin
 r:=accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','create_draft',current_setting('prep.org')::uuid,current_setting('prep.create_key')::uuid,jsonb_build_object('title','Original','draft',current_setting('prep.payload')::jsonb),'prepare-a@example.test');
 perform set_config('prep.agreement',r->>'agreement_id',true);
end $$;
select is((accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','create_draft',current_setting('prep.org')::uuid,current_setting('prep.create_key')::uuid,jsonb_build_object('title','Original','draft',current_setting('prep.payload')::jsonb),'prepare-a@example.test')->>'agreement_id'),current_setting('prep.agreement'),'identical create retry returns the same agreement');
select throws_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','create_draft',current_setting('prep.org')::uuid,current_setting('prep.create_key')::uuid,jsonb_build_object('title','Changed','draft',current_setting('prep.payload')::jsonb),'prepare-a@example.test')$$,'P4090',null,'same key with different content conflicts');
select throws_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000002','update_draft',current_setting('prep.agreement')::uuid,gen_random_uuid(),jsonb_build_object('expected_revision','1','draft',current_setting('prep.payload')::jsonb),'prepare-b@example.test')$$,'P4040',null,'cross-tenant update does not disclose the agreement');
select throws_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','freeze',current_setting('prep.agreement')::uuid,current_setting('prep.freeze_key')::uuid,'{"expected_revision":"1"}','prepare-a@example.test')$$,'23514',null,'missing party quorum prevents freezing');
select throws_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','set_parties',current_setting('prep.agreement')::uuid,gen_random_uuid(),'{"expected_revision":"1","provider":{"legal_name":"Provider","representative_name":"A"},"client":{"legal_name":"Client","representative_name":"C","email":"prepare-client@example.test","principal_id":"10000000-0000-4000-8000-000000000004"}}','prepare-a@example.test')$$,'22023',null,'provider cannot inject a verified client principal binding');
select lives_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','set_parties',current_setting('prep.agreement')::uuid,gen_random_uuid(),'{"expected_revision":"1","provider":{"legal_name":"Provider","representative_name":"A"},"client":{"legal_name":"Client","representative_name":"C","email":"prepare-client@example.test"}}','prepare-a@example.test')$$,'authorized parties are configured without client consent claims');
select throws_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','set_access',current_setting('prep.agreement')::uuid,gen_random_uuid(),jsonb_build_object('expected_revision','2','principal_id',current_setting('prep.b'),'grant_type','provider_read','active',true),'prepare-a@example.test')$$,'42501',null,'provider grant cannot target another tenant member');
select throws_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','set_access',current_setting('prep.agreement')::uuid,gen_random_uuid(),jsonb_build_object('expected_revision','2','principal_id',current_setting('prep.viewer'),'grant_type','provider_edit','active',true),'prepare-a@example.test')$$,'42501',null,'viewer cannot receive editor powers through an agreement grant');
select lives_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','set_access',current_setting('prep.agreement')::uuid,gen_random_uuid(),jsonb_build_object('expected_revision','2','principal_id',current_setting('prep.viewer'),'grant_type','provider_read','active',true),'prepare-a@example.test')$$,'owner can grant scoped viewer access');
select lives_ok($$select accordly_commands.agreement_details('10000000-0000-4000-8000-000000000003',current_setting('prep.agreement')::uuid)$$,'authorized viewer can retrieve its agreement');
select throws_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000003','update_draft',current_setting('prep.agreement')::uuid,gen_random_uuid(),jsonb_build_object('expected_revision','3','draft',current_setting('prep.payload')::jsonb),'prepare-viewer@example.test')$$,'42501',null,'read permission does not imply edit permission');
select throws_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','update_draft',current_setting('prep.agreement')::uuid,gen_random_uuid(),jsonb_build_object('expected_revision','1','draft',current_setting('prep.payload')::jsonb),'prepare-a@example.test')$$,'P4090',null,'stale revision rejected before editing');
select throws_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','update_draft',current_setting('prep.agreement')::uuid,gen_random_uuid(),jsonb_build_object('expected_revision','3','draft','{"amount_minor":"1.5"}'::jsonb),'prepare-a@example.test')$$,'22023',null,'malformed draft cannot enter the database');
select lives_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','update_draft',current_setting('prep.agreement')::uuid,gen_random_uuid(),jsonb_build_object('expected_revision','3','draft',current_setting('prep.payload')::jsonb),'prepare-a@example.test')$$,'permitted draft fields update with revision check');
select is(accordly_commands.agreement_details('10000000-0000-4000-8000-000000000001',current_setting('prep.agreement')::uuid)->>'revision','4','failed commands did not advance revision');
do $$ declare r jsonb; begin
 r:=accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','freeze',current_setting('prep.agreement')::uuid,current_setting('prep.freeze_key')::uuid,'{"expected_revision":"4"}','prepare-a@example.test');
 perform set_config('prep.frozen',r::text,true);
end $$;
select is(accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','freeze',current_setting('prep.agreement')::uuid,current_setting('prep.freeze_key')::uuid,'{"expected_revision":"4"}','prepare-a@example.test'),current_setting('prep.frozen')::jsonb,'freeze retry succeeds even after lifecycle changed');
select is(accordly_commands.agreement_details('10000000-0000-4000-8000-000000000001',current_setting('prep.agreement')::uuid)->>'lifecycle','awaiting_signatures','freezing never activates an agreement');
select throws_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','update_draft',current_setting('prep.agreement')::uuid,gen_random_uuid(),jsonb_build_object('expected_revision','5','draft',current_setting('prep.payload')::jsonb),'prepare-a@example.test')$$,'P4090',null,'frozen proposal cannot be silently edited');
select throws_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','freeze',current_setting('prep.agreement')::uuid,current_setting('prep.freeze_key')::uuid,'{"expected_revision":"5"}','prepare-a@example.test')$$,'P4090',null,'conflicting freeze retry is rejected');
select is(nullif(current_setting('accordly.actor_id',true),''),null::text,'new command path clears actor context');
select throws_ok($$select accordly_commands.freeze_candidate(current_setting('prep.org')::uuid,current_setting('prep.agreement')::uuid,'prepare-a@example.test')$$,'42501',null,'gateway cannot call the privileged internal freezer directly');
reset role;
select is((select count(*)::integer from accordly.agreement_versions where agreement_id=current_setting('prep.agreement')::uuid),1,'one immutable version despite retries');
select is((select count(*)::integer from accordly.proposal_participants where agreement_id=current_setting('prep.agreement')::uuid),2,'both required party slots are frozen');
select is((select count(*)::integer from accordly.outbox_events where agreement_id=current_setting('prep.agreement')::uuid),1,'durable outbox event emitted once');
select is((select count(*)::integer from accordly.command_receipts where agreement_id=current_setting('prep.agreement')::uuid),5,'only successful mutations have persistent receipts');
select is((select count(*)::integer from accordly.audit_events where agreement_id=current_setting('prep.agreement')::uuid),5,'successful commands have one atomic audit event each');
select ok((select bool_and(event_hash=sha256(prior_event_hash||canonical_event)) from accordly.audit_events),'audit hashes bind stored canonical bytes');
select ok((select bool_and((convert_from(canonical_event,'UTF8')::jsonb->>'occurred_at')::timestamptz=occurred_at) from accordly.audit_events),'audit canonical bytes bind exact server timestamps');
select is(encode(sha256(convert_to(current_setting('prep.frozen')::jsonb->>'canonical_text','UTF8')),'hex'),current_setting('prep.frozen')::jsonb->>'digest','returned digest hashes exact canonical bytes');
select throws_ok($$update accordly.command_receipts set outcome='{}'$$,'23514',null,'idempotency receipts cannot be rewritten');
select throws_ok($$delete from accordly.audit_events$$,'23514',null,'agreement audit cannot be deleted');
select throws_ok($$insert into accordly.outbox_events(organization_id,agreement_id,deduplication_key,event_type,references_json) select current_setting('prep.other_org')::uuid,current_setting('prep.other_agreement')::uuid,id,'proposal_frozen','{}' from accordly.command_receipts where operation='create_draft'$$,'23503',null,'outbox receipt relationship is tenant-scoped');
select throws_ok($$insert into accordly.outbox_events(organization_id,agreement_id,deduplication_key,event_type,references_json,lease_owner) select organization_id,agreement_id,id,'proposal_frozen','{}',gen_random_uuid() from accordly.command_receipts where operation='update_draft'$$,'23514',null,'partial lease metadata is rejected');
select ok(not pg_has_role('accordly_gateway','accordly_freezer','MEMBER'),'gateway cannot assume the freezer role');
select is((select principal_id from accordly.party_representatives r join accordly.agreement_parties p on p.id=r.party_id where p.side='client' and r.agreement_id=current_setting('prep.agreement')::uuid),null::uuid,'client designation did not fabricate verified identity');
select is((select count(*)::integer from accordly.command_receipts where operation='freeze'),1,'failed precondition left no receipt or partial freeze');
-- An expired success remains a tombstone: the key cannot create another effect.
do $$ declare key uuid:=gen_random_uuid(); input jsonb:=jsonb_build_object('expected_revision','5','draft',current_setting('prep.payload')::jsonb); begin
  insert into accordly.command_receipts(organization_id,agreement_id,actor_principal_id,operation,resource_id,idempotency_key,request_digest,outcome,committed_at,expires_at)
  values(current_setting('prep.org')::uuid,current_setting('prep.agreement')::uuid,current_setting('prep.a')::uuid,'update_draft',current_setting('prep.agreement')::uuid,key,sha256(convert_to(accordly_commands.canonical_json(jsonb_build_object('actor_principal_id',current_setting('prep.a')::uuid,'operation','update_draft','resource_id',current_setting('prep.agreement')::uuid,'input',input,'verified_provider_email',null)),'UTF8')),'{}',clock_timestamp()-interval '31 days',clock_timestamp()-interval '1 day');
  perform set_config('prep.expired_key',key::text,true);
end $$;
set local role accordly_gateway;
select throws_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','update_draft',current_setting('prep.agreement')::uuid,current_setting('prep.expired_key')::uuid,jsonb_build_object('expected_revision','5','draft',current_setting('prep.payload')::jsonb),'prepare-a@example.test')$$,'P4090',null,'expired key is rejected rather than reused');
select lives_ok($$select accordly_commands.set_membership('10000000-0000-4000-8000-000000000001',current_setting('prep.org')::uuid,current_setting('prep.viewer')::uuid,'viewer',false)$$,'member can be removed while old agreement grants remain');
select lives_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','set_access',current_setting('prep.agreement')::uuid,gen_random_uuid(),jsonb_build_object('expected_revision','5','principal_id',current_setting('prep.viewer'),'grant_type','provider_read','active',false),'prepare-a@example.test')$$,'owner can revoke stale grants after membership removal');
select lives_ok($$select accordly_commands.set_membership('10000000-0000-4000-8000-000000000001',current_setting('prep.org')::uuid,current_setting('prep.b')::uuid,'owner',true)$$,'owner can explicitly appoint a second owner');
select lives_ok($$select accordly_commands.set_membership('10000000-0000-4000-8000-000000000001',current_setting('prep.org')::uuid,current_setting('prep.a')::uuid,'viewer',true)$$,'owner can demote itself after another owner is installed');
select throws_ok($$select accordly_commands.execute_preparation('10000000-0000-4000-8000-000000000001','freeze',current_setting('prep.agreement')::uuid,current_setting('prep.freeze_key')::uuid,'{"expected_revision":"4"}','prepare-a@example.test')$$,'42501',null,'revoked issue authority cannot replay a cached freeze outcome');
reset role;
set constraints all immediate;
select * from finish();
rollback;
