# Stage 1C.1 — database foundation implementation

Product: Accordly, independently developed by BE WISE INNOVATION. Date: 10 November 2026.

## Scope and migration status

Implemented a real PostgreSQL foundation based on the approved Stage 1B documents. No database conventions existed, so this stage introduces Supabase's timestamped `supabase/migrations/<version>_<name>.sql` convention. All three migrations have been applied successfully to fresh disposable Supabase PostgreSQL containers and replayed after rebuilding only their private schemas with the same cluster roles retained. Nothing was applied to a remote/production database or the existing unrelated local Supabase project.

The database is not connected to the Next.js application yet. No application gateway credential was created, no password is hardcoded, and no Auth session is simulated in production code. The role's LOGIN attribute is present, but deployment authentication/verified TLS and a server adapter must be provisioned separately. The temporary test database uses trust authentication only inside a no-network/no-published-port container.

## Files changed

New:

- `supabase/config.toml`: separate local project `accordly-foundation`, ports 55420/55421/55422/55424/55429, private schemas absent from API exposure, automatic new-table exposure disabled, no seeds, no Storage/Realtime/Studio/Edge runtime enabled.
- `supabase/migrations/20261110000100_private_foundation.sql`: roles, private schemas, 16 tables, reference data, scoped FKs, checks and indexes, explicit privileges/default ACLs.
- `supabase/migrations/20261110000200_integrity.sql`: identity immutability, append-only history, owner constraints, snapshot/monetary/date validation, milestone totals, proposal/root consistency and fail-closed workflow boundary.
- `supabase/migrations/20261110000300_authorization_commands.sql`: FORCE RLS policies, isolated helpers and six allowlisted gateway commands.
- `supabase/tests/database/foundation.test.sql`: authorization/API-role/RLS and foundational integrity assertions (73).
- `supabase/tests/database/integrity.test.sql`: exact-money, canonical-field, timezone, milestone and immutable-record assertions (18).
- `scripts/test-database.mjs`: disposable Docker runner, migration/replay validation, actual gateway login and role-escalation denial, concurrent last-owner preservation, bounded timeouts and owned-resource cleanup.
- `docs/stage-1c1-report.md`: this report.

Modified:

- `package.json`: adds `npm run test:db`; no package dependency or lockfile change.
- `.gitignore`: ignores Supabase temporary/branch runtime files.
- `README.md`: updates implementation scope, database verification/setup and next steps.
- `docs/architecture.md`, `docs/database-design.md`, `docs/security-model.md`: explicitly map the implemented subset and documented refinements below; historical Stage 1A/1B reports are preserved.

No Next.js runtime source or product interface was changed. No invitation tokens, signatures, dashboards, marketing site, Storage buckets or remote infrastructure were created.

## Tables and integrity

All 16 tables live in private `accordly`, owned by `accordly_owner` and protected with ENABLE + FORCE RLS:

- Reference/identity: `currencies`, `principals`, `profiles`.
- Tenancy: `organizations`, `organization_memberships`.
- Engagement access: `agreements`, `agreement_access_grants`, `agreement_parties`, `party_representatives`.
- Content foundation: `agreement_drafts`, `agreement_versions`, `version_milestones`, `agreement_proposals`, `proposal_participants`.
- Artifact metadata and organization audit: `document_artifacts`, `organization_events`.

UUIDs and timezone-aware timestamps default to server-generated values. Agreement descendants carry organization/agreement composite references; there is no transferable tenant owner column masquerading as authorization. FKs use RESTRICT rather than history-erasing cascades. Dedicated triggers prevent changing tenant/identity/creator/author fields and frozen proposal content. Versions, milestone definitions, required participant slots and organization audit records reject UPDATE/DELETE/TRUNCATE. The principal's Auth FK prevents account deletion from silently deleting history.

