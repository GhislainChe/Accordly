-- Run only in the disposable database created by scripts/test-database.mjs.
-- Privileged setup is separate from assertions under API/gateway/executor roles.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
grant usage on schema extensions to accordly_gateway,accordly_executor,accordly_owner;
select no_plan();

insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','a@example.test'),
 ('00000000-0000-4000-8000-000000000002','b@example.test'),
 ('00000000-0000-4000-8000-000000000003','editor@example.test'),
 ('00000000-0000-4000-8000-000000000004','viewer@example.test'),
 ('00000000-0000-4000-8000-000000000005','admin@example.test'),
 ('00000000-0000-4000-8000-000000000006','client@example.test');

set local role accordly_gateway;
do $$ begin
  perform set_config('test.actor_a',accordly_commands.register_principal('00000000-0000-4000-8000-000000000001')::text,true);
  perform set_config('test.actor_b',accordly_commands.register_principal('00000000-0000-4000-8000-000000000002')::text,true);
  perform set_config('test.editor',accordly_commands.register_principal('00000000-0000-4000-8000-000000000003')::text,true);
  perform set_config('test.viewer',accordly_commands.register_principal('00000000-0000-4000-8000-000000000004')::text,true);
  perform set_config('test.admin',accordly_commands.register_principal('00000000-0000-4000-8000-000000000005')::text,true);
  perform set_config('test.client',accordly_commands.register_principal('00000000-0000-4000-8000-000000000006')::text,true);
  perform set_config('test.org_a',accordly_commands.create_organization('00000000-0000-4000-8000-000000000001','Freelancer A','individual')::text,true);
  perform set_config('test.org_b',accordly_commands.create_organization('00000000-0000-4000-8000-000000000002','Agency B','business')::text,true);
  perform accordly_commands.set_membership('00000000-0000-4000-8000-000000000001',current_setting('test.org_a')::uuid,current_setting('test.editor')::uuid,'editor',true);
  perform accordly_commands.set_membership('00000000-0000-4000-8000-000000000001',current_setting('test.org_a')::uuid,current_setting('test.viewer')::uuid,'viewer',true);
  perform accordly_commands.set_membership('00000000-0000-4000-8000-000000000001',current_setting('test.org_a')::uuid,current_setting('test.admin')::uuid,'admin',true);
  perform set_config('test.agreement_a',accordly_commands.create_agreement('00000000-0000-4000-8000-000000000001',current_setting('test.org_a')::uuid,'Private A')::text,true);
  perform set_config('test.agreement_b',accordly_commands.create_agreement('00000000-0000-4000-8000-000000000002',current_setting('test.org_b')::uuid,'Private B')::text,true);
  perform set_config('test.agreement_editor',accordly_commands.create_agreement('00000000-0000-4000-8000-000000000003',current_setting('test.org_a')::uuid,'Editor own agreement')::text,true);
end $$;
select is(current_user::text,'accordly_gateway','commands run as a real restricted gateway role');
select is(jsonb_array_length(accordly_commands.list_agreements('00000000-0000-4000-8000-000000000001')),2,'owner A sees its organization only');
select is(jsonb_array_length(accordly_commands.list_agreements('00000000-0000-4000-8000-000000000002')),1,'owner B cannot see A');
select is(jsonb_array_length(accordly_commands.list_agreements('00000000-0000-4000-8000-000000000003')),1,'editor sees explicitly granted creator agreement only');
select is(jsonb_array_length(accordly_commands.list_agreements('00000000-0000-4000-8000-000000000004')),0,'viewer gets no implicit agreement access');
select is(jsonb_array_length(accordly_commands.list_agreements('00000000-0000-4000-8000-000000000006')),0,'client identity alone grants no access');
select is(nullif(current_setting('accordly.actor_id',true),''),null::text,'commands clear actor context even in the same transaction');
select throws_ok($$select * from accordly.agreements$$,'42501',null,'gateway has no raw table access');
select throws_ok($$select accordly_commands.set_registered_actor('00000000-0000-4000-8000-000000000002')$$,'42501',null,'gateway cannot call internal identity resolver');
select throws_ok($$create function accordly_commands.escape() returns integer language sql as 'select 1'$$,'42501',null,'gateway cannot create executable command code');
select throws_ok($$select accordly_commands.set_membership('00000000-0000-4000-8000-000000000004',current_setting('test.org_a')::uuid,current_setting('test.viewer')::uuid,'owner',true)$$,'42501',null,'viewer cannot self-promote');
select throws_ok($$select accordly_commands.set_membership('00000000-0000-4000-8000-000000000005',current_setting('test.org_a')::uuid,current_setting('test.admin')::uuid,'owner',true)$$,'42501',null,'admin cannot promote itself to owner');
select throws_ok($$select accordly_commands.set_membership('00000000-0000-4000-8000-000000000005',current_setting('test.org_a')::uuid,current_setting('test.actor_a')::uuid,'viewer',true)$$,'42501',null,'admin cannot demote an owner');
select throws_ok($$select accordly_commands.set_membership('00000000-0000-4000-8000-000000000001',current_setting('test.org_a')::uuid,current_setting('test.actor_a')::uuid,'viewer',false)$$,'23514',null,'last owner cannot remove itself');
select throws_ok($$select accordly_commands.set_membership('00000000-0000-4000-8000-000000000001',current_setting('test.org_b')::uuid,current_setting('test.actor_a')::uuid,'owner',true)$$,'42501',null,'cross-tenant membership injection rejected');
select throws_ok($$select accordly_commands.create_agreement('00000000-0000-4000-8000-000000000001',current_setting('test.org_b')::uuid,'Attack')$$,'42501',null,'cross-tenant agreement creation rejected');
select throws_ok($$select accordly_commands.create_agreement('00000000-0000-4000-8000-000000000004',current_setting('test.org_a')::uuid,'Attack')$$,'42501',null,'viewer cannot create agreements');
select throws_ok($$select accordly_commands.create_organization(null,'Bad','business')$$,'42501',null,'missing identity rejected');
select throws_ok($$select accordly_commands.register_principal('00000000-0000-4000-8000-999999999999')$$,'23503',null,'nonexistent Auth user cannot bootstrap a principal');
select throws_ok($$select accordly_commands.create_organization('00000000-0000-4000-8000-000000000001','Bad','root')$$,'23514',null,'invalid organization kind rejected');
reset role;

