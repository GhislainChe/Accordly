"use client";
import { useId, useState } from "react";
import Link from "next/link";
export function AuthHeading({ title, children }: { title: string; children?: React.ReactNode }) { return <div className="auth-heading"><h1>{title}</h1>{children && <p>{children}</p>}</div>; }
export function AuthProgress({ step }: { step: 1 | 2 | 3 }) {
  return <div className="auth-progress"><ol aria-label="Registration progress">{[1, 2, 3].map(n => <li key={n} className={n < step ? "is-complete" : n === step ? "is-current" : ""} aria-current={n === step ? "step" : undefined}><span className="auth-sr-only">Step {n}{n === step ? ", current" : ""}</span></li>)}</ol><div><span className="auth-step-number" aria-hidden="true">{step}</span><span>Step {step} of 3</span></div></div>;
}
export function AuthField({ name, label, children, hint }: { name: string; label: string; children: React.ReactNode; hint?: string }) { return <div className="auth-field"><label htmlFor={name}>{label}</label>{children}{hint && <p id={`${name}-hint`} className="auth-hint">{hint}</p>}</div>; }
export function PasswordField({ name = "password", label = "Password", fresh = false, confirm = false }: { name?: string; label?: string; fresh?: boolean; confirm?: boolean }) {
  const [visible, setVisible] = useState(false);
  const hint = fresh && !confirm ? "At least 12 characters, including uppercase, lowercase, a number and a symbol. Maximum 72 UTF-8 bytes." : undefined;
  return <AuthField name={name} label={label} hint={hint}><div className="auth-password"><input id={name} name={name} type={visible ? "text" : "password"} autoComplete={fresh ? "new-password" : "current-password"} required minLength={fresh ? 12 : 1} maxLength={fresh ? 72 : 256} aria-describedby={hint ? `${name}-hint` : undefined} /><button type="button" aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? "Hide" : "Show"}</button></div></AuthField>;
}
export function AuthMessage({ children, error = false }: { children: React.ReactNode; error?: boolean }) { return <div className={`auth-message${error ? " auth-error" : ""}`} role={error ? "alert" : "status"}>{children}</div>; }
export function GoogleButton({ signup = false }: { signup?: boolean }) {
  const id = useId();
  return <div className="auth-google"><div className="auth-divider"><span>or</span></div><button className="auth-button auth-secondary" type="button" disabled aria-describedby={id}>{signup ? "Sign up" : "Sign in"} with Google</button><p id={id} className="auth-hint">Google sign-in is not configured for this environment.</p></div>;
}
export function LegalStatus() { return <details className="auth-hint auth-legal"><summary>Local demonstration · legal content pending</summary><p>The <Link href="/auth/legal#terms">Terms of Service</Link> and <Link href="/auth/legal#privacy">Privacy Policy</Link> await approved content. Legal agreement cannot yet be collected. Registration is for the fictional local demonstration only.</p></details>; }
