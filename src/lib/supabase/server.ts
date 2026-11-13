import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv } from "@/lib/env/public";
import { sessionCookieOptions } from "@/lib/supabase/cookie-options";

export async function createServerSupabaseClient() {
  const { url, publishableKey } = getSupabasePublicEnv();
  const cookieStore = await cookies();
  return createServerClient(url, publishableKey, {
    cookieOptions: sessionCookieOptions,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          try {
            cookieStore.set(name, value, options);
          } catch (error) {
            // Server Components are read-only; Proxy refreshes before render.
            if (error instanceof Error && error.message.includes("Cookies can only be modified")) continue;
            throw error;
          }
        }
      },
    },
  });
}
