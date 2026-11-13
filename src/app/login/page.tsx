import { AccountShell } from "@/components/account-shell";
import { LoginForm } from "@/components/auth-controls";
import { AuthHeading } from "@/components/auth/ui";
export const dynamic = "force-dynamic";
export default function LoginPage() {
  return <AccountShell page="login"><AuthHeading title="Welcome back.">Sign in to your Accordly account.</AuthHeading><LoginForm /></AccountShell>;
}

