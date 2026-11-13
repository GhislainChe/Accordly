"use client";
import { usePathname } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Brand, Footer, LocalBanner } from "@/components/ui/primitives";
import { LogoutButton } from "@/components/auth-controls";
import { WorkspaceChoice } from "@/components/account-forms";
import type { AccountStatus } from "@/features/accounts/types";
import { FlowIcon } from "./icons";
import "./flowcanvas.css";

export function WorkspaceFrame({ children, email, account, local }: { children: React.ReactNode; email: string; account: AccountStatus; local: boolean }) {
  const home = usePathname() === "/app";
  if (!home) return <>{local && <LocalBanner />}<header className="app-header"><Brand /><nav aria-label="Workspace"><a className="nav-current" href="/app">Agreements</a></nav><div className="account"><span>{email}</span><LogoutButton /></div></header><main id="main" className="workspace">{children}</main><Footer /></>;
  const organization = account.workspaces.find(o => o.id === account.selected_workspace_id);
  const savedName = account.full_name?.trim();
  const name = savedName === "Existing account" ? undefined : savedName;
  return <div className="flow-app">
    <header className="flow-header"><Link href="/app" aria-label="Accordly home"><Image src="/brand/accordly.png" width={932} height={244} className="flow-logo" alt="Accordly" unoptimized loading="eager" /></Link>
      <nav aria-label="Workspace navigation"><Link href="/app">Workspace</Link><Link href="/app?mode=explore">Agreements</Link></nav>
      <div className="flow-header-actions"><Link href="/app?mode=explore#flow-search" className="flow-header-action" aria-label="Search agreements" title="Search agreements"><FlowIcon kind="search" /></Link><Link href="/app?mode=review" className="flow-header-action" aria-label="Review signing progress" title="Review signing progress"><FlowIcon kind="review" /></Link></div>
      <details className="flow-account" onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}><summary aria-label={`Workspace & account: ${organization?.name ?? "Current workspace"}`}><span className="flow-avatar" aria-hidden="true">{Array.from(name || email)[0].toUpperCase()}</span><span className="flow-workspace-name">{organization?.name ?? "Workspace & account"}</span><span aria-hidden="true">⌄</span></summary>
        <div className="flow-account-panel"><h2>Workspace & account</h2><p>{name || "Your account"}</p><p className="flow-muted flow-wrap">{email}</p><dl><div><dt>Workspace</dt><dd>{organization?.name ?? "Unavailable"}</dd></div><div><dt>Your role</dt><dd>{organization?.role ?? "Unavailable"}</dd></div></dl><WorkspaceChoice data={account} /><p className="flow-caption">Workspace selection uses your existing memberships. Profile editing and workspace administration are not available here yet.</p><LogoutButton /></div>
      </details>
    </header>
    <main id="main" className="flow-main"><div className="flow-introduction"><h1>Your work, in one flow.</h1><p>What would you like to do?</p></div>{children}</main>
    <footer className="flow-footer"><span>Accordly by BE WISE INNOVATION</span>{local && <span>Local demonstration · Fictional data only · Production signing disabled</span>}</footer>
  </div>;
}





