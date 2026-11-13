-- Trusted identity assertions are simulated; roles, RLS and transactions are real.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
grant usage on schema extensions to accordly_gateway,accordly_executor;
select no_plan();
insert into auth.users(id,email) values('40000000-0000-4000-8000-000000000001','onboarding-a@example.test'),('40000000-0000-4000-8000-000000000002','onboarding-b@example.test');
set local role accordly_gateway;
create function pg_temp.account(op text,input jsonb default '{}',other_user boolean default false) returns jsonb language sql as $$
 select accordly_commands.account_command(case when other_user then '40000000-0000-4000-8000-000000000002'::uuid else '40000000-0000-4000-8000-000000000001'::uuid end,op,input)
$$;
select is(pg_temp.account('status')->>'step','2','verified assertion initializes onboarding at preferences');
select is(pg_temp.account('status')->>'completed','false','new account is incomplete');
select is(jsonb_array_length(pg_temp.account('status')->'workspaces'),0,'status never provisions a workspace');
select throws_ok($$select accordly_commands.account_command(null,'status','{}')$$,'42501',null,'missing trusted identity assertion denied');
select throws_ok($$select pg_temp.account('complete',jsonb_build_object('workspace_name','Forged','expected_revision','1','idempotency_key',gen_random_uuid()))$$,'P4090',null,'workspace cannot precede required preferences');
select throws_ok($$select pg_temp.account('preferences',jsonb_build_object('full_name','A','work_kind','individual','purpose','both','expected_revision','1','idempotency_key',gen_random_uuid(),'role','owner'))$$,'22023',null,'browser role assignment fields rejected by database');
do $$ declare c jsonb; r jsonb; begin
 c:=jsonb_build_object('full_name','Alex Example','work_kind','individual','purpose','review','expected_revision','1','idempotency_key',gen_random_uuid());r:=pg_temp.account('preferences',c);
 perform set_config('account.preferences',c::text,true);
end $$;
select is(pg_temp.account('preferences',current_setting('account.preferences')::jsonb)->>'revision','2','identical preference retry replays safely');
select throws_ok($$select pg_temp.account('preferences',jsonb_set(current_setting('account.preferences')::jsonb,'{purpose}','"create"'))$$,'P4090',null,'conflicting preference key rejected');
select is(pg_temp.account('status')->>'step','3','interrupted account resumes workspace setup');
select is(pg_temp.account('status')->>'purpose','review','preference persisted without granting agreement access');
select is(jsonb_array_length(pg_temp.account('status')->'workspaces'),0,'preferences still create no workspace');
reset role;
create function pg_temp.onboarding_rollback_fixture() returns trigger language plpgsql security definer as $$ begin
 if exists(select 1 from accordly.organizations where id=new.organization_id and name='Must Rollback') then raise exception using errcode='23514',message='fixture commit failure'; end if; return null;
end $$;
create constraint trigger onboarding_rollback_fixture after insert on accordly.organization_memberships deferrable initially deferred for each row execute function pg_temp.onboarding_rollback_fixture();
set local role accordly_gateway;
select throws_ok($$select pg_temp.account('complete',jsonb_build_object('workspace_name','Must Rollback','expected_revision','2','idempotency_key',gen_random_uuid()));set constraints all immediate$$,'23514',null,'deferred membership failure rolls back initial workspace and completion');
set constraints all deferred;
reset role;
drop trigger onboarding_rollback_fixture on accordly.organization_memberships;
select is((select count(*)::integer from accordly.organizations where name='Must Rollback'),0,'rollback leaves no orphan workspace');
set local role accordly_gateway;
select is(pg_temp.account('status')->>'completed','false','rollback leaves onboarding resumable');
do $$ declare c jsonb; r jsonb; begin
 c:=jsonb_build_object('workspace_name','Alex Professional','expected_revision','2','idempotency_key',gen_random_uuid());r:=pg_temp.account('complete',c);
 perform set_config('account.complete',c::text,true);perform set_config('account.org',r->>'organization_id',true);
