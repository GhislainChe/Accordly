// Real local GoTrue -> production Next Route Handler -> restricted PostgreSQL
// integration. No remote URL/linked project is accepted. Secrets stay in memory.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { signingIntegration } from "./signing-integration.mjs";
import { accountIntegration } from "./account-integration.mjs";
import { providerIntegration } from "./provider-integration.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run through npm run test:integration");
const workdir = mkdtempSync(path.join(tmpdir(), "accordly-c2-"));
const project = `accordly-c2-${randomUUID().slice(0, 8)}`;
const dbContainer = `supabase_db_${project}`;
const secrets = new Set();
const mask = (value) => {
  let result = String(value);
  for (const secret of secrets) if (secret) result = result.replaceAll(secret, "[redacted]");
  return result.replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[database-url]").replace(/eyJ[A-Za-z0-9_.-]{30,}/g, "[token]");
};
let owned = false;
let app;
let database;
let count = 0;
const origin = "https://localhost";

function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(mask(`${path.basename(bin)} ${args.slice(0,3).join(" ")} failed (${result.status}): ${result.error?.message || result.stderr?.slice(-2000) || result.stdout?.slice(-2000) || "no diagnostics"}`));
  return result.stdout;
}
function cli(...args) { return run(process.execPath, [npm, "exec", "--yes", "--package=supabase@3.1.0", "--", "supabase", ...args, "--workdir", workdir]); }
function adminSql(sql) { return run("docker", ["exec", "-i", dbContainer, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres"], { input: sql }); }
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function check(condition, message) { assert.ok(condition, message); count++; }
async function api(base, route, cookie, body, customOrigin = origin) {
  const response = await fetch(base + route, { method: body === undefined ? "GET" : "POST", headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json", origin: customOrigin }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

try {
  run("docker", ["version", "--format", "{{.Server.Version}}"]);
  mkdirSync(path.join(workdir, "supabase", "migrations"), { recursive: true });
  const { readdirSync } = await import("node:fs");
  for (const name of readdirSync(path.join(root, "supabase", "migrations"))) copyFileSync(path.join(root, "supabase", "migrations", name), path.join(workdir, "supabase", "migrations", name));
  writeFileSync(path.join(workdir, "supabase", "config.toml"), readFileSync(path.join(root, "supabase", "config.toml"), "utf8").replace('project_id = "accordly-foundation"', `project_id = "${project}"`).replaceAll("5542", "5552"));
  mkdirSync(path.join(workdir, "supabase", "templates"), { recursive: true });
  for (const file of ["confirmation.html", "recovery.html"]) copyFileSync(path.join(root, "supabase", "templates", file), path.join(workdir, "supabase", "templates", file));
  console.log("Starting a task-owned disposable full Supabase stack (ports 55520–55529)");
  owned = true;
  cli("start");
  const status = JSON.parse(cli("status", "--output", "json"));
  for (const value of Object.values(status)) if (typeof value === "string") secrets.add(value);
  assert.equal(new URL(status.API_URL).hostname, "127.0.0.1");
  assert.equal(new URL(status.API_URL).port, "55521");
  const publicKey = status.PUBLISHABLE_KEY;
  if (!publicKey?.startsWith("sb_publishable_")) throw new Error("Local CLI did not provide a publishable key");
  const rolePassword = randomBytes(24).toString("base64url"); secrets.add(rolePassword);
  adminSql(`alter role accordly_gateway password '${rolePassword}';`);
  // Ephemeral test CA/server files stay in the task-owned temp directory and
  // container, then are removed. No host certificate store is modified.
  const openssl = [process.env.ACCORDLY_TEST_OPENSSL, "openssl", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"].filter(Boolean).find((bin) => spawnSync(bin, ["version"], { windowsHide: true }).status === 0);
  if (!openssl) throw new Error("OpenSSL CLI is required for the real verified-TLS integration test");
  const keyFile = path.join(workdir, "gateway-test.key"); const certFile = path.join(workdir, "gateway-test.crt"); const sslConfig = path.join(workdir, "openssl.cnf");
  writeFileSync(sslConfig, "[req]\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n");
  run(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-config", sslConfig, "-keyout", keyFile, "-out", certFile, "-subj", "/CN=localhost"]);
  run("docker", ["cp", keyFile, `${dbContainer}:/tmp/accordly-c2.key`]); run("docker", ["cp", certFile, `${dbContainer}:/tmp/accordly-c2.crt`]);
  run("docker", ["exec", "-u", "root", dbContainer, "sh", "-c", "chown postgres:postgres /tmp/accordly-c2.key /tmp/accordly-c2.crt && chmod 600 /tmp/accordly-c2.key"]);
  const ca = readFileSync(certFile, "utf8");
  adminSql("alter system set ssl='on'; alter system set ssl_cert_file='/tmp/accordly-c2.crt'; alter system set ssl_key_file='/tmp/accordly-c2.key'; select pg_reload_conf();");
  const connection = { host: "localhost", port: 55522, user: "accordly_gateway", password: rolePassword, database: "postgres", ssl: { rejectUnauthorized: true, ca }, connectionTimeoutMillis: 5000 };
  database = new Client(connection); await database.connect();
  check((await database.query("select ssl from pg_stat_ssl where pid=pg_backend_pid()")).rows[0].ssl === true, "Actual gateway connection must negotiate TLS");
  check((await database.query("select current_user")).rows[0].current_user === "accordly_gateway", "Actual database connection must be the gateway role");
  const untrusted = new Client({ ...connection, ssl: { rejectUnauthorized: true } });
  await assert.rejects(untrusted.connect()); count++; await untrusted.end().catch(() => {});

  const fixtureAuth = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  async function user(label) {
    const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
    const password = `Aa9!${randomBytes(24).toString("base64url")}`; secrets.add(password);
    const created = await fixtureAuth.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error("Local Auth fixture creation failed");
    const jar = new Map();
    const client = createServerClient(status.API_URL, publicKey, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (values) => values.forEach(({ name, value }) => { jar.set(name, value); secrets.add(value); }) } });
    const logged = await client.auth.signInWithPassword({ email, password });
    if (logged.error || !logged.data.user || !logged.data.session) throw new Error("Real local Auth sign-in failed");
    secrets.add(logged.data.session.access_token); secrets.add(logged.data.session.refresh_token);
    const id = logged.data.user.id;
    const principal = (await database.query("select accordly_commands.register_principal($1) as id", [id])).rows[0].id;
    return { id, principal, email, password, cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") };
  }
  const a = await user("gateway-a"); const b = await user("gateway-b"); const viewer = await user("gateway-viewer");
  const orgA = (await database.query("select accordly_commands.create_organization($1,'Gateway A','business') as id", [a.id])).rows[0].id;
  const orgB = (await database.query("select accordly_commands.create_organization($1,'Gateway B','individual') as id", [b.id])).rows[0].id;
  await database.query("select accordly_commands.set_membership($1,$2,$3,'viewer',true)", [a.id, orgA, viewer.principal]);
  for (const [user, org, kind] of [[a,orgA,"business"],[b,orgB,"individual"],[viewer,orgA,"business"]]) {
    await database.query("select accordly_commands.account_command($1,'preferences',$2::jsonb)", [user.id, JSON.stringify({ full_name: "Verified fixture account", work_kind: kind, purpose: "both", expected_revision: "1", idempotency_key: randomUUID() })]);
    await database.query("select accordly_commands.account_command($1,'use_existing',$2::jsonb)", [user.id, JSON.stringify({ organization_id: org, expected_revision: "2", idempotency_key: randomUUID() })]);
  }
  const databaseUrl = new URL("postgresql://localhost:55522/postgres"); databaseUrl.username = "accordly_gateway"; databaseUrl.password = rolePassword;
  const mailbox = path.join(workdir, "mailbox");
  const challengeKey = randomBytes(32).toString("base64url"), rateKey = randomBytes(32).toString("base64url");
  secrets.add(challengeKey); secrets.add(rateKey);
  const env = { ...process.env, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey, ACCORDLY_DATABASE_URL: databaseUrl.toString(), ACCORDLY_DATABASE_CA_PEM: ca, ACCORDLY_DATABASE_ALLOW_LOCAL_PLAINTEXT: "false", ACCORDLY_APP_ORIGIN: origin, ACCORDLY_SIGNING_MODE: "local-test", ACCORDLY_ACCOUNTS_MODE: "local-test", ACCORDLY_AUTH_RATE_KEY: randomBytes(32).toString("base64url"), ACCORDLY_CHALLENGE_HMAC_KEY: challengeKey, ACCORDLY_SIGNING_RATE_KEY: rateKey, ACCORDLY_CHALLENGE_KEY_ID: "local-v1", ACCORDLY_LOCAL_MAILBOX: mailbox };
  secrets.add(env.ACCORDLY_AUTH_RATE_KEY);
  console.log("Building the real Next.js server; only public Supabase configuration is browser-visible");
  run(process.execPath, [npm, "run", "build"], { env, timeout: 300_000 });
  function staticFiles(folder) { return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? staticFiles(path.join(folder, entry.name)) : [path.join(folder, entry.name)]); }
  check(staticFiles(path.join(root, ".next", "static")).filter((file) => file.endsWith(".js")).every((file) => {
    const source = readFileSync(file, "utf8");
    return !source.includes(rolePassword) && !source.includes(status.SERVICE_ROLE_KEY);
  }), "Database and fixture service-role credentials must not appear in browser JavaScript");
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  app = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let logs = ""; app.stdout.on("data", (d) => { logs = (logs + mask(d)).slice(-4000); }); app.stderr.on("data", (d) => { logs = (logs + mask(d)).slice(-4000); });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch { /* Startup retry. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error(`Local Next server failed: ${logs}`);
  const draft = { scope: "Développement exact", terms: "Terms", amount_minor: "75000", currency_code: "XAF", currency_exponent: 0, content_language: "fr", deadline: { kind: "date", date: "2027-01-31" }, milestones: [], attachments: [] };
  const command = (operation, resource_id, input, idempotency_key = randomUUID()) => ({ operation, resource_id, input, idempotency_key });
  const post = (body, cookie = a.cookie, requestOrigin = origin) => api(base, "/api/agreements/commands", cookie, body, requestOrigin);
  const create = command("create_draft", orgA, { title: "Logo and Brand Identity Design", draft });
  check((await post(create, "")).status === 401, "Unauthenticated mutation must fail");
  check((await post(create, a.cookie, "https://attacker.example.test")).status === 403, "Cross-origin mutation must fail");
  check((await post({ ...create, actor_id: b.id })).status === 422, "Browser identity injection must fail");
  check((await post(command("create_draft", orgB, create.input))).status === 403, "Cross-tenant creation must fail");
  const created = await post(create); check(created.status === 200, `Verified creation failed (${created.status}/${created.body.error})`);
  const aid = created.body.agreement_id;
  check((await post(create)).body.agreement_id === aid, "Create retry must deduplicate");
  check((await post({ ...create, input: { ...create.input, title: "Conflict" } })).status === 409, "Conflicting key must fail");
  const details = () => api(base, `/api/agreements/${aid}`, a.cookie);
  check((await api(base, `/api/agreements/${aid}`, b.cookie)).status === 404, "Cross-tenant read must hide existence");
  check((await api(base, `/api/agreements/${aid}`, "")).status === 401, "Unauthenticated read must fail");
  check((await details()).headers.get("cache-control") === "private, no-store", "Private data must not be cached");
  adminSql("grant accordly_freezer to accordly_gateway;");
  check((await details()).status === 503, "Accidentally privileged gateway role must fail closed");
  adminSql("revoke accordly_freezer from accordly_gateway;");
  check((await details()).status === 200, "Safe gateway role must work again after the privilege is removed");
  const freezeKey = randomUUID();
  check((await post(command("freeze", aid, { expected_revision: "1" }, freezeKey))).status === 422, "Missing quorum must not freeze");
  const parties = command("set_parties", aid, { expected_revision: "1", provider: { legal_name: "Provider", representative_name: "Owner" }, client: { legal_name: "Client", representative_name: "Client", email: "future-client@example.test" } });
  check((await post(parties)).status === 200, "Parties must be configurable before freeze");
  check((await post(command("update_draft", aid, { expected_revision: "2", draft }))).status === 200, "Authorized draft update must succeed");

  // Fail at COMMIT after the command has written rows, to verify real rollback
  // of draft/revision/receipt/audit, and safe discard/reuse of pool connections.
  adminSql(`create function accordly_commands.integration_rollback() returns trigger language plpgsql set search_path='' as $$ begin if new.agreement_id='${aid}'::uuid and new.operation='update_draft' then raise exception 'integration rollback' using errcode='XX000'; end if; return null; end $$; create constraint trigger integration_rollback after insert on accordly.command_receipts deferrable initially deferred for each row execute function accordly_commands.integration_rollback();`);
  const rollbackKey = randomUUID();
  check((await post(command("update_draft", aid, { expected_revision: "3", draft: { ...draft, scope: "Must roll back" } }, rollbackKey))).status === 503, "Deferred COMMIT failure must not report success");
  adminSql("drop trigger integration_rollback on accordly.command_receipts; drop function accordly_commands.integration_rollback();");
  check((await details()).body.revision === "3", "Failed COMMIT must preserve original revision");
  check(adminSql(`select count(*) from accordly.command_receipts where idempotency_key='${rollbackKey}';`).trim() === "0", "Failed COMMIT must not retain a receipt");
  const updates = await Promise.all(["First", "Second"].map((scope) => post(command("update_draft", aid, { expected_revision: "3", draft: { ...draft, scope } }))));
  check(updates.map((r) => r.status).sort().join() === "200,409", "Concurrent updates must have one stale loser");
  check((await post(command("set_access", aid, { expected_revision: "4", principal_id: viewer.principal, grant_type: "provider_read", active: true }))).status === 200, "Owner must grant viewer scoped access");
  check((await api(base, `/api/agreements/${aid}`, viewer.cookie)).status === 200, "Granted viewer must read");
  check((await post(command("update_draft", aid, { expected_revision: "5", draft }), viewer.cookie)).status === 403, "Viewer must not gain edit authority");
  check((await post(command("set_access", aid, { expected_revision: "5", principal_id: b.principal, grant_type: "provider_read", active: true }))).status === 403, "Other tenant principal must not gain provider access");
  check((await post(command("set_access", aid, { expected_revision: "5", principal_id: viewer.principal, grant_type: "provider_read", active: false }))).status === 200, "Scoped revocation must succeed");
  check((await api(base, `/api/agreements/${aid}`, viewer.cookie)).status === 404, "Revoked grant must deny reads");
  const freeze = command("freeze", aid, { expected_revision: "6" }, freezeKey);
  const freezingCommands = [freeze, command("freeze", aid, freeze.input)];
  const freezes = await Promise.all(freezingCommands.map((c) => post(c)));
  check(freezes.map((r) => r.status).sort().join() === "200,409", "Concurrent freezes must select one immutable candidate");
  const winner = freezes.find((r) => r.status === 200);
  const winningCommand = freezingCommands[freezes.findIndex((r) => r.status === 200)];
  check((await post(winningCommand)).body.digest === winner.body.digest, "Frozen retry must return the same digest");
  check(createHash("sha256").update(winner.body.canonical_text).digest("hex") === winner.body.digest, "Actual returned bytes must match database digest");
  check((await post(command("update_draft", aid, { expected_revision: "7", draft }))).status === 409, "Frozen content must reject edits");
  check((await details()).body.lifecycle === "awaiting_signatures", "Freeze must not imply consent or activation");
  check(adminSql(`select count(*) from accordly.agreement_versions where agreement_id='${aid}';`).trim() === "1", "There must be one frozen version");
  await signingIntegration({ api, base, a, b, aid, winner, adminSql, mailbox, check });
  await providerIntegration({ api, base, a, b, aid, check });
  await accountIntegration({ api, base, database, adminSql, publicUrl: status.API_URL, publicKey, a, b, aid, orgA, check, protect: (value) => secrets.add(value) });
  const banned = await fixtureAuth.auth.admin.updateUserById(a.id, { ban_duration: "1h" });
  if (banned.error) throw new Error("Could not create local Auth revocation fixture");
  check([401,403].includes((await details()).status), "Live Auth ban must invalidate the next request");
  console.log(`Real gateway integration assertions passed: ${count}; verified PostgreSQL TLS, live GoTrue, production Next handlers, idempotency/concurrency/rollback`);
} catch (error) {
  console.error(mask(error.message)); process.exitCode = 1;
} finally {
  if (app && app.exitCode === null) {
    const exited = new Promise((resolve) => app.once("exit", resolve));
    app.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  if (database) await database.end().catch(() => {});
  if (owned) {
    try { cli("stop", "--project-id", project, "--no-backup"); console.log("Stopped only the task-owned Supabase integration stack"); }
    catch { console.error("Task-owned local stack cleanup failed"); process.exitCode = 1; }
  }
  const resolved = path.resolve(workdir);
  if (resolved.startsWith(path.resolve(tmpdir()) + path.sep) && path.basename(resolved).startsWith("accordly-c2-")) rmSync(resolved, { recursive: true, force: true });
}
