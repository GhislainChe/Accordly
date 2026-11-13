import { retrieveAgreement } from "@/features/agreements/service";
import { jsonResponse, errorResponse } from "@/lib/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ agreementId: string }> }) {
  try { return jsonResponse(await retrieveAgreement((await context.params).agreementId)); }
  catch (error) { return errorResponse(error); }
}
