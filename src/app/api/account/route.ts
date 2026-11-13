import { accountStatus, onboardingOperation } from "@/features/accounts/onboarding";
import { mutationBody, jsonResponse, errorResponse } from "@/lib/security/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { try { return jsonResponse(await accountStatus()); } catch (error) { return errorResponse(error); } }
export async function POST(request: Request) { try { return jsonResponse(await onboardingOperation(await mutationBody(request))); } catch (error) { return errorResponse(error); } }