XAF is enabled with ISO numeric code 950 and exponent 0. Money uses bounded bigint minor units (1..9,000,000,000,000,000 for totals, 0..ceiling for milestones), with decimal integer strings in snapshots. No money floats or assumed cents. Catalog changes do not rewrite existing snapshots. PostgreSQL computes SHA-256 over stored bytes using a generated digest column; JSON must have unique keys, and normalized money/currency/language/scope projections must match. Date-only and instant/timezone shapes are exclusive; timezone names are validated. When milestones exist their exact sum must equal the version total at transaction end.

These are snapshot foundations, not a complete RFC 8785 issuer: no runtime role can insert a version/proposal/slot, and complete canonicalization, attachments/quorum equality and typed input validation must be implemented before granting an issuance command. Tests use privileged fixture bytes to examine constraints/RLS, not to claim a valid signing workflow.

The preparing/awaiting state and pending initial pointer must agree with a scoped pending proposal. Submitted proposals require both provider/client slots at transaction end. Undefined states, cross-tenant pointers and direct activation/effectiveness are rejected. No active agreement is produced in this stage; activation is explicitly blocked until an authorized consent transaction exists. This avoids a placeholder direct UPDATE path that could bypass signing.

## Roles, grants and policies

- `accordly_owner`: NOLOGIN, NOBYPASSRLS table/schema owner, distinct from runtime roles. FORCE RLS prevents ordinary owner queries without a policy. Migration/infrastructure administration is still a privileged trust boundary.
- `accordly_gateway`: LOGIN, NOINHERIT, NOBYPASSRLS, no schema creation, no private table access, no membership in internal roles. Explicit CONNECT/command-schema USAGE and EXECUTE on six entry points only. No password or runtime environment connection string is generated. Existing managed-database PUBLIC connection/temp defaults are not represented as per-role secrets or domain access.
- `accordly_executor`: NOLOGIN, NOBYPASSRLS; SELECT subject to RLS on foundation tables, INSERT only on organization/membership/agreement/creator-grant/organization-audit tables, column-limited membership UPDATE and organization ID UPDATE only for row locking. It cannot update frozen versions, proposal state, agreement state/pointers, artifact metadata or arbitrary schema code.
- `accordly_authorizer`: NOLOGIN metadata-only helper owner. Explicit column grants and nonrecursive RLS permit reading authority metadata, not contract bytes, artifact paths, Auth credentials or arbitrary data.
- `accordly_identity`: NOLOGIN helper owner; only principal SELECT/INSERT under the internal verified Auth ID lookup scope. It cannot change privileges, read Auth credentials, create tenant memberships, or issue consent.
- `accordly_integrity`: NOLOGIN validator owner; explicit SELECT and organization-row locking for fixed integrity triggers. Its validator policies do not depend on actor context because deferred constraints execute after a command clears that context. No client-query entry point or gateway membership exposes this validator.
- `anon`, `authenticated`, `service_role`, PUBLIC: no domain/command schema access, no table DML or function execution. A service role's BYPASSRLS attribute does not supply missing schema/table privileges; the suite verifies this. No application service-role client is added.

The migrations define 50 policies across the 16 tables and 20 functions: six gateway entry points, five internal identity/authorization helpers (`actor_id`, `org_role`, `can_access_agreement`, `shared_version`, `set_registered_actor`), and nine fixed trigger functions (`prevent_identity_change`, `deny_history_mutation`, `validate_registered_membership`, `require_organization_owner`, `require_bootstrap_owner`, `validate_version`, `validate_milestone_totals`, `check_agreement_graph`, `workflow_boundary`). The SQL files are the exact policy/grant manifest; no gateway execution grant is given to an internal/trigger function.

All custom roles are NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION. Runtime roles cannot create command functions or assume each other. Function EXECUTE defaults are revoked, SECURITY DEFINER search paths are fixed empty and all object references are qualified. Reset replay reuses only reserved roles whose attributes/membership pass validation; unsafe preexisting roles abort rather than being silently adopted or overwritten.

