# Local demo login failure investigation and repair

12 November 2026, Africa/Douala. Accordly by BE WISE INNOVATION.

## Evidence and root causes

At initial inspection no application process/listener existed on port 3000: both application health and login HTTP probes returned ECONNREFUSED. The retained demo's Supabase containers were running, its Auth health endpoint returned 200, and a direct password request using the existing private credentials returned 200 with the expected confirmed fixture user ID. The saved URL/key were valid for `http://127.0.0.1:55621`; access credentials matched the saved setup state. The separately running `accordly-foundation` stack was not the provider account's project and was not used as a replacement.

Two startup defects were confirmed:

1. The original `npm run dev` launched plain Next without loading `.demo/state.json`. Only `npm run demo` injected the saved configuration, and no `.env.local` existed. A controlled reproduction using the original dev command and the same existing credentials produced **HTTP 503 `{error: "origin_configuration_required"}`** before Auth was called. The UI had no message for that code and fell through to the exact generic agreement-oriented message reported by the user. Setting only Auth values would also leave the required Origin configuration missing.
2. The shell's default Node **20.20.1** could not initialize the installed Supabase server client: an isolated constructor test failed with a missing-native-WebSocket error even with valid saved configuration. The installed compatible Node 24 runtime initialized/ran the real flow successfully. Merely restoring Origin/keys would therefore leave an application exception when restarting under default Node 20.

The original browser's historical request could not be recovered: it was no longer served at initial inspection, and browser automation timed out/reset. The report does not assert a captured historical browser HAR or know the user's exact earlier startup command. The configuration failure and incompatible-runtime exception were independently reproduced, corrected and contrasted with successful HTTP tests. There was no evidence of a wrong password, deleted/unconfirmed demo user, stopped Auth stack or invalid saved local key.

## Changes

- `package.json`: `dev` uses the development launcher; `dev:app` explicitly selects app configuration; demo commands use a compatible-runtime launcher. No dependency/version change.
- `scripts/development-mode.mjs`, `scripts/dev.mjs`: select the saved demo only when no explicit application environment exists, retain explicit app mode/Next arguments, refuse unintended production use and never copy secrets into `.env` files. Demo Origin remains fixed to localhost:3000.
- `scripts/node-runtime.mjs`, `scripts/run-demo.mjs`: enforce Node >=22.18, probe/reuse the installed executable recorded by successful local setup (or an explicitly provided path), and fail clearly if unavailable. They do not download Node, install a WebSocket polyfill, change global PATH or disable SDK checks. The executable path comes from private, ownership-validated local setup metadata or explicit operator environment, not HTTP input.
- `scripts/demo-startup.mjs`, `scripts/demo.mjs`: fail-closed loopback Auth/key health preflight before Next starts; successful setup records its actual compatible executable. Existing local project/fixtures are reused. No remote URL, reset, drop or credential-disclosure path was added.
- `src/lib/security/errors.ts`, `src/lib/env/public.ts`: configuration failures retain typed safe HTTP codes, with a constant non-secret setup message; explicit `NEXT_PUBLIC_*` references remain compatible with Next's browser configuration compilation. Secret/legacy-key rejection remains intact.
- `src/lib/auth/login-policy.ts`, `src/app/api/auth/login/route.ts`: distinguish invalid credentials/account restrictions, throttling, Auth transport/server failures and unexpected application errors. Previously every returned SDK error became a misleading credential rejection. Safe diagnostic events include only category/status and never serialize original exceptions, input, email, password or tokens. Origin/body validation, confirmed-account checks, actual password verification and session cookie handling remain mandatory.
- `src/lib/ui/api.ts`: actionable Origin/Auth configuration, Auth service and Auth rate-limit messages rather than the generic agreement-write fallback for these cases.
- `tests/login-regression.test.mjs`: launcher selection/explicit-config priority, runtime requirements, preflight endpoint/key/availability boundaries, safe classification and diagnostic redaction.
- `scripts/test-local-login.mjs`: non-destructive retained-demo HTTP check using the existing private credentials; no password/token/key output. It checks bad-password denial, successful cookies, original organization, dashboard HTML, logout cookie deletion and logged-out redirect.
- `scripts/provider-integration.mjs`: actual invalid-password regression in the disposable full-stack integration.
- `README.md`, this report: corrected restart/troubleshooting guidance and validation scope.

