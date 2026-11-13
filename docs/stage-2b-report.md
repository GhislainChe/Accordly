# Stage 2B — account registration and guided onboarding

Accordly, independently developed by BE WISE INNOVATION. 12 November 2026.

## Outcome

Implemented registration, native Supabase email-code verification, password recovery and a short three-step onboarding flow for individual professionals and businesses. Workspaces use the existing organization/membership model. Preferences never grant access, guests still sign without registration, and matching a registered email to a guest's address reveals no agreement history. Existing signing/amendment production restrictions remain intact.

The temporary responsive interface uses the existing Executive Indigo system. New screens are `/register`, `/verify`, `/recover`, `/reset-password`, `/onboarding` and `/workspace-unavailable`. Login sends an incomplete account to its saved onboarding step, a completed member to its last authorized workspace, and a completed account without access to a safe unavailable page. A small workspace selector supports actual multiple memberships without a new management dashboard.

## Files and migrations

New database files:

- `supabase/migrations/20261112001500_account_onboarding.sql`: four private tables, self/bucket-scoped FORCE RLS, permanent idempotency receipts, verified-assertion account commands, atomic initial tenant/owner bootstrap, existing-member adoption and shared Auth request counters.
- `supabase/migrations/20261112001600_recovery_grant_clock.sql`: fixes the recovery issuance clock race using one captured timestamp for issue/expiry. It does not widen the ten-minute lifetime, change existing grants or edit prior migrations.
- `supabase/templates/confirmation.html`, `supabase/templates/recovery.html`: native Auth code-only templates; no bearer callback links.
- `supabase/tests/database/onboarding.test.sql`.

New application/test files:

- `src/features/accounts/{schemas,types,config,onboarding,auth}.ts`.
- `src/features/amendments/presentation.ts`.
- `src/components/account-forms.tsx`, `src/components/account-shell.tsx`.
- The six page files under the screen paths above.
- `src/app/api/auth/account/route.ts`, `src/app/api/account/route.ts`.
- `tests/accounts.test.mjs`, `scripts/account-integration.mjs`.
- This report.

Updated files:

- `src/app/api/auth/login/route.ts`, `src/components/auth-controls.tsx`, `src/app/app/layout.tsx`: login routing, links, verified onboarding gate.
- `src/features/agreements/{provider,types}.ts`, `src/components/provider/{dashboard,new-agreement}.tsx`, `src/app/app/agreements/new/page.tsx`: selected authorized workspace and default creation context.
- `src/components/amendments-panel.tsx`, `src/components/ui/primitives.tsx`: current versus historical effective presentation; historical versions do not offer invalid current-access issuance controls.
- `src/proxy.ts`, `src/lib/ui/api.ts`, `src/app/globals.css`: nonce CSP/private headers for new pages, clear account errors and bounded responsive form width.
- `supabase/config.toml`, `.env.example`: local native Auth password/confirmation/rate/OTP settings and code templates; server-only account rate key placeholder and disabled-by-default account mode.
- `scripts/demo.mjs`: template/config synchronization, private Auth rate-key provisioning, retained-data owned-stack Auth reload, durable local DB TLS paths and strong new fixture passwords. Existing saved credentials are preserved.
- `scripts/test-gateway.mjs`, `scripts/test-database.mjs`: native account integration, approved fixture passwords/templates, explicit verified-member onboarding fixtures and concurrent initial completion test.
- `README.md`, `docs/architecture.md`, `docs/database-design.md`, `docs/security-model.md`.

No dependency was added or force-overridden. The first 14 migrations are unchanged. Private `.demo` state, Auth rate keys, TLS files, baseline snapshots and ignored validation logs are local artifacts, not source secrets.

## Identity, authorization and state decisions

Registration accepts only bounded full name, email and password. Supabase Auth stores/hashes the password and enforces confirmation and native password policy. The server requires at least 12 characters, ASCII uppercase/lowercase/digit/symbol and at most 72 UTF-8 bytes. Account identifiers, session payloads and Auth identity arrays are not returned by signup/resend/recovery requests. Eligible, duplicate, unknown and delivery-error requests share an acknowledgement. A response floor/jitter reduces obvious differences but does not claim constant network timing. Verification errors are generic and attempt accounting is persistent.

