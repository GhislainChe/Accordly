import type { ReactNode } from "react";
type IconKind = "create" | "review" | "explore" | "search" | "document" | "selected";
export function FlowIcon({ kind, className }: { kind: IconKind; className?: string }) {
  const paths: Record<IconKind, ReactNode> = {
    create: <><path d="M12 5v14M5 12h14" /></>,
    review: <><path d="M7 3H5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8l-5-5H11" /><path d="M14 3v5h5M8 13l3 3 5-5" /></>,
    explore: <><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    document: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
    selected: <><circle cx="12" cy="12" r="8.5" /><path d="m8 12 2.5 2.5L16 9" /></>,
  };
  return <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[kind]}</svg>;
}
