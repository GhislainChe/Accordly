// Owns one explicit local-only demo project. Never accepts a remote URL/reset.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { checkDemoAuth } from "./demo-startup.mjs";
import { supportsNode } from "./node-runtime.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".demo"), projectDir = path.join(dir, "project"), stateFile = path.join(dir, "state.json");
const npm = process.env.npm_execpath;
const mode = process.argv[2];
const secrets = new Set();
function safe(message) { let text = String(message); for (const s of secrets) if (s) text = text.replaceAll(s, "[redacted]"); return text.replace(/eyJ[A-Za-z0-9_.-]{30,}/g, "[token]").replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[database-url]"); }
function run(bin, args, options = {}) {
  const result = spawnSync(bin, args, { cwd: root, windowsHide: true, encoding: "utf8", timeout: 180000, maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(safe(`${path.basename(bin)} failed: ${result.error?.message ?? result.stderr?.slice(-1200) ?? "See local service status"}`));
  return result.stdout;
}
function cli(...args) {
  if (!npm) throw new Error("Run this script through npm");
  return run(process.execPath, [npm, "exec", "--yes", "--package=supabase@3.1.0", "--", "supabase", ...args, "--workdir", projectDir]);
}
function save(file, value) { writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 }); }
function load() {
  if (!existsSync(stateFile)) throw new Error("Run npm run demo:setup first");
  let state;
  try { state = JSON.parse(readFileSync(stateFile, "utf8")); } catch { throw new Error("Private demo state is unreadable. Inspect setup locally; no values were printed."); }
  if (!/^accordly-demo-[a-f0-9]{8}$/.test(state.project) || !existsSync(path.join(projectDir, "supabase", "config.toml")) || !readFileSync(path.join(projectDir, "supabase", "config.toml"), "utf8").includes(`project_id = "${state.project}"`)) throw new Error("Demo ownership metadata does not match. No local resources were changed.");
  for (const key of ["ACCORDLY_DATABASE_URL", "ACCORDLY_CHALLENGE_HMAC_KEY", "ACCORDLY_SIGNING_RATE_KEY", "ACCORDLY_AUTH_RATE_KEY"]) if (state.env?.[key]) secrets.add(state.env[key]);
  if (state.databasePassword) secrets.add(state.databasePassword);
  if (state.password) secrets.add(state.password);
  return state;
}
try {
  if (!supportsNode(process.versions.node)) throw new Error("The demo requires Node 22.18+; select a compatible installed runtime. No services or data were changed.");
  if (mode === "setup") {
    run("docker", ["version", "--format", "{{.Server.Version}}"]);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if (process.platform === "win32") {
      const who = run("whoami", []).trim();
      run("icacls", [dir, "/inheritance:r", "/grant:r", `${who}:(OI)(CI)F`, "SYSTEM:(OI)(CI)F"]);
    }
    let state;
    if (existsSync(stateFile)) state = load();
    else {
      state = { project: `accordly-demo-${randomUUID().slice(0, 8)}` };
      mkdirSync(path.join(projectDir, "supabase", "migrations"), { recursive: true });
      writeFileSync(path.join(projectDir, "supabase", "config.toml"), readFileSync(path.join(root, "supabase", "config.toml"), "utf8").replace('project_id = "accordly-foundation"', `project_id = "${state.project}"`).replaceAll("5542", "5562"));
      save(stateFile, state);
    }
    const ownedConfig = path.join(projectDir, "supabase", "config.toml");
    const nextConfig = readFileSync(path.join(root, "supabase", "config.toml"), "utf8").replace('project_id = "accordly-foundation"', `project_id = "${state.project}"`).replaceAll("5542", "5562");
    const changedConfig = readFileSync(ownedConfig, "utf8") !== nextConfig;
    if (changedConfig && state.env) {
      const container = `supabase_db_${state.project}`;
      const running = spawnSync("docker", ["inspect", container, "--format", "{{.State.Running}}"], { encoding: "utf8", windowsHide: true });
      if (running.status === 0 && running.stdout.trim() === "true") {
        const mounts = JSON.parse(run("docker", ["inspect", container, "--format", "{{json .Mounts}}"]));
        if (!mounts.some((m) => m.Type === "volume" && m.Name === container && m.Destination === "/var/lib/postgresql/data")) throw new Error("Unexpected owned demo data volume; no services stopped");
        // TLS files must survive the non-destructive CLI stop/start roundtrip.
        run("docker", ["cp", path.join(dir, "database.key"), `${container}:/var/lib/postgresql/data/accordly-demo.key`]);
        run("docker", ["cp", path.join(dir, "database.crt"), `${container}:/var/lib/postgresql/data/accordly-demo.crt`]);
        run("docker", ["exec", "-u", "root", container, "sh", "-c", "chown postgres:postgres /var/lib/postgresql/data/accordly-demo.key /var/lib/postgresql/data/accordly-demo.crt && chmod 600 /var/lib/postgresql/data/accordly-demo.key"]);
        run("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres"], { input: "alter system set ssl_key_file='/var/lib/postgresql/data/accordly-demo.key'; alter system set ssl_cert_file='/var/lib/postgresql/data/accordly-demo.crt'; select pg_reload_conf();" });
      }
      console.log("Reloading only the recorded demo stack for approved Auth settings; database volumes/data are retained (no reset).");
      cli("stop", "--project-id", state.project);
    }
    writeFileSync(ownedConfig, nextConfig);
    mkdirSync(path.join(projectDir, "supabase", "templates"), { recursive: true });
    for (const file of ["confirmation.html", "recovery.html"]) copyFileSync(path.join(root, "supabase", "templates", file), path.join(projectDir, "supabase", "templates", file));
    for (const file of readdirSync(path.join(root, "supabase", "migrations"))) copyFileSync(path.join(root, "supabase", "migrations", file), path.join(projectDir, "supabase", "migrations", file));
    console.log("Starting the owned local Accordly demo stack (ports 55620–55629). Keys are captured privately.");
    cli("start");
    cli("migration", "up", "--local");
    const status = JSON.parse(cli("status", "--output", "json"));
    for (const value of Object.values(status)) if (typeof value === "string") secrets.add(value);
    if (new URL(status.API_URL).hostname !== "127.0.0.1" || new URL(status.API_URL).port !== "55621") throw new Error("Unexpected demo Auth endpoint");
    const container = `supabase_db_${state.project}`;
    const sql = (text) => run("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "postgres"], { input: text });
    const openssl = [process.env.ACCORDLY_TEST_OPENSSL, "openssl", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"].filter(Boolean).find((exe) => spawnSync(exe, ["version"], { windowsHide: true }).status === 0);
    if (!openssl) throw new Error("OpenSSL is required to provision verified local database TLS");
    const key = path.join(dir, "database.key"), cert = path.join(dir, "database.crt"), config = path.join(dir, "openssl.cnf");
    if (!existsSync(cert)) {
      writeFileSync(config, "[req]\ndistinguished_name=dn\nx509_extensions=ext\n[dn]\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n");
      run(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "30", "-config", config, "-keyout", key, "-out", cert, "-subj", "/CN=localhost"]);
    }
    run("docker", ["cp", key, `${container}:/var/lib/postgresql/data/accordly-demo.key`]); run("docker", ["cp", cert, `${container}:/var/lib/postgresql/data/accordly-demo.crt`]);
    run("docker", ["exec", "-u", "root", container, "sh", "-c", "chown postgres:postgres /var/lib/postgresql/data/accordly-demo.key /var/lib/postgresql/data/accordly-demo.crt && chmod 600 /var/lib/postgresql/data/accordly-demo.key"]);
    sql("alter system set ssl='on'; alter system set ssl_cert_file='/var/lib/postgresql/data/accordly-demo.crt'; alter system set ssl_key_file='/var/lib/postgresql/data/accordly-demo.key'; select pg_reload_conf();");
    const databasePassword = state.databasePassword ?? randomBytes(24).toString("base64url"); secrets.add(databasePassword);
    sql(`alter role accordly_gateway password '${databasePassword}';`);
    const dbUrl = new URL("postgresql://localhost:55622/postgres"); dbUrl.username = "accordly_gateway"; dbUrl.password = databasePassword;
    const ca = readFileSync(cert, "utf8");
    const db = new Client({ connectionString: dbUrl.toString(), ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 5000 });
    await db.connect();
    try {
      if (!state.authUserId) {
        const email = "provider@example.test", password = `Aa9!${randomBytes(20).toString("base64url")}`; secrets.add(password);
        const auth = createClient(status.API_URL, status.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
        const created = await auth.auth.admin.createUser({ email, password, email_confirm: true });
        if (created.error) throw new Error("Could not create the fictional local provider account");
        state.authUserId = created.data.user.id; state.email = email; state.password = password;
        save(stateFile, state); // Recoverable fixture identity, no remote credentials.
      }
      if (!state.organizationId) state.organizationId = (await db.query("select accordly_commands.create_organization($1,'Atelier Demo Studio','individual') as id", [state.authUserId])).rows[0].id;
    } finally { await db.end(); }
    mkdirSync(path.join(dir, "mailbox"), { recursive: true, mode: 0o700 });
    state.databasePassword = databasePassword;
    state.nodeExecutable = process.execPath;
    state.env = { NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY, ACCORDLY_DATABASE_URL: dbUrl.toString(), ACCORDLY_DATABASE_CA_PEM: ca, ACCORDLY_DATABASE_ALLOW_LOCAL_PLAINTEXT: "false", ACCORDLY_APP_ORIGIN: "http://localhost:3000", ACCORDLY_SIGNING_MODE: "local-test", ACCORDLY_ACCOUNTS_MODE: "local-test", ACCORDLY_AUTH_RATE_KEY: state.env?.ACCORDLY_AUTH_RATE_KEY ?? randomBytes(32).toString("base64url"), ACCORDLY_CHALLENGE_HMAC_KEY: state.env?.ACCORDLY_CHALLENGE_HMAC_KEY ?? randomBytes(32).toString("base64url"), ACCORDLY_SIGNING_RATE_KEY: state.env?.ACCORDLY_SIGNING_RATE_KEY ?? randomBytes(32).toString("base64url"), ACCORDLY_CHALLENGE_KEY_ID: "demo-v1", ACCORDLY_LOCAL_MAILBOX: path.join(dir, "mailbox") };
    save(stateFile, state);
    save(path.join(dir, "access.json"), { url: "http://localhost:3000", email: state.email, password: state.password, note: "Fictional local-only account. Do not use real contracts or share this private directory." });
    console.log("Demo ready. Credentials: .demo/access.json. Run npm run demo, then open http://localhost:3000. No agreement has been fabricated or signed.");
  } else if (mode === "start") {
    const state = load();
    if (!state.env || state.env.ACCORDLY_APP_ORIGIN !== "http://localhost:3000" || new URL(state.env.NEXT_PUBLIC_SUPABASE_URL).port !== "55621") throw new Error("Invalid local demo configuration");
    await checkDemoAuth(state.env);
    console.log("Owned local Auth is reachable. Starting the demo with its saved configuration (no credentials printed).");
    const child = spawn(process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3000"], { cwd: root, env: { ...process.env, ...state.env }, windowsHide: true, stdio: ["inherit", "pipe", "pipe"] });
    child.stdout.on("data", (data) => process.stdout.write(safe(data))); child.stderr.on("data", (data) => process.stderr.write(safe(data)));
    child.on("exit", (code) => { process.exitCode = code ?? 1; });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
  } else if (mode === "mail") {
    const state = load(), id = process.argv[3];
    if (!state.env || !/^[0-9a-f-]{36}$/.test(id ?? "")) throw new Error("Usage: npm run demo:mail -- CHALLENGE_UUID (from the verification screen)");
    const delivery = JSON.parse(readFileSync(path.join(dir, "mailbox", `${id}.json`), "utf8"));
    if (!/^[^@\s]+@example\.test$/.test(delivery.recipient)) throw new Error("Not a fictional local delivery");
    console.log(`Local fictional recipient: ${delivery.recipient}\nChallenge: ${id}\nCode: ${delivery.code}\nTreat this as a private test mailbox; never forward real verification codes.`);
  } else if (mode === "stop") {
    const state = load(); cli("stop", "--project-id", state.project); console.log("Stopped only the owned local demo stack. Local data retained.");
  } else throw new Error("Use demo:setup, demo, demo:mail or demo:stop npm commands");
} catch (error) { console.error(safe(error.message)); process.exitCode = 1; }
