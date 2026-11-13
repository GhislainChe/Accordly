import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { randomUUID, randomBytes, createHash, createHmac, randomInt } from "node:crypto";
import { z } from "zod";
import { gatewayTransaction } from "@/lib/db/gateway";
import { GatewayError } from "@/lib/security/errors";
import { verifiedIdentity } from "@/lib/auth/identity-policy";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { authAccountSchema } from "./schemas";
import { accountConfig, accountPublicConfig } from "./config";
const proofCookie = "__Host-accordly-recovery-proof";
const hash = (id: string, value: string) => createHash("sha256").update(`accordly:recovery:v1:${id}:${value}`).digest("hex");
async function recoveryClient() {
  const jar = await cookies(), { url, publishableKey } = accountPublicConfig();
  return createServerClient(url, publishableKey, { cookieOptions: { name: "accordly-recovery", path: "/", httpOnly: true, secure: true, sameSite: "strict" }, cookies: { getAll: () => jar.getAll(), setAll: (values) => { for (const c of values) jar.set(c.name, c.value, c.options); } } });
}
async function recoveryIdentity(client: Awaited<ReturnType<typeof recoveryClient>>) {
  const { data, error } = await client.auth.getUser(); const actor = verifiedIdentity(data.user, error);
  const claims = await client.auth.getClaims(); const sid = z.uuid().safeParse(claims.data?.claims.session_id);
  if (claims.error || !sid.success || claims.data?.claims.sub !== actor.authUserId) throw new GatewayError(401, "authentication_required");
  return { ...actor, sid: sid.data };
}
export async function accountAuthOperation(raw: unknown) {
  const config = accountConfig(process.env), parsed = authAccountSchema.safeParse(raw);
  if (!parsed.success) throw new GatewayError(422, "invalid_account_input");
  const command = parsed.data;
  if ("email" in command && !/^[^\s@]+@example\.test$/.test(command.email)) throw new GatewayError(422, "local_recipient_required");
  // A reset's target is the verified recovery account, never a browser field
  // or a shared anonymous bucket that could exhaust every user's reset budget.
  const resetAuth = command.operation === "reset" ? await recoveryClient() : null;
  const resetActor = resetAuth ? await recoveryIdentity(resetAuth) : null;
  const target = "email" in command ? command.email : resetActor?.authUserId;
  if (!target) throw new GatewayError(401, "authentication_required");
  const mac = (value: string) => createHmac("sha256", Buffer.from(config.key, "base64url")).update(value).digest("hex");
  // No spoofable forwarded address. Conservative shared local ingress plus
  // native GoTrue rate/OTP controls. External mode remains fail-closed.
  const allowed = await gatewayTransaction(async (db) => (await db.query("select accordly_commands.account_rate_limit($1,$2,$3) as allowed", [command.operation, mac(`target:${target}`), mac("ingress:local")])).rows[0].allowed);
  if (!allowed) throw new GatewayError(429, "rate_limited");
  const { url, publishableKey } = accountPublicConfig();
  const settings = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: publishableKey }, cache: "no-store", signal: AbortSignal.timeout(10000) }).then((r) => r.ok ? r.json() : null);
  if (!settings || settings.mailer_autoconfirm !== false) throw new GatewayError(503, "accounts_disabled");
  const jar = await cookies();
  if (command.operation === "reset") {
    if (!resetAuth || !resetActor) throw new GatewayError(401, "authentication_required");
    const auth = resetAuth, actor = resetActor;
    const credential = z.string().regex(/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/).safeParse(jar.get(proofCookie)?.value);
    if (!credential.success) throw new GatewayError(403, "invalid_recovery");
    const [id, secret] = credential.data.split(".");
    // Auth and PostgreSQL cannot share a transaction. Consume BEFORE changing
    // password; failures require fresh recovery, never replay an uncertain write.
    await gatewayTransaction((db) => db.query("select accordly_commands.account_command($1,'recovery_consume',$2::jsonb)", [actor.authUserId, JSON.stringify({ id, auth_session_id: actor.sid, secret_digest: hash(id, secret) })]));
    jar.set(proofCookie, "", { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 0 });
    const changed = await auth.auth.updateUser({ password: command.password });
    if (changed.error) { await auth.auth.signOut({ scope: "local" }); throw new GatewayError(403, "invalid_recovery"); }
    const revoked = await auth.auth.signOut({ scope: "global" });
    if (revoked.error) throw new GatewayError(503, "account_action_uncertain");
    return { ok: true, next: "/login" };
  }
  if (command.operation === "verify") {
    const auth = command.purpose === "recovery" ? await recoveryClient() : await createServerSupabaseClient();
    // Keep native purposes exact. Generic type=email also accepts recovery
    // codes in GoTrue and must not turn recovery into ordinary signup login.
    const result = await auth.auth.verifyOtp({ email: command.email, token: command.code, type: command.purpose });
    if (result.error || !result.data.session) throw new GatewayError(403, "invalid_verification");
    verifiedIdentity(result.data.user, null);
    if (command.purpose === "signup") return { ok: true, next: "/onboarding" };
    const actor = await recoveryIdentity(auth), id = randomUUID(), secret = randomBytes(32).toString("base64url");
    await gatewayTransaction((db) => db.query("select accordly_commands.account_command($1,'recovery_issue',$2::jsonb)", [actor.authUserId, JSON.stringify({ id, auth_session_id: actor.sid, secret_digest: hash(id, secret) })]));
    jar.set(proofCookie, `${id}.${secret}`, { httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: 600 });
    return { ok: true, next: "/reset-password" };
  }
  const start = Date.now(), auth = await createServerSupabaseClient();
  try {
    if (command.operation === "signup") {
      const result = await auth.auth.signUp({ email: command.email, password: command.password, options: { data: { full_name: command.full_name } } });
      if (result.data.session) { await auth.auth.signOut({ scope: "local" }); throw new GatewayError(503, "accounts_disabled"); }
    } else if (command.operation === "resend") await auth.auth.resend({ type: "signup", email: command.email });
    else await auth.auth.resetPasswordForEmail(command.email, { redirectTo: `${config.origin}/recover` });
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    // Identical public acknowledgement for eligible, duplicate, unknown and
    // delivery-error requests. Never echo Auth response/user/identity metadata.
  }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, 650 + randomInt(150) - (Date.now() - start))));
  return { ok: true, message: "If this address is eligible, check its mailbox for a verification code." };
}
