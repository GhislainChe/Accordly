"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Field, Notice } from "./ui/primitives";
import { AuthHeading, AuthProgress, AuthField, PasswordField, AuthMessage, GoogleButton, LegalStatus } from "./auth/ui";
import { request, useAction, useIdempotency } from "@/lib/ui/api";
import type { AccountStatus } from "@/features/accounts/types";

export function AccountEntry({ mode, enabled }: { mode: "signup" | "verify" | "recover" | "reset"; enabled: boolean }) {
  const [email, setEmail] = useState(""), [verify, setVerify] = useState(mode === "verify"), [code, setCode] = useState("");
  const router = useRouter(), action = useAction();
  const recovery = mode === "recover", registration = mode === "signup" && !verify;
  const passwordForm = mode === "reset" || registration;
  const api = (body: unknown) => request<{ next?: string }>("/api/auth/account", body);
  return <>{registration && <AuthProgress step={1} />}<AuthHeading title={mode === "reset" ? "Reset your password." : verify ? "Verify your email." : recovery ? "Forgot your password?" : "Create your account."}>{registration ? "Join Accordly and start creating, signing and managing agreements with confidence." : verify ? "If your address is eligible, check its mailbox for a six-digit code. Codes expire in 10 minutes." : recovery ? "Enter your email address to request a secure recovery code." : "Choose a strong new password for your Accordly account."}</AuthHeading>
    {!enabled && <AuthMessage error>Registration and recovery are unavailable here. Approved Auth configuration, production delivery and abuse controls are required.</AuthMessage>}
    {action.error && <AuthMessage error>{action.error}</AuthMessage>}{action.message && <AuthMessage>{action.message}</AuthMessage>}
    <form className="auth-form" aria-busy={action.busy} onSubmit={(e) => { e.preventDefault(); const element = e.currentTarget, form = new FormData(element), password = form.get("password");
      if (passwordForm && password !== form.get("confirm_password")) { action.setError("Passwords do not match. Please check both password fields."); const confirm = element.elements.namedItem("confirm_password") as HTMLInputElement; confirm.focus(); return; }
      void action.run(async () => { try {
        const body = mode === "reset" ? { operation: "reset", password } : verify ? { operation: "verify", email, code, purpose: recovery ? "recovery" : "signup" } : recovery ? { operation: "recover", email } : { operation: "signup", email, full_name: form.get("full_name"), password };
        const result = await api(body);
        if (result.next) { router.replace(result.next); router.refresh(); }
        else { setVerify(true); setCode(""); action.setMessage("If this address is eligible, check its mailbox for a verification code. This request does not authorize a workspace."); }
      } finally { for (const name of ["password", "confirm_password"]) { const input = element.elements.namedItem(name) as HTMLInputElement | null; if (input) input.value = ""; } } }); }}>
      {registration && <AuthField label="Full name" name="full_name"><input id="full_name" name="full_name" autoComplete="name" required maxLength={200} /></AuthField>}
      {mode !== "reset" && <AuthField label="Email address" name="account-email"><input id="account-email" name="email" type="email" autoComplete="email" required maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} /></AuthField>}
      {verify && <AuthField label="Email verification code" name="account-code"><input id="account-code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} /></AuthField>}
      {passwordForm && <><PasswordField fresh label={mode === "reset" ? "New password" : "Password"} /><PasswordField fresh confirm name="confirm_password" label="Confirm password" /></>}
      {registration && <LegalStatus />}
      <button className="auth-button" disabled={!enabled || action.busy}>{action.busy ? "Processing…" : mode === "reset" ? "Update password" : verify ? "Verify email" : recovery ? "Send recovery code" : "Continue"}</button>
    </form>
    {registration && <GoogleButton signup />}
    {!verify && recovery && <p className="auth-bottom"><button className="auth-link" onClick={() => setVerify(true)}>I already have a recovery code</button></p>}
    {verify && <p className="auth-bottom"><button className="auth-link" disabled={!enabled || action.busy || !email} onClick={() => void action.run(async () => { await api({ operation: recovery ? "recover" : "resend", email }); setCode(""); }, "If this address is eligible, check its mailbox. Requests are rate limited.")}>Request a fresh code</button></p>}
    <p className="auth-bottom">{registration ? "Already have an account? " : ""}<Link href="/login">{registration ? "Sign in" : "Back to sign in"}</Link></p>
    {verify && <p className="auth-bottom auth-hint">Mailbox control is not verified legal identity. <Link href="/auth/help">Verification help</Link></p>}
  </>;
}