-- Privileged fixture: a shared frozen proposal with both party slots; no signing.
do $$ declare org uuid := current_setting('test.org_a')::uuid; aid uuid := current_setting('test.agreement_a')::uuid;
  provider uuid := gen_random_uuid(); client uuid := gen_random_uuid(); rp uuid := gen_random_uuid(); rc uuid := gen_random_uuid();
  draft uuid := gen_random_uuid(); version uuid := gen_random_uuid(); proposal uuid := gen_random_uuid(); body jsonb;
begin
  insert into accordly.agreement_parties(id,organization_id,agreement_id,side,legal_name,contact_email) values
    (provider,org,aid,'provider','Provider','a@example.test'),(client,org,aid,'client','Client','client@example.test');
  insert into accordly.party_representatives(id,organization_id,agreement_id,party_id,principal_id,entered_email,normalized_email,display_name,authority_source,can_review,can_propose,can_sign) values
    (rp,org,aid,provider,current_setting('test.actor_a')::uuid,'a@example.test','a@example.test','Provider','fixture',true,true,true),
    (rc,org,aid,client,current_setting('test.client')::uuid,'client@example.test','client@example.test','Client','fixture',true,true,true);
  insert into accordly.agreement_access_grants(organization_id,agreement_id,principal_id,grant_type,issued_by) values (org,aid,current_setting('test.client')::uuid,'client_review',current_setting('test.actor_a')::uuid);
  insert into accordly.agreement_drafts(id,organization_id,agreement_id,kind,author_principal_id,payload) values (draft,org,aid,'initial',current_setting('test.actor_a')::uuid,'{"scope":"private preparation"}');
  body := jsonb_build_object('amount_minor','1000','currency_code','XAF','currency_exponent',0,'content_language','en','agreement_id',aid,'organization_id',org);
  insert into accordly.agreement_versions(id,organization_id,agreement_id,version_number,kind,origin_draft_id,origin_draft_revision,canonical_bytes,amount_minor,currency_code,currency_exponent,content_language,deadline_date)
    values (version,org,aid,1,'initial',draft,1,convert_to(body::text,'UTF8'),1000,'XAF',0,'en','2027-01-31');
  insert into accordly.agreement_proposals(id,organization_id,agreement_id,kind,candidate_version_id,proposer_principal_id,proposer_party_id,expires_at)
    values (proposal,org,aid,'initial',version,current_setting('test.actor_a')::uuid,provider,statement_timestamp()+interval '7 days');
  insert into accordly.proposal_participants(organization_id,agreement_id,proposal_id,version_id,party_id,representative_id,expected_email,identity_snapshot,consent_text,disclosure_version,content_language) values
    (org,aid,proposal,version,provider,rp,'a@example.test','{}','Explicit consent','1','en'),
    (org,aid,proposal,version,client,rc,'client@example.test','{}','Explicit consent','1','en');
  update accordly.agreements set lifecycle='awaiting_signatures',pending_initial_proposal_id=proposal where id=aid;
  perform set_config('test.version',version::text,true);
  perform set_config('test.draft',draft::text,true);
  perform set_config('test.proposal',proposal::text,true);
  perform set_config('test.provider',provider::text,true);
