import { randomUUID, randomBytes } from "node:crypto";

// Actual GoTrue signup/OTP/recovery, Mailpit local delivery, production Next
// handlers and restricted TLS PostgreSQL. No admin confirmation or fake tokens.
export async function accountIntegration({ api, base, database, adminSql, publicUrl, publicKey, a, b, aid, orgA, check, protect }) {
  const endpoint = "/api/auth/account";
  const call = (body, cookie = "") => api(base, endpoint, cookie, body);
  const account = (body, cookie) => api(base, "/api/account", cookie, body);
  const cookie = (headers) => headers.getSetCookie().filter((c) => !c.includes("Max-Age=0")).map((c) => c.split(";")[0]).join("; ");
  const key = (operation, input) => ({ operation, ...input, idempotency_key: randomUUID() });
  const email = "future-client@example.test"; // Already bound to a guest in the original signing fixture.
  let password = `Aa9!${randomBytes(20).toString("base64url")}`; protect(password);
  async function mailCode(recipient, subject) {
    for (let i = 0; i < 60; i++) {
      const r = await fetch("http://127.0.0.1:55524/api/v1/messages", { signal: AbortSignal.timeout(3000) });
      if (!r.ok) throw new Error("Disposable local Auth test mailbox unavailable");
      const list = await r.json();
      const message = list.messages?.find((m) => m.To?.some((t) => t.Address === recipient) && m.Subject?.includes(subject));
      if (message) {
        const body = await (await fetch(`http://127.0.0.1:55524/api/v1/message/${message.ID}`, { signal: AbortSignal.timeout(3000) })).json();
        const code = /\b([0-9]{6})\b/.exec(body.Text ?? body.HTML ?? "")?.[1];
        if (code) { protect(code); return code; }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("Native Auth verification delivery not found; no secret values printed");
  }
  const signup = { operation: "signup", email, password, full_name: "Camille Example" };
  check((await call({ ...signup, password: "weak" })).status === 422, "Registration rejects weak password before Auth");
  check((await call({ ...signup, role: "owner" })).status === 422, "Registration rejects browser role injection");
  check((await call({ ...signup, redirectTo: "https://attacker.test" })).status === 422, "Registration rejects redirect injection");
  const publicAuth = (await import("@supabase/supabase-js")).createClient(publicUrl, publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const nativeWeak = await publicAuth.auth.signUp({ email: `weak-${randomUUID()}@example.test`, password: "onlylowercaselong" });
  check(!!nativeWeak.error, "Native Auth password configuration rejects direct weak-password signup");
  const registered = await call(signup);
  check(registered.status === 202 && !registered.body.user && !registered.body.session, `Signup returns private generic acknowledgement (${registered.status}/${registered.body.error})`);
  const duplicate = await call(signup);
  check(duplicate.status === 202 && JSON.stringify(duplicate.body) === JSON.stringify(registered.body), "Duplicate signup has identical acknowledgement");
  check((await account(undefined, cookie(registered.headers))).status === 401, "Unverified signup cookies grant no account or workspace access");
  check((await api(base, "/api/auth/login", "", { email, password })).status === 401, "Unverified account cannot log into the provider gateway");
  const userId = adminSql(`select id from auth.users where email='${email}';`).trim();
  check(/^[a-f0-9-]{36}$/.test(userId) && !userId.includes("\n"), "Duplicate attempts create exactly one native Auth identity");
  check(adminSql(`select count(*) from accordly.organizations o join accordly.principals p on p.id=o.created_by where p.auth_user_id='${userId}';`).trim() === "0", "Signup does not provision an authorized workspace");
  const code = await mailCode(email, "Confirm");
  const wrong = code === "000000" ? "000001" : "000000";
  check((await call({ operation: "verify", email, code: wrong, purpose: "signup" })).status === 403, "Incorrect native email code denied");
  const verified = await call({ operation: "verify", email, code, purpose: "signup" });
  check(verified.status === 200 && verified.body.next === "/onboarding", `Native email code verifies registration (${verified.status}/${verified.body.error})`);
  const session = cookie(verified.headers); protect(session);
  check((await call({ operation: "verify", email, code, purpose: "signup" })).status === 403, "Consumed registration code cannot be replayed");
  const initial = await account(undefined, session);
  check(initial.status === 200 && initial.body.step === 2 && !initial.body.completed && initial.body.workspaces.length === 0, "Verified new account starts at work preferences without workspace");
  const interrupted = await fetch(base + "/app", { headers: { cookie: session }, redirect: "manual" });
  check([303,307].includes(interrupted.status) && interrupted.headers.get("location") === "/onboarding", "Incomplete account resumes onboarding from protected app");
  const choice = key("preferences", { full_name: "Camille Example", work_kind: "individual", purpose: "both", expected_revision: initial.body.revision });
  check((await account({ ...choice, owner_id: a.principal }, session)).status === 422, "Onboarding rejects ownership injection");
  const preference = await account(choice, session);
  check(preference.status === 200 && preference.body.revision === "2", "Verified work preferences persist");
  check((await account(choice, session)).body.revision === "2", "Duplicate preference request is idempotent");
  check((await account(undefined, session)).body.step === 3, "Interruption resumes at saved workspace step");
  check((await account(undefined, session)).body.workspaces.length === 0, "Work-purpose selection grants no workspace privilege");
  const complete = key("complete", { expected_revision: "2", workspace_name: "Camille Professional" });
  const completions = await Promise.all([account(complete, session), account(complete, session)]);
  check(completions.every((r) => r.status === 200 && r.body.organization_id === completions[0].body.organization_id), "Concurrent identical onboarding creates one initial workspace");
  const org = completions[0].body.organization_id;
  check((await account({ ...complete, idempotency_key: randomUUID() }, session)).body.organization_id === org, "Refresh with a different key cannot duplicate the initial workspace");
  check((await account({ ...complete, workspace_name: "Conflicting" }, session)).status === 409, "Conflicting completion key rejected");
  const completed = await account(undefined, session);
  check(completed.body.completed && completed.body.selected_workspace_id === org && completed.body.workspaces[0].kind === "individual" && completed.body.workspaces[0].role === "owner", "Individual workspace and initial owner are correctly bound");
  check(adminSql(`select count(*) from accordly.organizations where created_by=(select id from accordly.principals where auth_user_id='${userId}');`).trim() === "1", "Only one workspace committed after retries/concurrency");
  check((await api(base, `/api/provider/${aid}`, session)).status === 404, "Matching the guest email never reveals its historical agreement");
  check((await api(base, "/api/provider", session)).body.agreements.length === 0, "New account has no email-derived historical grants");
  check((await account(key("select_workspace", { organization_id: orgA }), session)).status === 403, "Known foreign organization ID cannot grant membership");
  const dashboard = await fetch(base + "/app", { headers: { cookie: session } });
  const homeHtml = await dashboard.text();
  check(dashboard.status === 200 && homeHtml.includes("Your work, in one flow.") && homeHtml.includes("A clear beginning.") && !homeHtml.includes(aid), "Completed onboarding reaches an empty authorized FlowCanvas workspace");
  check((await api(base, "/api/auth/login", "", { email, password })).body.next === "/app", "Returning user login restores completed workspace path");
  // Recovery has its own HttpOnly Auth cookie namespace and one-use DB grant.
  check([401,403].includes((await call({ operation: "reset", password }, session)).status), "Ordinary authenticated session cannot use recovery-only password route");
  const recovery = await call({ operation: "recover", email });
  const unknown = await call({ operation: "recover", email: `absent-${randomUUID()}@example.test` });
  check(recovery.status === 202 && unknown.status === 202 && JSON.stringify(recovery.body) === JSON.stringify(unknown.body), "Recovery does not disclose whether an account exists");
  const recoveryCode = await mailCode(email, "Recover");
  check((await call({ operation: "verify", email, code: recoveryCode, purpose: "signup" })).status === 403, "Recovery code cannot be redeemed through signup verification");
  const recovered = await call({ operation: "verify", email, code: recoveryCode, purpose: "recovery" });
  check(recovered.status === 200 && recovered.body.next === "/reset-password", `Native recovery code issues scoped recovery session (${recovered.status}/${recovered.body.error})`);
  const recoveryCookie = cookie(recovered.headers); protect(recoveryCookie);
  check(recovered.headers.getSetCookie().filter((c) => !c.includes("Max-Age=0")).every((c) => c.includes("HttpOnly") && c.includes("Secure")), "Recovery cookies are Secure HttpOnly");
  check((await account(undefined, recoveryCookie)).status === 401, "Recovery cookies cannot act as ordinary application login");
  const noProof = recoveryCookie.split("; ").filter((c) => !c.startsWith("__Host-accordly-recovery-proof=")).join("; ");
  const nextPassword = `Bb8!${randomBytes(20).toString("base64url")}`; protect(nextPassword);
  check((await call({ operation: "reset", password: nextPassword }, noProof)).status === 403, "Recovery Auth alone cannot bypass one-use database proof");
  const resets = await Promise.all([call({ operation: "reset", password: nextPassword }, recoveryCookie), call({ operation: "reset", password: nextPassword }, recoveryCookie)]);
  check(resets.filter((r) => r.status === 200).length === 1 && resets.filter((r) => [401,403].includes(r.status)).length === 1, "Concurrent password resets consume exactly one verified recovery proof");
  check([401,403].includes((await call({ operation: "reset", password: nextPassword }, recoveryCookie)).status), "Recovery proof/session cannot be replayed after password change");
  check((await api(base, "/api/auth/login", "", { email, password })).status === 401, "Old password is invalid after actual Auth update");
  password = nextPassword;
  const returned = await api(base, "/api/auth/login", "", { email, password });
  check(returned.status === 200 && returned.body.next === "/app", "Recovered password signs into existing completed workspace");
  const fresh = cookie(returned.headers); protect(fresh);
  const principal = adminSql(`select id from accordly.principals where auth_user_id='${userId}';`).trim();
  await database.query("select accordly_commands.set_membership($1,$2,$3,'viewer',true)", [a.id, orgA, principal]);
  const selection = key("select_workspace", { organization_id: orgA });
  check((await account(selection, fresh)).status === 200, "Account may select another genuinely authorized workspace");
  check((await account(undefined, fresh)).body.selected_workspace_id === orgA, "Last authorized workspace selection persists");
  check((await api(base, "/api/provider", fresh)).body.agreements.length === 0, "Viewer membership alone grants no agreement access");
  await database.query("select accordly_commands.set_membership($1,$2,$3,'viewer',false)", [a.id, orgA, principal]);
  check((await account(selection, fresh)).status === 403, "Revoked membership cannot replay cached selection");
  check((await account(undefined, fresh)).body.selected_workspace_id === org, "Revoked last workspace falls back to another authorized membership");
  await database.query("select accordly_commands.set_membership($1,$2,$3,'owner',true)", [userId, org, b.principal]);
  await database.query("select accordly_commands.set_membership($1,$2,$3,'viewer',false)", [userId, org, principal]);
  check((await account(undefined, fresh)).body.next === "/workspace-unavailable", "Completed account with no membership enters safe unavailable state");
  check((await account({ ...complete, idempotency_key: randomUUID() }, fresh)).status === 403, "Lost membership cannot recreate its initial workspace through retries");
  const businessEmail = `business-${randomUUID()}@example.test`, businessPassword = `Cc7!${randomBytes(20).toString("base64url")}`; protect(businessPassword);
  check((await call({ operation: "signup", full_name: "Business Example", email: businessEmail, password: businessPassword })).status === 202, "Business account uses same secure registration path");
  const businessCode = await mailCode(businessEmail, "Confirm");
  const businessVerify = await call({ operation: "verify", email: businessEmail, code: businessCode, purpose: "signup" });
  check(businessVerify.status === 200, "Business account verifies real native email code");
  const businessCookie = cookie(businessVerify.headers); protect(businessCookie);
  check((await account(key("preferences", { full_name: "Business Example", work_kind: "business", purpose: "review", expected_revision: "1" }), businessCookie)).status === 200, "Business review preference is stored without role claims");
  const business = await account(key("complete", { workspace_name: "Fictional Example Business", expected_revision: "2" }), businessCookie);
  check(business.status === 200 && (await account(undefined, businessCookie)).body.workspaces[0].kind === "business", "Business workspace is created with approved tenant kind");
  check((await account(key("select_workspace", { organization_id: org }), businessCookie)).status === 403, "Business onboarding preserves cross tenant isolation");
  for (const path of ["/register", "/verify", "/recover", "/reset-password", "/auth/help", "/auth/legal", "/auth/error", "/auth/expired"]) {
    const page = await fetch(base + path); const html = await page.text();
    const nonce = page.headers.get("content-security-policy")?.match(/'nonce-([^']+)'/)?.[1];
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)];
    check(!!nonce && scripts.length > 0 && scripts.every(([tag]) => tag.includes(`nonce="${nonce}"`)), `Account screen ${path} gives rendered scripts the request CSP nonce`);
    check(page.status === 200 && !!page.headers.get("content-security-policy")?.includes("nonce-") && page.headers.get("referrer-policy") === "no-referrer" && !html.includes(password), `Account screen ${path} has private rendering and nonce CSP`);
  }
}