The native email template uses `.Token`; verification posts an email/code and an exact native purpose. `signup` is deliberately used rather than generic `email`: GoTrue's generic verification can also accept a recovery token. The regression suite checks that recovery codes cannot be used on the signup verification path. [Supabase verifyOtp reference](https://supabase.com/docs/reference/javascript/auth-verifyotp) and [Auth verification implementation](https://github.com/supabase/auth/blob/master/internal/api/verify.go) informed this supported API choice; the implementation and local tests are original.

No organization is created by registration, verification or preference saving. After live confirmed `getUser()` validation, the existing trusted gateway asserts the account's Auth UUID to a private command. Principal resolution uses the existing active-principal/Auth-FK boundary. SQL tests simulate that trusted assertion; they do not independently establish email confirmation or live Auth validity. No new runtime SELECT grant on managed Auth tables, public domain RPC, role-management API or service-role runtime client was introduced.

`account_onboarding` is self-scoped and keyed by stable principal. It stores full name, individual/business work kind, create/review/both purpose, revision, completion and initial/last workspace references. These fields are preferences; no permission check reads purpose as a grant. `account_receipts` reserves actor/operation/key and canonical request digest, with bounded committed outcomes and append-only protection. Keys are never recycled. The completed row also records a canonical intent digest, preventing duplicates when refresh creates a new key.

The completion command serializes by principal, checks saved preferences/revision, then calls the existing bootstrap to insert the tenant and its initial owner. Completion, organization event, membership and receipt commit together. Only the verified principal can become the new tenant's owner; no owner/role field is accepted. `use_existing` checks actual membership and preserves its role. A viewer never becomes owner by adopting a workspace. Migration adoption preserves pre-existing memberships and marks those accounts completed, using a neutral display fallback where a full name did not previously exist. No email matching or guest authority participates in adoption.

After login, last-workspace selection is reauthorized. Revoked selection falls back to another real membership; if none remains, completion is preserved and `/workspace-unavailable` is shown. No automatic replacement tenant is created. Suspended organization membership still permits the existing authorized historical-read model; writes continue to require active organization status.

Recovery uses native `recovery` verification, a separate Secure HttpOnly Auth-cookie namespace, and a random one-use proof whose digest, verified Auth session ID, principal and ten-minute lifetime are stored privately. A normal application cookie alone cannot use the application reset endpoint. Supabase recovery JWTs retain normal Auth semantics: namespace separation is a browser-session compartment, not a cryptographically restricted JWT. Public native Auth password-update policy remains Supabase's responsibility.

The proof is consumed in PostgreSQL before calling the external Auth password update. Native Auth and domain PostgreSQL cannot share a transaction. If the Auth write or response fails, the consumed grant cannot be replayed; check the intended password or request fresh recovery. Successful reset requests global refresh-session sign-out. Existing access JWTs and already-running operations still have the documented revocation race; no immediate universal access-token invalidation is claimed.

`account_rate_buckets` contains operation/scope/HMAC-target counters, not emails, passwords or OTPs. A separate key avoids correlating native account and guest-signing targets. Counts commit before native Auth attempts. Local per-target request budgets are three/hour for signup/resend/recovery, ten/hour for verification and five/hour for reset; resets derive the target from the verified recovery account. Conservative shared ingress/global limits also apply. Native Auth separately enforces password, email-send, OTP and verification limits for direct public SDK calls. Production needs trusted ingress, CAPTCHA and operational abuse handling; app counters alone do not protect the public Auth endpoint.

## Guest signing and future account claiming

Guests remain independent of onboarding. Registering with a guest's exact email is tested not to reveal its prior agreement. Create/review/both selections confer neither client authority nor signed-history access. Existing verified capability, representative, digest, proof, unanimous activation and amendment rules remain unchanged.

A future claiming flow must require a fresh verified account session and a fresh verified agreement-scoped guest capability, explicit linking intent and a narrowly scoped audited delegation/link. It must preserve the guest principal's old signatures, frozen parties and historical attribution. Email equality may be an additional check, never the authorization proof; no bulk email search, principal merge or silent frozen-signer reassignment is implemented.

## Agreement history correction

