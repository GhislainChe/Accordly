import { providerAgreement } from "@/features/agreements/provider";
import { jsonResponse, errorResponse } from "@/lib/security/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ agreementId: string }> }) {
  try { return jsonResponse(await providerAgreement((await params).agreementId)); } catch (e) { return errorResponse(e); }
}
