import { randomUUID } from "node:crypto";
// HTTP/server-rendered checks. These do not pretend to drive a browser DOM.
export async function providerIntegration({ api, base, a, b, aid, check }) {
  const anonymous = await api(base, "/api/provider", "");
  check(anonymous.status === 401, "Workspace HTTP API requires authentication");
  const workspace = await api(base, "/api/provider", a.cookie);
  check(workspace.status === 200 && workspace.body.organizations.length === 1 && workspace.body.agreements.some((g) => g.id === aid), "Authorized workspace includes real agreement/organization data");
  const other = await api(base, "/api/provider", b.cookie);
  check(other.status === 200 && !other.body.agreements.some((g) => g.id === aid), "Workspace HTTP projection isolates tenants");
  check((await api(base, `/api/provider/${aid}`, b.cookie)).status === 404, "Cross-tenant UI detail API hides existence");
  const detail = await api(base, `/api/provider/${aid}`, a.cookie);
  check(detail.status === 200 && detail.body.permissions.issue && detail.body.history.length > 0, "Provider detail projection returns permitted controls and real committed history");
  check(!JSON.stringify(detail.body).includes("secret_digest") && !JSON.stringify(detail.body).includes("proof_secret"), "UI projections expose no credential hashes or bearer secrets");
  const protectedResponse = await fetch(base + "/app", { redirect: "manual" });
  check([303,307].includes(protectedResponse.status) && protectedResponse.headers.get("location") === "/login", "Protected page redirects unauthenticated visitors");
  const login = await fetch(base + "/login"); const html = await login.text();
  check(login.status === 200 && html.includes("Sign in to your Accordly account."), "Real login screen is server-rendered");
  check(!/<script[^>]+src="https?:\/\//.test(html), "Login has no external scripts");
  const csp = login.headers.get("content-security-policy") ?? "";
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  check(!!nonce && html.includes(`nonce="${nonce}"`) && !csp.split(";").find((p) => p.includes("script-src"))?.includes("unsafe-inline"), "Nonce CSP applies to actual Next inline scripts");
  const second = await fetch(base + "/login");
  check(second.headers.get("content-security-policy") !== csp, "Each UI response has a fresh nonce");
  check(login.headers.get("referrer-policy") === "no-referrer" && login.headers.get("cache-control")?.includes("no-store"), "Sensitive UI uses no-referrer/no-store");
  // Real command-created records in the runner-owned disposable stack only.
  const fixtureDraft = { scope: "Fictional FlowCanvas integration scope", terms: "Fictional integration terms; not a real engagement.", amount_minor: "75000", currency_code: "XAF", currency_exponent: 0, content_language: "en", deadline: { kind: "date", date: "2027-01-31" }, milestones: [], attachments: [] };
  const command = (operation, resource_id, input) => api(base, "/api/agreements/commands", a.cookie, { operation, resource_id, input, idempotency_key: randomUUID() });
  const draftFixture = await command("create_draft", workspace.body.organizations[0].id, { title: "FlowCanvas draft fixture", draft: fixtureDraft });
  check(draftFixture.status === 200, "FlowCanvas draft fixture uses the real authorized creation command");
  const composerNew = await fetch(base + "/app/agreements/new", { headers: { cookie: a.cookie } });
  const composerNewHtml = await composerNew.text();
  check(composerNew.status === 200 && composerNewHtml.includes("LIVE AGREEMENT COMPOSER") && composerNewHtml.includes("DRAFT / NOT SIGNED") && composerNewHtml.includes("composer-scope"), "New composer uses the protected existing creation route with an honest live draft preview");
  const composerDraft = await fetch(base + `/app/agreements/${draftFixture.body.agreement_id}`, { headers: { cookie: a.cookie } });
  const composerDraftHtml = await composerDraft.text();
  check(composerDraft.status === 200 && composerDraftHtml.includes("Fictional FlowCanvas integration scope") && composerDraftHtml.includes("Save parties") && composerDraftHtml.includes("Freeze agreement"), "Existing authorized draft opens the composer with actual terms and existing party/freeze paths");
  check(!composerDraftHtml.includes('type="checkbox" checked'), "Composer freeze confirmation starts unchecked");
  const forbiddenComposer = await fetch(base + `/app/agreements/${draftFixture.body.agreement_id}`, { headers: { cookie: b.cookie } });
  const forbiddenComposerHtml = await forbiddenComposer.text();
  // Next can stream the protected layout before notFound(), yielding a 200
  // shell. Assert the denial content and absence of private data, not just HTTP.
  check([200,404].includes(forbiddenComposer.status) && forbiddenComposerHtml.includes("Agreement unavailable.") && !forbiddenComposerHtml.includes("Fictional FlowCanvas integration scope") && !forbiddenComposerHtml.includes("LIVE AGREEMENT COMPOSER"), "Another tenant receives only the unavailable page, never composer terms");
  const pendingFixture = await command("create_draft", workspace.body.organizations[0].id, { title: "FlowCanvas pending fixture", draft: fixtureDraft });
  check(pendingFixture.status === 200, "FlowCanvas second document is created without a parallel write path");
  check((await command("set_parties", pendingFixture.body.agreement_id, { expected_revision: "1", provider: { legal_name: "Fictional provider", representative_name: "Fictional provider signer" }, client: { legal_name: "Fictional client", representative_name: "Fictional client signer", email: "flowcanvas-client@example.test" } })).status === 200, "Pending fixture requires real designated parties");
  check((await command("freeze", pendingFixture.body.agreement_id, { expected_revision: "2" })).status === 200, "Pending fixture freezes through quorum-validated command");
  const app = await fetch(base + "/app", { headers: { cookie: a.cookie } }); const appHtml = await app.text();
  check(app.status === 200 && appHtml.includes("Logo and Brand Identity Design") && appHtml.includes("New agreement"), "Authenticated dashboard renders real authorized agreements");
  check(appHtml.includes('aria-label="Preview FlowCanvas draft fixture, Draft"') && appHtml.includes('aria-label="Preview FlowCanvas pending fixture, Awaiting signatures"'), "Multi-document home renders real draft and frozen lifecycle previews");
  const explore = await fetch(base + "/app?mode=explore", { headers: { cookie: a.cookie } });
  const exploreHtml = await explore.text();
  check(explore.status === 200 && exploreHtml.includes('id="flow-search"') && exploreHtml.includes('role="tablist"'), "FlowCanvas Explore deep link renders real search and accessible modes");
  const review = await fetch(base + "/app?mode=review", { headers: { cookie: a.cookie } });
  const reviewHtml = await review.text();
  check(review.status === 200 && reviewHtml.includes("A verified personal review queue is not available yet") && !reviewHtml.includes("Sign now"), "Review does not fabricate personal signing authority");
  check(reviewHtml.includes('aria-label="Preview FlowCanvas pending fixture, Awaiting signatures"') && !reviewHtml.includes('aria-label="Preview FlowCanvas draft fixture, Draft"'), "Review presents only frozen pending-signature previews without classifying a personal signer");
  const otherHome = await fetch(base + "/app?mode=explore", { headers: { cookie: b.cookie } });
  const otherHomeHtml = await otherHome.text();
  check(otherHome.status === 200 && !otherHomeHtml.includes(aid) && !otherHomeHtml.includes(draftFixture.body.agreement_id) && !otherHomeHtml.includes(pendingFixture.body.agreement_id), "FlowCanvas server rendering does not expose another tenant agreement ID");
  const agreement = await fetch(base + `/app/agreements/${aid}`, { headers: { cookie: a.cookie } });
  const agreementHtml = await agreement.text();
  check(agreement.status === 200 && agreementHtml.includes("Version integrity") && agreementHtml.includes("Agreement terms"), "Authorized agreement detail renders exact frozen-version sections");
  const invite = await fetch(base + "/invite"); const inviteHtml = await invite.text();
  check(invite.status === 200 && inviteHtml.includes("Your agreement, together.") && !inviteHtml.includes("Développement exact"), "Unverified invitation screen is generic and reveals no contract content");
  check((await api(base, "/api/auth/login", "", { email: a.email, password: a.password, actor_id: b.id })).status === 422, "Login rejects identity injection");
  const badLogin = await api(base, "/api/auth/login", "", { email: a.email, password: "incorrect-local-test-password" });
  check(badLogin.status === 401 && badLogin.body.error === "invalid_login", "Incorrect password remains a credential rejection, not a 503");
  const logged = await api(base, "/api/auth/login", "", { email: a.email, password: a.password });
  check(logged.status === 200 && logged.headers.getSetCookie().length > 0, "Actual provider login handler writes Auth cookies");
  const cookie = logged.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  check((await api(base, "/api/provider", cookie)).status === 200, "Cookies from UI login authorize the private gateway API");
  const loggedOut = await api(base, "/api/auth/logout", cookie, {});
  check(loggedOut.status === 200 && loggedOut.headers.getSetCookie().some((c) => c.includes("Max-Age=0")), "Actual sign-out clears the browser Auth cookie");
}