export function OnboardingForm({ initial, suggestedName }: { initial: AccountStatus; suggestedName: string }) {
  const [data, setData] = useState(initial), [kind, setKind] = useState(initial.work_kind ?? "individual"), [purpose, setPurpose] = useState(initial.purpose ?? "create"), [name, setName] = useState(initial.full_name ?? suggestedName);
  const action = useAction(), idempotent = useIdempotency(), router = useRouter();
  async function refresh() { const saved = await request<AccountStatus>("/api/account"); setData(saved); setKind(saved.work_kind ?? "individual"); setPurpose(saved.purpose ?? "create"); setName(saved.full_name ?? suggestedName); }
  return <><AuthProgress step={data.step === 2 ? 2 : 3} /><AuthHeading title={data.step === 2 ? "Tell us about your work." : "Set up your workspace."}>{data.step === 2 ? "Just a little information to personalize your experience." : "Give your workspace a name that feels like you."}</AuthHeading>
    {action.error && <AuthMessage error>{action.error}<br /><button className="auth-link" disabled={action.busy} onClick={() => void action.run(refresh)}>Reload saved progress</button></AuthMessage>}
    {data.step === 2 ? <form className="auth-form" aria-busy={action.busy} onSubmit={(e) => { e.preventDefault(); void action.run(async () => { await request("/api/account", idempotent({ operation: "preferences", expected_revision: data.revision, full_name: name, work_kind: kind, purpose })); await refresh(); }); }}>
      {!initial.full_name && !suggestedName && <AuthField name="onboarding-name" label="Full name"><input id="onboarding-name" name="full_name" value={name} onChange={e => setName(e.target.value)} autoComplete="name" required maxLength={200} /></AuthField>}
      <fieldset><legend>How do you work?</legend><div className="auth-options">{[["individual", "Individual / Freelancer"], ["business", "Business / Organization"]].map(([v, label]) => <label className="auth-option" key={v}><input type="radio" name="work-kind" required value={v} checked={kind === v} onChange={() => setKind(v as typeof kind)} />{label}</label>)}</div></fieldset>
      <fieldset><legend>What will you use Accordly for?</legend><div className="auth-options">{[["create", "Creating and managing agreements"], ["review", "Reviewing and signing agreements"], ["both", "Both"]].map(([v, label]) => <label className="auth-option" key={v}><input type="radio" name="purpose" required value={v} checked={purpose === v} onChange={() => setPurpose(v as typeof purpose)} />{label}</label>)}</div></fieldset>
      <button className="auth-button" disabled={action.busy}>{action.busy ? "Saving…" : "Continue"}</button><Link className="auth-link" href="/login">Back</Link>
    </form> : <div className="auth-form"><form className="auth-form" aria-busy={action.busy} onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); void action.run(async () => { const result = await request<{ next: string }>("/api/account", idempotent({ operation: "complete", expected_revision: data.revision, workspace_name: form.get("workspace_name") })); router.replace(result.next); router.refresh(); }); }}>
      <AuthField label={data.work_kind === "individual" ? "Professional display name" : "Business or organization name"} name="workspace-name"><input id="workspace-name" name="workspace_name" required maxLength={200} autoComplete="organization" /></AuthField>
      <p className="auth-hint">You can belong to more than one authorized workspace. Your preferences do not grant access to other people’s agreements.</p><button className="auth-button" disabled={action.busy}>{action.busy ? "Creating…" : "Finish setup"}</button>
    </form>{data.workspaces.length > 0 && <details><summary>Use an existing workspace</summary>{data.workspaces.map((o) => <button className="auth-button auth-secondary" disabled={action.busy} key={o.id} onClick={() => void action.run(async () => { await request("/api/account", idempotent({ operation: "use_existing", expected_revision: data.revision, organization_id: o.id })); router.replace("/app"); router.refresh(); })}>{o.name} · {o.role}</button>)}</details>}
      <button className="auth-link" disabled={action.busy} onClick={() => setData({ ...data, step: 2 })}>Back</button></div>}
  </>;
}

export function WorkspaceChoice({ data }: { data: Pick<AccountStatus, "selected_workspace_id" | "workspaces"> }) {
  const action = useAction(), idempotent = useIdempotency(), router = useRouter();
  if (data.workspaces.length < 2) return null;
  return <><Field name="current-workspace" label="Current workspace"><select id="current-workspace" disabled={action.busy} value={data.selected_workspace_id ?? ""} onChange={(e) => { const organization_id = e.target.value; void action.run(async () => { await request("/api/account", idempotent({ operation: "select_workspace", organization_id })); router.refresh(); }); }}>{data.workspaces.map((o) => <option value={o.id} key={o.id}>{o.name}</option>)}</select></Field>{action.error && <Notice error>{action.error}</Notice>}</>;
}



