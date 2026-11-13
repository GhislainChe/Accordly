import Link from "next/link";
import { AccountShell } from "@/components/account-shell";
import { AuthHeading } from "@/components/auth/ui";
export const dynamic = "force-dynamic";
export default function AuthErrorPage() { return <AccountShell><AuthHeading title="We couldn’t complete that step.">Return to sign in or request a fresh recovery code. Your agreement data has not been changed by this page.</AuthHeading><div className="auth-form"><Link className="auth-button" href="/login">Back to sign in</Link><Link className="auth-button auth-secondary" href="/recover">Recover your account</Link><Link className="auth-link" href="/auth/help">Get account help</Link></div></AccountShell>; }

