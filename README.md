# Accordly

Accordly is an independently developed SaaS product by **BE WISE INNOVATION** for secure client agreements and project engagements. Providers and clients will agree on scope, price, deadlines, and milestones, sign an immutable version, and approve amendments without overwriting earlier records.

## Current scope

Stage 1D adds the first provider/client interface to the reviewed backend: login, authorized agreements dashboard, draft/party preparation, freezing/invitations, exact-version guest review, separate mailbox verification and explicit signing, activation and committed activity. Stage 2A adds provider/guest amendment requests, negotiation, immutable revised terms, verified approvals and effective-version history. Stage 2B adds native account verification/recovery and guided onboarding. Sixteen migrations create 30 private tables with scoped RLS, immutable versions/evidence, receipts, audit and outbox. **Production signing is disabled.** External delivery, independent guest-history recovery, retention/incident controls and Storage remain incomplete. Product code/design are original; published packages and openly licensed fonts are dependencies.

Stage 1B defines the baseline in [architecture](docs/architecture.md), [database design](docs/database-design.md), and [security model](docs/security-model.md). The [Stage 1B report](docs/stage-1b-report.md) records the review. The [Stage 1C.1 report](docs/stage-1c1-report.md) maps implemented controls, actual database tests, limitations, and the next stage.

The [Stage 1C.2 report](docs/stage-1c2-report.md) documents the implemented commands, exact input protocol, real integration results, configuration and remaining launch gates.

The [Stage 1C.3 report](docs/stage-1c3-report.md) documents initial signing, actual test results and production blockers. `POST /api/agreements/signing` supports authorized slot listing/invitations, mailbox challenges, scoped Secure HttpOnly guest sessions, exact-version reads, separate fresh consent proofs, explicit signatures and unanimous activation. Invitation access alone grants no agreement content or signing right. Mailbox control is not legal-identity verification or signature certification.

The [Stage 1D report](docs/stage-1d-report.md) records the screens, read-only backend additions, validation and browser-testing limitations. `/api/health` remains the liveness endpoint; `/` now opens the protected application/login flow.

## Full fictional local demonstration

Use Node 22.18+ (tested with the installed Node 24 runtime), npm, running Docker and OpenSSL. Windows Git's bundled OpenSSL is detected; otherwise set `ACCORDLY_TEST_OPENSSL` to its executable. The setup uses pinned Supabase CLI 3.1.0 and ports **55620–55629**, separate from integration tests and unrelated local projects. Port 3000 must be free. It never accepts a remote database URL, resets a database, or inserts/signs an agreement automatically.

```powershell
npm ci
npm run demo:setup
npm run demo
```

Open **http://localhost:3000** (use this exact origin). Setup creates a fictional `provider@example.test` account and an individual provider organization. Read the generated password in private `.demo/access.json`; do not publish/commit the `.demo` directory. It contains local-only gateway credentials, TLS files and synthetic mailbox messages. Windows setup restricts its ACL to the current user/SYSTEM; POSIX uses private directory/file modes. `.env.local` is not modified. Setup is repeatable for its own recorded project, applies pending **local** migrations and preserves demo data. Supabase containers use CLI-published development ports; keep them on a trusted local machine/network and never put real contracts in this stack.

Demonstrate the complete path with fictional details:

1. Sign in, choose **New agreement**, and enter title `Fictional studio website — local test`, scope `Demonstration only: three fictional website pages; no real services promised`, amount `250000` XAF, a date-only deadline such as `2027-02-28`, and terms `Test fixture only. No payment or legal obligation. Not a real contract.` Select English or French as the controlling contract language. Milestones are optional; if added, they must allocate the full amount exactly.
2. Create the draft. Edit/save its terms to exercise an actual draft update. Save parties: provider `Atelier Demo Studio`, your signing name `Alex Demo`; client `Example Client Studio`, signer `Camille Example`, email **client@example.test**. Client designation records no identity verification or consent.
3. Review the saved data, tick the freeze confirmation and choose **Freeze agreement**. The immutable version is now awaiting signatures; it is not active.
4. Choose **Create my review invitation**, then **Open review screen** in the provider's signed-in browser. The fragment secret is cleared from history and stays in memory. Click **Send verification code**. The screen shows a challenge UUID, not its code. In a separate terminal, read that exact synthetic delivery:

```powershell
npm run demo:mail -- CHALLENGE_UUID_FROM_SCREEN
```

