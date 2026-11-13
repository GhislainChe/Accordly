import { accountStatus } from "@/features/accounts/onboarding";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { verifiedIdentity } from "@/lib/auth/identity-policy";
import { mutationBody, jsonResponse, errorResponse } from "@/lib/security/http";
import { GatewayError } from "@/lib/security/errors";
import { authLoginFailure, loginDiagnostic } from "@/lib/auth/login-policy";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const input = z.object({ email: z.email().max(320), password: z.string().min(1).max(256) }).strict().safeParse(await mutationBody(request));
    if (!input.success) throw new GatewayError(422, "invalid_login");
    const auth = await createServerSupabaseClient();
    const response = await auth.auth.signInWithPassword(input.data);
    if (response.error) throw authLoginFailure(response.error);
    try { verifiedIdentity(response.data.user, null); } catch { await auth.auth.signOut({ scope: "local" }); throw new GatewayError(401, "invalid_login"); }
    return jsonResponse({ ok: true, next: (await accountStatus()).next });
  } catch (e) { console.warn(loginDiagnostic(e)); return errorResponse(e); }
}
