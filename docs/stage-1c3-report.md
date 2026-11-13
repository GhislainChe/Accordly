# Stage 1C.3 — invitation verification and initial signing

Accordly, independently developed by BE WISE INNOVATION. 10 November 2026.

## Outcome and enablement boundary

Implemented the initial frozen-agreement invitation → mailbox challenge → scoped session → separate fresh consent challenge → explicit signature → unanimous activation backend. PostgreSQL serializes authority checks, proof consumption, evidence, receipts, audit, outbox and activation. Existing preparation and tenant controls remain in place. No remote or production resources were modified.

**Production signing is deliberately disabled.** The only supported delivery mode is `local-test`, requiring loopback application, Supabase Auth and database hosts. It delivers synthetic `example.test` OTP messages into an operator-controlled local directory, never through a public mailbox API. Invitation secrets are returned once to a verified local issuer for fixture/manual testing. This is a working development transport and actual cryptographic verification workflow, not production email delivery or verification of a real mailbox. The real integration reads this development sink; it does not prove external email delivery, an actual human receiving email, browser interaction or legal identity. No mode permits enabling this workflow on an external deployment merely by setting an enable flag.

The backend records ordinary electronic-signature evidence. It does not certify legal identity, corporate signing authority, qualified/certified signatures, trusted timestamping or enforceability. A mailbox can be shared, forwarded or compromised; same-mailbox checks are not an independent second factor.

## Files changed

New migrations (earlier five unchanged):

- `supabase/migrations/20261110000600_signing_foundation.sql`
- `supabase/migrations/20261110000700_signing_commands.sql`

New runtime files:

- `src/features/signing/config.ts`: fail-closed local-only enablement/configuration.
- `src/features/signing/crypto.ts`: cryptographic token/OTP generation, domain-separated credential digests and keyed challenge/rate identifiers.
- `src/features/signing/schemas.ts`: strict Zod command envelopes and cookie shape.
- `src/features/signing/service.ts`: live registered identity/session verification, private gateway transactions, independent durable throttling, local delivery, HttpOnly cookie and response handling.
- `src/app/api/agreements/signing/route.ts`: dynamic Node POST endpoint with the existing Origin/JSON/body/error boundaries.

Verification/documentation:

- `supabase/tests/database/signing.test.sql`: new real-role pgTAP assertions (registered Auth assertions simulated).
- `tests/signing.test.mjs`: configuration, cryptographic separation and malicious input unit cases.
- `scripts/signing-integration.mjs`: actual local Auth/HTTP/database signing integration.
- `scripts/test-gateway.mjs`: invokes signing tests, local mailbox/configuration and disposable HMAC keys; integration origin is loopback.
- `scripts/test-database.mjs`: concurrent shared abuse-counter enforcement through actual gateway sessions.
- `.env.example`, `README.md`, `docs/architecture.md`, `docs/database-design.md`, `docs/security-model.md`, this report.

No package/dependency changes, product dashboard, invitation UI, signature simulation, marketing site, Storage broker or remote migration were added.

## Private database and permissions

Six approved tables bring the domain total to 25: `invitations`, `email_challenges`, `guest_sessions`, `verification_proofs`, `consent_decisions`, `abuse_counters`. They use server timestamps, UUID identifiers, same-tenant composite FKs, exact existing version digests, credential-length/state checks, unique token/session/proof digests, unique decisions per proposal/slot and proof consumption. Scope/expiry/FK indexes support lookup/revocation and eventual bounded cleanup. No cleanup/deletion job is enabled.

All 25 tables ENABLE/FORCE RLS. PUBLIC, anon, authenticated, service_role and gateway have no new table grants. Two validated NOLOGIN/NOINHERIT/NOBYPASSRLS roles are introduced:

- `accordly_credentials`: locator-scoped metadata lookup on invitation/session/challenge rows and bucket-scoped atomic counters. No document, signature, organization mutation or broad query endpoint.
- `accordly_signer`: scope-derived domain reads, initial lifecycle/pointer writes, client principal binding, credential lifecycle fields, immutable decision/receipt/audit INSERT and outbox INSERT. No frozen version/slot mutation, membership management, evidence UPDATE/DELETE or ordinary login. Guest principal INSERT is bound to the newly derived principal context.

