import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalize, digest } from "../src/features/agreements/canonical.ts";
import { commandSchema, draftSchema } from "../src/features/agreements/schemas.ts";
import { verifiedIdentity } from "../src/lib/auth/identity-policy.ts";
import { applicationOrigin, databaseConfig } from "../src/lib/db/config.ts";
import { mutationBody, errorResponse } from "../src/lib/security/http.ts";

const id = "00000000-0000-4000-8000-000000000001";
const draft = { scope: "Développement", terms: "Terms unchanged", amount_minor: "9000000000000000", currency_code: "XAF", currency_exponent: 0, content_language: "fr", deadline: { kind: "date", date: "2027-01-31" }, milestones: [], attachments: [] };

test("canonical JSON uses deterministic UTF-16 ordering and ECMAScript primitives", () => {
  assert.equal(canonicalize({ z: "é", a: [true, null, 1e-7, -0] }), '{"a":[true,null,1e-7,0],"z":"é"}');
  assert.equal(canonicalize({ "€": 1, "\r": 2, "😀": 3, "דּ": 4 }), '{"\\r":2,"€":1,"😀":3,"דּ":4}');
  assert.equal(digest({ a: 1, b: "x" }), digest({ b: "x", a: 1 }));
  assert.notEqual(digest({ text: "é" }), digest({ text: "e\u0301" }));
});
test("canonical JSON rejects lossy/non-JSON values and malformed Unicode", () => {
  for (const value of [undefined, NaN, Infinity, BigInt(1), { a: undefined }, new Array(2), "\ud800", "\0"]) assert.throws(() => canonicalize(value));
});
test("draft validation preserves exact XAF integer strings and rejects unsafe money", () => {
  assert.equal(draftSchema.parse(draft).amount_minor, "9000000000000000");
  for (const amount_minor of [1.5, "1.5", "01", "-1", "9000000000000001", "0"]) assert.equal(draftSchema.safeParse({ ...draft, amount_minor }).success, false);
  assert.equal(draftSchema.safeParse({ ...draft, currency_exponent: 2 }).success, false);
});
test("draft validation rejects invalid calendar dates, attachment claims and mismatched milestones", () => {
  assert.equal(draftSchema.safeParse({ ...draft, deadline: { kind: "date", date: "2027-02-31" } }).success, false);
  assert.equal(draftSchema.safeParse({ ...draft, attachments: [{ verified: true }] }).success, false);
  assert.equal(draftSchema.safeParse({ ...draft, milestones: [{ description: "x", amount_minor: "1", deadline: draft.deadline, acceptance_terms: "x" }] }).success, false);
});
test("commands reject actor, role, ownership, canonical-byte and signature injection", () => {
  const valid = { operation: "create_draft", resource_id: id, idempotency_key: id, input: { title: "Project", draft } };
  assert.equal(commandSchema.safeParse(valid).success, true);
  for (const field of ["actor_id", "verified_auth_user_id", "role", "canonical_text", "signature"]) assert.equal(commandSchema.safeParse({ ...valid, [field]: id }).success, false);
  assert.equal(commandSchema.safeParse({ ...valid, input: { ...valid.input, organization_id: id } }).success, false);
});
test("identity policy requires a live successful registered, confirmed Auth result", () => {
  const user = { id, email: "owner@example.test", email_confirmed_at: "2026-11-10T00:00:00Z", role: "authenticated", aud: "authenticated", is_anonymous: false };
  assert.equal(verifiedIdentity(user, null).authUserId, id);
  for (const bad of [null, { ...user, is_anonymous: true }, { ...user, email_confirmed_at: null }, { ...user, role: "service_role" }]) assert.throws(() => verifiedIdentity(bad, null));
  assert.throws(() => verifiedIdentity(user, new Error("Auth unavailable")));
});
test("database configuration fails closed on privileged users and SSL override parameters", () => {
  for (const url of ["", "postgresql://postgres@localhost/postgres", "postgresql://accordly_gateway@localhost/postgres?sslmode=disable", "postgresql://accordly_gateway@localhost/other"]) assert.throws(() => databaseConfig({ ACCORDLY_DATABASE_URL: url }));
  const config = databaseConfig({ ACCORDLY_DATABASE_URL: "postgresql://accordly_gateway@localhost/postgres" });
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.throws(() => databaseConfig({ NODE_ENV: "production", ACCORDLY_DATABASE_URL: "postgresql://accordly_gateway@localhost/postgres", ACCORDLY_DATABASE_ALLOW_LOCAL_PLAINTEXT: "true" }));
  assert.throws(() => databaseConfig({ NODE_ENV: "development", ACCORDLY_DATABASE_URL: "postgresql://accordly_gateway@remote.test/postgres", ACCORDLY_DATABASE_ALLOW_LOCAL_PLAINTEXT: "true" }));
});
test("origin configuration rejects noncanonical origins and production HTTP", () => {
  assert.equal(applicationOrigin({ ACCORDLY_APP_ORIGIN: "https://accordly.example.test", NODE_ENV: "production" }), "https://accordly.example.test");
  for (const origin of ["https://accordly.example.test/", "https://user:secret@accordly.example.test", "http://accordly.example.test", ""]) assert.throws(() => applicationOrigin({ ACCORDLY_APP_ORIGIN: origin, NODE_ENV: "production" }));
});
test("HTTP mutation boundary enforces origin, JSON content type and actual byte limits", async () => {
  const previous = process.env.ACCORDLY_APP_ORIGIN;
  process.env.ACCORDLY_APP_ORIGIN = "https://accordly.example.test";
  try {
    const request = (origin, body = "{}", type = "application/json") => new Request("https://accordly.example.test/api/agreements/commands", { method: "POST", headers: { origin, "content-type": type }, body });
    assert.deepEqual(await mutationBody(request(process.env.ACCORDLY_APP_ORIGIN)), {});
    await assert.rejects(mutationBody(request("https://attacker.example.test")), { status: 403 });
    await assert.rejects(mutationBody(request(process.env.ACCORDLY_APP_ORIGIN, "{}", "text/plain")), { status: 415 });
    await assert.rejects(mutationBody(request(process.env.ACCORDLY_APP_ORIGIN, "x".repeat(131073))), { status: 413 });
    await assert.rejects(mutationBody(request(process.env.ACCORDLY_APP_ORIGIN, "{")), { status: 400 });
    await assert.rejects(mutationBody(request(process.env.ACCORDLY_APP_ORIGIN, '{"a":1,"\\u0061":2}')), { status: 400 });
    await assert.rejects(mutationBody(request(process.env.ACCORDLY_APP_ORIGIN, "[".repeat(26)+"0"+"]".repeat(26))), { status: 400 });
    assert.deepEqual(await mutationBody(request(process.env.ACCORDLY_APP_ORIGIN, '{"a":[{},[],"text\\\"x",true,null]}')), { a: [{}, [], 'text"x', true, null] });
  } finally { if (previous === undefined) delete process.env.ACCORDLY_APP_ORIGIN; else process.env.ACCORDLY_APP_ORIGIN = previous; }
});
test("raw database errors and credentials never enter HTTP error bodies", async () => {
  const response = errorResponse({ code: "XX000", message: "private token and connection URI" });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "gateway_unavailable" });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});
