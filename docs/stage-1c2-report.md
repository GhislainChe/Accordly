# Stage 1C.2 — verified gateway and agreement preparation

Product: Accordly, independently developed by BE WISE INNOVATION. Date: 10 November 2026.

## Implemented scope

Implemented an authenticated, server-only PostgreSQL gateway and initial-agreement preparation commands. Providers can create/update a typed draft, configure provider/client parties, manage authorized scoped access, freeze an exact immutable candidate with its required parties, and retrieve authorized details. A freeze creates a **pending proposal**, not an acceptance, signature, identity verification, or active contract. Active/effective transitions remain blocked by Stage 1C.1 guards.

Stages 1A/1B and all existing migration/test files were inspected before changes. The original three migrations are unchanged. Two additive migrations extend the approved private-schema model; no competing tenant model or browser-facing database RPC was introduced. Only disposable local infrastructure was migrated/tested. No remote/production database, existing unrelated local project, dashboard or marketing interface was modified.

## File manifest

Paths are relative to the repository root.

New database files:

- `supabase/migrations/20261110000400_preparation_support.sql`
- `supabase/migrations/20261110000500_agreement_commands.sql`
- `supabase/tests/database/preparation.test.sql`

New application files:

- `src/features/agreements/canonical.ts`, `schemas.ts`, `service.ts`
- `src/lib/auth/identity-policy.ts`, `verified-identity.ts`
- `src/lib/db/config.ts`, `gateway.ts`
- `src/lib/security/errors.ts`, `http.ts`
- `src/app/api/agreements/commands/route.ts`
- `src/app/api/agreements/[agreementId]/route.ts`

New verification/documentation files:

- `tests/agreements.test.mjs`
- `scripts/test-gateway.mjs`
- `docs/stage-1c2-report.md`

Modified:

- `scripts/test-database.mjs`: concurrent idempotent create, expected-revision update and freeze tests.
- `package.json`, `package-lock.json`: exact `pg@8.23.1`, `@types/pg@8.23.1`, integration command. No canonicalization/testing framework dependency added.
- `tsconfig.json`: permits explicit TypeScript import extensions for native Node testability; existing strict/no-emit settings retained.
- `src/proxy.ts`: new agreement handlers perform their own live Auth verification/refresh and safe JSON errors rather than depending on Proxy claims refresh.
- `.env.example`, `README.md`, `docs/architecture.md`, `docs/database-design.md`, `docs/security-model.md`: setup, implementation mapping and explicit refinements/limits.

## Verified server boundary

`getVerifiedIdentity()` creates a request-scoped Supabase server client and calls live `auth.getUser()`. The policy requires a valid UUID, authenticated role/audience, non-anonymous identity and confirmed email timestamp; known bans are rejected. It never authorizes from locally read session data, unverified JWT claims, user metadata, or a browser-supplied actor ID. Disabled Accordly principals are also rejected by the database resolver. No identity or resource permission result is globally cached.

`gatewayTransaction()` uses only the restricted `accordly_gateway` login. Server-only modules prevent browser imports. URL configuration rejects administrator usernames, alternate database names, TLS/query overrides and unexpected URI forms. Production PostgreSQL TLS always validates the certificate/hostname; an optional PEM CA supports private authorities. Plaintext is accepted only with an explicit development flag on loopback, never in production. Supavisor-qualified gateway usernames are accepted, but the backend's `current_user` must still be exactly `accordly_gateway`.

The driver checks current role attributes and role memberships on every transaction and rejects privileged/inheriting/group-member configurations. Pool size is 5 per process, connection timeout 5 seconds, idle timeout 30 seconds, maximum connection lifetime 300 seconds. Transactions use statement timeout 5 seconds, lock timeout 2 seconds, idle-in-transaction timeout 10 seconds, fixed search path and parameterized static queries. No prepared statement names or session-global actor state are used. Failed transactions roll back and their connections are discarded. There is no automatic mutation retry after an uncertain result.

The server runs a database permission preflight **before** invoking the mutation command. The command then rechecks identity, organization status, operation rights and scope after acquiring organization/agreement locks. A changed role/grant cannot use a stale server preflight or cached idempotency result. The gateway credential is an impersonation trust boundary: only trusted server code may possess it or assert the verified Auth UUID. RLS does not neutralize a stolen gateway credential.

## HTTP command surface

- `POST /api/agreements/commands`: strict discriminated command envelope containing `operation`, `resource_id`, UUID `idempotency_key`, and typed `input`. No actor, owner, signature, raw SQL or canonical bytes are accepted.
- `GET /api/agreements/[agreementId]`: authorized agreement metadata, permitted draft, party details and up to 100 authorized frozen versions. Clients cannot read provider preparation drafts. Missing and inaccessible agreements return the same 404.