Gateway may execute only the new `signing_command` and `signing_rate_limit` entry points. Internal lookup, event writer and command implementation are not gateway/API executable. The public wrapper clears actor, locator, tenant, agreement and principal contexts on entry/success; transaction rollback/end clears exceptional paths. Context is transaction-local. The existing runtime rejects any gateway role membership and unsafe privilege flags per transaction.

Organization SHARE, agreement UPDATE, proposal and authority/credential locks serialize signing with membership changes, scoped-grant changes, invitation reissue, session revocation and other signatures. Locator resolution derives scope without returning documents; every capability is then revalidated after locks. Guest sessions do not become tenant members or acquire generic Data API credentials.

## HTTP protocol and verification

`POST /api/agreements/signing` accepts a strict operation envelope. Every operation uses exact configured Origin, JSON, bounded body/read time, duplicate-key/Unicode rejection, private/no-store and no-referrer. It accepts no actor, organization override or raw evidence/canonical bytes.

- `list_slots`: live verified issuer/issue permission, pending agreement ID; returns designated slot IDs and intended recipient addresses.
- `invite`: same issuer authority, agreement/slot/idempotency UUID; creates a 32-byte random single-purpose invitation, default expiry min(72 hours, proposal expiry). Reissue revokes previous slot invitations and consequently their dependent sessions/proofs. A committed retry returns its reference, never regenerates/reveals the original secret. Losing the original response requires deliberate reissue with a new key.
- `revoke_invitation`: same pending issuer permission, agreement/slot/idempotency UUID. Active-client access cannot be revoked by a provider through this command.
- `start_access`: invitation locator plus secret, no agreement disclosure; starts a challenge to the immutable intended mailbox. A provider target additionally requires its live registered identity/session.
- `verify_access`: invitation proof, challenge locator and six-digit code. On success atomically consumes the invitation, binds only the designated client representative (without modifying its frozen snapshot), creates an agreement-scoped guest principal/session, and records receipt/audit. A registered-bound representative also requires the matching live verified Auth identity and session. A consumed invitation cannot mint another session.
- `read`: session cookie; returns exact canonical bytes/digest/version/proposal, own consent disclosure and redacted decision receipts, no preparation draft. Node recomputes canonical bytes/digest before returning content.
- `start_consent`: session plus exact proposal/digest; sends a distinct fresh code. `verify_consent` creates one random proof bound to that session/principal, proposal/version/digest and initial-signature action. Verification never signs.
- `initial_signature`: session, proof locator/secret, exact proposal/digest/disclosure, `affirmative: true`, bounded typed name and idempotency UUID. No implicit proposer approval, majority rule or admin override.
- `logout`: revokes the stored current capability; the old cookie is rejected even if replayed.

Registered signers use live `getUser()` plus verified `getClaims()` session ID/sub correspondence. A party capability alone cannot replace provider Auth. Verified email/session does not establish legal identity. Guest-only requests need no Supabase registration; an invalid existing registered session fails closed.

Invitation/session/proof values are independently random 256-bit secrets, stored only as SHA-256(domain/version/locator/secret). Raw invitation/session/proof secrets are never stored in PostgreSQL, receipt/audit/outbox, local delivery files or server logs. Access cookies are host-only `__Host-accordly-party`, Secure, HttpOnly, SameSite=Lax, Path=/; their raw values never appear in JSON. Proof secrets are returned once for temporary client memory, not localStorage. Session idle expiry is 30 minutes; absolute expiry is min(12 hours, source invitation/proposal expiry). Source revocation, authority revision and principal state are checked on every read/write.

Six-digit random codes use a dedicated versioned HMAC key, ten-minute maximum lifetime, at most five failed attempts, resend invalidation and one successful consumption. **Failed verification returns an error value inside SQL, commits the attempt counter, and only then becomes an HTTP failure.** The HMAC binds the unique immutable challenge locator and purpose; its protected row/FKs bind intended email, invitation/session, frozen slot and target version. This makes target binding indirect through immutable challenge identity rather than concatenating mutable caller fields. Codes cannot be transplanted between challenges/actions. Rotation rejects old-key challenges and requires resend; existing one-use proof lifetimes remain bounded.

No generated invitation secret enters a URL in this backend. The development issuer receives it once in a private JSON response. The next UI must carry invitation secrets in fragments, POST from memory, immediately erase history, use no third-party resources, CSP/no-store/no-referrer and redact bodies/URL material at every ingress/APM layer. No GET consumes tokens, starts mail delivery, signs or discloses agreement content. The local fixture server runs HTTP on loopback with an explicit HTTPS loopback Origin and manually forwards Secure cookies; it does **not** establish browser HTTPS/cookie UX readiness.

