import Link from "next/link";
import { AccountShell } from "@/components/account-shell";
import { AuthHeading } from "@/components/auth/ui";
export const dynamic = "force-dynamic";
export default function ExpiredPage() { return <AccountShell><AuthHeading title="Let’s start with a fresh code.">Your verification code may have expired or already been used.</AuthHeading><div className="auth-form"><Link className="auth-button" href="/verify">Verify your email</Link><Link className="auth-button auth-secondary" href="/recover">Recover your account</Link><p className="auth-hint">Request a fresh code from the appropriate screen. Opening this page does not redeem or resend a code.</p></div></AccountShell>; }

