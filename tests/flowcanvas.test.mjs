import test from "node:test";
import assert from "node:assert/strict";
import { selectedWorkspace, visibleAgreements, canvasMode, currentVersion, exactAmount } from "../src/components/flowcanvas/presentation.ts";

const rows = [
  { id: "draft", organization_id: "alpha", title: "Logo draft", lifecycle: "preparing" },
  { id: "pending", organization_id: "alpha", title: "Logo approval", lifecycle: "awaiting_signatures" },
  { id: "active", organization_id: "alpha", title: "Brand identity", lifecycle: "active" },
  { id: "foreign", organization_id: "beta", title: "Other tenant", lifecycle: "active" },
];
test("workspace projection never combines tenants or treats a missing selection as all tenants", () => {
  const data = { selected_organization_id: "alpha", organizations: [], agreements: rows };
  assert.deepEqual(selectedWorkspace(data).agreements.map(a => a.id), ["draft", "pending", "active"]);
  assert.deepEqual(selectedWorkspace({ ...data, selected_organization_id: null }).agreements, []);
  assert.deepEqual(selectedWorkspace({ ...data, selected_organization_id: "missing" }).agreements, []);
});
test("Explore filters saved titles and real states; Review is only lifecycle filtering", () => {
  const authorized = rows.slice(0,3);
  assert.deepEqual(visibleAgreements(authorized, "explore", "  LOGO  ", "preparing").map(a => a.id), ["draft"]);
  assert.deepEqual(visibleAgreements(authorized, "review", "", "all").map(a => a.id), ["pending"]);
  assert.equal(visibleAgreements(authorized, "explore", "not found", "all").length, 0);
  assert.equal(canvasMode("https://evil.test"), "canvas");
  assert.equal(canvasMode("review"), "review");
});
test("effective pointer wins over a later pending version; stale pointers never silently select another version", () => {
  const v1 = { id: "v1", version_number: "1" }, v2 = { id: "v2", version_number: "2" }, pending = { id: "v3", version_number: "3" };
  const data = { lifecycle: "active", effective_version_id: "v2", effective_version: null, versions: [v1,v2,pending] };
  assert.equal(currentVersion(data), v2);
  assert.equal(currentVersion({ ...data, effective_version_id: "missing" }), undefined);
  assert.equal(currentVersion({ ...data, effective_version_id: null, lifecycle: "preparing" }), undefined);
  assert.equal(currentVersion({ ...data, effective_version_id: null, lifecycle: "awaiting_signatures" }), pending);
});
test("preview amounts retain XAF and future currency precision without floating point", () => {
  assert.equal(exactAmount("75000", "XAF", 0), "75,000 XAF");
  assert.equal(exactAmount("100000", "XAF", 0), "100,000 XAF");
  assert.equal(exactAmount("900719925474099301", "USD", 2), "9,007,199,254,740,993.01 USD");
  assert.equal(exactAmount("-25000", "XAF", 0), "−25,000 XAF");
  assert.equal(exactAmount("0", "XAF", 0), "0 XAF");
  assert.equal(exactAmount("1.5", "XAF", 0), "Amount unavailable");
});