end $$;
select is(pg_temp.account('complete',current_setting('account.complete')::jsonb)->>'organization_id',current_setting('account.org'),'initial creation retry returns same workspace');
select is(pg_temp.account('complete',current_setting('account.complete')::jsonb||jsonb_build_object('idempotency_key',gen_random_uuid()))->>'organization_id',current_setting('account.org'),'refresh with a new key cannot create a second initial workspace');
select throws_ok($$select pg_temp.account('complete',jsonb_set(current_setting('account.complete')::jsonb,'{workspace_name}','"Different"'))$$,'P4090',null,'same key changed workspace payload rejected');
select is(pg_temp.account('status')->>'next','/app','completed account resumes app');
select is(pg_temp.account('status')->>'selected_workspace_id',current_setting('account.org'),'last workspace restored');
select is(pg_temp.account('status')->'workspaces'->0->>'role','owner','initial owner is securely assigned');
select is(pg_temp.account('status')->'workspaces'->0->>'kind','individual','freelancer receives individual tenant');
select is(jsonb_array_length(pg_temp.account('status','{}',true)->'workspaces'),0,'other account cannot enumerate workspace');
select throws_ok($$select pg_temp.account('use_existing',jsonb_build_object('expected_revision','1','organization_id',current_setting('account.org'),'idempotency_key',gen_random_uuid()),true)$$,'P4090',null,'incomplete preferences cannot adopt a workspace');
select lives_ok($$select pg_temp.account('preferences',jsonb_build_object('full_name','Business Example','work_kind','business','purpose','both','expected_revision','1','idempotency_key',gen_random_uuid()),true)$$,'business preferences accepted');
select throws_ok($$select pg_temp.account('use_existing',jsonb_build_object('expected_revision','2','organization_id',current_setting('account.org'),'idempotency_key',gen_random_uuid()),true)$$,'42501',null,'known workspace UUID cannot grant membership or ownership');
select lives_ok($$select pg_temp.account('complete',jsonb_build_object('workspace_name','Example Business','expected_revision','2','idempotency_key',gen_random_uuid()),true)$$,'business creation commits atomically');
select is(pg_temp.account('status','{}',true)->'workspaces'->0->>'kind','business','business tenant kind persists');
select throws_ok($$select pg_temp.account('select_workspace',jsonb_build_object('organization_id',current_setting('account.org'),'idempotency_key',gen_random_uuid()),true)$$,'42501',null,'cross tenant selection blocked');
select is(nullif(current_setting('accordly.actor_id',true),''),null::text,'commands clear identity context');
select throws_ok($$select * from accordly.account_onboarding$$,'42501',null,'gateway has no direct onboarding access');
reset role;
select is((select count(*)::integer from accordly.organizations where name='Alex Professional'),1,'one initial workspace exists despite retries');
select is((select count(*)::integer from accordly.organization_memberships where organization_id=current_setting('account.org')::uuid and role='owner' and active),1,'exactly one initial owner');
select throws_ok($$update accordly.account_receipts set outcome='{}'$$,'23514',null,'onboarding receipts are append only');
select throws_ok($$update accordly.account_onboarding set full_name='Rewritten' where principal_id=(select id from accordly.principals where auth_user_id='40000000-0000-4000-8000-000000000001')$$,'23514',null,'completed onboarding identity and initial workspace cannot be rewritten');
select set_config('account.actor',(select id::text from accordly.principals where auth_user_id='40000000-0000-4000-8000-000000000001'),true) is not null as actor_saved \gset
set local role accordly_executor;
select set_config('accordly.actor_id',(select principal_id::text from accordly.account_onboarding limit 1),true) is null as denied_scope \gset
select is((select count(*)::integer from accordly.account_onboarding),0,'executor with no context sees no onboarding rows');
select set_config('accordly.actor_id',current_setting('account.actor'),true) is not null as actor_set \gset
select is((select count(*)::integer from accordly.account_onboarding),1,'executor sees only its own onboarding state');
select lives_ok($$update accordly.account_onboarding set full_name='Foreign' where principal_id<>current_setting('account.actor')::uuid$$,'cross account direct updates affect no rows under RLS');
reset role;
select is((select full_name from accordly.account_onboarding where principal_id<>current_setting('account.actor')::uuid),'Business Example','cross account profile remains untouched');
set local role accordly_gateway;
do $$ declare id uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
 perform pg_temp.account('recovery_issue',jsonb_build_object('id',id,'auth_session_id',sid,'secret_digest',repeat('ab',32)));
 perform set_config('account.recovery',jsonb_build_object('id',id,'auth_session_id',sid,'secret_digest',repeat('ab',32))::text,true);
end $$;
select throws_ok($$select pg_temp.account('recovery_consume',current_setting('account.recovery')::jsonb,true)$$,'42501',null,'recovery proof belongs to one principal');
select throws_ok($$select pg_temp.account('recovery_consume',jsonb_set(current_setting('account.recovery')::jsonb,'{secret_digest}',to_jsonb(repeat('ff',32))))$$,'42501',null,'forged recovery secret denied');
select lives_ok($$select pg_temp.account('recovery_consume',current_setting('account.recovery')::jsonb)$$,'verified actor consumes own exact recovery proof');
select throws_ok($$select pg_temp.account('recovery_consume',current_setting('account.recovery')::jsonb)$$,'42501',null,'consumed recovery proof cannot replay');
select lives_ok($$do $stress$ declare i integer; id uuid; begin for i in 1..100 loop id:=gen_random_uuid(); perform pg_temp.account('recovery_issue',jsonb_build_object('id',id,'auth_session_id',gen_random_uuid(),'secret_digest',encode(sha256(convert_to(id::text,'UTF8')),'hex'))); end loop; end $stress$; $$,'recovery grant timestamps remain consistent across repeated issuance');
reset role;
set local role anon;
select throws_ok($$select * from accordly.account_onboarding$$,'42501',null,'anonymous private onboarding access blocked');
select throws_ok($$select accordly_commands.account_command(null,'status','{}')$$,'42501',null,'anonymous cannot fabricate gateway assertion');
reset role;
set local role authenticated;
select throws_ok($$select accordly_commands.account_command('40000000-0000-4000-8000-000000000001','status','{}')$$,'42501',null,'authenticated API cannot impersonate another account');
reset role;
set local role accordly_gateway;
select is(accordly_commands.account_rate_limit('signup',repeat('1',64),repeat('2',64)),true,'first shared signup request allowed');
select is(accordly_commands.account_rate_limit('signup',repeat('1',64),repeat('2',64)),true,'second shared signup request allowed');
select is(accordly_commands.account_rate_limit('signup',repeat('1',64),repeat('2',64)),true,'third shared signup request allowed');
select is(accordly_commands.account_rate_limit('signup',repeat('1',64),repeat('2',64)),false,'fourth target signup request blocked across instances');
select is(accordly_commands.account_rate_limit('signup',null,null),false,'invalid counter scope fails closed');
reset role;
select * from finish();
rollback;
