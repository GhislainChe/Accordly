-- Identity assertions are simulated; execution privileges/RLS/transactions are real.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
grant usage on schema extensions to accordly_gateway,accordly_signer;
select no_plan();
insert into auth.users(id,email) values('30000000-0000-4000-8000-000000000001','signer@example.test'),('30000000-0000-4000-8000-000000000002','other-signer@example.test');
set local role accordly_gateway;
do $$ declare org uuid; a jsonb; f jsonb; begin
 org:=accordly_commands.create_organization('30000000-0000-4000-8000-000000000001','Signing fixture','individual');
 a:=accordly_commands.execute_preparation('30000000-0000-4000-8000-000000000001','create_draft',org,gen_random_uuid(),'{"title":"Sign exact version","draft":{"scope":"Scope","terms":"Terms","amount_minor":"1000","currency_code":"XAF","currency_exponent":0,"content_language":"en","deadline":{"kind":"date","date":"2027-01-31"},"milestones":[],"attachments":[]}}','signer@example.test');
 perform accordly_commands.execute_preparation('30000000-0000-4000-8000-000000000001','set_parties',(a->>'agreement_id')::uuid,gen_random_uuid(),'{"expected_revision":"1","provider":{"legal_name":"Provider","representative_name":"Provider"},"client":{"legal_name":"Client","representative_name":"Client","email":"sql-client@example.test"}}','signer@example.test');
 f:=accordly_commands.execute_preparation('30000000-0000-4000-8000-000000000001','freeze',(a->>'agreement_id')::uuid,gen_random_uuid(),'{"expected_revision":"2"}','signer@example.test');
 perform set_config('sign.agreement',a->>'agreement_id',true); perform set_config('sign.frozen',f::text,true);
end $$;
create function pg_temp.run_sign(op text,input jsonb,internal jsonb default '{}',provider boolean default false) returns jsonb language sql as $$
 select accordly_commands.signing_command(case when provider then '30000000-0000-4000-8000-000000000001'::uuid else null end,case when provider then 'signer@example.test' else null end,case when provider then '30000000-0000-4000-8000-000000000003'::uuid else null end,op,input,internal)
$$;
do $$ declare s jsonb; r jsonb; n text; iid uuid; begin
 r:=pg_temp.run_sign('list_slots',jsonb_build_object('agreement_id',current_setting('sign.agreement')),'{}',true);
 for s in select value from jsonb_array_elements(r->'slots') loop
   n:=s->>'side'; iid:=gen_random_uuid();
   perform set_config('sign.'||n||'_slot',s->>'slot_id',true); perform set_config('sign.'||n||'_invitation',iid::text,true);
   r:=pg_temp.run_sign('invite',jsonb_build_object('agreement_id',current_setting('sign.agreement'),'slot_id',s->>'slot_id','idempotency_key',gen_random_uuid()),jsonb_build_object('invitation_id',iid,'token_digest',repeat(case when n='client' then '11' else '12' end,32)),true);
 end loop;
