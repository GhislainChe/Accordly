import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as presentation from "../src/components/flowcanvas/presentation.ts";
const require = createRequire(import.meta.url);
function load(relative, imports = {}) {
  const exports = {};
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const customRequire = name => imports[name] ?? (name === "next/link" ? { default: ({ children, ...props }) => createElement("a", props, children) } : require(name));
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: customRequire });
  return exports;
}
const icons = load("../src/components/flowcanvas/icons.tsx");
const preview = load("../src/components/flowcanvas/document-preview.tsx", { "./icons": icons, "./presentation": presentation, "@/components/ui/primitives": { Status: ({ value }) => createElement("span", null, presentation.lifecycleLabels[value]) } });
const rows = [
  { id: "draft-id", organization_id: "alpha", title: "Fictional <script>alert(1)</script>", lifecycle: "preparing", updated_at: "2026-11-13T12:00:00Z" },
  { id: "frozen-id", organization_id: "alpha", title: "Frozen example", lifecycle: "awaiting_signatures", updated_at: "2026-11-13T12:00:00Z" },
  { id: "active-id", organization_id: "alpha", title: "Active example", lifecycle: "active", updated_at: "2026-11-13T12:00:00Z" },
  { id: "foreign-id", organization_id: "beta", title: "Private unrelated tenant", lifecycle: "active", updated_at: "2026-11-13T12:00:00Z" },
];
function render(mode, agreements = rows, role = "owner") {
  const component = load("../src/components/flowcanvas/canvas.tsx", { "./icons": icons, "./presentation": presentation, "./document-preview": preview, "./detail-panel": {}, "next/navigation": { useSearchParams: () => new URLSearchParams(mode ? { mode } : {}) } }).FlowCanvas;
  return renderToStaticMarkup(createElement(component, { limited: false, data: { selected_organization_id: "alpha", organizations: [{ id: "alpha", name: "Fictional studio", status: "active", role }], agreements } }));
}
test("document previews escape hostile titles and distinguish real lifecycles without fabricated clauses", () => {
  const html = render("canvas");
  assert.ok(html.includes("&lt;script&gt;") && !html.includes("<script>alert"));
  assert.match(html, /Awaiting signatures/); assert.match(html, /Active example/);
  assert.ok(!html.includes("Private unrelated tenant") && !html.includes("foreign-id"));
  assert.match(html, /Previews show metadata, not contractual text/);
  assert.equal((html.match(/class="flow-document"/g) ?? []).length, 3);
});
test("zero-agreement, limited Review and denied Create modes have honest actionable states", () => {
  assert.match(render("canvas", []), /A clear beginning/);
  assert.match(render("review"), /A verified personal review queue is not available yet/);
  assert.ok(!render("review").includes("Active example"));
  const denied = render("create", [], "viewer");
  assert.match(denied, /does not permit creating agreements/);
  assert.ok(!denied.includes('href="/app/agreements/new"'));
  const create = render("create");
  assert.match(create, /href="\/app\/agreements\/new"/);
  assert.match(render("explore"), /id="flow-search"/);
});

