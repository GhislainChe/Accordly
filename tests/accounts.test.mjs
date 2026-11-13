import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { authAccountSchema, onboardingSchema, passwordSchema } from "../src/features/accounts/schemas.ts";
import { accountConfig } from "../src/features/accounts/config.ts";
import { versionPresentation } from "../src/features/amendments/presentation.ts";
test("registration validates name/email/password and rejects authority or redirect overrides", () => {
  const c = { operation: "signup", full_name: "Alex Example", email: "ALEX@example.test", password: "A-strong-pass-123" };
  assert.equal(authAccountSchema.parse(c).email, "alex@example.test");
  for (const extra of [{ role: "owner" }, { organization_id: randomUUID() }, { redirectTo: "https://evil.test" }, { verified: true }]) assert.equal(authAccountSchema.safeParse({ ...c, ...extra }).success, false);
  for (const password of ["short", "longbutonlylowercase", "Missing-number!", "MissingSymbol123", "Aa123456789é", "A1!" + "Ã©".repeat(36), "Aa9!\u0000morepassword"]) assert.equal(passwordSchema.safeParse(password).success, false);
  assert.equal(authAccountSchema.safeParse({ ...c, full_name: "  " }).success, false);
});
test("onboarding choices cannot assert identity, membership roles, completion or ownership", () => {
  const p = { operation: "preferences", full_name: "Alex", work_kind: "individual", purpose: "both", expected_revision: "1", idempotency_key: randomUUID() };
  assert.ok(onboardingSchema.safeParse(p).success);
  for (const field of ["actor_id", "role", "owner_id", "completed_at"]) assert.equal(onboardingSchema.safeParse({ ...p, [field]: randomUUID() }).success, false);
  assert.equal(onboardingSchema.safeParse({ ...p, purpose: "admin" }).success, false);
  assert.equal(onboardingSchema.safeParse({ operation: "complete", workspace_name: "Professional", expected_revision: "2", idempotency_key: randomUUID(), organization_id: randomUUID() }).success, false);
});
test("account Auth enablement fails closed outside approved local hosts or with reused keys", () => {
  const key = () => randomBytes(32).toString("base64url");
  const env = { NODE_ENV: "production", ACCORDLY_ACCOUNTS_MODE: "local-test", ACCORDLY_AUTH_RATE_KEY: key(), ACCORDLY_APP_ORIGIN: "https://localhost", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55521", ACCORDLY_DATABASE_URL: "postgresql://accordly_gateway@localhost/postgres" };
  assert.equal(accountConfig(env).origin, "https://localhost");
  for (const change of [{ ACCORDLY_ACCOUNTS_MODE: "production" }, { ACCORDLY_AUTH_RATE_KEY: "short" }, { NEXT_PUBLIC_SUPABASE_URL: "https://external.supabase.co" }, { ACCORDLY_APP_ORIGIN: "https://external.test" }, { ACCORDLY_SIGNING_RATE_KEY: env.ACCORDLY_AUTH_RATE_KEY }]) assert.throws(() => accountConfig({ ...env, ...change }));
});
test("history presentation distinguishes current effective and previously effective without rewriting state", () => {
  const historical = { state: "effective", version_id: "v1" };
  assert.equal(versionPresentation(historical.state, historical.version_id, "v2"), "historical_effective");
  assert.equal(versionPresentation("effective", "v2", "v2"), "current_effective");
  assert.equal(versionPresentation("pending", "v3", "v2"), "pending");
  assert.equal(versionPresentation("superseded", "v3", "v2"), "superseded");
  assert.equal(historical.state, "effective");
});
