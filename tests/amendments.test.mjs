import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { amendmentSchema, revisedAmount } from "../src/features/amendments/schemas.ts";
import { signingSchema } from "../src/features/signing/schemas.ts";
import { challengeMac, secret } from "../src/features/signing/crypto.ts";

const draft = { scope: "Logo and five social media templates", terms: "Fictional terms", amount_minor: "100000", currency_code: "XAF", currency_exponent: 0, content_language: "en", deadline: { kind: "date", date: "2027-01-31" }, milestones: [], attachments: [] };
const cmd = { operation: "amendment_create", agreement_id: randomUUID(), base_version_id: randomUUID(), idempotency_key: randomUUID(), payload: { draft, requested_change: "Five templates", reason: "Additional service", delta_minor: "25000", revises_proposal_id: null } };
test("amendment money remains exact for positive, negative, zero and boundary changes", () => {
  assert.equal(revisedAmount("75000", "25000"), "100000");
  assert.equal(revisedAmount("75000", "-25000"), "50000");
  assert.equal(revisedAmount("75000", "0"), "75000");
  assert.equal(revisedAmount("8999999999999999", "1"), "9000000000000000");
  for (const [base, delta] of [["1", "-1"], ["75000", "-75001"], ["9000000000000000", "1"], ["75000", "0.1"], ["75000", "-0"], ["75000", "025000"], ["75000", "+25000"]]) assert.throws(() => revisedAmount(base, delta));
});
test("strict amendment commands reject caller authority, unsupported currency and inconsistent milestones", () => {
  assert.equal(amendmentSchema.safeParse(cmd).success, true);
  assert.equal(amendmentSchema.safeParse({ ...cmd, actor_id: randomUUID() }).success, false);
  assert.equal(amendmentSchema.safeParse({ ...cmd, payload: { ...cmd.payload, delta_minor: 25000 } }).success, false);
  assert.equal(amendmentSchema.safeParse({ ...cmd, payload: { ...cmd.payload, draft: { ...draft, currency_code: "EUR" } } }).success, false);
  assert.equal(amendmentSchema.safeParse({ ...cmd, payload: { ...cmd.payload, draft: { ...draft, milestones: [{ description: "Templates", amount_minor: "25000", deadline: draft.deadline, acceptance_terms: "Approved" }] } } }).success, false);
  assert.equal(amendmentSchema.safeParse({ ...cmd, payload: { ...cmd.payload, reason: "\u0000" } }).success, false);
});
test("approval and rejection schemas require version-bound proof and distinct affirmative decisions", () => {
  const common = { proposal_id: randomUUID(), digest: "ab".repeat(32), proof_id: randomUUID(), proof_secret: secret(), idempotency_key: randomUUID(), consent_text: "Exact disclosure", disclosure_version: "accordly-amendment-v1" };
  assert.equal(signingSchema.safeParse({ operation: "amendment_approval", ...common, affirmative: true, typed_name: "Client" }).success, true);
  assert.equal(signingSchema.safeParse({ operation: "amendment_approval", ...common, affirmative: false, typed_name: "Client" }).success, false);
  assert.equal(signingSchema.safeParse({ operation: "amendment_reject", ...common, reason: "Revise deliverables" }).success, true);
  assert.equal(signingSchema.safeParse({ operation: "amendment_reject", ...common, reason: "Revise", affirmative: true }).success, false);
  const key = secret(), id = randomUUID();
  assert.notEqual(challengeMac(key, id, "amendment_approval", "123456"), challengeMac(key, id, "amendment_rejection", "123456"));
});