The underlying `effective` proposal state means a version was validly executed; multiple historical versions can retain it. The root `effective_version_id` identifies current terms. The UI now labels that one **Current effective** and predecessors **Previously effective · superseded**. Never-effective competing proposals keep their separate Superseded state. Historical current-access invitation controls are hidden. This is presentation only: no original version, amendment, decision or proposal state is rewritten.

## Actual validation

Final checks used the supported recorded Node 24 runtime; system Node was not changed:

- **34 application tests passed**, including password/input policy, authority/redirect injection rejection, account enablement gates and current-versus-historical version presentation.
- **275 SQL assertions passed across 16 migrations**, preserving the existing 224 assertions. Restricted-role concurrency checks also passed: one initial workspace from conflicting completions, one amendment winner, immutable initial-owner safeguards, preparation retry serialization and shared abuse counters. Schema replay with retained validated roles passed; the runner removed its disposable container and volumes.
- **247 live gateway integration assertions passed**, including the original signing/amendment regressions and the new native registration, exact-purpose verification, recovery, onboarding and workspace scenarios below. The task-owned Supabase stack was stopped and removed by the runner.
- `npm run lint` passed with **zero warnings**, `npm run typecheck` passed, and standalone `npm run build` passed. The integration runner also completed a production build and TypeScript validation.
- The retained demo has **16 local migrations**. Its pre/post preservation snapshot matched every existing frozen-version digest, signature-evidence digest, agreement effective pointer/revision and membership. Existing saved credentials passed **7 login/dashboard/logout HTTP assertions**. `/api/health` and all four registration/verification/recovery/reset screens returned HTTP 200; account screens were enabled locally and had nonce CSP. No retained user was registered or password changed by this stage's tests; native account creation/recovery tests used the disposable stack only.
- Fresh full dependency audit exited **1 with 8 moderate findings**, zero high/critical. Production-only audit exited **0 with zero findings**. The development-tooling advisories remain unresolved; no force fix, major override or dependency change was introduced.

Test scopes are distinguished below.

- SQL tests use actual restricted gateway/executor/API roles, grants/RLS, constraints and transactions with simulated trusted identity assertions. The new suite covers self isolation, forged ownership fields, missing identity, required steps, persistence, duplicate/conflicting keys, one initial owner, individual/business tenants, existing-workspace denial, receipt immutability, completed-state protection, recovery actor/secret/replay checks and shared rate limits. A deferred membership failure verifies complete rollback. A 100-issuance clock stress test reproduces the former lifetime constraint failure and passes with migration 016. Additional real concurrent gateway sessions select one initial workspace from conflicting completions.
- Real integration uses a disposable local Supabase stack, native GoTrue signup and verification, code delivery through local Mailpit, production Next handlers, actual HTTP cookies and certificate/hostname-verified PostgreSQL TLS. No admin confirmation, generated-link shortcut or mocked OTP is used for the new registration/recovery flow. The publishable key also tests native weak-password rejection. The original signing/amendment suites remain enabled.
- The live account scenario covers duplicate acknowledgement, no unverified account/workspace access, OTP failure/replay and purpose separation, resume after interruption, same/different-key completion retries, concurrent completion, correct initial ownership, same-email guest history denial, returning login, recovery isolation, missing/duplicate recovery proof, actual password change and old-password rejection, authorized multi-workspace selection, membership revocation/fallback and no-workspace handling, business setup, cross-tenant denial and nonce-bearing private account HTML.
- The retained demo is separate from disposable tests. Its owned Auth configuration reload retained the DB volume and moved its TLS files into that volume before stop/start. No reset or remote migration was performed. Pre/post snapshots compare every existing frozen digest, signature evidence digest, root pointer/revision and membership. Existing credentials, login/dashboard/logout and new account page HTTP checks are reported separately from native disposable registration tests.
- Browser acceptance was attempted using the computer-use skill. Inventory reported a Statsig initialization failure; opening `/register` in the in-app browser timed out and reset its kernel. No registration, recovery, mobile viewport or keyboard/screen-reader browser success is claimed. HTTP/server-rendering, unit and SQL results do not substitute for browser interaction.

