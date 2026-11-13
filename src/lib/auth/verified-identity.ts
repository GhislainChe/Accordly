import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { verifiedIdentity } from "./identity-policy.ts";

export async function getVerifiedIdentity() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  return verifiedIdentity(data.user, error);
}