5. Enter the access code. Review the complete frozen agreement/digest. Choose **Send signing verification code**, read the **new** challenge using the same command and verify it. Verification still records no signature. Enter `Alex Demo`, explicitly check the initially unchecked consent and select **Sign this exact version**. Status remains pending with one of two signatures.
6. Back in the provider agreement screen, refresh status and create the client invitation. Open its private link in a **separate browser profile/private window**, with no provider login. Repeat access verification, exact-version review and the separate signing challenge using `client@example.test` deliveries. Enter `Camille Example`, explicitly consent and sign. Actual database unanimity activates the exact frozen version.
7. Refresh each review/provider screen. Both should show the active agreement and two signature receipts. The Activity tab lists committed preparation, verification and signing events. Close a review session to test stored-session revocation; a consumed/expired/revoked invitation cannot be reused.

No OTP-fetch endpoint, verification bypass, browser secret logging or mock signing is provided. Codes are read by the local demo operator only; this is not external mailbox delivery. Failed codes, expiry, source revocation and shared rate limits still apply. If you lose a pending invitation's secret, deliberately reload/reissue it; reissue revokes previous source sessions. **Active access recovery after capability expiry is not implemented.** Do not reissue links casually during an ongoing review.

Guest cookies keep Secure/HttpOnly/host-only protections. Local HTTP testing depends on the browser's localhost exception for Secure cookies ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie#secure)); use `localhost`, never a LAN address. Browser cookie/viewport interaction could not be verified by this session's browser tools. If your browser rejects the cookie, use a properly trusted local HTTPS setup and matching origin; do not disable Secure or bypass verification. Production requires verified HTTPS and remains blocked independently.

Stop the application with Ctrl+C. To stop only this demo's Supabase services while retaining local data:

```powershell
npm run demo:stop
```

Use `npm run demo:setup` before the next `npm run demo` if services were stopped. Database certificates last 30 days; expired local certificates must be regenerated deliberately using a new setup/certificate, never by disabling TLS validation. General account signup, password recovery and organization onboarding are not part of this first interface.

### Restarting the demo and diagnosing login

After setup, `npm run dev` now uses the saved owned demo configuration when no explicit application environment or `.env` file exists. `npm run demo` explicitly selects that demo. For an intentionally separate configured app, use `npm run dev:app` (or `ACCORDLY_DEV_MODE=app`); explicit environment configuration is never silently replaced by fixture settings. These development launchers do not affect production build/start configuration.

The SDK requires Node **22.18+**; the default Node 20 on this machine cannot initialize its native WebSocket transport. Successful setup records the compatible installed Node executable in private `.demo/state.json`. Demo/dev launchers probe and reuse it if the shell's Node is too old, without downloading Node or changing system PATH. On a new machine, first run setup under a compatible runtime, or explicitly provide its absolute path in `ACCORDLY_NODE_BINARY`. A missing/incompatible runtime produces a startup error rather than a working-looking login page with broken Auth.

The demo performs a non-mutating local Auth health/key preflight before starting Next. If its services are stopped, use `npm run demo:setup`; this reuses the recorded project/data and does not reset it. Do not start the separate `accordly-foundation` project as a substitute: the retained demo uses Auth port **55621**, and its existing account belongs there. Credentials remain in `.demo/access.json`; do not paste passwords or keys into logs/chat.

Login now distinguishes missing application origin/Auth configuration, unavailable Auth, rate limiting and invalid credentials using safe messages. Server diagnostics contain only an event/category/status, not the submitted address, password, cookies or SDK response. The retained demo can be checked without printing credentials:

```powershell
node scripts/test-local-login.mjs
```

That check exercises actual login cookies, authorized dashboard HTTP access and logout; it is not a browser interaction test. See [login repair report](docs/login-failure-fix-report.md) for the reproduced failures and validation.

The only implemented signing mode is `ACCORDLY_SIGNING_MODE=local-test`, with loopback application/Auth/database hosts, distinct server HMAC/rate keys and a private absolute `ACCORDLY_LOCAL_MAILBOX` directory. Only synthetic `example.test` recipients are delivered there. Tokens are stored as digests; development invitation secrets are returned once to a verified issuer and are never put in delivery files. OTP files must remain private and must not be served by Next.js. External deployments fail closed. See the report before configuring manual testing; real browser tests require HTTPS for Secure cookies. Production transport, trusted ingress limits and client access recovery must be implemented before external signing.

## Technology

- Next.js App Router, React, TypeScript in strict mode
- Tailwind CSS v4; shadcn/ui configuration and class utilities, with no product components generated yet
- Supabase PostgreSQL, Auth, and private Storage as the planned backend; `@supabase/ssr` provides cookie-based clients
- Zod runtime validation, ESLint, npm with exact direct versions and a committed lockfile