Writes require an exact configured Origin and JSON media type, reject cross-site Fetch Metadata, enforce 128 KiB of actual bytes and a 5-second body-read deadline, and reject invalid UTF-8, duplicate/escaped-equivalent JSON keys, excessive nesting and unknown fields. Cookie identity comes from Supabase SSR, not request JSON. No wildcard CORS or GET mutation is exposed. Responses are private/no-store with no-referrer; errors contain only safe codes, not SQL, credentials or contract payloads.

Example command envelope (replace identifiers with authorized values):

```json
{
  "operation": "freeze",
  "resource_id": "00000000-0000-4000-8000-000000000001",
  "idempotency_key": "00000000-0000-4000-8000-000000000002",
  "input": { "expected_revision": "3" }
}
```

## Commands and authorization

`authorize_operation`, `execute_preparation` and `agreement_details` are the new gateway-callable private functions. Internal helpers and the internal freezer are not executable by the gateway or API roles. Ordinary Supabase authenticated/public/service roles still have no private schema, table or function access.

- **create_draft**: resource is an organization; owner/admin/editor with active membership can create a preparing agreement and complete initial draft. Creator grants, receipt and audit commit together. Input contains title plus the typed draft.
- **update_draft**: resource is an agreement; owner/admin or explicitly granted provider editor can replace only approved draft fields, with the expected agreement revision. It advances both draft and agreement revisions. Frozen/issued content and identity fields are never updated.
- **set_parties**: same preparation edit authority, before issuance only. Configures the fixed provider/client sides and one designated representative for each through this API. Provider principal/email comes from the verified current server actor. The client is an intended contact with **no principal binding or consent claim**. The API cannot inject a client principal, change a verified client identity, edit frozen parties or change tenant ownership. The schema/freezer support existing larger required sets; this convenience configuration command rejects existing multi-representative management rather than overwriting it.
- **set_access**: organization owner/admin only, scoped to this agreement. Provider read grants require eligible same-organization membership; edit/issue grants cannot upgrade a viewer. Revocation can clean up stale grants after membership removal. Client review activation requires an already verified, active client representative binding; the provider cannot manufacture that binding. The current stage supplies no client binding/invitation flow. Active-client historical access/authority is not unilaterally revocable through this command.
- **freeze**: owner/admin or explicitly permitted provider issuer, with expected revision. Validates complete fields, both party sides, nonempty required signer sets, provider membership, distinct party signer identities/mailboxes, current party identities, deadline/currency/milestone rules and supported attachments. It freezes every designated active signer slot, creates one pending initial proposal, updates the pending pointer, and inserts receipt/audit/outbox atomically. No signature/approval is inferred.

The old Stage 1C.1 low-level SQL bootstrap/organization/membership functions are retained for compatibility and infrastructure fixtures; none is exposed as an HTTP operation or automatic-retry path. Their legacy mutations do not gain request idempotency merely by existing. All new public preparation mutations use the receipt-backed path. Retiring/wrapping legacy infrastructure functions is a separate compatibility change, not a hidden relaxation of the new protocol.

## Contract integrity and canonicalization

Money stays in exact decimal integer strings at request/JSON boundaries and bigint minor units in PostgreSQL. XAF/exponent 0 is the only currently enabled command currency. The catalog/schema supports later currencies without redesign; enabling a new currency also requires validator/API fixtures. Fractions, leading-zero representations, negative/overflow amounts and mismatched milestone allocation are rejected. Date-only obligations are distinct from millisecond-precision UTC instants plus valid IANA timezone names. English/French content language metadata is supported without claiming complete localization.

The canonical snapshot is built from locked authoritative database state, never caller-supplied canonical bytes or a live join after issuance. It includes scope, terms, exact monetary metadata, deadlines, ordered milestones, title, organization/agreement/version identifiers, party/representative snapshots and the exact versioned consent disclosure in the controlling language. All active designated signers are required; contact designation is not mailbox/legal identity verification. Attachments must be empty until private artifact sealing exists; no invented object hash is accepted.

Canonicalization v1 follows RFC 8785 ECMAScript primitive serialization/ordering on the contract's constrained schema: fixed ASCII property keys, safe integer JSON metadata, integer-string money, preserved Unicode values and explicit array ordering. SQL independently emits canonical bytes; Node implements UTF-16 property ordering and checks both canonical text and SHA-256 against the returned snapshot **before COMMIT**. Malformed Unicode/NUL and unsupported JSON values are rejected. PostgreSQL generates the stored SHA-256 digest from exact UTF-8 bytes. This is not an unrestricted SQL JSON canonicalizer: arbitrary Unicode object keys/fractional JSON metadata are rejected, rather than silently implementing a different ordering/number scheme.

