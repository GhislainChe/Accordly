"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv } from "@/lib/env/public";
import { sessionCookieOptions } from "@/lib/supabase/cookie-options";

export function createBrowserSupabaseClient() {
  const { url, publishableKey } = getSupabasePublicEnv();
  return createBrowserClient(url, publishableKey, { cookieOptions: sessionCookieOptions });
}