## Local setup

Use **Node.js 22.18+ or newer supported LTS** and npm 10+. The installed Supabase SDK requires Node 22+; the validation tests use native TypeScript stripping. Then:

```powershell
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open [localhost:3000](http://localhost:3000). The public login page renders without credentials; protected operations fail closed until configuration is valid. `GET /api/health` indicates application liveness only, not Supabase readiness. For the complete fictional workflow use the dedicated demo commands above.

Before using auth helpers, set these public values in `.env.local` from your own Supabase project:

- `NEXT_PUBLIC_SUPABASE_URL`: project HTTPS URL (HTTP is accepted for local Supabase).
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: `sb_publishable_...` project key. Legacy JWT anon keys are deliberately not accepted, preventing accidental use of a legacy service-role JWT in this field.

No real secrets are supplied. The clients validate configuration lazily, so installing and building do not require a Supabase project. Missing/invalid values fail when an auth client is requested. Restart development after environment changes; public values are embedded at build time in production.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

`typecheck` generates Next route types before running TypeScript and works before the first build. ESLint is run explicitly, since `next build` is not the lint command. `npm test` checks configuration, identity policy, canonicalization, typed inputs, HTTP boundaries and simulated cookie refresh. Database commands are checked separately by `npm run test:db`.

For agreement operations, provision the restricted `accordly_gateway` database login externally and set server-only `ACCORDLY_DATABASE_URL`, optional `ACCORDLY_DATABASE_CA_PEM`, and exact `ACCORDLY_APP_ORIGIN`. The runtime enforces verified PostgreSQL TLS, restricted role attributes/memberships, live Supabase `getUser()` verification and confirmed registered email. No database password or service-role key belongs in public configuration. See `.env.example` and the Stage 1C.2 report. Missing/invalid configuration fails closed; it does not prevent the public health page/build.

`POST /api/agreements/commands` supports typed draft creation/update, initial parties, scoped grants and freezing; `GET /api/agreements/[agreementId]` returns authorized details. Mutation requests require exact Origin, JSON, an idempotency UUID and applicable expected revision. Freezing prepares one immutable pending proposal; it records no consent or signature. Client email contact entry does not verify identity or grant client access.

## Disposable database verification

With Docker running, pull the pinned Supabase PostgreSQL test image once, then run the database suite:

```powershell
docker pull public.ecr.aws/supabase/postgres:17.11.0.003@sha256:7374d196da7e301512cc5329e18040e0f7bb856287b323777cdadecccbc6c7e4
npm run test:db
```

The runner creates its own container with no exposed ports, no external network, and no persistent database volume. It applies migrations, exercises real PostgreSQL roles and pgTAP assertions, replays the private schemas with retained cluster roles, tests concurrent owner removal, and removes its own container/volumes. It accepts no remote URL or existing-container target. Local trust authentication is confined to that isolated test container; it is not a production authentication policy.

The project also includes Supabase CLI configuration using project ID `accordly-foundation` and ports 55420–55429. `npx --yes --package=supabase@3.1.0 supabase start` creates that separate local stack and applies migrations. Review the [report](docs/stage-1c1-report.md) before managing local data. Do not use linked/remote reset or push commands without explicit authorization. CLI output contains local keys: do not copy it into logs or chat. The private `accordly`/`accordly_commands` schemas are intentionally absent from API exposure/search paths.

`npm run test:integration` requires Docker, npm network/cache access for Supabase CLI 3.1.0, OpenSSL (or `ACCORDLY_TEST_OPENSSL`) and free ports 55520–55529. It creates a unique temporary local Supabase project, applies migrations, provisions disposable Auth/database/TLS fixtures, builds/starts the production Next server, and exercises actual cookie-authenticated HTTP commands. It removes only its own project and fixtures. It accepts no remote target. Build artifacts are regenerated with local test public configuration; rebuild with deployment configuration before deployment. Never publish local CLI credential output.

Development and production builds explicitly use Next.js's supported Webpack mode. Turbopack's PostCSS worker failed to start on this Windows environment, including outside the sandbox; revisit Turbopack after validating the host/runtime combination. See `docs/stage-1a-report.md` for validation results and dependency maintenance notes.

## Structure

- `src/app/`: App Router layout, health page, global styles, health API and agreement Route Handlers.
- `src/components/ui/`: reserved for shadcn/ui components; `components.json` configures generation.
- `src/lib/env/public.ts`: safe, explicit public configuration validation.
- `src/lib/supabase/`: browser client, per-request server client, cookie refresh adapter.
- `src/lib/auth/require-user.ts`: server-only verified identity guard, not a resource permission check.
- `src/lib/auth/verified-identity.ts`: live registered/confirmed identity resolver for agreement commands.
- `src/lib/db/`: server-only restricted PostgreSQL configuration/pooling/transaction gateway.
- `src/lib/security/`: HTTP input/origin boundaries and sanitized errors.
- `src/features/agreements/`: typed schemas, canonicalization and authorized services.
- `src/proxy.ts`: refreshes sessions outside health and independently verified agreement handlers.
- `docs/architecture.md`: proposed domain, state transitions, authorization, and integrity design.
- `supabase/migrations/`: ordered database foundation, integrity and authorization migrations.
- `supabase/tests/database/`: SQL pgTAP security/integrity assertions.
- `scripts/test-database.mjs`: isolated Docker-based migration/security/concurrency runner.
- `scripts/test-gateway.mjs`: disposable full Supabase/Auth/TLS/production Next integration runner.

## Fictional amendment demonstration (Stage 2A)

The existing `Logo and Brand Identity Design` agreement can remain at its signed Version 1 total of **75,000 XAF** while a **25,000 XAF** addition is reviewed. Do not edit/reset its original version. Restart the demo after applying pending local migrations with `npm run demo:setup`, then `npm run demo`. Setup preserves existing data and credentials. Stop an already running development process before restarting; do not reset Supabase.

1. Open the active agreement. In **Amendments & signed history**, choose **Request an amendment**. Enter change `Five branded social media templates`, a fictional reason, price difference `25000`, append the deliverables to scope, and set the proposed full total to `100000`. Keep the controlling language/currency. Specify any revised deadline. Milestones, if used, must allocate the full 100,000 XAF. Save, review all saved fields, then **Freeze saved amendment for review**. Submission is not consent.
2. Review the frozen candidate, original-versus-proposed full terms, reason, price difference, digests and required slots. Create each designated signer's private amendment invitation. Keep the provider in its authenticated profile and open the client link in a separate profile. Fragment secrets are shown once: never post them or use another signer's session.
3. Each party verifies access through its own synthetic mailbox challenge, reviews that exact amendment version, requests a **separate** signing verification code, types its name and explicitly selects the initially unchecked consent checkbox. Read each code only from the private operator mailbox: `npm run demo:mail -- CHALLENGE_UUID`. The final explicit signature advances effective terms to **100,000 XAF** atomically. Refresh both views; historical Version 1 still shows 75,000 XAF with its original digest and decisions.
4. A still-valid verified client session can request amendments and review pending proposals without registration. After capability expiry, a fresh **access invitation** and mailbox verification are required. The provider can create that invitation by reviewing the current effective version's designated slots. Independent client recovery remains a deployment blocker.
5. To negotiate a separate proposal, enter a reason and confirm **Request revisions**. This closes the candidate. **Prepare a replacement against current effective terms**, edit/save/freeze a new version, then collect fresh approvals. Formal **rejection** needs its own fresh verification code and explicit confirmation. Only the author may withdraw. Closed versions and prior approvals remain historical and cannot activate. Use a separate proposal for negative demonstrations; activated amendments cannot be withdrawn.
6. Multiple proposals may share a base. The first unanimous amendment wins; competitors become superseded. Future changes start from the new effective version. Negative/zero price differences are allowed if the final total stays positive. Shared hourly verification limits stay enabled; wait for the next window rather than resetting counters/data.

These are synthetic local test actions, not real contracts or certified signatures. The automated integration demonstrates the 75,000 → 100,000 XAF backend workflow in a disposable local stack; browser amendment interaction is a separate acceptance check. See [Stage 2A report](docs/stage-2a-report.md) for validation, changed files and deployment blockers.

## Registration and guided onboarding (Stage 2B)

Run `npm run demo:setup`, then restart the old development server with `npm run demo`. Setup applies only pending migrations to its recorded owned project. When Auth settings change, it restarts only that local stack with its DB volume retained; signed records and existing credentials are preserved. No reset is needed. A separate Auth rate key is generated only in private `.demo` state.

1. Open **http://localhost:3000/register**. Enter a fictional full name, a new `example.test` email and your own strong test password: at least 12 characters, uppercase/lowercase/digit/ASCII symbol and at most 72 UTF-8 bytes. Do not reuse a real password.
2. Read that recipient's **Confirm your Accordly account** code in the local **Auth Mailpit inbox at http://127.0.0.1:55624**, then submit it on the verification screen. This is Supabase's native Auth code, not the separate guest-signing filesystem mailbox. `/verify` lets an interrupted signup enter its existing code without sending another email. No workspace exists at this point.
3. Step 2 asks individual/freelancer or business/organization, and create/review/both. These preferences grant no agreement access. Step 3 asks a professional display name or business name, then atomically creates the appropriate workspace and its initial owner. Refresh/retry cannot duplicate that initial workspace. No phone, address, ID or business documents are collected.
4. Sign out/in to test resume and the last authorized workspace. Explicitly assigned existing members can use their authorized workspace without receiving a new role. A small selector appears for multiple memberships; accounts losing all workspace access get a safe unavailable page rather than a new tenant.
5. Use **http://localhost:3000/recover** to request a native recovery code. Read only that recipient's **Recover your Accordly account** message, verify it, then choose a new password at `/reset-password`. Interrupted recovery can use **I already have a recovery code**. The one-use reset proof lasts at most ten minutes; uncertain/failed password updates require checking the intended password or fresh recovery. Verification codes expire in ten minutes and resend/native/shared limits stay enabled.

Registration, duplicate requests and unknown recovery addresses receive generic acknowledgements; they never disclose account existence. Email verification is mailbox control, not legal identity. Signing still works for guests without registration; a matching email or review/both preference never reveals guest history.

Account registration/recovery remain **local-test only** and disabled on external hosts until production delivery, CAPTCHA/native limits, trusted ingress and recovery controls are reviewed. This does not replace protection of a hosted public Supabase Auth endpoint. Existing production signing restrictions remain unchanged. See [Stage 2B report](docs/stage-2b-report.md) for actual automated results, browser limitations, changed files and next steps.

Historical agreement proposals retain their immutable execution state. The UI now labels only the root's current version **Current effective**; earlier executed terms show **Previously effective · superseded** without changing signed records.

## Security boundaries

Browser clients use a publishable key, never a secret/service-role key. There is no privileged client. Server modules use `server-only` to prevent accidental browser imports. Do not put secrets in any `NEXT_PUBLIC_*` variable.

Proxy validates/refreshes cookies with `getClaims()` on ordinary non-health routes. Agreement handlers bypass that refresh layer and use their own request-scoped `getVerifiedIdentity()` with live `getUser()`, confirmed-email/account checks and database operation preflight/revalidation. `requireUser()` remains an identity-only helper for other future callers. Proxy alone does not restrict access. Future protected pages must be dynamic and must not cache user data.

Cookies are synchronized to the request and response during refresh. Responses passing through session refresh carry `Cache-Control: private, no-store`. Preserve cookies and cache headers if future code replaces that response. The browser SDK needs access to session cookies; this is not an HttpOnly backend-for-frontend design. Use HTTPS in production, strong XSS prevention, origin checks for mutation handlers, and allowlisted callback redirects when implementing authentication. Auth callbacks are not implemented in this stage.

The migrations implement deny-by-default RLS on all Accordly tables and restricted database functions; browser/API roles have no direct domain grants. The server gateway asserts identity only after live Auth verification and uses a dedicated restricted PostgreSQL credential, provisioned outside source control. Its credential is a trusted impersonation boundary. No ordinary service-role client is used. Initial and amendment signing are implemented for local synthetic testing only; production signing and private Storage remain disabled pending their respective gates.

Never log tokens, invite URLs, full agreement content, or signature evidence. Application logs do not replace an append-only domain audit history. Electronic signature evidence is recorded; **Accordly does not claim legally certified signatures**. Jurisdiction-specific compliance, consent, retention, and enforceability require separate evaluation.

## Next step

Stage 2C should complete registration/recovery and agreement desktop/mobile browser acceptance, production Auth delivery/abuse controls, independent guest-history recovery and operational retention/incident gates. Keep real-contract signing disabled until those gates pass. Stage 2A adds local amendment workflows; Storage, billing, marketing and dashboard breadth remain separate. Next complete browser amendment acceptance and production verification/recovery readiness. See the Stage 2A report for validation limits and next steps.

## Integration references

- [Supabase SSR clients](https://supabase.com/docs/guides/auth/server-side/creating-a-client)
- [Supabase session and cache boundaries](https://supabase.com/docs/guides/auth/server-side/advanced-guide)
- [Next.js installation](https://nextjs.org/docs/app/getting-started/installation)
- [shadcn/ui configuration](https://ui.shadcn.com/docs/components-json)
