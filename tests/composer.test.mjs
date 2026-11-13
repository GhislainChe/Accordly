import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as model from "../src/components/composer/model.ts";
import { draftSchema } from "../src/features/agreements/schemas.ts";
const require = createRequire(import.meta.url);
function load(relative, imports = {}) {
  const exports = {};
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: name => imports[name] ?? (name.endsWith(".css") ? {} : require(name)), BigInt });
  return exports;
}
const preview = load("../src/components/composer/document-preview.tsx", { "./model": model });
const draft = { scope: "Exact agreed scope é\nDeliverable two", terms: "Payment after acceptance. <script>unsafe()</script>", amount_minor: "75000", currency_code: "XAF", currency_exponent: 0, content_language: "en", deadline: { kind: "date", date: "2027-01-31" }, milestones: [], attachments: [] };
test("composer accepts existing canonical fields and exact milestone allocation without mutating its input", () => {
  const value = { ...draft, milestones: [{ description:"First", amount_minor:"50000", deadline:draft.deadline, acceptance_terms:"Agreed first delivery" }, { description:"Second", amount_minor:"25000", deadline:draft.deadline, acceptance_terms:"Agreed second delivery" }] };
  const before = JSON.stringify(value);
  assert.deepEqual(model.composerErrors(value, "Title"), {});
  assert.deepEqual(draftSchema.parse(value), value);
  assert.equal(JSON.stringify(value), before);
  assert.match(model.composerErrors({ ...value, amount_minor:"100000" }, "Title").milestones, /exactly/);
});
test("composer rejects unsafe money and ambiguous deadlines without rounding or inventing dates", () => {
  assert.equal(model.exactXaf("9000000000000000"), "9,000,000,000,000,000 XAF");
  for (const value of ["1.5", "01", "-1", "1e4", "9000000000000001", ""]) assert.equal(model.exactXaf(value), null);
  for (const date of ["2027-02-31", "", "0000-01-01"]) assert.equal(model.validDeadline({kind:"date", date}), false);
  assert.equal(model.validDeadline({kind:"instant", at:"2027-02-01T13:04:05.123Z", timezone:"Africa/Douala"}), true);
  assert.equal(model.validDeadline({kind:"instant", at:"2027-02-01T13:04:05.123Z", timezone:"Invalid/Zone"}), false);
  assert.ok(model.composerErrors(model.emptyDraft(), "").title);
  assert.ok(model.composerErrors({ ...draft, amount_minor:"0" }, "Title").amount);
});
test("live preview faithfully renders text, party input and milestones while remaining explicitly unsigned", () => {
  const html = renderToStaticMarkup(createElement(preview.AgreementPreview, { title:"Title <img src=x>", draft:{...draft, milestones:[{description:"Agreed deliverable",amount_minor:"75000",deadline:draft.deadline,acceptance_terms:"Exact acceptance text"}]}, parties:[{side:"client",legal_name:"Fictional client",contact_email:"client@example.test",signer:"Client signer"}] }));
  for (const text of ["DRAFT / NOT SIGNED", "75,000 XAF", "Exact agreed scope é\nDeliverable two", "Exact acceptance text", "2027-01-31", "Client signer", "Fictional client"]) assert.ok(html.includes(text));
  assert.ok(html.includes("&lt;script&gt;") && html.includes("&lt;img"));
  assert.ok(!html.includes("<script>") && !html.includes("<img src=x"));
  assert.match(html, /No version number or digest exists until/);
  assert.ok(!html.includes("Version 1") && !html.includes("Signed ✓"));
});
test("empty studio keeps missing content honest and prevents accidental submission controls", () => {
  const composer = load("../src/components/composer/agreement-composer.tsx", { "./model":model, "./document-preview":preview, "./use-unsaved":{useUnsavedChanges:()=>({release(){},pending:false,stay(){},leave(){}})} }).AgreementComposer;
  const html = renderToStaticMarkup(createElement(composer, {create:true,busy:false,onSave:async()=>true}));
  assert.match(html, /Untitled agreement/); assert.match(html, /No clauses are added automatically/);
  assert.match(html, /Not saved yet/); assert.match(html, /type="button"[^>]*>\+ Add milestone/);
  assert.match(html, /aria-label="Composer view"/); assert.match(html, /Save draft/);
  assert.ok(!html.includes("Freeze agreement") && !html.includes("localStorage"));
});
