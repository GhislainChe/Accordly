import { accountStatus } from "@/features/accounts/onboarding";
import { redirect } from "next/navigation";
import { getVerifiedIdentity } from "@/lib/auth/verified-identity";
import { WorkspaceFrame } from "@/components/flowcanvas/workspace-frame";
import { signingConfig } from "@/features/signing/config";
export const dynamic = "force-dynamic";
export default async function ProviderLayout({ children }: { children: React.ReactNode }) {
  let email: string; try { email = (await getVerifiedIdentity()).email; } catch { redirect("/login"); }
  const account = await accountStatus();
  if (account.next !== "/app") redirect(account.next);
  let local = false; try { signingConfig(process.env); local = true; } catch { /* No signing enablement. */ }
  return <WorkspaceFrame email={email} account={account} local={local}>{children}</WorkspaceFrame>;
}
