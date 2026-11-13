import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const image = "public.ecr.aws/supabase/postgres:17.11.0.003@sha256:7374d196da7e301512cc5329e18040e0f7bb856287b323777cdadecccbc6c7e4";
const name = `accordly-foundation-test-${randomUUID()}`;
let containerId;

function docker(args, { input, allowFailure = false, timeout = 60_000 } = {}) {
  const result = spawnSync("docker", args, { cwd: root, input, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    // Never accept a connection string or echo container environment/credentials.
    throw new Error(`Docker command failed: ${result.stderr || result.stdout}`);
  }
  return result;
}

function sql(input, user = "postgres") {
  return docker(["exec", "-i", containerId, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-U", user, "-d", "postgres"], { input });
}

function concurrentGatewaySql(input) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", containerId, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-h", "127.0.0.1", "-U", "accordly_gateway", "-d", "postgres"], { cwd: root });
    let stderr = "";
    let stdout = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Concurrent gateway transaction timed out")); }, 30_000);
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (status) => { clearTimeout(timer); resolve({ status, stderr, stdout }); });
    child.stdin.end(input);
  });
}

try {
  docker(["version", "--format", "{{.Server.Version}}"]);
  docker(["image", "inspect", image, "--format", "{{.Id}}"]);
  // No host ports, network, credentials, mounted project files, or persistent DB
  // volume. This runner cannot target a URL, existing container or remote DB.
  containerId = docker(["run", "--detach", "--name", name, "--network", "none", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", image]).stdout.trim();
  const deadline = Date.now() + 60_000;
  let ready = false;
  while (Date.now() < deadline) {
    if (docker(["exec", containerId, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], { allowFailure: true }).status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Disposable PostgreSQL did not become ready");
  console.log(`Disposable Supabase PostgreSQL: ${image}`);
  const migrationDir = path.join(root, "supabase", "migrations");
  const migrations = readdirSync(migrationDir).filter((file) => /^\d{14}_[a-z0-9_]+\.sql$/.test(file)).sort();
  if (!migrations.length) throw new Error("No migrations found");
  function applyMigrations() {
    for (const file of migrations) {
      sql(readFileSync(path.join(migrationDir, file), "utf8"));
      console.log(`Applied ${file}`);
    }
  }
  applyMigrations();
  const login = sql("select current_user;", "accordly_gateway").stdout.trim();
  if (login !== "accordly_gateway") throw new Error("Gateway login validation failed");
  const escalation = docker(["exec", "-i", containerId, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-h", "127.0.0.1", "-U", "accordly_gateway", "-d", "postgres"], {
    input: "set role accordly_executor;", allowFailure: true,
  });
  if (escalation.status === 0 || !escalation.stderr.includes("42501")) throw new Error("Actual gateway session could escalate roles or returned an unexpected error");
  console.log("Restricted gateway login passed (not an administrator session)");
  const testDir = path.join(root, "supabase", "tests", "database");
  let total = 0;
  for (const file of readdirSync(testDir).filter((name) => name.endsWith(".test.sql")).sort()) {
    // supabase_admin is used only for extension/fixture setup. SQL switches to
    // the actual gateway, executor and API roles before authorization assertions.
    const result = sql(readFileSync(path.join(testDir, file), "utf8"), "supabase_admin");
    process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (/^not ok\b/m.test(result.stdout)) throw new Error(`pgTAP assertion failed: ${file}`);
    const plan = result.stdout.match(/^1\.\.(\d+)\s*$/m);
    const assertions = result.stdout.match(/^ok \d+\b/gm) ?? [];
    if (!plan || assertions.length !== Number(plan[1])) throw new Error(`Missing/incomplete TAP plan: ${file}`);
    total += assertions.length;
  }
  console.log(`Database security assertions passed: ${total}; migrations: ${migrations.length}`);

  // Reuse only setup/helpers from the SQL suite in this runner-owned container.
  // Auth assertions/HMACs here are simulated; the restricted sessions, locks,
  // deferred constraints and concurrent transactions are actual PostgreSQL.
  const amendmentSource = readFileSync(path.join(testDir, "amendments.test.sql"), "utf8");
  const racePrefix = amendmentSource.split("do $$ declare d jsonb; f jsonb; proof jsonb; begin")[0]
    .replace(/^select (?:no_plan|is|ok|throws_ok|lives_ok)\(.*;\r?$/gm, "");
  const raceFixture = sql(racePrefix + `
    do $$ declare f jsonb; proof jsonb; jobs jsonb:='[]'; i integer; begin
      for i in 1..2 loop
        f:=current_setting('amend.frozen'||i)::jsonb;
        proof:=pg_temp.amend_proof('provider',f);
        perform pg_temp.approve_amend('provider',f,proof,gen_random_uuid());
        proof:=pg_temp.amend_proof('client',f);
        jobs:=jobs||jsonb_build_array(jsonb_build_object('proposal_id',f->>'proposal_id','input',jsonb_build_object('proposal_id',f->>'proposal_id','digest',f->>'digest','proof_id',proof->>'proof_id','typed_name','client','affirmative',true,'consent_text','By signing, I explicitly consent to this exact agreement amendment.','disclosure_version','accordly-amendment-v1','idempotency_key',gen_random_uuid()),'internal',current_setting('sign.client_session')::jsonb||jsonb_build_object('proof_digest',proof->>'proof_digest')));
      end loop;
      perform set_config('race.jobs',jsonb_build_object('agreement_id',current_setting('sign.agreement'),'jobs',jobs)::text,true);
    end $$;
    select 'RACE:'||current_setting('race.jobs'); commit;`, "supabase_admin");
  const race = JSON.parse(raceFixture.stdout.split(/\r?\n/).find((line) => line.startsWith("RACE:")).slice(5));
  const raceLiteral = (value) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const winners = await Promise.all(race.jobs.map((job) => concurrentGatewaySql(`select coalesce(r->>'proposal_state',r->>'error') from accordly_commands.signing_command(null,null,null,'amendment_approval',${raceLiteral(job.input)},${raceLiteral(job.internal)}) r;`)));
  if (winners.some((r) => r.status !== 0) || winners.map((r) => r.stdout.trim()).sort().join() !== "effective,invalid_capability") throw new Error("Competing final amendment approvals failed to select one winner");
  const raceState = sql(`select count(*) filter(where state='effective')||':'||count(*) filter(where state='superseded') from accordly.agreement_proposals where agreement_id='${race.agreement_id}' and kind='amendment';`, "supabase_admin").stdout.trim();
  if (raceState !== "1:2") throw new Error("Concurrent amendment activation did not supersede every same-base competitor");
  console.log("Concurrent competing amendments passed: one effective winner; two same-base competitors superseded; stale final proof refused");

  // This database belongs exclusively to this runner. Prove schema replay when
  // cluster roles survive a local reset. No external URL/container is accepted.
  sql("drop schema accordly_commands cascade; drop schema accordly cascade;", "supabase_admin");
  applyMigrations();
  console.log("Migration replay passed with retained, validated cluster roles");

  const authA = randomUUID();
  const authB = randomUUID();
  sql(`insert into auth.users(id,email) values ('${authA}','concurrency-a@example.test'),('${authB}','concurrency-b@example.test');`, "supabase_admin");
  const principalA = sql(`select accordly_commands.register_principal('${authA}');`, "accordly_gateway").stdout.trim();
  const principalB = sql(`select accordly_commands.register_principal('${authB}');`, "accordly_gateway").stdout.trim();
  const organization = sql(`select accordly_commands.create_organization('${authA}','Concurrent owners','business');`, "accordly_gateway").stdout.trim();
  sql(`select accordly_commands.set_membership('${authA}','${organization}','${principalB}','owner',true);`, "accordly_gateway");
  const results = await Promise.all([
    concurrentGatewaySql(`begin; select accordly_commands.set_membership('${authA}','${organization}','${principalA}','viewer',false); select pg_sleep(0.5); commit;`),
    concurrentGatewaySql(`begin; select accordly_commands.set_membership('${authB}','${organization}','${principalB}','viewer',false); select pg_sleep(0.5); commit;`),
  ]);
  if (results.filter((r) => r.status === 0).length !== 1 || results.filter((r) => r.status !== 0 && r.stderr.includes("23514")).length !== 1) {
    throw new Error(`Concurrent owner removal failed: ${results.map((r) => `${r.status}: ${r.stderr}`).join("; ")}`);
  }
  const remaining = sql(`select count(*) from accordly.organization_memberships where organization_id='${organization}' and active and role='owner';`, "supabase_admin").stdout.trim();
  if (remaining !== "1") throw new Error("Concurrent removals violated the last-owner invariant");
  console.log("Concurrent real-gateway sessions: exactly one removal committed; one owner preserved");

  const ownerAuth = sql(`select p.auth_user_id from accordly.organization_memberships m join accordly.principals p on p.id=m.principal_id where m.organization_id='${organization}' and m.active and m.role='owner';`, "supabase_admin").stdout.trim();
  const ownerEmail = ownerAuth === authA ? "concurrency-a@example.test" : "concurrency-b@example.test";
  const preparationOrg = sql(`select accordly_commands.create_organization('${ownerAuth}','Concurrent preparation','business');`, "accordly_gateway").stdout.trim();
  const draft = { scope: "Concurrent scope", terms: "Terms", amount_minor: "1000", currency_code: "XAF", currency_exponent: 0, content_language: "en", deadline: { kind: "date", date: "2027-01-31" }, milestones: [], attachments: [] };
  const literal = (v) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
  const createKey = randomUUID();
  const createSql = `select accordly_commands.execute_preparation('${ownerAuth}','create_draft','${preparationOrg}','${createKey}',${literal({ title: "Concurrent", draft })},'${ownerEmail}')->>'agreement_id';`;
  const duplicates = await Promise.all([concurrentGatewaySql(createSql), concurrentGatewaySql(createSql)]);
  if (duplicates.some((r) => r.status !== 0) || !duplicates[0].stdout.trim() || duplicates[0].stdout.trim() !== duplicates[1].stdout.trim()) throw new Error("Concurrent identical create requests were not deduplicated");
  const agreement = duplicates[0].stdout.trim();
  const updates = await Promise.all(["First", "Second"].map((scope) => concurrentGatewaySql(`select accordly_commands.execute_preparation('${ownerAuth}','update_draft','${agreement}','${randomUUID()}',${literal({ expected_revision: "1", draft: { ...draft, scope } })},'${ownerEmail}');`)));
  if (updates.filter((r) => r.status === 0).length !== 1 || updates.filter((r) => r.status !== 0 && r.stderr.includes("P4090")).length !== 1) throw new Error("Concurrent expected-revision updates were not serialized");
  sql(`select accordly_commands.execute_preparation('${ownerAuth}','set_parties','${agreement}','${randomUUID()}',${literal({ expected_revision: "2", provider: { legal_name: "Provider", representative_name: "Owner" }, client: { legal_name: "Client", representative_name: "Client", email: "client-prepare@example.test" } })},'${ownerEmail}');`, "accordly_gateway");
  const freezes = await Promise.all([1, 2].map(() => concurrentGatewaySql(`select accordly_commands.execute_preparation('${ownerAuth}','freeze','${agreement}','${randomUUID()}',${literal({ expected_revision: "3" })},'${ownerEmail}');`)));
  if (freezes.filter((r) => r.status === 0).length !== 1 || freezes.filter((r) => r.status !== 0 && r.stderr.includes("P4090")).length !== 1) throw new Error("Concurrent freezes did not select exactly one candidate");
  if (sql(`select count(*) from accordly.agreement_versions where agreement_id='${agreement}';`, "supabase_admin").stdout.trim() !== "1") throw new Error("Concurrent freeze duplicated versions");
  console.log("Concurrent preparation passed: identical creates deduplicated; stale updates/freeze rejected; one frozen version");
  sql("do $$ begin for i in 1..4 loop perform accordly_commands.signing_rate_limit(array['invitation:concurrentfixture'],true); end loop; end $$;", "accordly_gateway");
  const counterResults = await Promise.all([1, 2].map(() => concurrentGatewaySql("select accordly_commands.signing_rate_limit(array['invitation:concurrentfixture'],true);")));
  if (counterResults.some((r) => r.status !== 0) || counterResults.map((r) => r.stdout.trim()).sort().join() !== "f,t") throw new Error("Concurrent shared abuse counters did not enforce the fifth-send limit");
  console.log("Concurrent shared abuse counter passed: exactly one fifth send allowed across actual gateway sessions");
  const onboardingAuth = randomUUID();
  sql(`insert into auth.users(id,email) values('${onboardingAuth}','concurrent-onboarding@example.test');`, "supabase_admin");
  sql(`select accordly_commands.account_command('${onboardingAuth}','preferences',${literal({ full_name: "Concurrent Example", work_kind: "business", purpose: "both", expected_revision: "1", idempotency_key: randomUUID() })});`, "accordly_gateway");
  const onboardResults = await Promise.all(["Business First", "Business Second"].map((name) => concurrentGatewaySql(`select accordly_commands.account_command('${onboardingAuth}','complete',${literal({ workspace_name: name, expected_revision: "2", idempotency_key: randomUUID() })});`)));
  if (onboardResults.filter((r) => r.status === 0).length !== 1 || onboardResults.filter((r) => r.status !== 0 && r.stderr.includes("P4090")).length !== 1) throw new Error("Concurrent distinct onboarding completions did not select one initial workspace");
  if (sql(`select count(*) from accordly.organizations where created_by=(select id from accordly.principals where auth_user_id='${onboardingAuth}');`, "supabase_admin").stdout.trim() !== "1") throw new Error("Concurrent onboarding created duplicate workspaces");
  console.log("Concurrent onboarding passed: one workspace/owner committed; conflicting initial completion refused");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  // Delete only the exact ID returned by this process's successful docker run.
  if (containerId && /^[a-f0-9]{64}$/.test(containerId)) {
    const cleanup = docker(["rm", "--force", "--volumes", containerId], { allowFailure: true });
    if (cleanup.status !== 0) {
      console.error("Failed to remove this runner's disposable container; cleanup is required");
      process.exitCode = 1;
    } else {
      console.log("Removed disposable test container and its volumes");
    }
  }
}
