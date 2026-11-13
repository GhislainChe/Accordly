import { NextResponse, type NextRequest } from "next/server";
import { refreshSession } from "@/lib/supabase/proxy";
import { uiContentSecurityPolicy } from "@/lib/security/csp";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const ui = ["/", "/login", "/invite", "/register", "/verify", "/recover", "/reset-password", "/auth/help", "/auth/legal", "/auth/error", "/auth/expired", "/onboarding", "/workspace-unavailable"].includes(pathname) || pathname.startsWith("/app");
  const headers = new Headers(request.headers);
  let policy: string | undefined;
  if (ui) {
    const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
    policy = uiContentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
    headers.set("x-nonce", nonce); headers.set("Content-Security-Policy", policy);
  }
  let response: NextResponse;
  // Public liveness works without credentials or an available Auth service.
  if (["/", "/api/health", "/login", "/invite", "/register", "/verify", "/recover", "/reset-password", "/auth/help", "/auth/legal", "/auth/error", "/auth/expired"].includes(request.nextUrl.pathname) || ["/api/agreements/", "/api/auth/", "/api/provider", "/api/account"].some((prefix) => request.nextUrl.pathname.startsWith(prefix))) {
    // Agreement Route Handlers verify live Auth themselves, refresh writable
    // cookies, and return safe JSON errors even with missing configuration.
    response = NextResponse.next({ request: { headers } });
  } else {
    try { response = await refreshSession(request, headers); }
    catch { response = NextResponse.next({ request: { headers } }); } // Layouts independently verify live Auth.
  }
  if (policy) { response.headers.set("Content-Security-Policy", policy); response.headers.set("Cache-Control", "private, no-store"); }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