## Throttling, delivery and failures

Counters live in PostgreSQL so separate application instances share atomic limits. Send buckets are five/hour per invitation and keyed recipient, 20/hour per ingress bucket, 200/hour global; other operations have 500/hour global/ingress caps. The local-only ingress uses a single conservative `local` bucket: no user-supplied `X-Forwarded-For` can allocate new buckets. Counters use fixed UTC hour windows (boundary bursts remain possible), saturate counts and have indexed expiry metadata. Independent short transactions commit counters even if the following domain command fails. Direct challenge attempts remain authoritative. Actual concurrent gateway sessions prove exactly one remaining fifth send is allowed.

Production remains disabled pending trusted-ingress IP identification, a reviewed distributed/per-target abuse policy, bounded counter cleanup and edge limits. Shared SQL counters are implemented controls, not in-memory placeholders; they do not claim complete deployment DoS protection.

The development mailbox writes only synthetic recipient/challenge/code/purpose to a private absolute directory (mkdir 0700/files 0600 where supported), never an HTTP endpoint. Windows deployments must secure that directory using real ACLs; POSIX mode bits alone do not configure Windows ACLs. Recipients outside `example.test` are refused. It is a test mail sink, not proof of actual mailbox receipt. A delivery failure/rate denial can leave an unusable challenge; resend generates a new challenge and invalidates its predecessor. No network/file operation occurs inside a domain transaction. Production encrypted outbox payloads, isolated mail worker/leases/reconciliation and external transport are unimplemented and cannot be enabled by this mode.

## Consent, evidence and activation

Proof validity is min(five minutes after verification, source session/invitation/proposal expiry). Signing checks current authority, live registered session where applicable, exact immutable target/disclosure and one-use proof under locks. Only initial affirmative signatures are supported. One immutable decision per required slot and one decision per proof prevent duplicate effects across keys.

Evidence binds principal, applicable party/representative, slot/proposal/version/digest, exact displayed disclosure and language/version, typed name, affirmative action, mailbox verification time/channel, server signing time, session/Auth-session binding, authority source and capture policy version into canonical UTF-8 bytes with generated SHA-256. No raw IP/device/OTP/token is collected. Access/proof verification and signatures are separately audited. Frozen versions, slots, decisions, receipts and audit remain append-only for ordinary runtime roles.

The final required decision marks the exact initial proposal effective and advances the root to its exact candidate in the same transaction. No empty quorum: existing graph checks require both party sides and every frozen slot needs matching evidence. A deferred validator independently rejects activation without exact digest/disclosure/proof correspondence and quorum. The ordinary executor still cannot activate or insert frozen content. Other authorized metadata revisions on an active root remain possible without changing its effective pointer.

Committed signatures atomically add durable `initial_signature_recorded` outbox references, including whether activation occurred. Delivery/render workers are still disabled. Receipt/audit/outbox rollback with evidence, consumed proof and activation. A lost commit response is retried with the original key/payload; matching retries return the original point-in-time result only while currently authorized. A revoked/expired session cannot retrieve cached results. Signing receipts remain unique and retained with evidence; their inherited thirty-day metadata is not used to recycle signing keys. Verification retries do not reveal a previously issued bearer secret: lost access cookies/proofs require fresh verification/reissue.

## Validation

Actual results:

- **18 application tests passed**, including all original 15. New unit tests exercise local-only enablement, cryptographic domain/challenge separation and strict consent/identity injection rejection.
- **169 SQL assertions passed**: the existing 135 unchanged plus 34 signing/RLS/integrity assertions. All seven migrations applied from empty state and replayed successfully with retained/validated cluster roles. Separate actual concurrent gateway sessions preserved the last owner, deduplicated creates, rejected stale competing updates/freezes, and enforced the remaining fifth-send limit across sessions.
- **101 real local integration assertions passed** through live GoTrue login/verified claims, production Next.js handlers and certificate/hostname-verified PostgreSQL TLS. This includes the original preparation/gateway coverage and the signing flow. Both verified party bindings and signature/outbox deduplication were checked.
- `npm run lint` passed with zero warnings; `npm run typecheck` passed. The production `npm run build` passed inside the real integration runner, including route compilation/TypeScript checks. `npm test` passed without skipped tests.
- Fresh full dependency audit exited 1 with **8 moderate development findings**, zero high/critical. Production-only audit exited 0 with **zero findings**. No dependencies were added/changed, advisories hidden or forced overrides applied.

