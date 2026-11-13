"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { request, useAction } from "@/lib/ui/api";
import { AuthField, PasswordField, AuthMessage, GoogleButton } from "./auth/ui";
export function LoginForm() {
  const router = useRouter(), action = useAction();
  return <><form className="auth-form" aria-busy={action.busy} onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); void action.run(async () => {
    const result = await request<{ next: string }>("/api/auth/login", { email: form.get("email"), password: form.get("password") }); router.replace(result.next); router.refresh();
  }); }}>
    <AuthField label="Email address" name="email"><input id="email" name="email" type="email" autoComplete="username" required maxLength={320} /></AuthField>
    <PasswordField />
    <div className="auth-right"><Link className="auth-link" href="/recover">Forgot password?</Link></div>
    {action.error && <AuthMessage error>{action.error}<details className="auth-context-help"><summary>Need help verifying your email?</summary><p>If you haven’t confirmed your account, <Link href="/verify">enter your verification code or request a fresh one</Link>. This does not check whether an account exists.</p></details></AuthMessage>}
    <button className="auth-button" disabled={action.busy}>{action.busy ? "Signing in…" : "Sign in"}</button>
  </form><GoogleButton /><p className="auth-bottom">New to Accordly? <Link href="/register">Create an account</Link></p></>;
}
export function LogoutButton() {
  const router = useRouter(), action = useAction();
  return <div><button className="button quiet" disabled={action.busy} onClick={() => void action.run(async () => { await request("/api/auth/logout", {}); router.replace("/login"); router.refresh(); })}>{action.busy ? "Signing out…" : "Sign out"}</button>{action.error && <span role="alert" className="inline-error">{action.error}</span>}</div>;
}
