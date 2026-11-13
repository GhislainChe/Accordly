import { redirect } from "next/navigation";
import { AccountShell } from "@/components/account-shell";
import { OnboardingForm } from "@/components/account-forms";
import { LogoutButton } from "@/components/auth-controls";
import { accountStatus, registrationName } from "@/features/accounts/onboarding";
import { GatewayError } from "@/lib/security/errors";
export const dynamic = "force-dynamic";
export default async function OnboardingPage() {
  let data;
  try { data = await accountStatus(); } catch (e) { if (e instanceof GatewayError && [401,403].includes(e.status)) redirect("/login"); throw e; }
  if (data.completed) redirect(data.next);
  return <AccountShell page="onboarding"><OnboardingForm initial={data} suggestedName={await registrationName()} /><LogoutButton /></AccountShell>;
}