A dedicated NOLOGIN/NOBYPASSRLS `accordly_freezer` owns the internal candidate constructor. It has only scoped reads, agreement-row locking, and INSERT into immutable version/milestone/proposal/slot tables. The ordinary executor still has no INSERT/UPDATE/DELETE path to frozen versions; the original assertion remains passing. Neither role can update/delete frozen content. No gateway role membership permits assuming the freezer.

The full required set and content projections are inserted from the same constructed snapshot in one transaction, with existing deferred graph/total checks. Freezing is initial-issuance-only; replacement issuance, amendments, signing, expiry materialization and active/effective transitions remain deferred. Proposal expiry is sampled after locking and is seven days. A durable `proposal_frozen` outbox record references the exact candidate; no invitation, email or delivery worker is implemented.

## Persistent idempotency, audit and outbox

Added the approved `command_receipts`, `audit_events` and `outbox_events` tables in private `accordly`, all owned by the private owner and protected by ENABLE/FORCE RLS. Receipt/audit rows are append-only. Outbox receipt relationships use composite tenant/agreement FKs; partial lease metadata is rejected and no worker mutation grants are enabled.

Receipt uniqueness is `(actor principal, operation, resource boundary, UUID key)`. Create uses organization scope; other operations use agreement scope. The SHA-256 request fingerprint also binds actor, operation, resource, validated input and, for party configuration, the server-verified provider email. Property ordering cannot cause a conflict, but a genuine payload or implicit verified-email change does. Organization/agreement locks plus transaction-scoped advisory serialization and unique constraints handle concurrent requests.

Current authorization is checked before cached outcomes. Identical committed requests return the original result, including a freeze retried after the lifecycle changed. A different payload with the same scoped key returns 409. A failed transaction leaves no receipt, so its key may be retried after fixing prerequisites. A lost COMMIT response must be retried using the same key; the application does not assume failure means the mutation did not commit.

Successful outcomes replay for 30 days. After expiry the retained receipt is a reserved-key tombstone: the key is rejected, not reused for a second effect. No purge operation exists; production retention/tombstone compaction needs explicit review. A revoked actor cannot obtain an old cached result. If a create receipt becomes invisible through revoked agreement access, the unique key still prevents a second creation; no cached private outcome is returned.

Successful commands write one ordered per-agreement audit event under the agreement lock, with actor, receipt, request digest, resource/version digest and exact server timestamp bound into canonical bytes and a hash chain. This detects application-level alterations; it is not an operator-proof checkpoint or certified timestamp. Rejected requests are not misrepresented as committed audit events. Separate denial telemetry/incident infrastructure is still a launch gate.

## Actual validation

Node 24.22.1, npm 10.8.2, Docker, pinned Supabase CLI 3.1.0 and disposable Supabase PostgreSQL were used. No test targeted a remote URL.

- Original 91 SQL assertions remained passing.
- Application tests: **15 passed**, including the original 5. New unit cases use fabricated identity/error objects for policy/configuration boundaries; they are not described as live Auth verification.
- SQL security/integrity checks: **135 assertions passed** (the original 91 plus 44 preparation assertions), across all five migrations. Replay with retained/validated cluster roles passed. Separate real concurrent gateway sessions preserved the last owner, deduplicated identical creates, rejected stale competing updates/freezes, and produced exactly one frozen version.
- Real integration: **36 assertions passed** through live local GoTrue login/cookies, production Next.js Route Handlers and restricted PostgreSQL over certificate/hostname-verified TLS. An untrusted test certificate was rejected. This used actual services and real gateway sessions, not mocked database/Auth adapters.
- The integration checks cover unauthenticated and cross-tenant access, Origin/actor injection denial, scoped viewer grants/revocation, conflicting/identical retries, concurrent revision updates/freezes, missing quorum, frozen immutability, live Auth ban, and an accidentally privileged gateway role. Browser JavaScript was checked for the ephemeral database password and fixture service-role key; neither appeared.
- A disposable deferred trigger injected an error at COMMIT after writes; the HTTP result failed safely, original revision persisted, and no receipt survived. The fixture trigger/function was removed and the whole temporary stack discarded. No such backdoor exists in production migrations/code.
- `npm run lint`: passed, zero warnings. `npm run typecheck`: passed. Production `npm run build` was executed successfully inside the real integration runner, including Next TypeScript validation; it was not inferred from unit tests.
- Fresh full audit: exit 1, **8 moderate development lint-chain findings**, no high/critical. Production-only audit: exit 0, **0 findings**. `pg` introduced no reported production advisory. No forced downgrade, audit suppression or untested major override was used.

