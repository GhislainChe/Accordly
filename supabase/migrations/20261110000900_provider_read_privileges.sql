-- Keep the UI executor limited to redacted receipt projections, not evidence bytes.
begin;
set local role accordly_owner;
revoke select on accordly.consent_decisions from accordly_executor;
grant select(organization_id,agreement_id,slot_id,signed_at,version_digest) on accordly.consent_decisions to accordly_executor;
commit;
