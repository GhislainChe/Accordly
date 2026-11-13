# Stage 1D — first provider/client interface

Accordly, independently developed by BE WISE INNOVATION. 10 November 2026.

## Delivered scope

Implemented a responsive provider/client interface over the existing Stage 1C commands, plus two authorized provider read projections and server Auth login/logout. The local demo provisions a fictional provider and organization; agreements are created, frozen and signed only through the real application/database commands. There are no fabricated dashboard records, mock signatures, automatic approvals or production signing bypasses. No remote or production resource was modified.

**This is a local demonstration, not a production release for real contracts.** Full browser interaction and viewport QA could not be completed because the available browser automation services failed (details below). HTTP/server rendering and backend flows have separate real validation; they must not be described as a successful browser end-to-end test.

## Working screen implementation

- `/login`: labeled email/password form, safe errors/loading, actual Supabase cookie-based login. Registration/password recovery are clearly unavailable.
- `/app`: live-verified protected layout, real authorized organizations/agreements, loaded agreement counts, empty/error/loading states, status labels and new-agreement entry. The read projection caps loaded agreements at 200; counts represent loaded records rather than organization-wide analytics.
- `/app/agreements/new`: eligible organization selection, exact XAF string amount, scope/terms, en/fr controlling language, date-only or explicit UTC/IANA deadline, optional exact-summing milestones. The API independently applies the existing Zod/SQL validators. No attachment interface is implied.
- `/app/agreements/[id]`: permitted draft fields, intended parties, optimistic revisions, explicit saved-data freeze confirmation, frozen version/digest, required signer status, authorized local invitation issuance and latest 100 committed activity events. Title remains fixed after creation because the approved update command does not permit changing it. Larger representative sets remain subject to the backend's existing reviewed-management restriction.
- `/invite`: generic entry until invitation verification, fragment cleanup before requests, memory-only invitation/proof values, access-code form, exact frozen version review, distinct fresh signing challenge, initially unchecked affirmative consent/typed name, real signature receipt, pending/all-signed status, explicit refresh and stored-session logout. Guests need no account; provider signers keep their live Auth/session requirement. No implicit consent occurs on navigation or OTP verification.

Contract rendering includes scope, exact money/exponent, deadline semantics, every milestone/acceptance term, frozen parties/required representatives, controlling language, exact disclosure/version, version identifiers/digest and inspectable canonical JSON. Text is rendered as escaped React content; no caller HTML or remote resource is executed. Review API recomputes canonical bytes/digest server-side as before. Contract whitespace is preserved. The UI uses the exact disclosure/digest from that authorized read for the signing command.

## Original visual system and accessibility implementation

Executive Indigo `#4F46E5`, dark accent `#312E81`, soft `#EEF2FF`, white cards and a quiet light workspace. Original simple lettermark, restrained borders, no legal stock imagery, third-party analytics, gradients or heavy shadows. Inter UI and Plus Jakarta Sans headings are self-hosted local font files with their SIL OFL licenses from the Google Fonts repository; no Google-font request is made by a browser or production build.

Layouts include desktop/two-column and narrow single-column breakpoints, fluid headings, wrapping hashes/long content, keyboard-operable native controls, explicit labels, visible focus, skip link, live errors/status, unchecked consent, disabled in-flight actions and reduced-motion support. These are implemented controls; actual mobile viewport/screen-reader/browser verification remains outstanding rather than inferred from CSS.

## Files and backend changes

New migrations:

- `supabase/migrations/20261110000800_provider_views.sql`: `provider_workspace` and `provider_agreement_view`, using the existing verified actor, organization/agreement RLS and operation preflight. Returns only scoped workspace, draft/frozen view, permission hints, signer receipts and allowlisted history fields.
- `supabase/migrations/20261110000900_provider_read_privileges.sql`: narrows executor SELECT on decisions to tenant/agreement IDs, slot, signing timestamp and version digest. The UI executor cannot read raw evidence bytes. No new tables, mutation workflow or browser database RPC is introduced.

New application files:

- `src/features/agreements/provider.ts`, `types.ts`
- `src/features/signing/invitation-entry.ts`
- `src/lib/ui/api.ts`, `src/lib/security/csp.ts`
- `src/app/api/provider/route.ts`, `src/app/api/provider/[agreementId]/route.ts`
- `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`
- `src/app/login/page.tsx`, `src/app/invite/page.tsx`
- `src/app/app/layout.tsx`, `page.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`
- `src/app/app/agreements/new/page.tsx`, `src/app/app/agreements/[agreementId]/page.tsx`
- `src/components/ui/primitives.tsx`, `src/components/auth-controls.tsx`, `src/components/contract-view.tsx`
- `src/components/provider/dashboard.tsx`, `draft-form.tsx`, `new-agreement.tsx`, `agreement-detail.tsx`
- `src/components/client/review-flow.tsx`
- `src/app/fonts/{Inter.ttf,PlusJakartaSans.ttf,Inter-OFL.txt,PlusJakartaSans-OFL.txt}`

