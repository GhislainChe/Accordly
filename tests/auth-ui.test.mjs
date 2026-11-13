import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(relative, imports = {}) {
  const exports = {};
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const customRequire = name => imports[name] ?? (name === "next/link" ? { default: ({ children, ...props }) => createElement("a", props, children) } : require(name));
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: customRequire });
  return exports;
}
const ui = load("../src/components/auth/ui.tsx");
const navigation = { useRouter: () => ({ replace() {}, refresh() {} }) };
const api = { request() { throw new Error("Rendering must not perform network requests"); }, useAction: () => ({ busy: false, error: "", message: "" }), useIdempotency: () => value => value };
const forms = load("../src/components/account-forms.tsx", { "./auth/ui": ui, "./ui/primitives": {}, "next/navigation": navigation, "@/lib/ui/api": api });
const html = (Component, props) => renderToStaticMarkup(createElement(Component, props));

test("registration requires confirmed passwords and exposes legal/OAuth blockers honestly", () => {
  const output = html(forms.AccountEntry, { mode: "signup", enabled: true });
  assert.match(output, /Create your account\./);
  assert.match(output, /Step 1 of 3/);
  assert.match(output, /name="confirm_password"/);
  assert.match(output, /autoComplete="new-password"/);
  assert.match(output, /aria-label="Show confirm password"/);
  assert.match(output, /Legal agreement cannot yet be collected/);
  assert.match(output, /href="\/auth\/legal#privacy"/);
  assert.match(output, /disabled=""[^>]*>Sign up/);
});

test("verification and recovery are separate from numbered onboarding and fail closed", () => {
  for (const mode of ["verify", "recover", "reset"]) {
    const output = html(forms.AccountEntry, { mode, enabled: false });
    assert.ok(!output.includes("Registration progress"));
    assert.match(output, /Registration and recovery are unavailable/);
    assert.match(output, /disabled=""/);
  }
  assert.match(html(forms.AccountEntry, { mode: "verify", enabled: true }), /autoComplete="one-time-code"/);
});

test("onboarding exposes native keyboard-accessible choices without role or owner fields", () => {
  const initial = { full_name: "Fictional professional", work_kind: "individual", purpose: "both", revision: "1", completed: false, workspaces: [], step: 2 };
  const output = html(forms.OnboardingForm, { initial, suggestedName: "" });
  assert.equal((output.match(/type="radio"/g) ?? []).length, 5);
  assert.equal((output.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(output, /Tell us about your work\./);
  assert.ok(!output.includes('name="owner"') && !output.includes('name="role"'));
  assert.ok(!output.includes('name="full_name"'));
  const workspace = html(forms.OnboardingForm, { initial: { ...initial, step: 3 }, suggestedName: "" });
  assert.match(workspace, /Professional display name/);
  assert.match(workspace, /Finish setup/);
  assert.ok(!workspace.includes("Business or organization name"));
});

test("sign-in verification help is contextual and cannot disclose account existence", () => {
  const imports = { "./auth/ui": ui, "next/navigation": navigation, "@/lib/ui/api": api };
  const normal = html(load("../src/components/auth-controls.tsx", imports).LoginForm);
  assert.ok(!normal.includes('href="/verify"'));
  assert.match(normal, /Sign in with Google/);
  const failed = html(load("../src/components/auth-controls.tsx", { ...imports, "@/lib/ui/api": { ...api, useAction: () => ({ busy: false, error: "Generic sign-in error", message: "" }) } }).LoginForm);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /auth-context-help/);
  assert.match(failed, /href="\/verify"/);
  assert.match(failed, /does not check whether an account exists/);
});
