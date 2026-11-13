# Stage 3B — FlowCanvas workspace

## Implementation plan

1. Preserve the verified server layout gate and existing provider APIs. Render a FlowCanvas shell only at `/app`; preserve the existing frame on creation and detail deep links.
2. Filter the authorized server list to the selected workspace before passing agreement rows to the client. Do not expand database privileges, alter migrations or preload full contracts.
3. Implement accessible Canvas / Create / Review / Explore tabs with allowlisted URL modes and native history integration. Search only loaded titles, filter real lifecycle states and disclose the existing global 200-row projection limit.
4. Render reusable metadata-only document sheets. Load the existing authorized detail API on selection, abort stale requests, show actual parties/current version and route valid actions into existing detail pages. Preserve exact monetary representation and distinguish current effective versions from other frozen history.
5. Use a desktop side panel and a stacked mobile detail region, with focus/close/Escape behavior. Avoid modal trapping for the nonmodal stacked region.
6. Keep Review explicitly limited: no API verifies a personal signature queue. Create links to the existing validated creation route. Workspace/account settings expose actual profile/workspace metadata, the existing authorized workspace selector and sign-out; no fake management, notifications or OAuth controls.
7. Validate pure presentation logic, real gateway/authorization and SQL regressions, lint, types and production build. Verify actual browser layouts/interactions where available and report missing coverage accurately.

The implementation follows this plan; final decisions, verification and limitations are recorded below.

## Delivered experience

Accordly by BE WISE INNOVATION. 13 November 2026.

The `/app` home is now FlowCanvas: a white/warm-white agreement workspace with the supplied official logo, near-black headings, neutral secondary typography and restrained burgundy actions/selection. The statistical dashboard has been replaced by a responsive document canvas. No animation library, new package, fake notification, seeded sample document or external asset was added to the application.

The protected server layout still performs the same live identity and onboarding checks before rendering. A route-aware presentation frame applies the new shell only to `/app`; creation, agreement details, signed history and amendments keep their existing interface and deep links. Authentication and onboarding screens remain as delivered in Stage 3A.1.

### Modes and navigation

- **My Canvas:** up to six most recently updated records in the selected workspace. Paper previews use actual saved title, lifecycle and UTC update metadata, with decorative neutral lines explicitly described as metadata previews rather than contractual text. Long titles are visually limited to three complete lines; the full title remains in the accessible label and detail view.
- **Create:** a focused starting pane linking to `/app/agreements/new`. The action is shown only for an active selected organization with an existing owner/admin/editor membership. Actual command authorization remains on the unchanged server/database path. No duplicate creation form or write API was introduced.
- **Review:** an explicitly limited view of workspace records whose lifecycle is `awaiting_signatures`. It does not infer a personal signature requirement, verify signer identity or represent a personal task queue. Active agreements with pending amendments are not discoverable as tasks through the current list projection; their existing detail view remains the entry point.
- **Explore:** search loaded titles and filter the three implemented agreement lifecycles: `preparing`, `awaiting_signatures`, `active`. Twelve previews render initially, with incremental Show more. Search is local to loaded authorized metadata; query text is not written into URL parameters.

Mode changes use the installed Next.js-supported native History API with `useSearchParams`. `mode` is allowlisted; `document` is resolved only against the current filtered workspace collection. Tab arrow keys, Home/End, active-state semantics, refresh and Back are supported without creating disconnected administrative pages. Tab controls refer to the same adaptive, correctly labeled panel.

Workspace/account access shows real profile and membership information, the existing authorized workspace selector when multiple memberships exist, and the existing sign-out command. Read-only profile/workspace limitations are stated inside that disclosure; no placeholder administration controls were created. The current workspace name remains visible on mobile. A migration-generated `Existing account` fallback is not treated as a person's first name in the greeting. Actual supplied profile names personalize the greeting without becoming authorization data.

### Selected-document presentation

One selection loads the existing `/api/provider/[agreementId]` endpoint with same-origin credentials and no-store semantics. No full contracts or per-record detail requests run during the initial canvas load. Requests are aborted when selection changes/unmounts, responses must match both the requested agreement and its organization, and each mounted selection starts without the previous agreement's data. Failures display controlled messages and retry/sign-in actions, not raw database details. Refresh details repeats the same authorized read.

