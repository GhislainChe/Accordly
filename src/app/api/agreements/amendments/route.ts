import { amendmentOperation } from "@/features/amendments/service";
import { mutationBody, jsonResponse, errorResponse } from "@/lib/security/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { return jsonResponse(await amendmentOperation(await mutationBody(request), false)); }
  catch (error) { return errorResponse(error); }
}
