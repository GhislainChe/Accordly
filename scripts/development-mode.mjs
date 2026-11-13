import { existsSync } from "node:fs";
import path from "node:path";

// Explicit app configuration always wins. Never fall back from a configured
// (possibly remote) environment to a different database or fixture identity.
export function developmentMode(root, env) {
  if (env.NODE_ENV === "production") throw new Error("The development launcher cannot run in production.");
  const mode = env.ACCORDLY_DEV_MODE;
  if (mode !== undefined && !["app", "demo"].includes(mode)) throw new Error("ACCORDLY_DEV_MODE must be app or demo.");
  if (mode) return mode;
  const configured = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "ACCORDLY_DATABASE_URL", "ACCORDLY_APP_ORIGIN", "ACCORDLY_SIGNING_MODE"].some((name) => env[name] !== undefined)
    || [".env", ".env.local", ".env.development", ".env.development.local"].some((file) => existsSync(path.join(root, file)));
  return !configured && existsSync(path.join(root, ".demo", "state.json")) ? "demo" : "app";
}
