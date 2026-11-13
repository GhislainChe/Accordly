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
create function pg_temp.sign_input(n text) returns jsonb language sql as $$
 select jsonb_build_object('proposal_id',current_setting('sign.frozen')::jsonb->>'proposal_id','digest',current_setting('sign.frozen')::jsonb->>'digest','proof_id',current_setting('sign.'||n||'_proof'),'typed_name',n,'affirmative',true,'consent_text','By signing, I explicitly consent to this exact agreement version.','disclosure_version','accordly-consent-v1','idempotency_key','30000000-0000-4000-8000-000000000004')
$$;

do $$ begin perform pg_temp.run_sign('initial_signature',pg_temp.sign_input('client'),current_setting('sign.client_session')::jsonb||jsonb_build_object('proof_digest',repeat('66',32))); perform pg_temp.run_sign('initial_signature',pg_temp.sign_input('provider'),current_setting('sign.provider_session')::jsonb||jsonb_build_object('proof_digest',repeat('67',32)),true); end $$;
set constraints all immediate;
set constraints all deferred;

create function pg_temp.amend(op text,input jsonb,guest boolean default false) returns jsonb language sql as $$
 select accordly_commands.amendment_command(case when guest then null else '30000000-0000-4000-8000-000000000001'::uuid end,case when guest then null else 'signer@example.test' end,case when guest then null else '30000000-0000-4000-8000-000000000003'::uuid end,op,jsonb_build_object('agreement_id',current_setting('sign.agreement'))||input,case when guest then current_setting('sign.client_session')::jsonb||'{"use_session":"true"}' else '{"use_session":"false"}' end)
$$;
create function pg_temp.amend_payload(delta text default '25000') returns jsonb language sql as $$
 select jsonb_build_object('draft',(current_setting('sign.frozen')::jsonb->'snapshot')-array['schema_version','canonicalization_version','organization_id','agreement_id','version_id','version_number','title','parties','consent_text','disclosure_version']||jsonb_build_object('scope','Scope plus five social media templates','amount_minor',(1000+delta::bigint)::text),'requested_change','Five social media templates','reason','Additional service requested','delta_minor',delta,'revises_proposal_id',null)
$$;
select lives_ok($$select pg_temp.amend('amendment_list','{}')$$,'designated provider can read active effective terms');
select lives_ok($$select pg_temp.amend('amendment_list','{}',true)$$,'verified guest can read amendment history');
select throws_ok($$select accordly_commands.amendment_command('30000000-0000-4000-8000-000000000002','other-signer@example.test',null,'amendment_list',jsonb_build_object('agreement_id',current_setting('sign.agreement')),'{}')$$,'P4040',null,'cross tenant amendment enumeration blocked');
select throws_ok($$select accordly_commands.amendment_command(null,null,null,'amendment_list',jsonb_build_object('agreement_id',current_setting('sign.agreement')),'{"use_session":"true"}')$$,'42501',null,'guest without capability cannot inspect history');
select throws_ok($$select pg_temp.amend('amendment_create',jsonb_build_object('base_version_id',gen_random_uuid(),'idempotency_key',gen_random_uuid(),'payload',pg_temp.amend_payload()))$$,'P4090',null,'stale base rejected');
select throws_ok($$select pg_temp.amend('amendment_create',jsonb_build_object('base_version_id',current_setting('sign.frozen')::jsonb->>'version_id','idempotency_key',gen_random_uuid(),'payload',jsonb_set(pg_temp.amend_payload(),'{draft,amount_minor}','"25999"')))$$,'23514',null,'inconsistent revised total rejected');
select throws_ok($$select pg_temp.amend('amendment_create',jsonb_build_object('base_version_id',current_setting('sign.frozen')::jsonb->>'version_id','idempotency_key',gen_random_uuid(),'payload',jsonb_set(pg_temp.amend_payload(),'{draft,currency_code}','"EUR"')))$$,'22023',null,'currency mismatch rejected');
select lives_ok($$select pg_temp.amend('amendment_create',jsonb_build_object('base_version_id',current_setting('sign.frozen')::jsonb->>'version_id','idempotency_key',gen_random_uuid(),'payload',pg_temp.amend_payload('0')))$$,'zero value scope change allowed');
select lives_ok($$select pg_temp.amend('amendment_create',jsonb_build_object('base_version_id',current_setting('sign.frozen')::jsonb->>'version_id','idempotency_key',gen_random_uuid(),'payload',pg_temp.amend_payload('-500')),true)$$,'guest can propose an exact negative price change');
select throws_ok($$select pg_temp.amend('amendment_create',jsonb_build_object('base_version_id',current_setting('sign.frozen')::jsonb->>'version_id','idempotency_key',gen_random_uuid(),'payload',pg_temp.amend_payload('-1000')))$$,'22023',null,'nonpositive final total rejected');
do $$ declare cmd jsonb; r jsonb; f jsonb; i integer; begin
 for i in 1..3 loop
 cmd:=jsonb_build_object('base_version_id',current_setting('sign.frozen')::jsonb->>'version_id','idempotency_key',gen_random_uuid(),'payload',pg_temp.amend_payload());
 r:=pg_temp.amend('amendment_create',cmd); perform set_config('amend.create'||i,cmd::text,true); perform set_config('amend.draft'||i,r::text,true);
 f:=pg_temp.amend('amendment_submit',jsonb_build_object('draft_id',r->>'draft_id','expected_revision',r->>'revision','idempotency_key',gen_random_uuid())); perform set_config('amend.frozen'||i,f::text,true);
 end loop;
