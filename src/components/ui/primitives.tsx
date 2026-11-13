import Link from "next/link";
export function Brand() { return <Link href="/app" className="brand" aria-label="Accordly home"><span className="brand-mark" aria-hidden="true">a</span>accordly<span className="brand-dot">.</span></Link>; }
export function Status({ value }: { value: string }) {
  const labels: Record<string, string> = { preparing: "Draft", awaiting_signatures: "Awaiting signatures", active: "Active", pending: "Pending approval", effective: "Effective", current_effective: "Current effective", historical_effective: "Previously effective · superseded", rejected: "Rejected", withdrawn: "Withdrawn", expired: "Expired", superseded: "Superseded" };
  return <span className={`status status-${value}`}><span aria-hidden="true" />{labels[value] ?? value}</span>;
}
export function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) {
  return <div className={error ? "notice error" : "notice"} role={error ? "alert" : "status"}>{children}</div>;
}
export function Field({ label, name, hint, children }: { label: string; name: string; hint?: string; children: React.ReactNode }) {
  return <div className="field"><label htmlFor={name}>{label}</label>{children}{hint && <p className="hint" id={`${name}-hint`}>{hint}</p>}</div>;
}
export function LocalBanner() { return <div className="demo-banner"><span className="demo-indicator" />Local demonstration · Fictional projects only. Production signing is disabled.</div>; }
export function Footer() { return <footer className="footer"><span>Accordly · BE WISE INNOVATION</span><span>Clear expectations. Shared confidence.</span></footer>; }