Policies distinguish organization authority from agreement access. Owner/admin sees its organization; editor/viewer needs explicit agreement grants, and the creator's grants are inserted atomically. A registered client needs an unexpired/unrevoked explicit review grant plus a bound active client representative, and only shared lifecycle/version data is visible. Clients cannot read provider drafts, provider membership or internal organization audit. Revoked membership invalidates provider grants. Registered principal disablement blocks gateway principal resolution. No guest access policy is enabled because its verification/session mechanism is out of scope.

## Gateway command surface

Only the restricted gateway can call:

1. `register_principal(verified_auth_user_id)` — creates/resolves a stable registered principal linked to an existing Auth ID; disabled principals cannot re-register to regain access.
2. `create_organization(verified_auth_user_id, name, kind)` — atomically creates an individual/business tenant, initial owner membership and audit event. Deferred constraints prevent an ownerless committed tenant.
3. `set_membership(verified_auth_user_id, organization_id, principal_id, role, active)` — locks organization, validates current authority and target role, restricts admins to editor/viewer management, prohibits self-promotion and loss of the last owner, audits atomically and increments authority revision.
4. `create_agreement(verified_auth_user_id, organization_id, title)` — validates provider role and active organization under lock; inserts preparing agreement, explicit creator grants and audit event together.
5. `list_agreements(verified_auth_user_id)` — returns an allowlisted metadata projection through RLS. Add bounded pagination before exposing it to production workloads.
6. `read_version(verified_auth_user_id, version_id)` — returns a scoped shared snapshot/digest or NULL for both missing and unauthorized IDs.

`verified_auth_user_id` is an assertion accepted only from the private trusted server gateway, never a browser parameter or public RPC. The database FK checks existence, not a live Auth session, email ownership or company authority. The future server must use live Auth verification, confirmed-email/account checks and request authorization before invoking these commands. Possession of the private gateway credential is an impersonation boundary; do not provision it to a generic SQL proxy or the browser.

Each command overwrites internal actor lookup scope and clears it before returning, including within the same database transaction. Exception rollback restores statement-local changes; the next command also resets its scope. Organization locks serialize membership changes, last-owner checks and agreement creation against revocation. Mutation audit is written while pre-change authority is valid, then the membership change commits with it; failure rolls both back.

## Explicit refinements to Stage 1B

1. `organizations.kind` documents freelancers/businesses within one approved tenant model, not competing ownership tables.
2. `accordly_integrity` is necessary to enforce deferred cross-row constraints independently of cleared request context. It has no login/query API and no RLS bypass. Ordinary RLS authorization remains in the executor/authorizer roles.
3. Organization bootstrap/membership needs an audit stream before an agreement exists: `organization_events` is append-only, rather than inventing a fake agreement or weakening agreement-audit foreign keys. Per-agreement consent audit chains/checkpoints are deferred.
4. Supabase's managed Auth REFERENCES grant may be usable by the migration operator but not delegable. Build the Auth FK under that operator, then assign private table ownership. Do not grant Auth credential-table access or emulate session verification in a database helper.
5. Active/effective transitions are intentionally denied and frozen-row writes are ungranted until a reviewed signing/issuance migration implements the already approved state machine. The baseline workflow decision is unchanged.

## Environment and actual validation

Docker daemon 29.9.2 was available; host `psql`/PostgreSQL and a globally installed Supabase CLI were not on PATH. Supabase CLI 3.1.0 was available through pinned npm execution. The existing `bewiseinnovations.com` local stack was inspected by name/image only and left untouched.

Primary executed database verification: `npm run test:db` (also executed directly during development), Node 24.22.1, Supabase PostgreSQL image 17.11.0.003 pinned to digest `sha256:7374d196da7e301512cc5329e18040e0f7bb856287b323777cdadecccbc6c7e4`.

