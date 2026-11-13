import path from "node:path";
import { GatewayError } from "../../lib/security/errors.ts";
import { applicationOrigin, databaseConfig } from "../../lib/db/config.ts";

export function signingConfig(env: Record<string, string | undefined>) {
  try {
    if (env.ACCORDLY_SIGNING_MODE !== "local-test") throw new Error();
    const origin = applicationOrigin(env);
    databaseConfig(env);
    for (const value of [origin, env.NEXT_PUBLIC_SUPABASE_URL, env.ACCORDLY_DATABASE_URL]) {
      if (!value || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname)) throw new Error();
    }
    const key = env.ACCORDLY_CHALLENGE_HMAC_KEY;
    const rateKey = env.ACCORDLY_SIGNING_RATE_KEY;
    const keyId = env.ACCORDLY_CHALLENGE_KEY_ID;
    const mailbox = env.ACCORDLY_LOCAL_MAILBOX;
    if (!key || !rateKey || key === rateKey || !/^[A-Za-z0-9_-]{43}$/.test(key) || !/^[A-Za-z0-9_-]{43}$/.test(rateKey) || !keyId || !/^[a-zA-Z0-9_-]{1,64}$/.test(keyId) || !mailbox || !path.isAbsolute(mailbox)) throw new Error();
    return { key, rateKey, keyId, mailbox, origin };
  } catch { throw new GatewayError(503, "signing_disabled"); }
}
