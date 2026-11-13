import { applicationOrigin, databaseConfig } from "../../lib/db/config.ts";
import { getSupabasePublicEnv } from "../../lib/env/public.ts";
import { GatewayError } from "../../lib/security/errors.ts";
export function accountConfig(env: Record<string, string | undefined>) {
  try {
    const origin = applicationOrigin(env), db = env.ACCORDLY_DATABASE_URL;
    databaseConfig(env);
    const url = env.NEXT_PUBLIC_SUPABASE_URL;
    if (env.ACCORDLY_ACCOUNTS_MODE !== "local-test" || !url || !db || [origin, url, db].some((v) => !["localhost", "127.0.0.1", "[::1]"].includes(new URL(v).hostname))) throw new Error();
    const key = env.ACCORDLY_AUTH_RATE_KEY;
    if (!key || !/^[A-Za-z0-9_-]{43}$/.test(key) || key === env.ACCORDLY_CHALLENGE_HMAC_KEY || key === env.ACCORDLY_SIGNING_RATE_KEY) throw new Error();
    return { origin, key };
  } catch { throw new GatewayError(503, "accounts_disabled"); }
}
export function accountPublicConfig() { return getSupabasePublicEnv(); }
