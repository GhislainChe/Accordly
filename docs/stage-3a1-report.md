# Stage 3A.1 — authentication visual refinement

Accordly by BE WISE INNOVATION. 13 November 2026.

## Changes

Refined the existing white, single-column authentication system using the unchanged official Accordly logo. The form width is now 456px, with a consistent 18px form rhythm, 48px rounded controls, clearer heading spacing and neutral secondary links. The primary action and selected controls retain burgundy #800020. Footer text is slightly larger and uses the standard secondary text color. No graphics, dependencies or animations were added.

Registration and onboarding share the refined progress treatment: completed segments are muted, the current segment uses solid burgundy, future segments remain neutral, and the small numbered indicator is clearer. Selection cards retain native radio controls, generous touch areas and visible keyboard focus. All field requirements and work/account choices remain unchanged.

Mobile inputs use 16px text, password visibility buttons have 44px-high touch targets, and narrow/short viewports use reduced vertical padding. Inputs and fieldsets can shrink within their containers. Existing reduced-motion support is preserved.

Email-verification guidance is no longer a permanent standalone sign-in link. After any sign-in error, an expandable help section offers the existing verification route. It does not classify whether an account exists, prefill an email, send a code or change server error handling. The ordinary inline error remains visible.

The registration legal blocker remains visibly labeled “Local demonstration · legal content pending.” Its native disclosure reveals the unchanged missing-document explanation and working status-page links. No legal text, legal acceptance checkbox or consent collection was invented. Production account restrictions remain unchanged.

## Files changed

- `src/components/auth/auth.css`: scoped spacing, typography, rounded fields/buttons, progress, selection controls, contextual notices and responsive refinements.
- `src/components/auth/ui.tsx`: distinct current/completed progress classes and compact expandable legal notice.
- `src/components/auth-controls.tsx`: contextual sign-in verification help; permanent verification link removed. Login request, redirect, refresh and shared logout operation are unchanged.
- `tests/auth-ui.test.mjs`: added rendering regression for absence of a permanent verification link and presence of generic contextual help after an error.
- `docs/screenshots/stage-3a1/{sign-in-desktop,sign-in-mobile,registration-mobile,registration-tablet}.png`: actual browser captures, with empty fields and no credentials/codes.
- This report.

No API route, Supabase client/session handling, onboarding command, workspace creation behavior, guest signing, RLS, authorization, migration, environment setting or logo asset was modified. Dashboard, agreement and amendment interfaces were not redesigned. No remote/production database was touched, and no retained demo data was reset.

## Validation results

Validation used the project's supported bundled Node 24 runtime.

- `npm test`: **38 passed, 0 failed**; includes authentication/onboarding validation tests and the new contextual-help rendering test. Component tests are server-rendered React tests, not simulated browser interactions.
- `npm run lint`: passed, exit 0, zero warnings.
- `npm run typecheck`: passed, exit 0, after Next route type generation.
- `npm run test:integration`: **259 assertions passed**, exit 0. This starts and stops its own disposable local Supabase stack and tests live GoTrue, native Auth email verification/recovery, production Next handlers, actual HTTP cookies, verified PostgreSQL TLS, authorization and existing agreement/signing/amendment regressions.
- Production build: **passed**, through the integration runner's actual `npm run build` invocation before starting its compiled production server. No separate redundant second build was run.
- Standalone SQL suite was not rerun in this presentation-only stage. Its previous Stage 3A result is not counted as a new result here. The live integration runner applies existing migrations to its disposable stack; no database policy was changed.

Ignored local logs: `.stage-3a1-{app,lint,typecheck,integration}-validation.log`.

## Real browser verification

The in-app Chromium browser was checked against the existing local development server:

- Desktop sign-in at 1440×1000: official logo, aligned fields/button, balanced spacing, Google visibly disabled and no permanent verification link.
- One deliberately invalid fictional sign-in: the existing generic credential error appeared. The contextual verification disclosure expanded and exposed its working `/verify` link without asserting account existence. No code was requested and no account was created.
- Registration at 390×844: progress and numbered indicator, restrained password instructions, complete controls, compact legal blocker and expandable explanation inspected. Computed mobile input font was 16px; document content did not exceed the viewport width.
- Registration at 320×740: all input bounding boxes fit horizontally; document content width was 305px within the 320px viewport, accounting for the scrollbar.
- Tablet registration at 768×1024 and mobile sign-in at 390×844 were visually inspected and captured. Mobile sign-in content width matched the viewport with no horizontal overflow.
- Browser viewport overrides were reset and the empty sign-in screen left available.

Two browser-control attempts initially timed out and reset the automation session. Reconnection succeeded; the checks above were performed after recovery. These timeouts were not treated as application test failures or successful visual checks.

The complete browser registration/verification/onboarding journey from Stage 3A was not repeated. Onboarding component rendering and the actual server account/workspace flows were covered by this stage's application and live integration tests. No existing provider password was changed, and no browser password-reset submission was performed. Physical devices, Safari/Firefox and screen-reader conformance were not tested.

## Remaining issues and next steps

Google OAuth remains unavailable and disabled. Approved Terms of Service and Privacy Policy content, legal agreement capture/versioning and the existing production delivery/abuse/recovery/retention requirements remain deployment blockers. This visual refinement does not enable production registration or signing or claim signature certification.

A subsequent acceptance pass should cover assistive technology and additional browsers. Resolve the documented operational/legal gates before real-user deployment; dashboard and agreement visual work remains separately scoped.