The panel shows actual participants, the current effective or initially frozen version and exact amount when supplied. Amount formatting uses BigInt, integer currency metadata and string output; XAF has no decimal conversion or floating-point rounding. Future exponent formatting does not enable new backend currencies.

An effective-version pointer takes precedence over version ordering. A later pending version cannot replace the current effective amount. If the pointer is missing from the returned projection, the panel does not silently choose another version. Other versions are called **Historical frozen version**, not all presumed effective or approved. Their detailed approval outcomes remain in the existing history interface.

The current provider detail projection does not carry `updated_at` even though the legacy TypeScript view type inherits it. The new UI therefore uses the actual listing timestamp for update metadata rather than assuming that missing field exists; no database/API schema was changed. This projection/type discrepancy should be addressed in a later API-contract cleanup.

Desktop selection keeps the canvas visible beside a detail panel. At tablet/mobile widths the panel becomes an ordinary stacked, nonmodal region. Selection focuses its heading and scrolls the region into view; Close and Escape restore focus to the originating document, or to the active mode for a deep-linked document outside the displayed batch. There is no modal focus trap or hover-only action. Frozen records have no edit fields; Continue draft is offered only with `preparing` plus the server's actual edit permission. Other records use Open agreement. Signing and amendments continue through their existing verified workflows.

### Data and security boundaries

The unchanged `providerWorkspace()` gateway/SQL projection returns at most the latest **200 accessible agreements across the account's memberships**. The server Dashboard filters these rows to the selected workspace before sending the collection to the client; the canvas repeats that presentation guard. No selected workspace means an empty collection, never combined tenant records. Organization membership names remain available for the authorized workspace selector.

If the source collection reaches 200, the UI discloses that older selected-workspace records may be missing and that search covers loaded titles only. Explore is not advertised as complete server-side search or pagination. The detail endpoint independently reauthorizes each request; a public agreement ID or URL selection grants nothing. The header/profile and displayed role are never trusted as mutation permissions.

No RLS, membership rules, session/cookie handling, privileged role boundary, idempotency rule, version integrity, consent evidence, guest capability, registration gate, Google OAuth gate or production signing gate was changed. No remote/production database was accessed or migrated. No contract was created, changed, invited or signed in the retained demo during browser validation. Additional draft/pending records exist only as real command-created fixtures in the task-owned disposable integration stack, which was removed afterwards.

## Files changed

New:

- `src/components/flowcanvas/workspace-frame.tsx`: home-only shell, profile/workspace disclosure, existing workspace/sign-out controls and preserved frame for other application routes.
- `src/components/flowcanvas/canvas.tsx`: accessible modes, URL history, filters, batching, selected-document and empty/limited states.
- `src/components/flowcanvas/document-preview.tsx`: reusable semantic document-preview control with real metadata and safe text rendering.
- `src/components/flowcanvas/detail-panel.tsx`: authorized lazy detail read, cancellation/error/retry handling, exact current version/amount, participants, history labels and existing workflow links.
- `src/components/flowcanvas/presentation.ts`: selected-workspace filtering, lifecycle/title filtering, mode validation, effective-pointer resolution, UTC dates and exact money formatting.
- `src/components/flowcanvas/flowcanvas.css`: home-scoped tokens, responsive paper grid/panels, focus/touch targets, 150–180ms interaction feedback and reduced-motion rules.
- `tests/flowcanvas.test.mjs`: pure presentation/precision/boundary regressions.
- `tests/flowcanvas-render.test.mjs`: React rendering tests for hostile titles, multiple lifecycles, empty state, limited Review and denied/allowed Create states.
- `docs/screenshots/stage-3b/*.png`: real local browser captures, described below.
- This report, including the plan recorded before implementation.

Updated:

- `src/app/app/layout.tsx`: delegates presentation to WorkspaceFrame after the existing verified identity, onboarding and local signing configuration checks.
- `src/components/provider/dashboard.tsx`: server-scoped FlowCanvas entry; replaces metrics/list presentation.
- `scripts/provider-integration.mjs`: real draft/frozen multi-document fixtures, FlowCanvas deep-link/Review/tenant-isolation checks, existing authorization and detail regressions retained.
- `scripts/account-integration.mjs`: replaces the obsolete dashboard-text assertion with the new home heading, genuine empty state and absence of the foreign agreement ID after successful onboarding.

