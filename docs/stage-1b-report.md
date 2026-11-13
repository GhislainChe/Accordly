# Stage 1B architecture and security review report

Reviewed: 10 November 2026. Product: Accordly, independently developed by BE WISE INNOVATION. Outcome: a finalized logical design for Stage 1C, with explicit implementation and launch gates. This is not a production security approval, database verification, or signature legal assessment.

## Scope and evidence inspected

Read README.md, docs/architecture.md and docs/stage-1a-report.md before revising the design. Inspected the browser/server/proxy Supabase factories, cookie options, public configuration validation, requireUser helper, root Proxy matcher, Next security headers, tests, package.json and lockfile dependency path. Consulted primary Supabase session/RLS/function/Storage guidance, OWASP token/session guidance, RFC 8785 and the published minimatch advisory; references are linked in the architecture/security documents. Retrieved SIX's ISO currency XML and confirmed XAF minor-unit exponent 0.

No evidence exists yet for deployed domain tables, RLS, immutable storage, guest verification, signatures, approval transactions, database concurrency tests, or production operational controls. Findings about those features are design gaps and implementation requirements, not claims of exploitable deployed endpoints.

## Findings and resolutions

### F01 — High: guest workflow contradicted the business requirements

Stage 1A required an authenticated account to sign and did not define registration-free review. Resolved in design: generic public landing, invitation plus mailbox challenge, agreement-scoped guest principal/session, separate action-bound fresh proof and explicit consent. Guests need no Supabase Auth account. Code to implement this does not exist. Mailbox possession is expressly not verified legal identity or corporate authority.

### F02 — High: mutation boundary did not prevent bypass of the Next.js layer

The old proposal described authenticated public RPCs deriving auth.uid(), but did not settle how server-only validation, guest actors, and direct RPC calls fit together. Resolved in design: unexposed domain/command schemas, dedicated restricted PostgreSQL gateway login, narrow NOLOGIN command executor with RLS, no browser domain grants, and server-verified registered assertions or DB-resolved guest sessions. Default function EXECUTE grants and owner/BYPASSRLS paths must be tested. Gateway compromise remains an explicit impersonation risk; this is not eliminated by RLS.

### F03 — High: the approval target could differ from the activated version

Stage 1A described creating a derived version after final approval, leaving canonical equality and signer-set binding ambiguous. Resolved: freeze the complete original/amendment candidate before decisions; every decision binds its ID/hash and slot; final approval advances the pointer to that exact candidate. Canonical bytes include disclosures, party identities and attachment hashes. RFC 8785, integer strings, content language, and deterministic dates/order are specified; fixtures and database comparison remain Stage 1C work.

### F04 — High: unanimity, revocation and concurrency were underspecified

The old document deferred delegation/quorum details, lacked one-use proof and idempotency semantics, and did not define failure ordering. Resolved: nonempty required signer set on both parties, unanimous approval, immutable slots copied for amendments, fixed lock order with authority-row locks, effective-base compare-and-swap, per-slot/proof uniqueness and scoped receipt/payload digests. Expiry is checked after lock acquisition using current database time, not only a worker or transaction-start timestamp. Concurrent amendments supersede losing proposals; no carried approvals. Repeated committed requests return the authorized original result even after activation, not an erroneous pending-state failure. Representative replacement is deliberately unsupported until separately reviewed.

### F05 — High: private buckets and signed URLs did not imply revocable access

Stage 1A did not separate authorization to mint a URL from the subsequent bearer access window or explain privileged Storage credentials for guests. Resolved: authorize every brokered download, stream bounded bytes, no guest Storage credential, immutable sealed objects and quarantine. Signed URLs are deferred; if introduced their residual TTL window is explicit. A Supabase Storage secret remains inherently privileged and requires an isolated component before enablement. Already downloaded data cannot be recalled.

### F06 — High: cross-tenant references and command privileges lacked testable structure

Resolved: organization/agreement composite FKs on scoped child relations, stable immutable tenant ownership, private-schema grants, FORCE RLS with separate table owner/executor, explicit command checks, no exposed views/GraphQL/Realtime alternate paths and scoped list/export queries. Owners/admins read their organization; editors/viewers require explicit agreement grants; clients receive only agreement/party access. Organization admin is not client signer authority. No migration or real-role verification has been performed.

