-- Read projections for the first UI. Existing commands remain the only mutations.
begin;
grant create on schema accordly_commands to accordly_executor;
set local role accordly_owner;
grant select on accordly.consent_decisions to accordly_executor;
create policy provider_decision_read on accordly.consent_decisions for select to accordly_executor
 using(accordly_commands.can_access_agreement(organization_id,agreement_id,'draft_read'));
create function accordly_commands.provider_workspace(p_auth uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare result jsonb; begin
 perform accordly_commands.set_registered_actor(p_auth);
 select jsonb_build_object('organizations',(select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'kind',o.kind,'status',o.status,'role',accordly_commands.org_role(o.id)) order by o.created_at),'[]') from accordly.organizations o where accordly_commands.org_role(o.id) is not null),
 'agreements',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'organization_id',a.organization_id,'title',a.title,'lifecycle',a.lifecycle,'revision',a.revision::text,'created_at',a.created_at,'updated_at',a.updated_at) order by a.updated_at desc),'[]') from (select * from accordly.agreements order by updated_at desc limit 200) a)) into result;
 perform set_config('accordly.actor_id','',true); return result;
end $$;
create function accordly_commands.provider_agreement_view(p_auth uuid,p_agreement uuid) returns jsonb
language plpgsql security definer set search_path='' as $$ declare result jsonb; org uuid; begin
 org:=accordly_commands.authorize_operation(p_auth,'read',p_agreement);
 result:=accordly_commands.agreement_details(p_auth,p_agreement);
 perform accordly_commands.set_registered_actor(p_auth);
 result:=result||jsonb_build_object('permissions',jsonb_build_object('edit',coalesce(accordly_commands.can_access_agreement(org,p_agreement,'edit'),false),'issue',coalesce(accordly_commands.can_access_agreement(org,p_agreement,'issue'),false)),
 'representatives',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'party_id',r.party_id,'display_name',r.display_name,'can_sign',r.can_sign) order by r.id),'[]') from accordly.party_representatives r where r.agreement_id=p_agreement and r.revoked_at is null),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'event_type',e.event_type,'occurred_at',e.occurred_at,'sequence',e.sequence::text) order by e.sequence),'[]') from (select * from accordly.audit_events where agreement_id=p_agreement order by sequence desc limit 100) e),
 'signatures',(select coalesce(jsonb_agg(jsonb_build_object('slot_id',d.slot_id,'signed_at',d.signed_at,'digest',encode(d.version_digest,'hex')) order by d.signed_at),'[]') from accordly.consent_decisions d where d.agreement_id=p_agreement),
 'slots',(select coalesce(jsonb_agg(jsonb_build_object('slot_id',s.id,'side',p.side,'expected_email',s.expected_email,'proposal_id',s.proposal_id)),'[]') from accordly.proposal_participants s join accordly.agreement_parties p on p.id=s.party_id where s.agreement_id=p_agreement and s.proposal_id=(select pending_initial_proposal_id from accordly.agreements where id=p_agreement)));
 perform set_config('accordly.actor_id','',true); return result;
end $$;
reset role;
alter function accordly_commands.provider_workspace(uuid) owner to accordly_executor;
alter function accordly_commands.provider_agreement_view(uuid,uuid) owner to accordly_executor;
revoke all on function accordly_commands.provider_workspace(uuid),accordly_commands.provider_agreement_view(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function accordly_commands.provider_workspace(uuid),accordly_commands.provider_agreement_view(uuid,uuid) to accordly_gateway;
revoke create on schema accordly_commands from accordly_executor;
commit;
