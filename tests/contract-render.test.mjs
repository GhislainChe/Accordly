import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

test("contract rendering preserves exact text/money and escapes hostile contractual content", () => {
  const require = createRequire(import.meta.url), exports = {};
  const source = readFileSync(new URL("../src/components/contract-view.tsx", import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require, BigInt });
  const snapshot = { title: "Fictional <script>alert('x')</script>", version_number: "1", version_id: "frozen-version", agreement_id: "agreement", organization_id: "org", schema_version: 1, canonicalization_version: 1, content_language: "fr", amount_minor: "9000000000000000", currency_code: "XAF", currency_exponent: 0, scope: "Exact é\nsecond line", terms: "<img src=x onerror=alert(1)>", deadline: { kind: "date", date: "2027-01-31" }, milestones: [], attachments: [], parties: [{ id: "party", side: "client", legal_name: "Fictional client", contact_email: "client@example.test", representatives: [{ id: "rep", display_name: "Required signer", expected_email: "client@example.test", required: true }] }], consent_text: "Explicit frozen consent.", disclosure_version: "test-v1" };
  const canonicalText = JSON.stringify(snapshot);
  const html = renderToStaticMarkup(exports.ContractView({ snapshot, digest: "ab".repeat(32), canonicalText }));
  assert.ok(html.includes("9,000,000,000,000,000"));
  assert.ok(html.includes("2027-01-31") && html.includes("date only"));
  assert.ok(html.includes("Exact é\nsecond line"));
  assert.ok(html.includes("Required signer") && html.includes("Explicit frozen consent."));
  assert.ok(html.includes("French controls") && html.includes("ab".repeat(32)));
  assert.ok(html.includes("&lt;script&gt;") && html.includes("&lt;img"));
  assert.ok(!html.includes("<script>") && !html.includes("<img src=x"));
});