No migration, database function, API route, package, environment setting or brand asset was changed.

## Validation

Validation used the supported bundled Node 24 runtime.

- `npm test`: **44 passed, 0 failed**. Six new FlowCanvas tests cover selected-workspace filtering (including no selection), real lifecycle/title filtering, mode allowlisting, effective pointers versus later candidates, exact XAF/future exponent formatting, escaped hostile titles, multiple preview states, empty state and denied/allowed Create rendering. These pure/React rendering tests are not claimed as browser tests or proof of RLS by themselves.
- `npm run test:db`: **275 SQL assertions passed**, all **16 existing migrations** applied and replayed in an isolated disposable PostgreSQL database. Real restricted-role concurrency checks passed for owner preservation, preparation, abuse counters, competing amendments and atomic onboarding. Database tests exercise simulated trusted identity assertions under actual roles; live Auth is verified separately below.
- `npm run test:integration`: **268 assertions passed**, exit 0, against a disposable full local Supabase stack, live GoTrue, native account verification/recovery, production Next handlers, actual HTTP cookies and certificate/hostname-verified PostgreSQL TLS. New checks create real draft and frozen pending-signature records through existing commands, validate multi-document SSR and lifecycle rendering, verify Explore/Review deep links, verify unrelated-tenant IDs are absent from the home HTML, and verify a newly onboarded account receives a genuine empty workspace. Original agreement, signing, amendment, idempotency, rollback, cross-tenant and account regressions remain enabled.
- `npm run lint`: passed, zero warnings, exit 0.
- `npm run typecheck`: passed, exit 0, after Next route type generation.
- `npm run build`: standalone production builds passed. The final integration run rebuilt the final application before its successful 268 assertions. Final generated production CSS/JS contains the corrected preview sizing and stacked-panel focus behavior.

During implementation, TypeScript rejected BigInt literal syntax under the existing project target; formatting now uses BigInt constructors without changing tsconfig or money storage. The first integration attempt stopped at a legacy assertion expecting the old dashboard text “Agreements”; it was updated to validate the actual FlowCanvas heading, empty state and foreign-ID exclusion. Later final runs passed; those earlier failures are not counted as successful runs.

Real in-app Chromium browser checks used the retained local development demo:

- Existing provider login reached the new authenticated workspace. All four modes were visited. Arrow keys and End changed active tabs and focus; URL modes updated immediately, survived refresh, and browser Back restored Explore after rendering completed.
- Explore title search produced an honest no-match state, Clear filters restored the collection, Draft filtering excluded the active record and Active filtering restored it. Search text stayed out of the URL.
- Review displayed its missing-personal-queue notice and did not label the provider as needing to sign.
- Selecting the real `Logo and Brand Identity Design` record loaded its authorized participants, current effective **Version 2 / 100,000 XAF**, and separate **Version 1 / Historical frozen version** label. Escape/Close restored document focus and removed the selection URL parameter.
- The Create action reached the existing editable draft form. Open agreement reached the unchanged detail page. Its existing history review displayed original signed **Version 1 / 75,000 XAF**, correctly marked previously effective/superseded, alongside current Version 2. No terms, invitations, signatures or amendments were modified.
- Desktop 1440×1000, tablet 768×1024 and narrow mobile 320×740 were checked. Mobile document selection focused and scrolled to the stacked detail region, with a visible close control. The 320px page content width was 305px with the scrollbar; all mode targets were at least 44px wide and 48px high. No horizontal overflow was observed in the canvas, detail region or account disclosure.
- Narrow testing caught a partially clipped preview title. The final paper spacing prevents essential text from flex-shrinking; the test title measured two full 26.6px lines (53.1875px after layout rounding). Decorative lines yield space before actual title/status/actions.
- Workspace/account disclosure showed the real workspace, email and owner role. Escape dismissed it and restored summary focus. Its Sign out action returned to the existing login page; the provider signed back in successfully. Multi-workspace switching itself was not exercised manually in the retained one-membership demo; existing account integration tests cover authorized selection and forbidden membership claims.

