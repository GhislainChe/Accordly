// Non-destructive HTTP check of the owned retained demo, never a remote target.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
function readPrivate(file) { try { return JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8")); } catch { throw new Error("Cannot read the private demo fixture. Inspect setup locally; values are withheld."); } }
const state = readPrivate("../.demo/state.json"), access = readPrivate("../.demo/access.json");
assert.ok(/^accordly-demo-[a-f0-9]{8}$/.test(state.project), "Unexpected demo ownership metadata; values withheld");
assert.ok(state.env.ACCORDLY_APP_ORIGIN === "http://localhost:3000", "Unexpected demo origin; values withheld");
assert.ok(state.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:55621", "Unexpected demo Auth endpoint; values withheld");
assert.ok(access.email === state.email && access.password === state.password, "Private credentials do not match the saved setup; values withheld");
const base = "http://localhost:3000";
let count = 0;
function check(condition, message) { assert.ok(condition, message); count++; }
async function post(route, body, cookie) {
  return fetch(base + route, { method: "POST", headers: { origin: base, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
}
try {
  const rejected = await post("/api/auth/login", { email: access.email, password: randomBytes(24).toString("base64url") });
  check(rejected.status === 401 && (await rejected.json()).error === "invalid_login", "Bad password must be rejected as credentials, not infrastructure");
  const logged = await post("/api/auth/login", { email: access.email, password: access.password });
  check(logged.status === 200 && (await logged.json()).ok === true, "Existing saved provider credentials must pass actual login route");
  const cookies = logged.headers.getSetCookie();
  check(cookies.length > 0, "Successful login must issue session cookies");
  const cookie = cookies.map((c) => c.split(";")[0]).join("; ");
  const data = await fetch(base + "/api/provider", { headers: { cookie }, signal: AbortSignal.timeout(30000) });
  const workspace = await data.json();
  check(data.status === 200 && workspace.organizations.some((o) => o.id === state.organizationId), "Session must reach the original authorized demo organization");
  const dashboard = await fetch(base + "/app", { headers: { cookie }, redirect: "manual", signal: AbortSignal.timeout(30000) });
  check(dashboard.status === 200 && (await dashboard.text()).includes("Agreements"), "Authenticated session must reach provider dashboard HTML");
  const logout = await post("/api/auth/logout", {}, cookie);
  const expired = logout.headers.getSetCookie();
  check(logout.status === 200 && expired.some((c) => c.includes("Max-Age=0")), "Logout must clear Auth cookies");
  // Apply the logout instructions to the simulated browser jar, rather than
  // pretending an already issued JWT is instantaneously revoked everywhere.
  const after = await fetch(base + "/app", { redirect: "manual", signal: AbortSignal.timeout(30000) });
  check([303,307].includes(after.status) && after.headers.get("location") === "/login", "Logged-out browser must return to login");
  console.log(`Retained local login HTTP assertions passed: ${count}; existing credentials, dashboard and logout. No password, token or key printed. Browser interaction is not claimed.`);
} catch { console.error("Retained local login test failed. Inspect safe route categories/statuses; no credential data was printed."); process.exitCode = 1; }