end $$;
set constraints all immediate;
set constraints all deferred;

set local role accordly_gateway;
select is(jsonb_array_length(accordly_commands.list_agreements('00000000-0000-4000-8000-000000000006')),1,'client sees only explicitly shared agreement');
select ok(accordly_commands.read_version('00000000-0000-4000-8000-000000000006',current_setting('test.version')::uuid) is not null,'client can read the shared candidate');
select is(accordly_commands.read_version('00000000-0000-4000-8000-000000000002',current_setting('test.version')::uuid),null::jsonb,'knowing a version UUID gives another tenant no access');
select is(accordly_commands.read_version('00000000-0000-4000-8000-000000000004',current_setting('test.version')::uuid),null::jsonb,'ungranted viewer cannot read a candidate');
do $$ begin perform set_config('accordly.actor_id',current_setting('test.actor_a'),true); end $$;
select throws_ok($$select * from accordly.agreements$$,'42501',null,'forged actor GUC does not grant gateway table rights');
reset role;

-- Direct RLS assertions under NOLOGIN executor, not an administrator/table owner.
set local role accordly_executor;
do $$ begin perform set_config('accordly.actor_id',current_setting('test.actor_a'),true); end $$;
select is(current_user::text,'accordly_executor','RLS assertions run as the non-owner non-bypass executor');
select is((select count(*)::integer from accordly.agreements),2,'RLS hides other tenants from executor');
select throws_ok($$insert into accordly.agreements(organization_id,created_by,title) values (current_setting('test.org_b')::uuid,current_setting('test.actor_a')::uuid,'Attack')$$,'42501',null,'RLS blocks cross-tenant inserts even with table INSERT privilege');
select results_eq($$update accordly.organization_memberships set role='viewer' where organization_id=current_setting('test.org_b')::uuid returning principal_id$$,array[]::uuid[],'RLS blocks cross-tenant membership updates');
select throws_ok($$update accordly.agreements set organization_id=current_setting('test.org_b')::uuid where id=current_setting('test.agreement_a')::uuid$$,'42501',null,'executor cannot transfer ownership by direct UPDATE');
select throws_ok($$update accordly.agreement_versions set amount_minor=1 where id=current_setting('test.version')::uuid$$,'42501',null,'executor has no frozen-version UPDATE grant');
select throws_ok($$insert into accordly.agreement_versions default values$$,'42501',null,'executor cannot insert unreviewed frozen versions');
do $$ begin perform set_config('accordly.actor_id',current_setting('test.client'),true); end $$;
select is((select count(*)::integer from accordly.agreements),1,'client RLS limits parent rows');
select is((select count(*)::integer from accordly.agreement_drafts),0,'client cannot read provider preparation drafts');
select is((select count(*)::integer from accordly.organization_memberships),0,'client cannot enumerate provider memberships');
select is((select count(*)::integer from accordly.organization_events),0,'client cannot read internal organization audit');
do $$ begin perform set_config('accordly.actor_id','',true); end $$;
select is((select count(*)::integer from accordly.agreements),0,'cleared actor context denies reads');
reset role;

