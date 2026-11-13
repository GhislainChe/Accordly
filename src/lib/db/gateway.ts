import "server-only";
import { Pool, type PoolClient } from "pg";
import { databaseConfig } from "./config.ts";
import { GatewayError } from "../security/errors.ts";

let pool: Pool | undefined;
function connectionPool() {
  if (!pool) {
    pool = new Pool(databaseConfig(process.env));
    pool.on("error", () => { console.warn("Accordly database pool connection failed."); });
  }
  return pool;
}

export async function gatewayTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await connectionPool().connect();
  let failed = false;
  try {
    await client.query("begin");
    await client.query("set local statement_timeout='5s'; set local lock_timeout='2s'; set local idle_in_transaction_session_timeout='10s'; set local search_path='pg_catalog'");
    const role = await client.query("select current_user as name, rolsuper,rolinherit,rolreplication,rolbypassrls,rolcreaterole,rolcreatedb,exists(select 1 from pg_auth_members where member=(select oid from pg_roles where rolname=current_user)) as internal_member from pg_roles where rolname=current_user");
    const r = role.rows[0];
    if (!r || r.name !== "accordly_gateway" || r.rolsuper || r.rolinherit || r.rolreplication || r.rolbypassrls || r.rolcreaterole || r.rolcreatedb || r.internal_member) throw new GatewayError(503, "invalid_gateway_role");
    const value = await work(client);
    await client.query("commit");
    return value;
  } catch (error) {
    failed = true;
    try { await client.query("rollback"); } catch { /* Discard uncertain connections. */ }
    throw error;
  } finally { client.release(failed); }
}
