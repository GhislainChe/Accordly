import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mutationBody, jsonResponse, errorResponse } from "@/lib/security/http";
import { GatewayError } from "@/lib/security/errors";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    await mutationBody(request);
    const response = await (await createServerSupabaseClient()).auth.signOut({ scope: "local" });
    if (response.error) throw new GatewayError(503, "logout_failed");
    return jsonResponse({ ok: true });
  } catch (e) { return errorResponse(e); }
}