SQL fixtures use real restricted gateway/signer/API roles but simulated trusted Auth assertions; the HTTP integration uses real local GoTrue login, verified registered claims, production Next Route Handlers, restricted PostgreSQL TLS and the synthetic development mailbox sink. These scopes must not be conflated with external email or a real browser.

The integration covers valid guest/provider signing, provider Auth bypass, forged/expired/revoked/reissued/consumed invitations, correct-code rejection after exhaustion/expiry, idle expiry, scoped reads, false consent, stale digest, wrong-signer proof, consumed/expired proof, conflicting/identical retries, insufficient quorum, concurrent final signing, live Auth ban, immutable evidence hashes and revoked-session reads/receipt replay. A task-only deferred trigger forces failure at COMMIT after writes; evidence/proof/receipt/activation rollback are checked, then the trigger is removed with the disposable stack. Such a fixture is absent from production migrations.

No test uses a remote database. Test runners remove only task-owned containers/projects and temporary secrets/mailboxes, leaving unrelated local projects alone.

## Deployment gates and remaining limitations

- External mail transport, encrypted delivery outbox/worker, ingress HTTPS/browser cookie testing, production abuse/denial telemetry, key rotation/provisioning, hosted connection-pooler validation and operational monitoring are required before any external guest signing. Default configuration is disabled; external hosts fail local-test validation.
- Historical access is available only within the current valid capability lifetime. Generic request-access/recovery and active-history invitations independent of provider cooperation are **not implemented**; an active client cannot yet recover access after session/source expiry. This approved requirement is a release blocker, not delegated to provider discretion.
- Approval is initial/affirmative only. Rejection, withdrawal, materialized proposal expiry, replacement issuance, amendments and representative replacement remain disabled/unimplemented. Expired/terminal/stale proposals cannot sign; no background worker is claimed. The frozen C2 signer/party snapshot is not silently rewritten by verification.
- No full UI/auth onboarding, invitation fragment landing, accessible consent display or account linking. Development invitation tokens cannot be used through a user interface yet. Local fixture issuance/registration remains infrastructure-assisted.
- No sealed artifacts/PDFs, private Storage download broker or document delivery worker. Canonical JSON is the exact contract; empty attachments remain required.
- Production class-specific retention/holds/deletion, backup/restore, independently controlled audit checkpoints, incident response and legal/jurisdiction review remain unresolved. A database operator/gateway credential remains a trusted boundary. In-flight registered Auth revocation is not atomically coupled to database commit.
- Optional IP/device metadata remains uncollected. Audit chains and server UTC timestamps do not provide operator-proof history or certified timestamps. Mailbox control does not verify legal identity, corporate authority or free consent.
- Existing development lint dependency advisories remain visible; no forced dependency override is used. See final validation for any fresh audit results.

## Local setup and next stage

Use Node 22.18+ (validation uses the installed Node 24 runtime), Docker and the existing pinned PostgreSQL/Supabase CLI setup. `npm run test:integration` provisions all local-only keys/mailbox fixtures without modifying `.env.local`. Never copy CLI keys into chat/logs. For manual synthetic tests configure `.env.example` values externally, provision the restricted gateway/TLS and distinct random 32-byte base64url HMAC/rate keys, and select `local-test` only with loopback application/Auth/database endpoints. Use a private absolute mailbox directory; never publish it or use real recipient addresses. Secure cookies require local HTTPS for actual browser testing.

```powershell
npm test
npm run test:db
npm run test:integration
npm run lint
npm run typecheck
npm run build
```

Recommended next: **Stage 1D — first end-to-end interface and remaining access gates**. First implement/test durable external verification delivery, generic authorized client access recovery and browser HTTPS/cookie/fragment handling. Then add a minimal provider preparation/invitation screen and client exact-version review → challenge → separate explicit consent → signed/active receipt flow, with accessible English/French metadata and visible mailbox-identity limitations. Keep signing disabled outside local tests until its production gates pass. Defer dashboard breadth, branding, payments, amendments and Storage artifacts to their own reviewed stages.