The real integration uses task-created Auth users and a task-only PostgreSQL password/certificate. A local service-role key is used **only by fixture setup** to create/ban those local Auth users; the runtime gateway never uses it. CLI output/credentials are captured and redacted rather than printed. The test TLS key is confined to a task-owned temporary directory/container and removed; no host certificate store is modified. Application HTTP during the integration uses loopback with explicit configured Origin; production ingress/browser HTTPS and a hosted Supavisor deployment are not claimed as tested.

## Corrections and limitations

The original migrations are untouched. Additive refinements are explicit:

- PostgreSQL schema-local default REVOKEs cannot subtract global default PUBLIC EXECUTE. The regression test caught six new helper ACLs; migration 004 revokes the actual API/PUBLIC ACLs and fixes the global default for owner/migration roles. No unsafe grant was left as an accepted warning.
- The separate freezer role preserves the original immutable INSERT boundary instead of broadly granting frozen-table writes to the ordinary executor.
- One-contact party setup is a deliberate API subset; existing larger required sets cannot be silently overwritten. Future verified binding/delegation needs a dedicated command, not provider-supplied principal IDs.
- TypeScript refinements originally attempted BigInt conversion after an already failed regex. A unit test caught that exception; guarded pipelines now return validation failures without converting malformed amounts.
- The PostgreSQL image lacks an OpenSSL executable. The integration runner now uses host OpenSSL (PATH, the existing Windows Git binary, or `ACCORDLY_TEST_OPENSSL`) to create disposable test certificates; no insecure TLS fallback was added.

Remaining gates:

- No production credentials or deployment were provisioned. Configure the restricted gateway login, trusted PostgreSQL CA/hostname, exact origin and public Supabase project values externally. Hosted connection-pooler behavior, production ingress HTTPS, key rotation/rollout and platform connection budgets need deployment validation.
- Guest invitations, mailbox challenges, guest sessions, verified client binding, action-bound consent proofs, approval/evidence records and unanimous activation are not implemented. Client designation and an empty-attachment snapshot are not signatures or legally certified identities.
- No delivery/render/expiry worker or private Storage upload/download path is enabled. Outbox records are durable intents only. Pending-proposal expiration and history/replacement/amendment commands need the next workflow layer.
- No distributed gateway/edge abuse counter, denial-event pipeline, incident tooling, external audit checkpoint, backup/restore exercise or finalized retention/hold/deletion policy is supplied. Body/time/pool bounds are real but do not replace deployment rate limiting and operational controls. Resolve applicable gates before external signing/production launch.
- The read endpoint caps returned versions at 100; cursor/history pagination and a product onboarding/organization HTTP API are not part of this stage. Organization/membership bootstrap remains infrastructure SQL.
- The gateway credential and migration/operator roles remain trusted impersonation/administration boundaries. Auth revocation racing a request already in flight is not atomically coupled to PostgreSQL commit.
- The existing development dependency advisory/ESLint maintenance work remains open. Reassess compatible upstream fixes separately with full verification.

## Local commands and next stage

Use Node 22.18+ and Docker; validation used Node 24. The standalone database suite needs the pinned image listed in README. The real integration needs Docker, cached/downloadable Supabase CLI images, host OpenSSL, and free local ports 55520–55529. It creates a unique temporary project, copies the migrations, provisions only task-owned fixtures and deletes its own resources. It does not read a linked remote project or accept a remote database argument.

```powershell
npm ci
npm test
npm run test:db
npm run test:integration
npm run lint
npm run typecheck
npm run build
```

For normal local API development, copy `.env.example` to `.env.local`; supply your public Supabase values, exact `ACCORDLY_APP_ORIGIN`, restricted `ACCORDLY_DATABASE_URL` and appropriate CA. Keep all nonpublic values server-only. The health routes still work without credentials; agreement operations fail closed. The integration runner does not write production credentials to that file.

Recommended Stage 1C.3: implement verified client invitations/party binding and fresh one-use action proofs, then real consent/evidence and unanimous transactional activation with replay/expiry/revocation/concurrency tests. Keep amendments, private artifacts and delivery workers behind their own reviewed gates; complete operational retention/abuse/incident controls before enabling external signing. Do not add a broad service-role request path or replace missing consent with a status update.
