import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getVerifiedIdentity } from "@/lib/auth/verified-identity";
import { gatewayTransaction } from "@/lib/db/gateway";
import { GatewayError } from "@/lib/security/errors";
import { onboardingSchema } from "./schemas";
import type { AccountStatus } from "./types";
export async function accountStatus(): Promise<AccountStatus> {
  const actor = await getVerifiedIdentity();
  return gatewayTransaction(async (db) => (await db.query("select accordly_commands.account_command($1,'status','{}') as result", [actor.authUserId])).rows[0].result);
}
export async function onboardingOperation(raw: unknown) {
  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) throw new GatewayError(422, "invalid_command");
  const actor = await getVerifiedIdentity(), { operation, ...input } = parsed.data;
  return gatewayTransaction(async (db) => (await db.query("select accordly_commands.account_command($1,$2,$3::jsonb) as result", [actor.authUserId, operation, JSON.stringify(input)])).rows[0].result);
}
export async function registrationName() {
  const { data } = await (await createServerSupabaseClient()).auth.getUser();
  const name = data.user?.user_metadata?.full_name;
  return typeof name === "string" && name.length <= 200 ? name : ""; // Display only; never authority.
}
