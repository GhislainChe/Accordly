import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { uiContentSecurityPolicy } from "../src/lib/security/csp.ts";
import { errorMessage } from "../src/lib/ui/api.ts";

test("UI CSP permits only nonce scripts in production and blocks external embedding", () => {
  const nonce = randomBytes(16).toString("base64");
  const policy = uiContentSecurityPolicy(nonce, false);
  const scripts = policy.split(";").find((p) => p.includes("script-src"));
  assert.ok(scripts.includes(`'nonce-${nonce}'`));
  assert.ok(scripts.includes("'strict-dynamic'"));
  assert.ok(!scripts.includes("unsafe-inline") && !scripts.includes("unsafe-eval"));
  assert.ok(policy.includes("frame-ancestors 'none'") && policy.includes("form-action 'self'") && policy.includes("object-src 'none'"));
  assert.ok(!policy.includes("https:"));
  assert.ok(uiContentSecurityPolicy(nonce, true).includes("'unsafe-eval'"));
  assert.throws(() => uiContentSecurityPolicy("injected'; https://evil.test", false));
});
test("UI errors are actionable without echoing unknown server details", () => {
  assert.match(errorMessage("invalid_capability"), /expired|revoked/);
  assert.match(errorMessage("signing_disabled"), /disabled/);
  assert.match(errorMessage("conflict"), /Refresh/);
  assert.ok(!errorMessage("postgresql://secret-password@internal/db").includes("secret-password"));
});