New verification/demo/documentation files:

- `scripts/demo.mjs`, `scripts/provider-integration.mjs`
- `supabase/tests/database/provider_views.test.sql`
- `tests/ui-security.test.mjs`, `tests/invitation-entry.test.mjs`, `tests/contract-render.test.mjs`
- This report.

Modified:

- `src/app/layout.tsx`, `page.tsx`, `globals.css`: typography, shell, root redirect and responsive interface styles. Health remains at `/api/health`.
- `src/proxy.ts`, `src/lib/supabase/proxy.ts`, `next.config.ts`: per-response nonce CSP and forwarding, cookie/cache preservation, route ownership and privacy headers.
- `scripts/test-gateway.mjs`: retains existing checks and adds actual provider login/projection/server-rendering integration.
- `package.json`: demo setup/start/mail/stop commands only; no dependency/version changes.
- `.gitignore`, `eslint.config.mjs`, `tsconfig.json`: keep private `.demo` fixtures out of source control/lint/type scanning.
- `README.md`, `docs/architecture.md`, `docs/database-design.md`, `docs/security-model.md`: demo/API/read-boundary/verification scope updates.
- `AGENTS.md`: automatically generated by this Next.js version on `next dev`, read and retained. Its applicable local Next documentation was consulted. `next-env.d.ts` is generated by Next type generation/build, not handwritten.

The original seven migrations and existing security tests remain unchanged. The local `.demo` project, passwords, TLS keys and synthetic mailbox are private runtime fixtures, not deliverable source files.

## Security and API boundaries

Sensitive pages verify live registered identity independently of proxy claims refresh. Every API verifies identity/capability/permission on the server. Protected reads call only allowlisted functions through the restricted gateway; all mutations reuse Stage 1C draft/party/freeze/signing commands. No service-role runtime client or direct browser domain-table path is added. The existing gateway privilege/TLS/session checks and FORCE RLS remain intact.

`GET /api/provider` and `GET /api/provider/[id]` return private/no-store scoped projections. Inaccessible agreement IDs produce 404. They expose redacted signature receipts and event type/time/sequence, never credential hashes, proof secrets, audit internals or raw evidence bytes. Registered Auth login/logout are JSON POSTs subject to the existing strict Origin/body parser; login rejects unknown fields and uses Supabase Auth's actual password verification/confirmed-account policy. Logout revokes the local Auth session and clears its cookie; guest logout remains a distinct stored-capability command. Public auth/signup/recovery provisioning and production ingress abuse defenses remain incomplete.

UI scripts use fresh per-response nonces and `strict-dynamic`; production policy does not permit inline/eval scripts without the nonce. Development permits eval for Next debugging; inline styles remain allowed. External scripts/fonts/frames/objects are blocked. The proxy forwards the nonce/CSP to rendering while preserving refreshed cookies; no-store/no-referrer/frame-denial headers remain. Production integration checks the nonce in actual rendered Next scripts and verifies it changes between responses. This does not replace browser CSP enforcement/XSS review.

Invitation secrets use fragment links only. Entry removes fragment/query material synchronously before requests, accepts only same-origin invitation URLs or valid raw fragments and stores secrets only in component memory. No localStorage/sessionStorage, analytics, third-party scripts or token console logging is used. The private invitation is shown once to the verified local issuer; it can be hidden. Codes are never fetched/displayed by an unauthenticated mailbox API. The operator reads synthetic deliveries via the explicit local terminal command. Existing expiry, attempts, reissue, source revocation, registered-session binding, shared SQL counters, one-use proofs and unanimous transaction rules are unchanged.

Mutation UI retains idempotency keys for matching payloads within its mounted session, prevents duplicate clicks and does not automatically regenerate/retry ambiguous writes. Reloading loses those in-memory keys: inspect current status before deliberately creating/reissuing again. This is an acknowledged interface limitation, not a claim of crash-persistent client retries. Server receipts/slot uniqueness continue to prevent replay of the original key and duplicate signing effects.

## Local demo provisioning

`npm run demo:setup` creates/reuses only a recorded `accordly-demo-xxxxxxxx` project under private `.demo/project`, with ports 55620–55629. It has no remote URL/reset option. It applies pending local migrations, provisions verified PostgreSQL TLS and a restricted login, creates a fictional `provider@example.test` account/organization, and writes distinct server HMAC/rate keys and a private synthetic mailbox. The setup-only local Auth admin key stays in memory; the runtime has no service-role key. Nothing automatically creates or signs an agreement.

Windows ACLs are restricted to the current user/SYSTEM; POSIX uses private modes. `.demo/access.json` contains the fictional login. `.env.local` is untouched. `npm run demo` runs a loopback development server at exactly `http://localhost:3000`; database TLS remains verified. Secure/HttpOnly/host-only guest cookie flags are not weakened; local HTTP relies on the documented localhost cookie exception and still needs real-browser validation. Use a properly trusted local HTTPS origin if your browser requires it; never disable Secure or certificate verification. Production application HTTPS is independently required.

