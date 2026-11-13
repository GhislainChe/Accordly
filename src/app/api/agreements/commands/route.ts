import { executeAgreementCommand } from "@/features/agreements/service";
import { mutationBody, jsonResponse, errorResponse } from "@/lib/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { return jsonResponse(await executeAgreementCommand(await mutationBody(request))); }
  catch (error) { return errorResponse(error); }
}