end $$;
select is(pg_temp.amend('amendment_create',current_setting('amend.create1')::jsonb)->>'draft_id',current_setting('amend.draft1')::jsonb->>'draft_id','identical create replay returns durable result');
select throws_ok($$select pg_temp.amend('amendment_create',jsonb_set(current_setting('amend.create1')::jsonb,'{payload,reason}','"Conflicting"'))$$,'P4090',null,'conflicting amendment idempotency key rejected');
select throws_ok($$select pg_temp.amend('amendment_save',jsonb_build_object('draft_id',current_setting('amend.draft1')::jsonb->>'draft_id','expected_revision','1','base_version_id',current_setting('sign.frozen')::jsonb->>'version_id','payload',pg_temp.amend_payload(),'idempotency_key',gen_random_uuid()))$$,'23514',null,'submitted draft immutable');
select is(pg_temp.amend('amendment_review',jsonb_build_object('proposal_id',current_setting('amend.frozen1')::jsonb->>'proposal_id'))->>'state','pending','frozen amendment is pending, never automatically approved');
select lives_ok($$select pg_temp.amend('amendment_revisions',jsonb_build_object('proposal_id',current_setting('amend.frozen3')::jsonb->>'proposal_id','reason','Please specify template formats','idempotency_key',gen_random_uuid()),true)$$,'other designated party can request substantive revisions');
do $$ declare inv uuid:=gen_random_uuid(); cid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); r jsonb; target uuid; begin
 target:=(pg_temp.amend('amendment_review',jsonb_build_object('proposal_id',current_setting('amend.frozen1')::jsonb->>'proposal_id'),true)->>'own_slot_id')::uuid;
 r:=pg_temp.run_sign('invite_amendment',jsonb_build_object('agreement_id',current_setting('sign.agreement'),'slot_id',target,'idempotency_key',gen_random_uuid()),jsonb_build_object('invitation_id',inv,'token_digest',repeat('99',32)),true);
 if r ? 'error' then raise exception 'Invitation failed %',r; end if;
 r:=pg_temp.run_sign('start_access',jsonb_build_object('invitation_id',inv),jsonb_build_object('token_digest',repeat('99',32),'challenge_id',cid,'code_hmac',repeat('aa',32),'key_id','test'));
 if r ? 'error' then raise exception 'Access challenge failed %',r; end if;
 r:=pg_temp.run_sign('verify_access',jsonb_build_object('invitation_id',inv,'challenge_id',cid),jsonb_build_object('token_digest',repeat('99',32),'code_hmac',repeat('aa',32),'key_id','test','session_id',sid,'session_digest',repeat('bb',32)));
 if r ? 'error' then raise exception 'Access verification failed %',r; end if;
 perform pg_temp.run_sign('revoke_invitation',jsonb_build_object('agreement_id',current_setting('sign.agreement'),'slot_id',target,'idempotency_key',gen_random_uuid()),'{}',true);
 perform set_config('amend.extra_session',jsonb_build_object('session_id',sid,'session_digest',repeat('bb',32))::text,true);
end $$;
select is(pg_temp.run_sign('read','{}',current_setting('amend.extra_session')::jsonb)->>'digest',current_setting('amend.frozen1')::jsonb->>'digest','pending amendment token management preserves consumed active-history access');
select is(pg_temp.run_sign('start_consent',jsonb_build_object('proposal_id',current_setting('amend.frozen3')::jsonb->>'proposal_id','digest',current_setting('amend.frozen3')::jsonb->>'digest','action','amendment_approval'),current_setting('sign.client_session')::jsonb||jsonb_build_object('challenge_id',gen_random_uuid(),'code_hmac',repeat('88',32),'key_id','test'))->>'error','invalid_capability','closed revision proposal cannot collect new approvals');

