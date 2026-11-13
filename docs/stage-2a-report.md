# Stage 2A — contract amendments and change management

Accordly, independently developed by BE WISE INNOVATION. 12 November 2026.

## Implemented scope

The existing active-agreement model now supports provider and verified guest amendment authorship, author-private editable drafts, immutable full amendment versions, original-versus-proposed review, attributed negotiation feedback, requests for revisions, author withdrawal, explicit verified rejection, and unanimous exact-version approval. Effective terms and price are projected independently from issued/historical candidates. Initial agreement bytes and signing evidence remain untouched. This is a local synthetic demonstration, not production-enabled or legally certified signing.

The existing trusted Next.js gateway, private PostgreSQL schemas, RLS, live Auth checks, capability verification, exact integer money, canonicalization, persistent receipts, hash-chained audit and outbox remain the mutation path. There is no browser table-write path, privileged Supabase browser key, parallel mock API or dashboard redesign. No new dependency was added.

## Files and migrations

New additive migrations (the first nine are unchanged):

- `supabase/migrations/20261112001000_amendment_foundation.sql`: schema-version-2 allowance, purpose/action/check extensions, explicit consent challenge targets/backfill, immutable feedback table, author/scope RLS, submitted-draft guard and internal authority resolver.
- `supabase/migrations/20261112001100_amendment_commands.sql`: exact price/base validation, isolated amendment freezer, registered/capability command wrapper, proposal/history projections, negotiation, receipts/audit/outbox.
- `supabase/migrations/20261112001200_amendment_signing.sql`: additive replacement of the existing signing implementation for access/amendment invitations, target-bound reads/proofs, approval/rejection, base compare-and-swap and atomic supersession. The original migration remains a reproducible historical step.
- `supabase/migrations/20261112001300_amendment_integrity.sql`: guarded active-pointer progression, deferred unanimous-evidence validation for every effective proposal, and explicit effective-version/current-signature provider projection. Revokes temporary CREATE privileges from internal function owners.
- `supabase/migrations/20261112001400_preserve_amendment_history_access.sql`: final security correction: active agreement amendment-token management revokes unredeemed invitations while preserving already verified history sessions; security/operator source revocation is still checked by capabilities. No historical bytes/evidence change.

New implementation files:

- `src/features/amendments/{schemas,types,service}.ts`.
- `src/app/api/agreements/amendments/route.ts` and `src/app/api/agreements/party-amendments/route.ts`.
- `src/components/amendments-panel.tsx`.
- `supabase/tests/database/amendments.test.sql`, `tests/amendments.test.mjs`, `scripts/amendment-integration.mjs`.
- This report.

Updated implementation/test/documentation files:

- `src/features/signing/{schemas,service,crypto}.ts`: target/action validation and existing verified identity reuse, HMAC domain separation, one-use secrets and local-only delivery protections.
- `src/features/agreements/types.ts`, `src/components/provider/agreement-detail.tsx`, `src/components/client/review-flow.tsx`, `src/components/ui/primitives.tsx`: effective versus pending terms, shared amendment UI and explicit approval/rejection states.
- `scripts/test-database.mjs`: concurrent final approvals for different same-base amendments using actual restricted gateway sessions.
- `scripts/test-gateway.mjs`, `scripts/signing-integration.mjs`, `scripts/provider-integration.mjs`: preserve initial-signing regression and extend the real fixture to 75,000 → 100,000 XAF; five-minute build budget for the local runner.
- `README.md`, `docs/architecture.md`, `docs/database-design.md`, `docs/security-model.md`: local demo and additive architectural decisions.

Private ignored `.demo` state/migration copies and validation logs are local artifacts, not source credentials or deployable configuration. No environment template, package dependency, remote resource or original signed version is changed by the implementation.

## Authorization and versioning decisions

`POST /api/agreements/amendments` requires live confirmed registered Auth and a valid session claim. `POST /api/agreements/party-amendments` uses the existing verified HttpOnly capability, with live Auth additionally required for registered-bound representatives. Static route code selects the authorization mode; caller JSON cannot supply identity or trusted context. Both routes share one Zod service and restricted database wrapper. An ordinary tenant reader cannot propose or sign merely because it owns/reads the agreement: current designated review/propose/sign authority is required. Other parties cannot edit an author's private draft or withdraw their proposal.

All mutations lock the organization then agreement and recheck authorization. The freezer revalidates full contractual payload, same current base, active complete quorum, currency/exponent/language and exact milestone totals. Price difference is a canonical signed decimal integer string, bounded to ±9,000,000,000,000,000. Revised total is exact base + delta, positive and within the existing limit. Zero/negative differences are supported. XAF exponent remains zero. No floating-point money arithmetic is used.