Browser checks used the development server; production was verified through the compiled HTTP integration server, not a separate production-browser session. Empty-account and multiple/draft/frozen collections were tested by real HTTP/server-rendering integration plus component rendering, not manually seeded into the retained demo. No new retained account or agreement was created in this stage. One real local-development preview read returned HTTP 503 after 30.6s (the server log attributed 21.2s to Next.js work and 9.4s to application code). Its explicit retry returned HTTP 200 in 496ms and displayed the correct authorized data. The precise gateway failure cause was not isolated, so this is recorded as an unresolved transient development-server issue, not claimed fixed by a security change. No stale details appeared during the failure. Aborted-read guards are implemented; deliberate browser network-fault injection/race stress was not performed.

Development console history also contained hydration diagnostics during hot-editing (the legacy profile fallback initial changed from E to P) and an early Back operation while streamed rendering was still loading. After final code stabilization, a clean selected-document reload completed with the correct data and **zero new browser error entries** relative to a captured console baseline. A browser load-state wait timed out before that completed state was observed; it was not counted as a successful timing test. Development latency and slow-hydration navigation deserve further profiling; no production-browser performance claim is made.

Reduced-motion CSS removes animation, transition, smooth scrolling and hover/press transforms. Its static rules and non-animation-dependent layout were reviewed; actual reduced-motion media emulation was not available through the browser controls, so that mode is **not claimed as dynamically tested**. Screen-reader conformance, physical devices and Safari/Firefox remain unverified.

Saved actual captures under `docs/screenshots/stage-3b/`: `canvas-desktop.png`, `canvas-tablet.png`, `canvas-mobile.png`, `agreement-detail-desktop.png`, `agreement-detail-mobile.png`. Desktop/tablet captures show the broader canvas; mobile captures show viewport portions, not guaranteed full-page capture. No passwords, invitation tokens, codes or secret keys are included.

Ignored `.stage-3b-*-validation.log` files hold local command output; private demo credentials and tokens are excluded from this report.

### Local demonstration

Use the existing local demo and Node 22.18+ setup in README (`npm run dev` or `npm run demo`). This UI stage needs no migration, reseed or database reset. Keep `.demo/access.json` private and use only the existing fictional provider credentials.

1. Open `http://localhost:3000/app` after login. Select the real agreement paper to inspect current terms, participants and history labels.
2. Explore with `http://localhost:3000/app?mode=explore`; test a title and lifecycle filter. Review at `?mode=review` explains its limited scope.
3. Create at `?mode=create` enters the existing authorized form. Merely changing modes or opening a paper cannot create, invite or sign an agreement.
4. Use Open agreement for the existing exact-document, signature evidence and amendment history. The original 75,000 XAF version and current 100,000 XAF version remain separate.
5. Open Workspace & account for identity, membership, existing workspace switching where available and sign-out. Do not use real contracts or recipients while deployment gates remain unresolved.

## Limitations and recommended next stage

1. Review is not a personalized signing/amendment task queue. A future authorized projection must establish the current principal's designated pending slot, live grant/invitation/proposal state, current digest and remaining action before offering task or signature-required labels.
2. The global 200-row listing cap needs real workspace-scoped, authorized pagination and server search for larger collections. Older records are not made public or guessed by this interface.
3. Initial previews cannot show participants/version numbers because the lightweight listing does not contain them. Those appear only after an authorized detail read. No N+1 preload was added.
4. The existing detail endpoint returns full authorized version/evidence history, even though this UI renders metadata. Very large histories may need a smaller paginated preview projection; this stage did not rebuild backend contracts or permissions. The inherited timestamp type mismatch is noted above.
5. Account/profile editing and workspace administration are not implemented by this home redesign. The existing authorized workspace switcher and sign-out work; the profile disclosure accurately states the remaining limitation.
6. Existing production blockers remain: approved legal content and consent/version handling, external identity/verification delivery, abuse/ingress controls, recovery operations, audit retention and incident procedures. Google and production account/signing restrictions remain intact. No legal certification or enforceability is claimed.

Recommended next stage: refine the verified preview/list API contracts and implement workspace pagination plus a genuinely authorized personal review queue, then conduct broader assistive-technology and supported-browser acceptance. Redesign agreement details/signing/amendments separately once that scope is approved; their current functioning interface remains intact.


