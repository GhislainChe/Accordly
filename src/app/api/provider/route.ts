import { providerWorkspace } from "@/features/agreements/provider";
import { jsonResponse, errorResponse } from "@/lib/security/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { try { return jsonResponse(await providerWorkspace()); } catch (e) { return errorResponse(e); } }
