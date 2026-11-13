import "server-only";
import { accountStatus } from "@/features/accounts/onboarding";
import { z } from "zod";
import { getVerifiedIdentity } from "@/lib/auth/verified-identity";
import { gatewayTransaction } from "@/lib/db/gateway";
import { GatewayError, safeGatewayError } from "@/lib/security/errors";
import type { AgreementView, Workspace } from "./types";
export async function providerWorkspace(): Promise<Workspace> {
  const actor = await getVerifiedIdentity();
  const account = await accountStatus();
  try { const data = await gatewayTransaction(async (db) => (await db.query("select accordly_commands.provider_workspace($1) as result", [actor.authUserId])).rows[0].result); return { ...data, selected_organization_id: account.selected_workspace_id }; }
  catch (e) { throw safeGatewayError(e); }
}
export async function providerAgreement(id: string): Promise<AgreementView> {
  if (!z.uuid().safeParse(id).success) throw new GatewayError(404, "not_found");
  const actor = await getVerifiedIdentity();
  try { return await gatewayTransaction(async (db) => (await db.query("select accordly_commands.provider_agreement_view($1,$2) as result", [actor.authUserId, id])).rows[0].result); }
  catch (e) { throw safeGatewayError(e); }
}