create function pg_temp.amend_proof(n text,f jsonb,action text default 'amendment_approval') returns jsonb language plpgsql as $$
declare r jsonb; cid uuid; pid uuid:=gen_random_uuid(); begin
 r:=pg_temp.run_sign('start_consent',jsonb_build_object('proposal_id',f->>'proposal_id','digest',f->>'digest','action',action),current_setting('sign.'||n||'_session')::jsonb||jsonb_build_object('challenge_id',gen_random_uuid(),'code_hmac',repeat('88',32),'key_id','test'),n='provider');
 if r ? 'error' then raise exception 'Challenge failed %',r; end if;
 cid:=(r->>'challenge_id')::uuid;
 r:=pg_temp.run_sign('verify_consent',jsonb_build_object('challenge_id',cid,'action',action),current_setting('sign.'||n||'_session')::jsonb||jsonb_build_object('code_hmac',repeat('88',32),'key_id','test','proof_id',pid,'proof_digest',encode(sha256(convert_to(pid::text,'UTF8')),'hex')),n='provider');
 if r ? 'error' then raise exception 'Verification failed %',r; end if;
 return jsonb_build_object('proof_id',pid,'proof_digest',encode(sha256(convert_to(pid::text,'UTF8')),'hex'));
end $$;
create function pg_temp.approve_amend(n text,f jsonb,proof jsonb,key uuid) returns jsonb language sql as $$
 select pg_temp.run_sign('amendment_approval',jsonb_build_object('proposal_id',f->>'proposal_id','digest',f->>'digest','proof_id',proof->>'proof_id','typed_name',n,'affirmative',true,'consent_text','By signing, I explicitly consent to this exact agreement amendment.','disclosure_version','accordly-amendment-v1','idempotency_key',key),current_setting('sign.'||n||'_session')::jsonb||jsonb_build_object('proof_digest',proof->>'proof_digest'),n='provider')
$$;
do $$ declare d jsonb; f jsonb; proof jsonb; begin
 d:=pg_temp.amend('amendment_create',jsonb_build_object('base_version_id',current_setting('sign.frozen')::jsonb->>'version_id','idempotency_key',gen_random_uuid(),'payload',pg_temp.amend_payload('0')));
 f:=pg_temp.amend('amendment_submit',jsonb_build_object('draft_id',d->>'draft_id','expected_revision','1','idempotency_key',gen_random_uuid()));
 proof:=pg_temp.amend_proof('provider',f);
 perform pg_temp.approve_amend('provider',f,proof,gen_random_uuid());
 perform set_config('amend.old_approved',f::text,true);
 proof:=pg_temp.amend_proof('client',f); perform set_config('amend.old_proof',proof::text,true);
 perform pg_temp.amend('amendment_revisions',jsonb_build_object('proposal_id',f->>'proposal_id','reason','Material revision after first approval','idempotency_key',gen_random_uuid()),true);
end $$;
select is(pg_temp.approve_amend('client',current_setting('amend.old_approved')::jsonb,current_setting('amend.old_proof')::jsonb,gen_random_uuid())->>'error','invalid_capability','old approval and unused fresh proof cannot activate a revised proposal');
select is(pg_temp.amend('amendment_review',jsonb_build_object('proposal_id',current_setting('amend.old_approved')::jsonb->>'proposal_id'))->'slots' @> '[{"decision":"approve"}]'::jsonb,true,'old approval remains in immutable historical proposal');
do $$ declare d jsonb; f jsonb; proof jsonb; r jsonb; begin
 d:=pg_temp.amend('amendment_create',jsonb_build_object('base_version_id',current_setting('sign.frozen')::jsonb->>'version_id','idempotency_key',gen_random_uuid(),'payload',pg_temp.amend_payload('0')));
 f:=pg_temp.amend('amendment_submit',jsonb_build_object('draft_id',d->>'draft_id','expected_revision','1','idempotency_key',gen_random_uuid()));
 proof:=pg_temp.amend_proof('client',f,'amendment_rejection');
 r:=pg_temp.run_sign('amendment_reject',jsonb_build_object('proposal_id',f->>'proposal_id','digest',f->>'digest','proof_id',proof->>'proof_id','reason','This proposal is not acceptable','consent_text','By signing, I explicitly consent to this exact agreement amendment.','disclosure_version','accordly-amendment-v1','idempotency_key',gen_random_uuid()),current_setting('sign.client_session')::jsonb||jsonb_build_object('proof_digest',proof->>'proof_digest'));
 if r ? 'error' then raise exception 'Rejection failed %',r; end if;
 perform set_config('amend.rejected',f::text,true);
