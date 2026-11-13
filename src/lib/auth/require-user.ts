import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createServerSupabaseClient();
  // Verify with Auth rather than trusting a locally read session or cookie.
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Authentication required.");
  // Identity only: callers must authorize the requested resource and operation.
  return { user, supabase };
}
