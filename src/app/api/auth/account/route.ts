import { accountAuthOperation } from "@/features/accounts/auth";
import { mutationBody, jsonResponse, errorResponse } from "@/lib/security/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try { const result = await accountAuthOperation(await mutationBody(request)); return jsonResponse(result, "message" in result ? 202 : 200); }
  catch (error) { return errorResponse(error); }
}