end $$;
select is(pg_temp.amend('amendment_review',jsonb_build_object('proposal_id',current_setting('amend.rejected')::jsonb->>'proposal_id'))->>'state','rejected','fresh verified rejection atomically closes proposal');
select is(pg_temp.amend('amendment_review',jsonb_build_object('proposal_id',current_setting('amend.rejected')::jsonb->>'proposal_id'))->'slots' @> '[{"decision":"reject"}]'::jsonb,true,'explicit rejection evidence retained separately from approval');
select throws_ok($$select pg_temp.amend('amendment_withdraw',jsonb_build_object('proposal_id',current_setting('amend.frozen2')::jsonb->>'proposal_id','reason','Not my proposal','idempotency_key',gen_random_uuid()),true)$$,'42501',null,'another party cannot withdraw the proposer request');
do $$ begin
 perform set_config('amend.cp',pg_temp.amend_proof('client',current_setting('amend.frozen1')::jsonb)::text,true);
 perform set_config('amend.pp',pg_temp.amend_proof('provider',current_setting('amend.frozen1')::jsonb)::text,true);
 perform set_config('amend.key',gen_random_uuid()::text,true);
end $$;
select throws_ok($$select pg_temp.approve_amend('client',jsonb_set(current_setting('amend.frozen1')::jsonb,'{digest}',to_jsonb(repeat('00',32))),current_setting('amend.cp')::jsonb,gen_random_uuid())$$,'P4090',null,'amendment approval rejects stale digest');
select lives_ok($$select pg_temp.approve_amend('client',current_setting('amend.frozen1')::jsonb,current_setting('amend.cp')::jsonb,current_setting('amend.key')::uuid);set constraints all immediate$$,'first amendment approval commits below quorum');
set constraints all deferred;
select is(pg_temp.amend('amendment_list','{}')->>'effective_version_id',current_setting('sign.frozen')::jsonb->>'version_id','partial approval leaves original effective');
select throws_ok($$select pg_temp.amend('amendment_revisions',jsonb_build_object('proposal_id',current_setting('amend.frozen1')::jsonb->>'proposal_id','reason','Retract my consent','idempotency_key',gen_random_uuid()),true)$$,'P4090',null,'immutable decision cannot be retracted by revision action');
select lives_ok($$select pg_temp.approve_amend('provider',current_setting('amend.frozen1')::jsonb,current_setting('amend.pp')::jsonb,gen_random_uuid());set constraints all immediate$$,'unanimous amendment signatures activate atomically');
select is(pg_temp.amend('amendment_list','{}')->>'effective_version_id',current_setting('amend.frozen1')::jsonb->>'version_id','effective pointer advances to amendment');
select is(pg_temp.amend('amendment_list','{}')->'effective'->'snapshot'->>'amount_minor','26000','exact effective total is base plus price difference');
select is(pg_temp.amend('amendment_review',jsonb_build_object('proposal_id',current_setting('amend.frozen2')::jsonb->>'proposal_id'))->>'state','superseded','competing same base proposal is superseded');
select lives_ok($$select pg_temp.approve_amend('client',current_setting('amend.frozen1')::jsonb,current_setting('amend.cp')::jsonb,current_setting('amend.key')::uuid)$$,'identical approved retry returns safe receipt after activation');
select is(pg_temp.run_sign('read',jsonb_build_object('proposal_id',current_setting('sign.frozen')::jsonb->>'proposal_id'),current_setting('sign.client_session')::jsonb)->>'digest',current_setting('sign.frozen')::jsonb->>'digest','original signed digest remains intact');
select is(pg_temp.run_sign('read','{}',current_setting('sign.client_session')::jsonb)->>'digest',current_setting('amend.frozen1')::jsonb->>'digest','guest default review resolves current effective terms');
reset role;
select is((select count(*)::integer from accordly.consent_decisions where proposal_id=(current_setting('sign.frozen')::jsonb->>'proposal_id')::uuid),2,'original signatures preserved');
select is((select count(*)::integer from accordly.proposal_feedback where kind='revision_requested'),2,'revision feedback preserves author and reason');
select throws_ok($$update accordly.proposal_feedback set reason='hidden'$$,'23514',null,'negotiation feedback is append only');
set local role anon;
select throws_ok($$select accordly_commands.amendment_command(null,null,null,'amendment_list','{}','{}')$$,'42501',null,'anonymous RPC cannot invoke amendment gateway');
reset role;
set local role accordly_signer;
select is((select count(*)::integer from accordly.proposal_feedback),0,'unscoped signer cannot read negotiation history');
reset role;
select * from finish();
rollback;