set local role anon;
select is(current_user::text,'anon','anonymous API role is actually selected');
select throws_ok($$select * from accordly.agreements$$,'42501',null,'anonymous access denied');
select throws_ok($$select accordly_commands.list_agreements('00000000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous cannot call gateway commands');
reset role;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated","user_metadata":{"role":"owner"}}',true); end $$;
select throws_ok($$select * from accordly.agreements$$,'42501',null,'valid-looking JWT metadata does not expose private tables');
select throws_ok($$insert into accordly.organization_memberships(organization_id,principal_id,role) values (current_setting('test.org_a')::uuid,current_setting('test.viewer')::uuid,'owner')$$,'42501',null,'direct API role escalation blocked');
select throws_ok($$select accordly_commands.create_organization('00000000-0000-4000-8000-000000000001','Spoof','business')$$,'42501',null,'authenticated browser cannot forge gateway identity assertions');
reset role;
set local role service_role;
select throws_ok($$select * from accordly.agreements$$,'42501',null,'service-role RLS bypass does not bypass private schema/grant denial');
reset role;
set local role accordly_owner;
select is((select count(*)::integer from accordly.agreements),0,'FORCE RLS applies to the table owner');
reset role;

-- Structural/data-integrity assertions are privileged, NOT evidence of RLS.
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='accordly' and c.relkind='r' and (not c.relrowsecurity or not c.relforcerowsecurity)),0,'every domain table has ENABLE and FORCE RLS');
select is((select count(*)::integer from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='accordly' and c.relkind='r' and c.relowner <> 'accordly_owner'::regrole),0,'all domain tables have the isolated NOLOGIN owner');
select ok(not (select rolbypassrls or rolsuper or rolcreaterole or rolcreatedb from pg_roles where rolname='accordly_executor'),'executor has no bypass/administrative role attributes');
select ok(not pg_has_role('accordly_gateway','accordly_executor','MEMBER'),'gateway is not an executor member');
select ok(not has_schema_privilege('authenticated','accordly','USAGE'),'private schema is not granted to authenticated');
select ok(not has_schema_privilege('anon','accordly_commands','USAGE'),'command schema is not granted to anon');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='accordly_commands' and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE') or has_function_privilege('service_role',p.oid,'EXECUTE'))),0,'no domain function is executable by Supabase API roles');
select is((select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='accordly_commands' and p.prosecdef and not coalesce('search_path=""'=any(p.proconfig),false)),0,'every SECURITY DEFINER has an empty fixed search path');
select is((select kind from accordly.organizations where id=current_setting('test.org_a')::uuid),'individual','freelancers use a real tenant with individual kind');
select is((select count(*)::integer from accordly.organization_memberships where organization_id=current_setting('test.org_a')::uuid and active and role='owner'),1,'new organization has one initial owner');
select is((select minor_unit_exponent::integer from accordly.currencies where code='XAF'),0,'XAF uses integer francs, not assumed cents');
select is((select amount_minor from accordly.agreement_versions where id=current_setting('test.version')::uuid),1000::bigint,'money is stored exactly as integer minor units');
select ok((select digest=sha256(canonical_bytes) from accordly.agreement_versions where id=current_setting('test.version')::uuid),'snapshot digest is generated by PostgreSQL');
select throws_ok($$update accordly.agreement_versions set amount_minor=1$$,'23514',null,'even a privileged accidental UPDATE is stopped by append-only trigger');
select throws_ok($$delete from accordly.agreement_versions$$,'23514',null,'frozen history cannot be deleted by ordinary SQL');
select throws_ok($$truncate accordly.agreement_versions cascade$$,'23514',null,'truncate cannot silently erase frozen history');
select throws_ok($$update accordly.agreements set organization_id=current_setting('test.org_b')::uuid where id=current_setting('test.agreement_a')::uuid$$,'23514',null,'tenant identity trigger rejects reassignment');
select throws_ok($$insert into accordly.agreement_parties(organization_id,agreement_id,side,legal_name,contact_email) values (current_setting('test.org_a')::uuid,current_setting('test.agreement_b')::uuid,'provider','Bad','bad@example.test')$$,'23503',null,'composite FK rejects cross-tenant parent relationship');
select throws_ok($$update accordly.agreements set lifecycle='active',effective_version_id=current_setting('test.version')::uuid,pending_initial_proposal_id=null where id=current_setting('test.agreement_a')::uuid$$,'23514',null,'activation is explicitly unavailable until reviewed signing commands exist');
select throws_ok($$update accordly.agreements set lifecycle='awaiting_signatures' where id=current_setting('test.agreement_b')::uuid$$,'23514',null,'awaiting state without pending pointer rejected');
select throws_ok($$update accordly.agreements set lifecycle='deleted' where id=current_setting('test.agreement_b')::uuid$$,'23514',null,'undefined lifecycle state rejected');
select throws_ok($$update accordly.agreement_proposals set state='effective',terminal_at=clock_timestamp() where id=current_setting('test.proposal')::uuid$$,'23514',null,'no direct effective proposal path exists');
select throws_ok($$insert into accordly.organization_memberships(organization_id,principal_id,role) values (current_setting('test.org_a')::uuid,current_setting('test.actor_a')::uuid,'owner')$$,'23505',null,'duplicate membership rejected');
select throws_ok($$insert into accordly.organizations(kind,name,created_by) values ('individual','Orphan',current_setting('test.actor_a')::uuid); set constraints all immediate$$,'23514',null,'orphan organization cannot commit without owner');
select throws_ok($$delete from auth.users where id='00000000-0000-4000-8000-000000000001'$$,'23503',null,'Auth deletion cannot cascade into principal history');

set local role accordly_gateway;
select lives_ok($$select accordly_commands.set_membership('00000000-0000-4000-8000-000000000001',current_setting('test.org_a')::uuid,current_setting('test.editor')::uuid,'editor',false)$$,'owner can revoke an editor atomically');
select is(jsonb_array_length(accordly_commands.list_agreements('00000000-0000-4000-8000-000000000003')),0,'revoked member loses access despite retained agreement grants');
reset role;
update accordly.principals set status='disabled',disabled_at=clock_timestamp() where id=current_setting('test.client')::uuid;
set local role accordly_gateway;
select throws_ok($$select accordly_commands.list_agreements('00000000-0000-4000-8000-000000000006')$$,'42501',null,'disabled principal cannot regain access by re-registering');
reset role;

select * from finish();
rollback;
