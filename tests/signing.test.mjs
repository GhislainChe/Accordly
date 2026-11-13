import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { signingConfig } from "../src/features/signing/config.ts";
import { signingSchema } from "../src/features/signing/schemas.ts";
import { secret, code, credentialDigest, challengeMac, rateDigest } from "../src/features/signing/crypto.ts";

test("signing defaults disabled and cannot enable for external deployment", () => {
  const env = { NODE_ENV: "production", ACCORDLY_SIGNING_MODE: "local-test", ACCORDLY_APP_ORIGIN: "https://localhost", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55521", ACCORDLY_DATABASE_URL: "postgresql://accordly_gateway@localhost/postgres", ACCORDLY_CHALLENGE_HMAC_KEY: secret(), ACCORDLY_SIGNING_RATE_KEY: secret(), ACCORDLY_CHALLENGE_KEY_ID: "test-v1", ACCORDLY_LOCAL_MAILBOX: path.resolve("mailbox-fixture") };
  assert.equal(signingConfig(env).origin, "https://localhost");
  for (const change of [{ ACCORDLY_SIGNING_MODE: "production" }, { ACCORDLY_SIGNING_MODE: undefined }, { NEXT_PUBLIC_SUPABASE_URL: "https://external.supabase.co" }, { ACCORDLY_DATABASE_URL: "postgresql://accordly_gateway@external.example/postgres" }, { ACCORDLY_APP_ORIGIN: "https://accordly.example" }, { ACCORDLY_SIGNING_RATE_KEY: env.ACCORDLY_CHALLENGE_HMAC_KEY }, { ACCORDLY_LOCAL_MAILBOX: "relative/path" }]) {
    assert.throws(() => signingConfig({ ...env, ...change }), /signing_disabled/);
  }
});
test("credential hashes and short-code HMACs are domain and challenge separated", () => {
  const id = randomUUID(), token = secret(), key = secret();
  assert.match(token, /^[a-zA-Z0-9_-]{43}$/);
  assert.match(code(), /^\d{6}$/);
  const hash = credentialDigest("invitation", id, token);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, credentialDigest("session", id, token));
  assert.notEqual(hash, credentialDigest("invitation", randomUUID(), token));
  const mac = challengeMac(key, id, "access", "012345");
  assert.notEqual(mac, challengeMac(key, id, "initial_signature", "012345"));
  assert.notEqual(mac, challengeMac(key, randomUUID(), "access", "012345"));
  assert.notEqual(mac, challengeMac(secret(), id, "access", "012345"));
  assert.notEqual(mac, challengeMac(key, id, "access", "012346"));
  assert.equal(rateDigest(key, "person@example.test"), rateDigest(key, "person@example.test"));
  assert.ok(!hash.includes(token));
});
test("signing schema rejects identity overrides and implicit or altered consent", () => {
  const command = { operation: "initial_signature", proposal_id: randomUUID(), digest: "ab".repeat(32), proof_id: randomUUID(), proof_secret: randomBytes(32).toString("base64url"), affirmative: true, typed_name: "Invited signer", consent_text: "Exact frozen disclosure", disclosure_version: "accordly-consent-v1", idempotency_key: randomUUID() };
  assert.equal(signingSchema.safeParse(command).success, true);
  for (const change of [{ affirmative: false }, { affirmative: undefined }, { actor_id: randomUUID() }, { role: "owner" }, { session_id: randomUUID() }, { typed_name: " \t" }, { digest: "AB".repeat(32) }, { proof_secret: "short" }, { typed_name: "bad\u0000name" }]) assert.equal(signingSchema.safeParse({ ...command, ...change }).success, false);
  assert.equal(signingSchema.safeParse({ operation: "read", agreement_id: randomUUID() }).success, false);
  assert.equal(signingSchema.safeParse({ operation: "verify_access", invitation_id: randomUUID(), token: secret(), challenge_id: randomUUID(), code: "12345" }).success, false);
});
