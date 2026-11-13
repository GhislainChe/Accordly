# Stage 3A — authentication and onboarding redesign

Accordly, an independent product of BE WISE INNOVATION. 13 November 2026.

## Implemented scope

Replaced the split sign-in presentation with a single centered authentication layout. Authentication and onboarding now share a slim official-logo header, white background, 464px desktop form width, restrained burgundy (#800020) accents, neutral borders, consistent 48px controls and a quiet footer. Existing local Inter and Plus Jakarta Sans fonts are retained. No decorative waves, animations, gradients, new dependencies or replacement logo artwork were introduced.

Registration uses three thin progress segments and a small numbered step indicator. Step 1 includes full name, email, password and confirmation. Password fields have accessible Show/Hide controls; mismatches prevent submission and move focus to confirmation. Confirmation stays in the browser and is never added to the strict server command. Password inputs are cleared after a submitted registration/reset attempt.

Verification is separate from numbered onboarding. Step 2 uses native, keyboard-accessible radio groups for work type and purpose, without requesting the already supplied full name again. A missing-name fallback preserves accounts created outside the form. Step 3 requests only the professional display name or business name. Existing membership adoption is available only when the authorized server response includes workspaces. Back navigation and reload of saved progress preserve the existing command and revision rules.

Sign-in, registration, verification, recovery, password reset, workspace-unavailable, account-help, legal-status, expired-code guidance and authentication-error guidance share the same system. The two new guidance pages do not consume codes, resend messages, classify arbitrary tokens or echo URL parameters. Actual errors continue to appear inline through the existing safe error mapping. Guest invitations, signing and amendment screens have not been redesigned.

## Files

New source/assets:

- `src/components/auth/ui.tsx`: heading, progress, labeled field, password visibility, alert/status, disabled Google and legal-status components.
- `src/components/auth/auth.css`: scoped auth tokens, layout, controls, radio selections, responsive rules and reduced-motion handling. Existing global dashboard tokens are unchanged.
- `src/app/auth/{help,legal,error,expired}/page.tsx`: real help/status/guidance destinations.
- `public/brand/{accordly,accordly-icon,accordly-name}.png`: byte-identical copies of the three user-supplied PNGs. All three SHA-256 comparisons matched their source files. The header uses the supplied combined logo, including the actual A/checkmark monogram. The other original assets are retained for future authorized use.
- `tests/auth-ui.test.mjs`: server-rendered React tests for registration requirements, honest unavailable controls, separate verification, fail-closed mode and accessible onboarding choices. These are component rendering tests, not browser interaction tests.
- `docs/screenshots/stage-3a/*.png`: real local browser captures; see acceptance evidence below.
- This report.

Updated:

- `src/components/account-shell.tsx`: shared scoped auth shell and context-relevant navigation.
- `src/components/auth-controls.tsx`: redesigned login form; existing shared logout operation preserved.
- `src/components/account-forms.tsx`: redesigned account/onboarding forms; `WorkspaceChoice` behavior and markup preserved.
- `src/app/{login,register,onboarding,workspace-unavailable}/page.tsx`: shared shell integration and unavailable-state presentation. Existing verify/recover/reset pages inherit the redesigned components without route-handler changes.
- `src/proxy.ts`: includes the four new public information pages in the existing nonce CSP/private-rendering boundary. Their public status does not grant access to any account or agreement.
- `scripts/provider-integration.mjs`: updates the server-rendered login copy assertion to the requested description.
- `scripts/account-integration.mjs`: covers all eight public account/information routes and verifies actual script nonces match the response CSP, in addition to existing authentication checks.

No migration, Auth API, account command, RLS policy, database role, environment configuration or dependency was changed. No remote/production resource was modified. Existing account and signing deployment restrictions remain active.

## Security and implementation decisions

The existing Supabase signup, exact-purpose OTP verification, recovery proof, secure cookies and live identity checks remain the only authentication paths. The existing atomic/idempotent workspace creation, expected revisions and last-authorized-workspace routing remain server-controlled. Choices of work type/purpose remain preferences, not authorization. Guest history is not claimed through matching email addresses.

New information pages use dynamic rendering because request-specific CSP nonces cannot be injected into prebuilt static HTML. This follows the installed Next.js 16.4.6 guide, and live integration checks compare each rendered script nonce to the actual response policy. No CSP allowance was relaxed.

**Legal documents remain a deployment blocker.** No approved Terms of Service or Privacy Policy existed in the project or supplied assets. `/auth/legal#terms` and `#privacy` therefore point to explicit availability notices, not invented legal documents. The registration notice states that legal agreement cannot yet be collected and restricts the experience to the existing fictional local demonstration. There is deliberately no misleading checkbox claiming acceptance of unavailable terms. Before public launch, publish approved documents, add explicit agreement capture with approved document-version evidence, and review the server enforcement required for that capture.

**Google remains disabled.** No supported application OAuth callback or configured provider integration exists. The buttons have no action and explain the missing configuration. Setting an arbitrary public flag or enabling a provider in a console is insufficient. A future implementation must use approved Supabase OAuth/PKCE, exact allowlisted local/production callbacks, safe internal return destinations, live identity/email validation, onboarding routing, account-linking review and integration tests. Keep provider secrets server-side and preserve production account/signing gates. No fake OAuth endpoint was added.

Only the three logo images were supplied as references; no separate authentication-layout screenshots were available. The implementation follows the requested single-column layout, exact headings and restrained visual rules.

## Validation

All required command families passed using Node 24:

- `npm test`: **37 passed, 0 failed** (34 existing tests plus 3 new auth component tests).
- `npm run test:db`: **275 SQL assertions passed**, all **16 existing migrations** applied and replayed successfully in an isolated disposable PostgreSQL container. Existing real restricted-role concurrency tests passed for owner preservation, draft preparation, shared abuse counters, competing amendments and atomic onboarding. These simulate the trusted database assertion boundary; live identity is tested separately below.
- `npm run test:integration`: **259 assertions passed** against a task-owned disposable full local Supabase stack, live GoTrue, native Mailpit delivery, production Next handlers and verified PostgreSQL TLS. Coverage includes existing provider/guest signing and amendment workflows, real signup and native OTP verification, duplicate/invalid registration, unverified access restrictions, exact recovery purposes, one-use recovery proofs, new/returning accounts, workspace creation/retries/concurrency, tenant isolation and all eight account/information routes. The final run additionally checked actual script nonce attributes against the CSP on each route.
- `npm run lint`: passed with zero warnings.
- `npm run typecheck`: passed after Next route type generation. An initial UI prop mismatch (`AccountStatus.step` is typed as a number) was fixed by mapping the existing two onboarding branches to literal steps 2/3; the final check passed.
- `npm run build`: standalone production build passed. The final integration run rebuilt the final application successfully with production configuration after the information-page nonce correction.

Real in-app Chromium browser acceptance passed against the retained local demo:

- Existing private provider credentials: sign in, real `/app` dashboard, sign out back to `/login`.
- Password mismatch: rejected before submission; confirmation received focus. Show/Hide state toggled correctly with an empty password field, avoiding disclosure in captures.
- One new fictional account: registration, native six-digit mailbox verification, Step 2 preferences, Step 3 refresh/resume, Back with preferences preserved, workspace creation and arrival at an empty authorized dashboard.
- Arrow-key navigation changed the native purpose radio selection and restored Both before saving.
- That completed account signed out, signed back in directly to `/app`, and signed out again.
- Desktop 1440×1000, tablet 768×1024 and mobile 390×844 layouts inspected; narrow 320px registration and the tablet reset form had no horizontal overflow. These are browser viewport checks, not physical-device or cross-browser certification.
- Legal status links were followed and explicitly displayed the missing-document notices. FAQ navigation, recovery request/code-entry states, the reset form and both error/expired guidance pages were inspected. No browser recovery code was requested or password reset submitted.

A single new fictional local account and `Fictional Stage 3A Studio` workspace were retained as acceptance-test data. Existing provider credentials were not changed; no existing agreement was edited or signed and no retained database was reset. Its generated test password and mailbox code are not recorded in this report or screenshots.

Browser password-recovery completion was **not** performed. Native recovery, password update, replay rejection and subsequent login passed the real disposable-stack HTTP integration tests; this must not be described as a manual browser reset test. No screen-reader, Safari/Firefox, physical-device or complete WCAG audit was performed. Browser acceptance used the development server; production behavior was tested through the compiled HTTP integration server.

Saved real captures are under `docs/screenshots/stage-3a/`: `sign-in-desktop.png`, `sign-in-mobile.png`, `registration-desktop.png`, `registration-mobile.png`, `onboarding-work-desktop.png`, `onboarding-work-mobile.png`, `onboarding-workspace-mobile.png` and `reset-password-tablet.png`. Captures contain no passwords or verification codes. Some mobile captures show the viewport rather than all scrollable content. They are evidence of the running local UI, not mockups.

Ignored `.stage-3a-*-validation.log` files contain local check output; private demo credentials and mailbox contents are not part of this report.

## Local acceptance instructions

Use the existing Node 22.18+ / Docker local setup described in README; this validation used the bundled Node 24 runtime. With the retained local demo configured, run `npm run dev` or `npm run demo`, then open `http://localhost:3000/login`. Do not reset the database for this UI change. Use only fictional `example.test` recipients and private local demo credentials; never paste credentials into issue reports or screenshots.

1. Sign in with the existing local provider and confirm `/app` loads; sign out.
2. At `/register`, test password mismatch and Show/Hide. Register a new fictional address with a strong test password. No legal acceptance is claimed.
3. Find only that recipient's confirmation email in the local Auth Mailpit inbox at `http://127.0.0.1:55624`. Enter the native six-digit code. This is distinct from the guest-signing filesystem mailbox. Do not publish screenshots of inboxes or codes.
4. Complete Step 2, refresh at Step 3 to check resume, go Back to confirm saved preferences, then finish setup. The created workspace should contain no other tenant's agreements.
5. Sign out and back in: the completed account should go directly to its authorized workspace.
6. Test `/recover`, verify its separate native recovery code, then choose a new test password on `/reset-password`. Do not change existing demo account passwords merely to check visual styling. Unknown addresses receive the same acknowledgement.
7. Check `/verify`, `/auth/help`, `/auth/legal`, `/auth/expired` and `/auth/error`. The guidance pages are safe GETs; they do not themselves redeem or resend tokens.
8. Repeat at desktop and mobile widths, including 320px. Native radio groups support arrow-key selection; all fields retain labels and visible keyboard focus.

## Remaining release work

Public registration requires approved legal content, consent/version handling, production email delivery and reconciliation, native Auth CAPTCHA/abuse controls, trusted ingress and operational recovery/incident processes. Production signing additionally retains its existing verification delivery, recovery, retention and operational prerequisites. Email control is not verified legal identity, and electronic signatures are not claimed to be certified or legally enforceable.

The next stage should resolve these operational/legal prerequisites and perform a broader supported-browser and assistive-technology acceptance pass. A dashboard/signing visual redesign can follow as a separately scoped stage; it is not part of this change.