end $$;
select is(pg_temp.run_sign('start_access',jsonb_build_object('invitation_id',current_setting('sign.client_invitation')),jsonb_build_object('token_digest',repeat('ff',32)))->>'error','invalid_capability','forged token denied');
select is(pg_temp.run_sign('read','{}',jsonb_build_object('session_id',gen_random_uuid(),'session_digest',repeat('22',32)))->>'error','invalid_capability','unknown capability grants no content');
select throws_ok($$select accordly_commands.resolve_signing_credential('invitation',current_setting('sign.client_invitation')::uuid)$$,'42501',null,'gateway cannot use raw credential lookup');
select throws_ok($$select accordly_commands.signing_command_impl(null,null,null,'read','{}','{}')$$,'42501',null,'gateway cannot bypass context-cleaning wrapper');
select throws_ok($$select * from accordly.invitations$$,'42501',null,'gateway has no direct credential table access');
do $$ declare n text; cid uuid; sid uuid; pid uuid; r jsonb; inv jsonb; begin
 foreach n in array array['client','provider'] loop
   cid:=gen_random_uuid(); sid:=gen_random_uuid(); pid:=gen_random_uuid();
   inv:=jsonb_build_object('invitation_id',current_setting('sign.'||n||'_invitation'));
   r:=pg_temp.run_sign('start_access',inv,jsonb_build_object('token_digest',repeat(case when n='client' then '11' else '12' end,32),'challenge_id',cid,'code_hmac',repeat('33',32),'key_id','test'),n='provider');
   if r ? 'error' then raise exception 'Access challenge failed: %',r; end if;
   r:=pg_temp.run_sign('verify_access',inv||jsonb_build_object('challenge_id',cid),jsonb_build_object('token_digest',repeat(case when n='client' then '11' else '12' end,32),'code_hmac',repeat('33',32),'key_id','test','session_id',sid,'session_digest',repeat(case when n='client' then '44' else '45' end,32)),n='provider');
   if r ? 'error' then raise exception 'Verification failed: %',r; end if;
   perform set_config('sign.'||n||'_session',jsonb_build_object('session_id',sid,'session_digest',repeat(case when n='client' then '44' else '45' end,32))::text,true);
   r:=pg_temp.run_sign('start_consent',jsonb_build_object('proposal_id',current_setting('sign.frozen')::jsonb->>'proposal_id','digest',current_setting('sign.frozen')::jsonb->>'digest'),current_setting('sign.'||n||'_session')::jsonb||jsonb_build_object('challenge_id',gen_random_uuid(),'code_hmac',repeat('55',32),'key_id','test'),n='provider');
   cid:=(r->>'challenge_id')::uuid;
   r:=pg_temp.run_sign('verify_consent',jsonb_build_object('challenge_id',cid),current_setting('sign.'||n||'_session')::jsonb||jsonb_build_object('code_hmac',repeat('55',32),'key_id','test','proof_id',pid,'proof_digest',repeat(case when n='client' then '66' else '67' end,32)),n='provider');
   if r ? 'error' then raise exception 'Consent verification failed: %',r; end if;
   perform set_config('sign.'||n||'_proof',pid::text,true);
 end loop;
end $$;
select is(pg_temp.run_sign('read','{}',current_setting('sign.client_session')::jsonb)->>'digest',current_setting('sign.frozen')::jsonb->>'digest','verified guest reads exact canonical version');
select is(nullif(current_setting('accordly.signing_org',true),''),null::text,'wrapper clears signing scope within same transaction');
select is(pg_temp.run_sign('read','{}',current_setting('sign.provider_session')::jsonb)->>'error','invalid_capability','provider session still requires live registered assertion');
create function pg_temp.sign_input(n text) returns jsonb language sql as $$
 select jsonb_build_object('proposal_id',current_setting('sign.frozen')::jsonb->>'proposal_id','digest',current_setting('sign.frozen')::jsonb->>'digest','proof_id',current_setting('sign.'||n||'_proof'),'typed_name',n,'affirmative',true,'consent_text','By signing, I explicitly consent to this exact agreement version.','disclosure_version','accordly-consent-v1','idempotency_key','30000000-0000-4000-8000-000000000004')