`npm run demo:mail -- CHALLENGE_UUID` reads only a private synthetic `example.test` delivery matching the screen's challenge. It is an explicit operator test mechanism, not server logging or proof of real external mailbox receipt. Global/recipient/attempt limits still apply. `demo:stop` stops only the recorded local services and retains data; setup can start/apply pending local migrations again. CLI development ports remain host-published, so use a trusted development machine/network and fictional data only. The generated local DB certificate expires after 30 days; no insecure certificate fallback is provided.

## Actual validation

- **23 application tests passed**, no skipped/failing tests, including all original 18.
- **181 SQL assertions passed**: original 169 plus 12 provider projection/privilege assertions. All nine migrations applied/replayed successfully with retained validated cluster roles. Actual concurrent gateway sessions preserved the last owner, deduplicated creates, rejected stale update/freeze races and enforced the shared send limit.
- **120 real local HTTP/backend integration assertions passed**, including the original 101 and 19 provider/UI Auth/projection/server-rendering/privacy checks. Production Next build and restricted PostgreSQL TLS/live Auth were part of this runner; synthetic deliveries remain distinguished from external mail.
- **Production build passed** both standalone and inside the final integration runner, including TypeScript validation. Final lint passed with zero warnings; an initial React JSX-in-try/catch lint finding was fixed and rerun successfully.
- Standalone `npm run typecheck` passed after the final build. The retained demo also passed actual login → authorized workspace → dashboard HTML → logout smoke checks at `http://localhost:3000`; no agreement was inserted by provisioning/smoke.
- Fresh full audit exited 1 with **8 moderate development findings**, zero high/critical. Production-only audit exited 0 with **zero findings**. Dependencies were not added, overridden or downgraded to suppress these findings.

The real integration uses disposable local GoTrue, restricted PostgreSQL with certificate/hostname-verified TLS, a production Next server and a synthetic local mailbox. It tests the existing signing flow plus actual UI Auth cookies, protected page redirects, tenant-scoped projections, private headers, nonce-bearing rendered scripts, real dashboard/detail HTML, generic unverified invitation HTML, and logout. These are HTTP/server-rendering checks, **not browser DOM interaction or visual QA**. Unit rendering checks escaped hostile contract text, Unicode, exact XAF formatting, disclosure/parties/deadline output. URL helper tests verify same-origin parsing and immediate history cleanup. These are unit tests, not an impersonated browser test.

Browser automation was attempted through the available computer-use facilities. The in-app browser timed out/reset and reported a Statsig initialization failure; a dedicated Chrome session reported `Browser is not available: chrome`. Native Chrome was found/launched, but the helper repeatedly reported a minimized window/user-input state that it could not restore despite refresh/recovery. No security interstitial was bypassed, no production site was used and no browser end-to-end or mobile screenshot success is claimed. Manual localhost browser acceptance, guest cookie behavior, keyboard/screen-reader and mobile viewport QA remain required.

Test containers/stacks are disposable and isolated from the retained demo project and unrelated local resources. No remote database was used. The demonstration server/owned stack may remain running for the user; test stacks are removed by their runners.

## Remaining online deployment blockers and next step

- Production signing remains fail-closed. External mail delivery, encrypted delivery outbox/worker and reconciliation are absent; synthetic delivery cannot be used for real users.
- Provider-independent active-history access recovery after capability expiry is unimplemented. Registration/password recovery/organization onboarding are infrastructure-assisted rather than complete product flows.
- Trusted-ingress/distributed abuse policy, edge limits, auth ingress hardening, denial telemetry, counter/mailbox cleanup, key rotation/hosted pooler validation, production HTTPS and browser acceptance remain unresolved deployment work. The existing shared SQL counters are retained, not disabled for demos.
- Retention/holds/deletion, backup/restore, incident response, independently controlled audit checkpoints and jurisdiction/legal review remain gates. No claim of legal certification, enforceability or trusted timestamps is made.
- Amendments, rejection/withdrawal/replacement, materialized proposal expiry, Storage/artifacts/PDF exports and representative replacement remain outside this interface. Historical evidence/terms cannot be edited through the screens.
- No current real-browser usability, mobile viewport or assistive-technology certification. CSS/labels/focus are implemented but need real browser QA. Current list/history caps are 200/100 with no pagination, and no global analytics are inferred from loaded counts.
- Existing moderate development dependency advisories remain open; no new dependency or force override was introduced.

Recommended next stage: **Stage 1E — browser acceptance and online verification/recovery readiness**. First run the documented fictional provider/client flow in real desktop/mobile browsers, verify Secure-cookie/CSP/fragment/keyboard behavior and fix any observed UI issues. Then implement production delivery/abuse controls and independent client access recovery, plus operational retention/incident gates. Keep real-contract signing disabled until those gates and legal review are satisfied; defer billing, AI, payments, marketing and broad dashboards.