- Fresh ordered application of all three migrations: passed.
- pgTAP: 73 foundation + 18 additional integrity assertions, **91 passed**, exit 0.
- Real gateway connection using `-U accordly_gateway`: passed; attempting SET ROLE executor under that actual login returned insufficient privilege. A privileged session merely switched to a role is not used as proof of SET ROLE denial.
- Direct RLS assertions selected actual NOLOGIN executor/API/owner roles and verified current_user, not only administrator queries. Privileged setup/constraint assertions are separately labeled and do not count as proof of RLS.
- Cross-tenant read/INSERT/UPDATE denial, unauthenticated/API-call denial, client draft privacy, direct role escalation, immutable tenancy, invalid relationships/states, disabled/revoked access, owner bootstrap/last-owner rules and frozen-record mutation protections: passed within that suite.
- Private-schema rebuild and migration replay with retained validated cluster roles: passed.
- Two concurrent actual gateway sessions attempting to remove their respective owner memberships: exactly one committed, the other received an integrity rejection, one owner remained. Passed.
- The runner removed each container/volume it created; no remote URL or existing-container target is accepted.
- Full Supabase CLI 3.1.0 stack: startup completed, exit 0, after downloading its PostgreSQL 17.11.0.018 and PostgREST v16.5 images. Migration history contains all three exact versions, and all 16 domain tables have FORCE RLS. Both SQL suites were executed again in that separate full local stack: **91 assertions passed**. This additionally verifies migration compatibility with the CLI-managed database, not just the pinned database-only runner.
- The CLI stack was discarded/recreated after the final integrity-trigger edits. Final metadata verified the new fixed-draft-author/frozen-proposal-content triggers; both SQL suites again passed all 91 assertions from that final fresh migration state. Schema inventory includes the 20 functions and 50 policies described above.
- Actual anonymous HTTP PostgREST boundary checks with the local public key: private `Accept-Profile: accordly` table request returned 406/PGRST106; private `Content-Profile: accordly_commands` RPC request returned 406/PGRST106; querying `agreements` through the public schema returned 404. Keys/credentials were captured only inside the check process and were not printed. Authenticated API-role SQL tests cover database grants; no live user sign-in/signing/guest/Storage flow is claimed.

Quality checks performed through explicit Node 24/npm CLI invocation:

- `npm run lint`: exit 0, zero warnings.
- `npm run typecheck`: exit 0, including generated Next route types.
- `npm test`: exit 0, 5 application scaffold tests passed.
- `npm run build`: exit 0, Webpack production compilation/TypeScript/route generation passed.
- `npm audit --omit=dev --json`: exit 0, no reported production findings.
- `npm audit --json`: exit 1, the existing 8 moderate development lint-chain findings remain; 0 high/critical. No forced fix, dependency change or untested override was applied. The Stage 1B advisory disposition/CI containment requirements remain open.

During development, the first runner failed due to peer authentication and early socket-only readiness; corrected to isolated TCP-loopback readiness. Two initial pgTAP assertions were invalid (administrator session retained SET ROLE ability; duplicate party uniqueness masked the intended FK failure); corrected fixtures plus a true gateway-login assertion now cover those cases. Concurrent removal exposed a real post-revocation audit-policy failure; moving the audit insert before the membership update in the same transaction resolved it. A later run exposed a microsecond-sensitive fixture expiry expression; statement-time fixture expiry removed that flake. Final results above reflect the corrected runs, not the earlier failures.

Documentation validation: all 16 local links in the five changed Markdown documents resolve. No incomplete validation markers remain. Disposable runner containers and the task-created full CLI stack were stopped/removed; the unrelated existing local project was left running. Downloaded image caches remain available for repeat tests.

## Local setup and operation

Use Node 22.18+ (validation used bundled Node 24), npm 10+, and Docker. Avoid the system Node 20 launcher for the current Supabase SDK.

```powershell
npm ci
docker pull public.ecr.aws/supabase/postgres:17.11.0.003@sha256:7374d196da7e301512cc5329e18040e0f7bb856287b323777cdadecccbc6c7e4
npm run test:db
```

This is the recommended repeatable security/migration check. It needs no database credentials, Supabase account, linked project or host PostgreSQL installation. It fails if Docker/image/test support is unavailable; it does not silently substitute fake SQL evaluation. `pgTAP` runs inside the disposable image and its failed assertions/SQL errors/incomplete TAP plans cause nonzero exit. Cleanup targets only the exact container ID created by this process.