Private `.demo/state.json` gained the compatible executable path during successful repeat setup; its account/password, organization, gateway/HMAC keys and data were reused. `.demo/access.json` still contains the same fictional credentials. These private runtime files are excluded from source control and are not source-code secrets.

## Remediation and actual validation

Repeat setup was run with the compatible installed runtime, only against the previously recorded owned local project. It reused its database and identities, applied no new schema changes, retained the password/organization and recorded its runtime. No remote environment or unrelated local stack was migrated, stopped or reset.

The corrected **ordinary `npm run dev` was then launched from the unchanged default Node 20 shell**. It selected the recorded compatible runtime, loaded the saved local demo configuration, passed its Auth preflight and started Next at localhost:3000. This tests the actual problematic restart entry point rather than relying solely on a manually injected test environment.

The retained local check using existing credentials has passed seven HTTP assertions: wrong password is 401/invalid_login, correct password is 200, cookies are issued, the original authorized organization is returned, `/app` returns dashboard HTML, logout clears the Auth cookie, and a logged-out request redirects to `/login`. The browser jar is modeled from actual Set-Cookie responses; no claim is made that an issued JWT is immediately revoked everywhere just because a cookie was removed. Live server output confirms 401 rejection, 200 login/provider/dashboard/logout and the 307 logged-out redirect, without credential logging.

Validation results:

- **27 application tests passed**, including all prior 23 and launcher/runtime/preflight/error-classification regressions. Private-state parse/credential mismatch errors withhold values rather than allowing assertion/JSON diagnostics to reveal them.
- **Seven retained-demo HTTP assertions passed** after launching from the default Node 20 shell through the corrected wrapper and recorded compatible runtime, using the existing credentials. They separately passed with an explicitly selected compatible runtime as well.
- **121 disposable local integration assertions passed**, including the full existing gateway/signing controls, production Next handlers, TLS PostgreSQL, live Auth and the added actual invalid-password regression.
- `npm run lint` passed with zero warnings; `npm run typecheck` passed. The actual production `npm run build` passed inside the integration runner, including Next route compilation and TypeScript validation. No production target was deployed.
- No schema/migration/database-policy changes were needed; the standalone SQL-only suite was not rerun for this authentication/launcher repair. The full local integration did apply the existing migrations to its own disposable stack and test the gateway boundaries.

Unit preflight/outage/error fixtures are simulated boundary tests; retained-demo and disposable GoTrue/Next/PostgreSQL integration are actual HTTP/service tests. They are not external production tests. Existing data, credentials and production-signing gates were preserved.

Browser inspection of the existing in-app login tab was attempted and timed out/reset. Browser form filling/clicks and manual redirect rendering remain unverified. Successful authentication/dashboard/logout is verified at API/server-rendered HTTP level, not described as browser automation success.

## Remaining limits

Production signing remains disabled and no auth/tenant/Origin/confirmed-email/TLS check was bypassed. The underlying Stage 1D production delivery, recovery, retention and abuse-control blockers remain. The system-wide Node remains 20.20.1; application-quality commands require a supported runtime, while the local demo/dev commands can reuse the recorded one. On another machine an obsolete or missing recorded executable must be replaced by running setup with a compatible installed runtime or explicitly selecting `ACCORDLY_NODE_BINARY`. Explicit custom `.env`/environment configuration continues to take priority and must be correct for that app; it never silently falls back to the demo.

The demo server is left running at http://localhost:3000 for retry. Passwords/keys were neither printed nor changed. New account provisioning, schema changes and remote/production operations were not needed.