Amendment schema version 2 contains the full revised terms, immutable original parties, base ID/digest, reason/change/delta and author attribution. Canonicalization remains version 1/JCS-compatible constrained JSON, with generated SHA-256 digests. The server verifies returned canonical digest before commit. No approvals carry forward. Submitted drafts, frozen versions, participants, decisions and feedback have append-only/update guards. Required party/representative replacement and currency/language conversions are intentionally blocked.

Negotiation uses the existing state machine: `pending → rejected` plus `revision_requested` feedback for a revision request; replacement is a new author draft and immutable candidate linked to the closed proposal. Formal rejection records a fresh verified reject decision with separate evidence/reason; it is never counted toward quorum. Only the proposer can withdraw. A recorded decision cannot be retracted through a revision request. Review or submission implies no consent.

Multiple proposals can be pending against one effective base. Issued version numbers are chronology, not precedence. The first unanimous approval atomically makes its already-frozen candidate effective and supersedes all still-pending competitors on that base. A losing/stale candidate cannot activate. Original and formerly effective proposals retain historical `effective` state; the root pointer identifies current terms. Read/command-time expiry is enforced; a scheduler does not yet materialize expired state.

Approval and rejection require distinct target-bound challenge purposes, fresh mailbox verification, one-use proofs and explicit action against the exact digest/disclosure. An existing verified session may target another proposal only for its same agreement/representative. New consent challenges explicitly persist proposal/version/digest. The migration backfills existing challenge targets using the migration administrator because the NOLOGIN owner is intentionally denied row reads by FORCE RLS.

Closing a proposal revokes its unused proofs and unredeemed invitations. Otherwise-valid consumed sessions continue to provide authorized agreement history until their own expiry/revocation. Revoking a source invitation invalidates its derived sessions. New access invitations use only existing effective required slots, require a new mailbox verification and do not revoke consumed history sessions. Provider-independent recovery after capability expiry remains unimplemented.

Mutations use actor + operation + agreement + idempotency key. Matching retries return committed receipts only after current authorization checks; conflicts and expired 30-day keys are rejected, never recycled. Failed COMMIT rolls back pointer, proof, evidence, supersession, receipt, audit and outbox. Lost verification bearer responses require a new challenge; bearer secrets are not recovered from stored receipts. Shared SQL verification limits remain enabled.

## Actual validation

Checks run with the supported recorded Node 24 runtime (system Node is unchanged):

- Application tests: **30 passed**, including exact positive/negative/zero/boundary amendment arithmetic, strict input schemas and distinct approval/rejection HMAC purposes.
- SQL security suite: **224 pgTAP assertions passed** against all **14 migrations**, preserving the original 181 assertions. Additional actual concurrent gateway sessions selected one effective amendment and superseded two same-base competitors; stale final consent was refused. Existing concurrent ownership, preparation/idempotency and shared-counter checks also passed. Full schema replay with retained validated roles passed. Test containers and their volumes were removed by their owner runner.
- Lint: passed with zero warnings after correcting an unused field in the integration fixture helper. TypeScript: standalone `npm run typecheck` passed; production builds also ran TypeScript successfully. Standalone `npm run build` passed after the final UI selection correction.
- Live local gateway integration: **190 assertions passed**, including the original signing regression, 75,000 + 25,000 = 100,000 XAF unanimous amendment activation, rollback, real amendment-specific invitation verification, consumed history-session preservation during token management, self-revocation and effective terms after a later withdrawn candidate. The runner built the production server successfully and stopped only its task-owned Supabase stack. No verification counters were reset or relaxed.
- Retained demo: `npm run demo:setup` applied only pending owned-local migrations, without reset. All **14** migrations are installed. Existing **three** consent challenges were backfilled successfully. Before/after checks confirmed the original effective version ID/digest, **75,000 XAF** and **two signatures** are unchanged. Existing login → authorized dashboard → logout passed **7 HTTP assertions** with credentials kept private. Authorized amendment list/create/list and provider detail HTTP checks passed, preparing one **unsubmitted 100,000 XAF draft** for the 25,000 XAF addition. Its draft ID/key are recorded privately in `.demo/stage-2a-scenario.json`; no retained candidate was frozen and no invitation, challenge, consent or signature was created for it. localhost:3000 health returned HTTP 200.
- Dependency audit: the production-only audit passed with **zero findings**. The full dependency audit timed out twice (the retry reported `ETIMEDOUT`), so no fresh all-dependency clean result is claimed. Previously documented development advisories remain unresolved; no dependency overrides/changes were introduced.