For a separate full local Supabase development stack:

```powershell
npx --yes --package=supabase@3.1.0 supabase start
# Manage only project_id=accordly-foundation from this workspace.
npx --yes --package=supabase@3.1.0 supabase stop --no-backup
```

Startup applies the ordered migrations. The second command discards this local development stack's data; use it only when that local stack is disposable, as it was during this task. Do not run reset/push with linked/remote/URL flags. No migration command should be aimed at an existing remote or production database without explicit authorization. Do not paste CLI status/start output containing local keys or database URLs into logs/chat. The runner intentionally avoids printing keys, environment dumps or connection strings.

For production provisioning in a later stage, use a reviewed migration operator with the required role/schema/Auth REFERENCES privileges, separately provision gateway authentication and verified TLS, and do not use the isolated test trust configuration. No production or pool/TLS setup has been validated here.

## Deferred work and unresolved risks

- No server PostgreSQL driver/gateway adapter or runtime DB credentials are installed/configured. No public HTTP command endpoint exposes verified-user assertions. Live Auth verification, email status, CSRF/origin enforcement and credential isolation must precede server integration.
- No guest invitations, challenges, proofs/sessions, consent decisions, amendment activation, worker/outbox processing, command receipts, private evidence metadata, agreement audit chain, incident telemetry or Storage buckets/policies are implemented. Their approved design remains required. No broad guest/service-role policy substitutes for them.
- No runtime command provisions client representative/review grants or inserts frozen versions/participants; tests arrange these with privileged fixtures and then exercise actual restricted roles. Add typed, audited, authorized provisioning/freezing in the next stage rather than granting arbitrary DML.
- These initial bootstrap/create commands are low-level database commands without request-level idempotency receipts. Before exposing mutation endpoints or automatic retries, add reviewed idempotency keys/payload digests and appropriate organization/agreement audit receipts. Do not blindly retry successful creation commands after a lost response.
- Full RFC 8785 canonicalization, complete payload/child/signer-set equality, attachment sealing, required-set carry-forward and actual signature freshness/consent are not implemented. Frozen-byte hashing/immutability alone does not claim a valid electronic signature or legal certification.
- Typed draft editing, expected-revision mutations, issued-record/signer binding and complete workflow transitions are unexposed. The explicit effectiveness guard must only be changed by a migration that supplies the approved consent evidence/atomic authorization path.
- Profile maintenance, principal tombstoning/Auth deletion, incident suspension, legal holds/retention, independent checkpoints, backup/restore and organization suspension commands need dedicated reviewed operations. Do not infer that table existence supplies these policies.
- Private artifact metadata is not proof of private Storage enforcement. Storage remains disabled/unprovisioned; its broker credentials and immutable uploads need separate tests and isolation.
- Privileged migration/infrastructure operators and a compromised gateway are trust boundaries. RLS cannot neutralize their credentials. Local tests do not prove production TLS, pool context isolation under a real connection pool, live Auth revocation or every external Supabase API path.
- The development dependency advisory, mailbox/legal-authority limitations and production retention/incident decisions remain open as described in Stage 1B.

## Proposed Stage 1C.2

1. Add server-only, verified-TLS PostgreSQL gateway integration with bounded pooling/timeouts, live Auth/verified-email/account checks and tests preventing browser-supplied identity assertions. Add pagination and request idempotency before exposing commands.
2. Add typed draft/party/representative/grant provisioning and canonical freeze/issuance commands with exact snapshot/quorum/attachment equality, expected revisions, transactional agreement audit/outbox/receipts and real-role tests. Keep activation disabled until its evidence model is real.
3. Implement the next reviewed consent/approval transaction layer and its concurrency/replay/expiry tests, then guest verification and isolated private Storage in their scoped follow-up steps. No production feature enablement or complete interface until those gates pass.
