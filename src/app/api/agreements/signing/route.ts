import { signingOperation } from "@/features/signing/service";
import { mutationBody, jsonResponse, errorResponse } from "@/lib/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { return jsonResponse(await signingOperation(await mutationBody(request))); }
  catch (error) { return errorResponse(error); }
}