$$;
select throws_ok($$select pg_temp.run_sign('initial_signature',pg_temp.sign_input('client')||'{"affirmative":false}',current_setting('sign.client_session')::jsonb||jsonb_build_object('proof_digest',repeat('66',32)))$$,'P4090',null,'no affirmative consent means no signature');
select throws_ok($$select pg_temp.run_sign('initial_signature',pg_temp.sign_input('client')||jsonb_build_object('digest',repeat('00',32)),current_setting('sign.client_session')::jsonb||jsonb_build_object('proof_digest',repeat('66',32)))$$,'P4090',null,'stale digest rejected');
select lives_ok($$select pg_temp.run_sign('initial_signature',pg_temp.sign_input('client'),current_setting('sign.client_session')::jsonb||jsonb_build_object('proof_digest',repeat('66',32)))$$,'guest signs with exact proof');
select is((pg_temp.run_sign('initial_signature',pg_temp.sign_input('client'),current_setting('sign.client_session')::jsonb||jsonb_build_object('proof_digest',repeat('66',32)))->>'active')::boolean,false,'partial quorum stays pending and retry is safe');
reset role;
set local role accordly_signer;
select set_config('accordly.signing_agreement',current_setting('sign.agreement'),true) is not null as scope_set \gset
select set_config('accordly.signing_org',(current_setting('sign.frozen')::jsonb->'snapshot'->>'organization_id'),true) is not null as org_set \gset
select throws_ok($$update accordly.agreement_proposals set state='effective',terminal_at=clock_timestamp() where agreement_id=current_setting('sign.agreement')::uuid; update accordly.agreements set lifecycle='active',pending_initial_proposal_id=null,effective_version_id=(current_setting('sign.frozen')::jsonb->>'version_id')::uuid where id=current_setting('sign.agreement')::uuid; set constraints all immediate$$,'23514',null,'even internal signing role cannot commit activation below exact quorum');
reset role;
set local role accordly_gateway;
select throws_ok($$select pg_temp.run_sign('initial_signature',pg_temp.sign_input('client')||'{"typed_name":"changed"}',current_setting('sign.client_session')::jsonb||jsonb_build_object('proof_digest',repeat('66',32)))$$,'P4090',null,'conflicting signature key rejected');
select lives_ok($$select pg_temp.run_sign('initial_signature',pg_temp.sign_input('provider'),current_setting('sign.provider_session')::jsonb||jsonb_build_object('proof_digest',repeat('67',32)),true); set constraints all immediate$$,'last required verified signature atomically activates');
reset role;
select is((select lifecycle from accordly.agreements where id=current_setting('sign.agreement')::uuid),'active','database activation persisted');
select is((select count(*)::integer from accordly.consent_decisions where agreement_id=current_setting('sign.agreement')::uuid),2,'one immutable decision per slot');
select ok((select bool_and(evidence_digest=sha256(evidence_bytes)) from accordly.consent_decisions),'evidence digests bind exact bytes');
select throws_ok($$update accordly.consent_decisions set typed_name='rewritten'$$,'23514',null,'even owner cannot rewrite evidence through ordinary DML');
set local role accordly_gateway;
select lives_ok($$select pg_temp.run_sign('logout','{}',current_setting('sign.client_session')::jsonb)$$,'guest can revoke own session');
select is(pg_temp.run_sign('read','{}',current_setting('sign.client_session')::jsonb)->>'error','invalid_capability','revoked session cannot read');
select is(pg_temp.run_sign('initial_signature',pg_temp.sign_input('client'),current_setting('sign.client_session')::jsonb||jsonb_build_object('proof_digest',repeat('66',32)))->>'error','invalid_capability','revoked session cannot replay receipt');
select is(nullif(current_setting('accordly.signing_principal',true),''),null::text,'guest principal context is cleared');
select is(accordly_commands.signing_rate_limit(array['invitation:sqlfixture'],true),true,'first shared send counter allows request');
do $$ begin for i in 1..4 loop perform accordly_commands.signing_rate_limit(array['invitation:sqlfixture'],true); end loop; end $$;
select is(accordly_commands.signing_rate_limit(array['invitation:sqlfixture'],true),false,'shared database bucket blocks sixth send across calls');
reset role;
set local role anon;
select throws_ok($$select * from accordly.consent_decisions$$,'42501',null,'anonymous evidence access denied');
select throws_ok($$select accordly_commands.signing_command(null,null,null,'read','{}','{}')$$,'42501',null,'public signing RPC denied');
reset role;
set local role authenticated;
select throws_ok($$select * from accordly.guest_sessions$$,'42501',null,'ordinary registered API role cannot read guest credentials');
select throws_ok($$select accordly_commands.signing_rate_limit(array['global:local'],false)$$,'42501',null,'API role cannot invoke internal abuse command');
reset role;
set local role accordly_signer;
select is((select count(*)::integer from accordly.consent_decisions),0,'internal signer without derived scope sees no evidence');
select is((select count(*)::integer from accordly.invitations),0,'internal signer without derived scope sees no invitations');
reset role;
select ok(not pg_has_role('accordly_gateway','accordly_signer','MEMBER'),'gateway cannot assume signer');
select ok(not exists(select 1 from pg_tables where schemaname='accordly' and not rowsecurity),'all domain tables enable RLS');
select ok(not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='accordly' and c.relkind='r' and not c.relforcerowsecurity),'all domain tables force RLS');
select * from finish();
rollback;
