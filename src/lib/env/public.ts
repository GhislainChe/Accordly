import { z } from "zod";
import { GatewayError } from "../security/errors.ts";

const supabasePublicSchema = z.object({
  url: z.url({ protocol: /^https?$/ }).refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return !url.username && !url.password && (
      url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  }),
  publishableKey: z.string().startsWith("sb_publishable_").min(20),
});

// Explicit references let Next.js inline browser configuration.
export function getSupabasePublicEnv() {
  const result = supabasePublicSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!result.success) {
    // Do not include supplied values or key material in errors.
    throw new GatewayError(503, "auth_configuration_required", "Set a valid Supabase URL and publishable key in .env.local before using authentication.");
  }
  return result.data;
}
