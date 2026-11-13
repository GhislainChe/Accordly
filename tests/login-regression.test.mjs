import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { developmentMode } from "../scripts/development-mode.mjs";
import { checkDemoAuth } from "../scripts/demo-startup.mjs";
import { supportsNode, developmentNode } from "../scripts/node-runtime.mjs";
import { authLoginFailure, loginDiagnostic } from "../src/lib/auth/login-policy.ts";
import { GatewayError, safeGatewayError } from "../src/lib/security/errors.ts";
import { errorMessage } from "../src/lib/ui/api.ts";

test("ordinary dev loads a saved demo only when no explicit application configuration exists", () => {
  const root = mkdtempSync(path.join(tmpdir(), "accordly-dev-mode-"));
  try {
    assert.equal(developmentMode(root, {}), "app");
    assert.throws(() => developmentNode(root, {}, "20.20.1"), /requires Node 22.18/);
    mkdirSync(path.join(root, ".demo")); writeFileSync(path.join(root, ".demo", "state.json"), JSON.stringify({ project: "accordly-demo-1234abcd", nodeExecutable: process.execPath }));
    assert.equal(developmentNode(root, {}, "20.20.1"), process.execPath);
    assert.equal(developmentMode(root, {}), "demo");
    assert.equal(developmentMode(root, { NEXT_PUBLIC_SUPABASE_URL: "https://explicit.example" }), "app");
    assert.equal(developmentMode(root, { ACCORDLY_APP_ORIGIN: "" }), "app");
    writeFileSync(path.join(root, ".env.local"), "");
    assert.equal(developmentMode(root, {}), "app");
    assert.equal(developmentMode(root, { ACCORDLY_DEV_MODE: "demo" }), "demo");
    assert.throws(() => developmentMode(root, { NODE_ENV: "production" }));
    assert.throws(() => developmentMode(root, { ACCORDLY_DEV_MODE: "guess" }));
    writeFileSync(path.join(root, ".demo", "state.json"), "private-secret-not-json");
    assert.throws(() => developmentNode(root, {}, "20.20.1"), (error) => error.message.includes("unreadable") && !error.message.includes("private-secret"));
  } finally {
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(root).startsWith("accordly-dev-mode-")) throw new Error("Refusing to remove unexpected fixture directory");
    rmSync(root, { recursive: true, force: true });
  }
});
test("unsupported Node is rejected instead of serving a broken Auth client", () => {
  for (const version of ["20.20.1", "22.17.0", "invalid"]) assert.equal(supportsNode(version), false);
  for (const version of ["22.18.0", "24.22.1", "v24.22.1"]) assert.equal(supportsNode(version), true);
});
test("demo startup preflight refuses remote targets and distinguishes unavailable Auth from stale keys", async () => {
  const env = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55621", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_fixture_only", ACCORDLY_APP_ORIGIN: "http://localhost:3000" };
  let calls = 0;
  const healthy = async (url, options) => { calls++; assert.equal(url, env.NEXT_PUBLIC_SUPABASE_URL + "/auth/v1/health"); assert.equal(options.redirect, "error"); return { ok: true }; };
  await checkDemoAuth(env, healthy); assert.equal(calls, 1);
  await assert.rejects(checkDemoAuth({ ...env, NEXT_PUBLIC_SUPABASE_URL: "https://remote.example" }, healthy), /configuration is invalid/); assert.equal(calls, 1);
  await assert.rejects(checkDemoAuth(env, async () => { throw new Error("sensitive network details"); }), /unreachable/);
  await assert.rejects(checkDemoAuth(env, async () => ({ ok: false, status: 401 })), /key is no longer accepted/);
});
test("login failure policy separates credentials, throttling, transport and unknown exceptions", () => {
  assert.equal(authLoginFailure({ name: "AuthApiError", status: 400, code: "invalid_credentials" }).code, "invalid_login");
  assert.equal(authLoginFailure({ status: 429 }).status, 429);
  assert.equal(authLoginFailure({ name: "AuthApiError", status: 401, code: "invalid_api_key" }).code, "auth_configuration_required");
  for (const e of [{ name: "AuthRetryableFetchError" }, { status: 0 }, { status: 503 }, { name: "AuthUnknownError" }]) assert.equal(authLoginFailure(e).code, "auth_unavailable");
  assert.equal(loginDiagnostic(new GatewayError(503, "origin_configuration_required")).category, "configuration");
  assert.equal(loginDiagnostic(new Error("password-and-secret-that-must-never-appear")).category, "application_exception");
  assert.ok(!JSON.stringify(loginDiagnostic(new Error("password-and-secret-that-must-never-appear"))).includes("password-and-secret"));
  assert.equal(safeGatewayError(new GatewayError(503, "auth_configuration_required", "safe instructions")).code, "auth_configuration_required");
  assert.match(errorMessage("origin_configuration_required"), /npm run demo/);
  assert.match(errorMessage("auth_unavailable"), /authentication service/);
});
