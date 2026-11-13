import { GatewayError } from "../security/errors.ts";

export function databaseConfig(env: Record<string, string | undefined>) {
  try {
    const url = new URL(env.ACCORDLY_DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !/^accordly_gateway(?:\.[a-z0-9-]+)?$/.test(decodeURIComponent(url.username)) || url.search || url.hash || url.pathname !== "/postgres") throw new Error();
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const plaintext = env.ACCORDLY_DATABASE_ALLOW_LOCAL_PLAINTEXT === "true";
    if (plaintext && (!local || env.NODE_ENV === "production")) throw new Error();
    return {
      connectionString: url.toString(),
      ssl: plaintext ? false as const : { rejectUnauthorized: true as const, minVersion: "TLSv1.2" as const, ...(env.ACCORDLY_DATABASE_CA_PEM ? { ca: env.ACCORDLY_DATABASE_CA_PEM } : {}) },
      max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, maxLifetimeSeconds: 300,
    };
  } catch { throw new GatewayError(503, "database_configuration_required"); }
}

export function applicationOrigin(env: Record<string, string | undefined>): string {
  try {
    const url = new URL(env.ACCORDLY_APP_ORIGIN ?? "");
    if (url.origin !== env.ACCORDLY_APP_ORIGIN || url.username || url.password ||
      (url.protocol !== "https:" && !(env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error();
    return url.origin;
  } catch { throw new GatewayError(503, "origin_configuration_required"); }
}