Initial validation caught and corrected a missing live registered session assertion, a PostgreSQL record/alias collision, test constraint-mode isolation, and the active-history revocation edge case documented in migration 014. The integration build initially exceeded its old 120-second budget; the runner now allows 300 seconds and subsequent builds passed. Fixture assertions were updated to the scenario title and to scope the two original verification audit events by their immutable original version; added amendment access creates its own separate audit event. A first retained-demo login smoke request timed out during cold development compilation; after warmup, the complete unchanged login smoke passed. The unresponsive prior Accordly development process chain was restarted; unrelated processes/stacks were not stopped.

The SQL suite uses simulated trusted identity/HMAC assertions but actual restricted gateway/signer/API roles, real grants/RLS, constraints and transactions. It is not evidence of live GoTrue verification. The real integration separately uses disposable local GoTrue identities, production Next handlers, restricted PostgreSQL with hostname/certificate-verified TLS, actual HTTP cookies and the synthetic local mailbox. It does not test external email or human identity.

Positive formal rejection and prior-approval invalidation after a revision request are covered by real-role SQL tests with simulated trusted identity/HMAC assertions. The live HTTP scenario covers affirmative amendment signing and refusal to repurpose an approval challenge into rejection; it does not claim a separate positive rejection mailbox loop or browser rejection demonstration.

The amendment tests cover author/guest creation, cross-tenant/anonymous/forged authority denial, author-only editing, stale bases/revisions/digests, positive/negative/zero exact amounts, currency/milestone rejection, freeze immutability, negotiation/withdrawal authorization, prior approval invalidation, explicit rejection, quorum, duplicate/conflicting submissions, concurrent creation/freezing/signing, same-base competition, rollback and effective projections. Initial signing, evidence, tenant and gateway regression suites remain enabled.

Browser automation was attempted this stage. In-app browser inventory reported Statsig initialization failure and opening localhost timed out/reset the kernel. Native window accessibility was unavailable and screenshot capture did not reliably show the selected Accordly window. No unrelated browser was operated and no new browser acceptance or mobile/assistive-technology success is claimed. The user's earlier manual initial-signing demonstration remains distinct from unverified Stage 2A browser amendment interaction.

## Manual local demo

Use Node 22.18+ (the recorded compatible Node 24 runtime is supported), Docker, OpenSSL and npm. Follow the README's **Fictional amendment demonstration**. `npm run demo:setup` applies only pending migrations to the recorded owned local demo; `npm run demo` starts localhost:3000. Never reset it or target a linked/remote project.

Keep `Logo and Brand Identity Design` Version 1 at 75,000 XAF and preserve its digest. Request `Five branded social media templates`, delta `25000`, full revised total `100000`; update scope/deadline and full milestone allocation as appropriate. Save and review the draft, freeze, review before/after, create the designated private approval invitations, verify each party's mailbox independently and collect fresh explicit approval from both. Read only the requested synthetic code with `npm run demo:mail -- CHALLENGE_UUID`. Provider stays signed in; client uses a separate profile. Refresh effective terms after the last signature and inspect original Version 1/history. No setup step signs on a user's behalf.

For negotiation, use a separate pending proposal, request revisions with a reason, prepare a new linked replacement against current effective terms and obtain fresh approvals. For rejection, choose the distinct rejection verification action and explicitly confirm. Shared hourly limits apply: wait for the next window instead of resetting data or counters. After an idle/absolute/source expiry, use a new authorized access invitation and mailbox verification.

## Limitations and recommended next stage

Production guest signing stays fail-closed. Synthetic local delivery is not production email. External delivery/reconciliation, independent client recovery, trusted-ingress/edge abuse controls, Auth ingress hardening, counter/mailbox cleanup, key rotation, audit retention/legal holds, backup/restore, incident response and independent audit checkpoints remain online deployment blockers. Mailbox control is not verified legal identity or corporate authority; no legal certification or enforceability is claimed.

Representative replacement, cancellation/termination, currency conversion, controlling-language change, attachments/Storage/PDF export and expiry workers remain outside this stage. Historical list pages contain 50 issued versions with a load-older control; own unsubmitted drafts show 50 recent records. Existing dashboard/activity caps remain. No external email, production pooler or browser/mobile accessibility acceptance is inferred from local HTTP tests. Existing dependency advisories are not suppressed by dependency overrides.

Recommended **Stage 2B — amendment browser acceptance and production readiness**: manually exercise provider/client amendment approval, revision and rejection on desktop/mobile, verify fragment/cookie/CSP and keyboard behavior, then implement production delivery and independent recovery, trusted-ingress abuse controls, retention/incident/backup gates and legal review before enabling real contracts. Defer the premium redesign, payments, AI and unrelated marketing work.