### F07 — Medium: audit integrity and retention claims needed limits

Append-only behavior alone cannot prevent operator rewriting; a failed transaction cannot retain its own denied-event audit insert. Resolved: successful domain audit in the transaction, separate denied-event telemetry, ordered hash-linked events with independent checkpoints as a future operator-tampering control, restricted raw evidence and tombstoned identities. Remove accidental indefinite retention: prohibit application destruction of signed history now, and make class-specific retention/holds/redaction/backups an explicit launch gate. Optional raw IP/device capture stays disabled until policy and access controls exist.

### F08 — Medium: the session scaffold is identity plumbing, not authorization

Source findings: requireUser fetches an Auth user but does not verify email or domain authority; Proxy does not deny based on getClaims errors and cannot be an agreement guard; broad matching invokes Supabase configuration on future guest and unknown non-health paths; browser Auth cookies are readable by JavaScript; the app has no CSP or mutation/guest origin policy yet. The design now defines separate registered/guest resolvers, verified email binding, explicit route policy, CSRF/CSP/cache requirements and Auth revocation race limitations. No sensitive domain route currently exists, so source changes are deferred to Stage 1C rather than adding an incomplete guest/auth implementation here. Mocked refresh tests are not live Auth tests.

### F09 — Medium: current development dependencies retain an advisory

Fresh full audit returned exit 1 and **8 moderate findings** (0 high/critical), all from the minimatch glob amplification advisory and its TypeScript lint dependency chain. Production-only audit returned exit 0 and **0 findings**. The affected copy is under `@typescript-eslint/typescript-estree`; these are eight affected dependency nodes, not eight independent root vulnerabilities. Published patched minimatch is 11.0.1. npm proposes `eslint-config-next@15.5.29`, a major downgrade from the matching 16.4.6 config. No forced fix, downgrade, package change or untested major override was applied.

Disposition: open, bounded development/CI risk; BE WISE INNOVATION engineering owns remediation. Before Stage 1C merge and each release, re-audit and assess a compatible upstream toolchain update; do not suppress the finding. Run untrusted PR jobs without secrets and with CPU/memory/time bounds; do not invoke lint/glob tooling from product input. These CI controls are requirements, not configured CI in this repository. ESLint 9 deprecation is an additional maintenance issue; upgrade coordinated peers, not ESLint alone. Zero reported production advisories is not proof of absence of vulnerabilities.

### F10 — Medium: money, languages and deadlines lacked a fixed representation

Resolved: extensible currency catalog with only XAF enabled initially, exponent 0, bounded bigint minor units and decimal integer strings at JSON boundaries; no assumed two decimals. Date-only deadlines remain distinct from timestamp/timezone obligations. Freeze content/disclosure language and allow locale preferences for English/French without implementing translations. Translation artifacts cannot silently replace the controlling signed bytes.

## Decisions and deliberate scope limits

The finalized design uses one proposal model with initial/amendment kinds, separate mutable drafts and immutable candidate versions, and immutable consent decisions. This avoids duplicated amendment state/evidence. Active agreements do not return to draft; proposal rejection/withdrawal/expiry before activation preserves partial evidence and returns only the engagement preparation state. Unilateral completion/termination, party/signer replacement, payments, account/guest merging, full localization, certified identity and legal compliance evaluation are outside the initial workflow. Reject unsupported commands; do not invent administrator overrides.

Initial access is server-mediated, including guest review and downloads. This trades an extra server/database integration for an explicit server authorization boundary and avoids pretending that the existing registered Supabase client can authorize guests. It does not require a service-role client for domain mutations. Stage 1C must verify custom PostgreSQL role/pool connectivity and Storage component isolation before enabling the affected paths.

Continuing client access is not at the provider administrator's discretion: existing representatives can request fresh verification to their stored address without registration, and a provider cannot revoke the active client's party authority or signed-history access. Session compromise handling is separate from signer replacement. Historical reads survive organization suspension subject to an explicit incident/retention restriction; no new writes are allowed while suspended.

## Unresolved risks and gates