An intermittent 422 during recovery verification led to the concrete `account_recovery_grants_check` failure. Separate volatile clock reads for default issue time and explicit expiry could differ across the ten-minute constraint boundary. Migration 016 captures one timestamp; the bound was not widened. The stress test and full integration were rerun. An early attempt to query native Auth metadata from the SQL-only fixture was removed; the final implementation retains the approved live-Auth/trusted-gateway boundary and does not grant extra managed Auth-table access.

## Manual local demonstration

Use Node 22.18+ (recorded Node 24 supported), Docker, OpenSSL and npm. Run `npm run demo:setup`, then `npm run demo` after stopping an old development server. Setup updates only the recorded owned local project, preserves data/credentials, copies code-only templates and applies pending local migrations. An Auth configuration change restarts only that stack with its volume retained. Existing `.demo/access.json` credentials remain private and unchanged.

1. Open `http://localhost:3000/register`. Use a fictional full name and a new `example.test` address, for example `onboarding-demo@example.test`. Choose your own strong test password meeting the displayed rules; do not reuse a real password. Submit Step 1. The acknowledgement does not reveal whether an identity already existed or promise delivery.
2. Open the **local Auth Mailpit inbox** at `http://127.0.0.1:55624`. Find only that recipient's **Confirm your Accordly account** message and enter its six-digit code on the verification form. This is native Supabase Auth email delivery. It is different from the guest signing filesystem mailbox/`demo:mail` command. Do not forward codes or expose this developer inbox.
3. After verification, choose individual/freelancer or business/organization and create/review/both. No profession, phone, address, ID or incorporation document is requested. Continue; refresh to confirm Step 3 resumes. No workspace exists yet.
4. Enter a professional display name for an individual, or a business/organization name for a business. Create the workspace. You become the initial owner of that new tenant. Refresh/retry safely; it cannot duplicate the initial workspace. A user already explicitly assigned membership can choose that authorized existing workspace while retaining its actual role.
5. Sign out and sign back in. Confirm the selected authorized workspace resumes. For an interrupted signup, `/verify` accepts its still-valid code without resending. For interrupted recovery, use **I already have a recovery code** on `/recover`. Shared limits remain enforced; wait for the native one-minute send cooldown/hourly windows rather than resetting data or counters.
6. Use `/recover` with the same fictional email. Read the **Recover your Accordly account** code from the same local inbox, verify, and enter a different strong test password on `/reset-password`. Sign in with the new password. Unknown addresses receive the same acknowledgement. Code consumption and fresh recovery remain required after expiration or uncertain reset outcome.
7. Review an agreement with an effective amendment. Its newest effective pointer should have one Current effective label; older executed versions should say Previously effective · superseded, with their original terms and signatures intact. Guest `/invite` continues to work without registration; registering with the client's email must not reveal its history automatically.

No real account, email delivery or contract should be tested on this local-only stack. These instructions are a manual acceptance checklist, not a claim that browser execution was performed by the agent.

## Remaining deployment blockers and next stage

Account registration/recovery are implemented only in loopback local-test mode and disabled externally. Production SMTP delivery/reconciliation, native Auth CAPTCHA/rate configuration, trusted ingress, denial telemetry, key rotation, account recovery/incident procedures and browser acceptance are release gates. The application mode does not itself disable a separately hosted public Auth project: configure its public signup/recovery protections independently. Mailpit is not external delivery and no CAPTCHA/mock bypass is provided.

Guest signing's production delivery, independent history-access recovery, retention/legal holds, backup/restore, incident handling and independent audit checkpoint gates remain. Recovery grants, counters and permanent receipt retention/cleanup need an operational policy. Email control is not legal identity or company-authority verification; no legal certification/enforceability claim is made.

Profile/preference editing after completion, additional workspace creation UI, organization invitation administration, account claiming, MFA, recovery-session cryptographic restriction and native access-token revocation hardening are outside this stage. Multiple existing memberships are supported without an elaborate management interface. No billing, payments, AI or premium redesign is included.

Recommended **Stage 2C — browser acceptance and production Auth readiness**: execute registration/resume/recovery and historical-label acceptance in desktop/mobile browsers, then implement and validate production delivery, CAPTCHA/trusted-ingress abuse controls, recovery/incident/retention operations and backup/restore. Keep external signing and real contracts disabled until their existing separate gates also pass.
