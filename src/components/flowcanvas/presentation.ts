import type { AgreementRow, AgreementView, Workspace } from "@/features/agreements/types";

export const modes = ["canvas", "create", "review", "explore"] as const;
export type CanvasMode = typeof modes[number];
export function canvasMode(value: string | null): CanvasMode {
  return modes.includes(value as CanvasMode) ? value as CanvasMode : "canvas";
}
export const lifecycleLabels = { preparing: "Draft", awaiting_signatures: "Awaiting signatures", active: "Active" };
export function selectedWorkspace(data: Workspace): Workspace {
  // An absent selected workspace is not a request to combine tenants.
  return { ...data, agreements: data.selected_organization_id ? data.agreements.filter(a => a.organization_id === data.selected_organization_id) : [] };
}
export function visibleAgreements(rows: AgreementRow[], mode: CanvasMode, query: string, status: string) {
  const search = query.trim().toLowerCase();
  return rows.filter(a => (mode !== "review" || a.lifecycle === "awaiting_signatures") && (status === "all" || a.lifecycle === status) && (!search || a.title.toLowerCase().includes(search)));
}
export function currentVersion(data: AgreementView) {
  if (data.effective_version_id) return data.effective_version?.id === data.effective_version_id ? data.effective_version : data.versions.find(v => v.id === data.effective_version_id);
  return data.lifecycle === "awaiting_signatures" ? data.versions.at(-1) : undefined;
}
export function exactAmount(amount: string, currency: string, exponent: number) {
  if (!/^-?\d+$/.test(amount) || !Number.isInteger(exponent) || exponent < 0 || exponent > 9) return "Amount unavailable";
  const value = BigInt(amount), sign = value < BigInt(0) ? "−" : "", absolute = value < BigInt(0) ? -value : value;
  const scale = BigInt(10) ** BigInt(exponent);
  return `${sign}${(absolute / scale).toLocaleString("en-GB")}${exponent ? `.${(absolute % scale).toString().padStart(exponent, "0")}` : ""} ${currency}`;
}
export function updatedDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}