- **Before schema/command acceptance:** prove custom roles, RLS policies and executor ownership on a disposable database; generated SQL constraints and canonical payload projections must agree; lock order and pooled-context reset need adversarial tests. No database configuration exists yet.
- **Before guest signing:** verify challenge delivery, throttling, CSRF, session fixation/replay defenses, identity disclosure, duplicate/expired/forwarded invitation behavior, fresh proof binding and consent display. Mailbox compromise/shared-mailbox authority remains a residual risk even after tests. Stronger identity assurance may be required by later product/legal evaluation.
- **Before artifact access:** isolate the privileged Storage component and prove broker authorization, object immutability, quarantine, orphan reconciliation and failure behavior. Native Supabase secret keys are not bucket-scoped.
- **Before production launch:** approve retention durations, lawful deletion/holds, backup expiry/restore, operator access/checkpoints, monitoring, incident response, canonical origin and key rotation. BE WISE INNOVATION product/security/legal stakeholders own retention and signature claims evaluation; no legal conclusion is made here.
- **Before Stage 1C merge/releases:** reassess the open lint-tooling advisory and ESLint support status; a forced audit-green dependency change is not an approved resolution.
- **Residual after controls:** privileged infrastructure or gateway compromise, mailbox compromise, misrepresented company authority, downloaded documents and Auth revocation racing in-flight work cannot be dismissed. The reviewed application has no live Supabase credentials, so no live Auth, Storage, TLS or revocation result is claimed.

## Files changed

- README.md: links the Stage 1B baseline and distinguishes design from enforcement.
- docs/architecture.md: replaces the Stage 1A proposal with the finalized Stage 1B architecture.
- docs/database-design.md: new logical schema, constraints/indexes and transaction protocols.
- docs/security-model.md: new textual authorization matrix, trust/credential boundaries, threat handling and dependency policy.
- docs/stage-1b-report.md: this review, dispositions, validation and Stage 1C plan.

No runtime source, dependencies, lockfile, migrations, database, external service or interface was changed. Next's generated files may be refreshed by validation; their generated contents are not domain functionality.

## Validation performed

Executed under bundled Node 24.22.1 using its explicit executable and npm CLI:

- `npm run lint`: exit 0, zero warnings.
- `npm run typecheck`: exit 0, Next route types generated and TypeScript passed.
- `npm test`: exit 0, all 5 existing tests passed; these cover public environment validation and simulated request/response cookie forwarding only.
- `npm audit --json`: exit 1, 8 moderate development findings as detailed in F09.
- `npm audit --omit=dev --json`: exit 0, no reported production findings.
- `npm run build`: exit 0, Webpack production compilation, TypeScript validation and route generation passed. No live HTTP check was repeated for this documentation-only stage.
- Documentation checks: 5 changed Markdown files, 11 valid local link targets, no pending validation markers and 0 database migration files. Manual consistency review covered guest authority, frozen candidates, nonempty quorum, expiry, lock order, idempotent retries after activation, client historical access, and operator/retention limitations. These are document checks, not executable proofs of future controls.

No migration, database policy/concurrency test, real guest flow, email delivery or live Supabase authentication test was run. The above scaffold checks cannot validate the proposed database security.

## Proposed Stage 1C implementation plan

1. Establish a disposable Supabase-compatible test database and private schemas. Implement/test restricted gateway, executor, workers, default grants, RLS and TLS/pool behavior first. Keep production and delivery disabled; generate database TypeScript types only after the schema is real.
2. Add organizations, stable principals/party grants, immutable versions/participants, currency/deadline constraints, proposal/evidence/audit/outbox/receipt records and scoped indexes. Prove composite tenant isolation, role administration, destructive-write denial and canonicalization fixtures before exposing domain endpoints.
3. Implement narrow preparation/issuance/signing/amendment commands using the specified locks, current-time expiry, expected revisions, idempotency and atomic audit/outbox. Exercise simultaneous final signatures/approvals, withdrawals/revocations, stale bases, duplicates and serialization retries against real database connections.
4. Add server-only identity/authorization services and explicit guest route policy, then hashed invitations, HMAC challenges, guest cookies and one-use fresh consent proofs. Test token leakage, origin checks, enumeration, scanner GETs, replay, challenge exhaustion, revoked grants and account deletion/tombstones before allowing real external signatures.
5. Add quarantine/sealed private artifacts and isolated authorized streaming, with worker lease/reconciliation tests. Finish applicable retention/operational gates and reassess dependencies before enabling delivery and artifact access. Build the full product interface in a later stage after these invariants pass; Stage 1C needs only minimal integration surfaces and test harnesses.
