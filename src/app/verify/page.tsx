import { AccountEntry } from "@/components/account-forms";
import { AccountShell } from "@/components/account-shell";
import { accountConfig } from "@/features/accounts/config";
export const dynamic = "force-dynamic";
export default function VerifyPage() { let enabled = false; try { accountConfig(process.env); enabled = true; } catch {} return <AccountShell><AccountEntry mode="verify" enabled={enabled} /></AccountShell>; }
