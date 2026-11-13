import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { parsePrivateInvitation, consumePrivateFragment } from "../src/features/signing/invitation-entry.ts";

test("invitation entry accepts only a valid fragment or same-origin private link", () => {
  const invitation_id = randomUUID(), token = randomBytes(32).toString("base64url"), fragment = `${invitation_id}.${token}`, origin = "http://localhost:3000";
  assert.deepEqual(parsePrivateInvitation(fragment, origin), { invitation_id, token });
  assert.deepEqual(parsePrivateInvitation(`${origin}/invite#${fragment}`, origin), { invitation_id, token });
  for (const invalid of [`https://foreign.example/invite#${fragment}`, `${origin}/invite?token=leak#${fragment}`, `${origin}/app#${fragment}`, `${invitation_id}.short`, "malformed", ""]) assert.equal(parsePrivateInvitation(invalid, origin), null);
});
test("URL cleanup removes fragment and query material synchronously before reuse", () => {
  const calls = [], location = { pathname: "/invite", search: "?untrusted=secret", hash: "#private-secret" };
  const result = consumePrivateFragment(location, { replaceState: (...args) => calls.push(args) });
  assert.equal(result, "private-secret");
  assert.deepEqual(calls, [[null, "", "/invite"]]);
  assert.ok(!JSON.stringify(calls).includes("secret"));
});
