import { AccountEntry } from "@/components/account-forms";
import { AccountShell } from "@/components/account-shell";
import { accountConfig } from "@/features/accounts/config";
export const dynamic = "force-dynamic";
export default function RegisterPage() { let enabled = false; try { accountConfig(process.env); enabled = true; } catch {} return <AccountShell page="register"><AccountEntry mode="signup" enabled={enabled} /></AccountShell>; }

