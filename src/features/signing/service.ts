import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { cookies } from "next/headers";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { verifiedIdentity } from "@/lib/auth/identity-policy";
import { gatewayTransaction } from "@/lib/db/gateway";
import { GatewayError } from "@/lib/security/errors";
import { canonicalize, digest as snapshotDigest } from "@/features/agreements/canonical";
import { signingConfig } from "./config.ts";
import { signingSchema, sessionCookieSchema } from "./schemas.ts";
import { secret, code, credentialDigest, challengeMac, rateDigest } from "./crypto.ts";

const cookieName = "__Host-accordly-party";
export async function optionalRegisteredIdentity() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (!data.user && error?.name === "AuthSessionMissingError") return null;
  const actor = verifiedIdentity(data.user, error);
  const claims = await supabase.auth.getClaims();
  const sid = z.uuid().safeParse(claims.data?.claims.session_id);
  if (claims.error || claims.data?.claims.sub !== actor.authUserId || !sid.success) throw new GatewayError(401, "authentication_required");
  return { ...actor, sessionId: sid.data };
}

export async function signingOperation(raw: unknown) {
  const config = signingConfig(process.env); // No deployed production transport/control bypass.
  const parsed = signingSchema.safeParse(raw);
  if (!parsed.success) throw new GatewayError(422, "invalid_command");
  const command = parsed.data;
  const actor = await optionalRegisteredIdentity();
  const issuer = ["invite", "invite_access", "invite_amendment", "revoke_invitation", "list_slots"].includes(command.operation);
  if (issuer && !actor) throw new GatewayError(401, "authentication_required");
  const jar = await cookies();
  const cookie = sessionCookieSchema.safeParse(jar.get(cookieName)?.value);
  const internal: Record<string, string> = {};
  if (cookie.success) {
    const [id, value] = cookie.data.split(".");
    internal.session_id = id; internal.session_digest = credentialDigest("session", id, value);
  }
  if (!issuer && !["start_access", "verify_access"].includes(command.operation) && !cookie.success) throw new GatewayError(401, "party_session_required");
  const invitationId = randomUUID(); const sessionId = randomUUID(); const proofId = randomUUID();
  const value = secret(); const challengeId = randomUUID(); const otp = code();
  const input: Record<string, unknown> = { ...command };
  delete input.operation;
  if ("token" in command) {
    internal.token_digest = credentialDigest("invitation", command.invitation_id, command.token); delete input.token;
  }
  if (["invite", "invite_access", "invite_amendment"].includes(command.operation)) {
    internal.invitation_id = invitationId; internal.token_digest = credentialDigest("invitation", invitationId, value);
  }
  if (command.operation.startsWith("start_")) {
    internal.challenge_id = challengeId;
    internal.code_hmac = challengeMac(config.key, challengeId, command.operation === "start_access" ? "access" : "action" in command ? command.action ?? "initial_signature" : "initial_signature", otp);
    internal.key_id = config.keyId;
  }
  if ("code" in command) {
    internal.code_hmac = challengeMac(config.key, command.challenge_id, command.operation === "verify_access" ? "access" : "action" in command ? command.action ?? "initial_signature" : "initial_signature", command.code);
    internal.key_id = config.keyId; delete input.code;
  }
  if (command.operation === "verify_access") {
    internal.session_id = sessionId; internal.session_digest = credentialDigest("session", sessionId, value);
  }
  if (command.operation === "verify_consent") {
    internal.proof_id = proofId; internal.proof_digest = credentialDigest("proof", proofId, value);
  }
  if (command.operation === "initial_signature" || command.operation === "amendment_approval" || command.operation === "amendment_reject") {
    internal.proof_digest = credentialDigest("proof", command.proof_id, command.proof_secret); delete input.proof_secret;
  }
  async function rate(buckets: string[], send: boolean) {
    const allowed = await gatewayTransaction(async (db) => (await db.query("select accordly_commands.signing_rate_limit($1,$2) as allowed", [buckets, send])).rows[0]?.allowed);
    if (!allowed) throw new GatewayError(429, "rate_limited");
  }
  // A shared DB counter covers all instances. Local-only runtime has one
  // conservative ingress bucket; never trust X-Forwarded-For from a browser.
  await rate(["global:local", "ip:local"], false);
  if (command.operation.startsWith("start_")) await rate(["global:local", "ip:local", `invitation:${"invitation_id" in command ? command.invitation_id : internal.session_id}`], true);
  const result = await gatewayTransaction(async (db) => {
    const response = await db.query("select accordly_commands.signing_command($1,$2,$3,$4,$5::jsonb,$6::jsonb) as result", [actor?.authUserId ?? null, actor?.email ?? null, actor?.sessionId ?? null, command.operation, JSON.stringify(input), JSON.stringify(internal)]);
    const result = response.rows[0]?.result;
    if (!result || typeof result !== "object") throw new GatewayError(503, "invalid_database_response");
    if (command.operation === "read" && !result.error) {
      const snapshot = JSON.parse(result.canonical_text);
      if (canonicalize(snapshot) !== result.canonical_text || snapshotDigest(snapshot) !== result.digest) throw new GatewayError(503, "snapshot_integrity_error");
    }
    return result;
  });
  // Verification failures must commit counters; convert to HTTP errors only AFTER COMMIT.
  if (result.error) throw new GatewayError(403, "invalid_capability");
  if (result.delivery_email) {
    if (typeof result.delivery_email !== "string" || !/^[^\s@]+@example\.test$/.test(result.delivery_email)) throw new GatewayError(503, "local_recipient_required");
    if (command.operation.startsWith("start_")) {
      await rate([`recipient:${rateDigest(config.rateKey, result.delivery_email)}`], true);
      await mkdir(config.mailbox, { recursive: true, mode: 0o700 });
      // Development sink, never an HTTP endpoint or log. Contains synthetic OTP
      // delivery only; invitation/session/proof secrets are never persisted.
      await writeFile(path.join(config.mailbox, `${challengeId}.json`), JSON.stringify({ recipient: result.delivery_email, challenge_id: challengeId, code: otp, purpose: command.operation }), { mode: 0o600, flag: "wx" });
    }
    delete result.delivery_email;
  }
  if (["invite", "invite_access", "invite_amendment"].includes(command.operation) && result.invitation_id === invitationId) result.development_invitation = { invitation_id: invitationId, token: value }; // Returned once to verified local issuer only.
  if (command.operation === "verify_access") {
    jar.set(cookieName, `${sessionId}.${value}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 43200 });
    delete result.session_id;
  }
  if (command.operation === "verify_consent") result.proof_secret = value;
  if (command.operation === "logout") jar.set(cookieName, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return result;
}
