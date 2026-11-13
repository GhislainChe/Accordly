import "server-only";
import { cookies } from "next/headers";
import { gatewayTransaction } from "@/lib/db/gateway";
import { GatewayError } from "@/lib/security/errors";
import { canonicalize, digest } from "@/features/agreements/canonical";
import { optionalRegisteredIdentity } from "@/features/signing/service";
import { signingConfig } from "@/features/signing/config";
import { credentialDigest } from "@/features/signing/crypto";
import { sessionCookieSchema } from "@/features/signing/schemas";
import { amendmentSchema } from "./schemas";

export async function amendmentOperation(raw: unknown, partySession: boolean) {
  const parsed = amendmentSchema.safeParse(raw);
  if (!parsed.success) throw new GatewayError(422, "invalid_command");
  const command = parsed.data;
  const actor = await optionalRegisteredIdentity();
  if (!partySession && !actor) throw new GatewayError(401, "authentication_required");
  const internal: Record<string, string> = { use_session: String(partySession) };
  if (partySession) {
    signingConfig(process.env);
    const token = sessionCookieSchema.safeParse((await cookies()).get("__Host-accordly-party")?.value);
    if (!token.success) throw new GatewayError(401, "party_session_required");
    const [id, value] = token.data.split(".");
    internal.session_id = id; internal.session_digest = credentialDigest("session", id, value);
  }
  return gatewayTransaction(async (db) => {
    if (!partySession) await db.query("select accordly_commands.authorize_operation($1,'read',$2)", [actor?.authUserId, command.agreement_id]);
    const response = await db.query("select accordly_commands.amendment_command($1,$2,$3,$4,$5::jsonb,$6::jsonb) as result", [actor?.authUserId ?? null, actor?.email ?? null, actor?.sessionId ?? null, command.operation, JSON.stringify(command), JSON.stringify(internal)]);
    const result = response.rows[0]?.result;
    if (!result || typeof result !== "object") throw new GatewayError(503, "invalid_database_response");
    if (command.operation === "amendment_submit" && (canonicalize(result.snapshot) !== result.canonical_text || digest(result.snapshot) !== result.digest)) throw new GatewayError(503, "snapshot_integrity_error");
    for (const value of [result.effective, result.candidate, result.base]) {
      if (value && digest(value.snapshot) !== value.digest) throw new GatewayError(503, "snapshot_integrity_error");
    }
    return result;
  });
}
