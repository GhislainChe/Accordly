import "server-only";
import { gatewayTransaction } from "@/lib/db/gateway";
import { getVerifiedIdentity } from "@/lib/auth/verified-identity";
import { GatewayError } from "@/lib/security/errors";
import { commandSchema, agreementIdSchema } from "./schemas.ts";
import { canonicalize, digest } from "./canonical.ts";

export async function executeAgreementCommand(raw: unknown) {
  const parsed = commandSchema.safeParse(raw);
  if (!parsed.success) throw new GatewayError(422, "invalid_command");
  const command = parsed.data;
  const actor = await getVerifiedIdentity();
  return gatewayTransaction(async (client) => {
    // Separate preflight before any mutating database command. The command
    // reauthorizes under locks, since this first decision can become stale.
    await client.query("select accordly_commands.authorize_operation($1,$2,$3)", [actor.authUserId, command.operation, command.resource_id]);
    const result = await client.query("select accordly_commands.execute_preparation($1,$2,$3,$4,$5::jsonb,$6) as result", [actor.authUserId, command.operation, command.resource_id, command.idempotency_key, JSON.stringify(command.input), actor.email]);
    const value = result.rows[0]?.result;
    if (!value || typeof value !== "object") throw new GatewayError(503, "invalid_database_response");
    if (command.operation === "freeze" && (canonicalize(value.snapshot) !== value.canonical_text || digest(value.snapshot) !== value.digest)) throw new GatewayError(503, "snapshot_integrity_error");
    return value;
  });
}

export async function retrieveAgreement(id: string) {
  const parsed = agreementIdSchema.safeParse(id);
  if (!parsed.success) throw new GatewayError(404, "not_found");
  const actor = await getVerifiedIdentity();
  return gatewayTransaction(async (client) => {
    await client.query("select accordly_commands.authorize_operation($1,'read',$2)", [actor.authUserId, parsed.data]);
    const response = await client.query("select accordly_commands.agreement_details($1,$2) as result", [actor.authUserId, parsed.data]);
    if (!response.rows[0]?.result) throw new GatewayError(404, "not_found");
    return response.rows[0].result;
  });
}
