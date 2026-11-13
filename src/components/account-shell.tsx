import Image from "next/image";
import Link from "next/link";
import "./auth/auth.css";
export function AccountShell({ children, page }: { children: React.ReactNode; page?: "login" | "register" | "onboarding" }) {
  return <div className="auth-app"><header className="auth-header"><Link href="/login" aria-label="Accordly home"><Image className="auth-logo" src="/brand/accordly.png" alt="Accordly" width={932} height={244} loading="eager" unoptimized /></Link><nav aria-label="Account navigation">{page !== "login" && page !== "onboarding" && <Link href="/login">Sign in</Link>}{page !== "register" && page !== "onboarding" && <Link href="/register">Create account</Link>}<Link href="/auth/help">FAQ</Link></nav></header><main id="main" className="auth-main">{children}</main><footer className="auth-footer"><span>Accordly by BE WISE INNOVATION</span><Link href="/auth/legal">Legal information</Link></footer></div>;
}

