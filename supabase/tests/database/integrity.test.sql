begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions,public;
select no_plan();

-- Administrator arranges rows to exercise CHECK/FK/trigger behavior, not RLS.
do $$ declare actor uuid := gen_random_uuid(); org uuid := gen_random_uuid(); agreement uuid := gen_random_uuid(); draft uuid := gen_random_uuid();
begin
  insert into auth.users(id,email) values(actor,'integrity@example.test');
  insert into accordly.principals(id,kind,auth_user_id) values(actor,'registered',actor);
  insert into accordly.organizations(id,kind,name,created_by) values(org,'individual','Integrity fixture',actor);
  insert into accordly.organization_memberships(organization_id,principal_id,role) values(org,actor,'owner');
  insert into accordly.agreements(id,organization_id,created_by,title) values(agreement,org,actor,'Integrity fixture');
  insert into accordly.agreement_drafts(id,organization_id,agreement_id,kind,author_principal_id,payload) values(draft,org,agreement,'initial',actor,'{}');
  perform set_config('test.integrity_actor',actor::text,true); perform set_config('test.integrity_org',org::text,true);
  perform set_config('test.integrity_agreement',agreement::text,true); perform set_config('test.integrity_draft',draft::text,true);
end $$;

create function pg_temp.try_snapshot(money text, currency text default 'XAF', exponent integer default 0, body_override text default null, zone text default null)
returns void language plpgsql as $$
declare body text;
begin
  body := coalesce(body_override,jsonb_build_object('amount_minor',money,'currency_code',currency,'currency_exponent',exponent,'content_language','fr','agreement_id',current_setting('test.integrity_agreement'),'organization_id',current_setting('test.integrity_org'))::text);
  insert into accordly.agreement_versions(organization_id,agreement_id,version_number,kind,origin_draft_id,origin_draft_revision,canonical_bytes,amount_minor,currency_code,currency_exponent,content_language,deadline_date,deadline_at,deadline_timezone)
  values(current_setting('test.integrity_org')::uuid,current_setting('test.integrity_agreement')::uuid,1,'initial',current_setting('test.integrity_draft')::uuid,1,convert_to(body,'UTF8'),money::bigint,currency,exponent,'fr',case when zone is null then date '2027-01-31' else null end,case when zone is null then null else clock_timestamp() end,zone);
end $$;

select throws_ok($$select pg_temp.try_snapshot('-1')$$,'23514',null,'negative money rejected');
select throws_ok($$select pg_temp.try_snapshot('1.5')$$,'22P02',null,'fractional minor-unit string cannot become bigint');
select throws_ok($$select pg_temp.try_snapshot('9000000000000001')$$,'23514',null,'product monetary ceiling enforced');
select throws_ok($$select pg_temp.try_snapshot('9223372036854775808')$$,'22003',null,'bigint overflow rejected');
select throws_ok($$select pg_temp.try_snapshot('1000','XAF',2)$$,'23514',null,'fractional-XAF exponent rejected');
select throws_ok($$select pg_temp.try_snapshot('1000','USD',2)$$,'23514',null,'unconfigured currency rejected');
select throws_ok($$select pg_temp.try_snapshot('01')$$,'23514',null,'noncanonical integer string rejected');
select throws_ok($$select pg_temp.try_snapshot('1000','XAF',0,'{"amount_minor":1000}')$$,'23514',null,'JSON money must be an integer string, not a numeric literal');
select throws_ok($$select pg_temp.try_snapshot('1000','XAF',0,'{"amount_minor":"1"}')$$,'23514',null,'snapshot/projection mismatch rejected');
select throws_ok($$select pg_temp.try_snapshot('1000','XAF',0,'{"amount_minor":"1000","amount_minor":"1"}')$$,'23514',null,'duplicate JSON keys rejected before hashing');
select throws_ok($$select pg_temp.try_snapshot('1000','XAF',0,null,'Unknown/Timezone')$$,'23514',null,'invalid IANA timezone rejected');
select lives_ok($$select pg_temp.try_snapshot('1000','XAF',0,null,'Africa/Douala')$$,'timezone-aware French-language candidate accepted');
select throws_ok($$insert into accordly.version_milestones(organization_id,agreement_id,version_id,ordinal,description,amount_minor,deadline_date,acceptance_terms) select organization_id,agreement_id,id,1,'Partial',999,'2027-01-31','Review' from accordly.agreement_versions; set constraints all immediate$$,'23514',null,'milestone sum must equal the exact version total at commit');
select lives_ok($$insert into accordly.version_milestones(organization_id,agreement_id,version_id,ordinal,description,amount_minor,deadline_date,acceptance_terms) select organization_id,agreement_id,id,1,'Full',1000,'2027-01-31','Review' from accordly.agreement_versions; set constraints all immediate$$,'complete exact milestone allocation accepted');
set constraints all deferred;
select throws_ok($$update accordly.agreements set created_by=gen_random_uuid()$$,'23514',null,'creator cannot be silently reassigned');
select throws_ok($$update accordly.organization_memberships set principal_id=gen_random_uuid()$$,'23514',null,'membership principal cannot be reassigned');
select throws_ok($$update accordly.version_milestones set description='Substituted'$$,'23514',null,'frozen milestone content cannot be modified');
select throws_ok($$delete from accordly.organization_events$$,'23514',null,'organization audit is append-only even when empty');
select * from finish();
rollback;
