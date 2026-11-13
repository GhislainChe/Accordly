import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "@/lib/env/public";
import { sessionCookieOptions } from "@/lib/supabase/cookie-options";

export async function refreshSession(request: NextRequest, securityHeaders?: Headers) {
  const { url, publishableKey } = getSupabasePublicEnv();
  const pendingCookies = new Map<string, { value: string; options: CookieOptions }>();
  const refreshHeaders = new Headers({ "Cache-Control": "private, no-store" });
  const supabase = createServerClient(url, publishableKey, {
    cookieOptions: sessionCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        for (const { name, value, options } of cookiesToSet) {
          request.cookies.set(name, value);
          pendingCookies.set(name, { value, options });
        }
        for (const [name, value] of Object.entries(headers)) refreshHeaders.set(name, value);
      },
    },
  });
  // Refresh/validate before rendering. This is not resource authorization.
  await supabase.auth.getClaims();
  // Forward the updated request headers only after refresh has updated cookies.
  const headers = new Headers(request.headers);
  securityHeaders?.forEach((value, name) => headers.set(name, value));
  // Preserve cookies updated during refresh, rather than overwriting them with
  // the pre-refresh security-header copy.
  headers.set("cookie", request.headers.get("cookie") ?? "");
  const response = NextResponse.next({ request: { headers } });
  for (const [name, { value, options }] of pendingCookies) response.cookies.set(name, value, options);
  refreshHeaders.forEach((value, name) => response.headers.set(name, value));
  return response;
}
