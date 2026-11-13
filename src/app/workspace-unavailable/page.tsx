import { redirect } from "next/navigation";
import { AccountShell } from "@/components/account-shell";
import { AuthHeading } from "@/components/auth/ui";
import { LogoutButton } from "@/components/auth-controls";
import { accountStatus } from "@/features/accounts/onboarding";
import { GatewayError } from "@/lib/security/errors";
export const dynamic = "force-dynamic";
export default async function UnavailablePage() {
  let data; try { data = await accountStatus(); } catch (e) { if (e instanceof GatewayError && [401,403].includes(e.status)) redirect("/login"); throw e; }
  if (data.next !== "/workspace-unavailable") redirect(data.next);
  return <AccountShell page="onboarding"><AuthHeading title="Your workspace is unavailable.">Your account is signed in, but no workspace is currently accessible.</AuthHeading><p>Ask an authorized workspace owner to restore your membership. This page cannot assign a role or recreate a workspace automatically.</p><p>Guest review remains available through your private invitation.</p><a className="auth-button auth-secondary" href="/app">Check access again</a><LogoutButton /></AccountShell>;
}

