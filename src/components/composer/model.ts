import type { Draft, Party } from "@/features/agreements/types";

export type PreviewParty = { side: "provider" | "client"; legal_name: string; contact_email: string; signer: string };
export const emptyDraft = (): Draft => ({ scope: "", terms: "", amount_minor: "", currency_code: "XAF", currency_exponent: 0, content_language: "en", deadline: { kind: "date", date: "" }, milestones: [], attachments: [] });
export function previewParties(parties: Party[], representatives: { party_id: string; display_name: string }[]): PreviewParty[] {
  return parties.map(p => ({ side: p.side, legal_name: p.legal_name, contact_email: p.contact_email, signer: representatives.find(r => r.party_id === p.id)?.display_name ?? "" }));
}
export function exactXaf(value: string): string | null {
  return /^(0|[1-9][0-9]{0,15})$/.test(value) && BigInt(value) <= BigInt("9000000000000000") ? `${BigInt(value).toLocaleString("en-GB")} XAF` : null;
}
export function validDeadline(value: Draft["deadline"]): boolean {
  if (value.kind === "date") {
    const date = new Date(`${value.date}T00:00:00.000Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(value.date) && Number(value.date.slice(0,4)) > 0 && Number.isFinite(date.valueOf()) && date.toISOString().slice(0,10) === value.date;
  }
  try { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.at) && new Date(value.at).toISOString() === value.at && !!new Intl.DateTimeFormat("en", { timeZone: value.timezone }); } catch { return false; }
}
// Presentation feedback only. The existing server Zod schema and SQL commands
// remain authoritative; this module never canonicalizes or freezes a version.
export function composerErrors(draft: Draft, title: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!title.trim() || title.length > 300) errors.title = "Enter an agreement title (up to 300 characters).";
  if (!draft.scope.trim()) errors.scope = "Describe the agreed scope and deliverables.";
  if (!draft.terms.trim()) errors.terms = "Enter the terms already agreed by the parties.";
  if (!exactXaf(draft.amount_minor) || draft.amount_minor === "0") errors.amount = "Enter a positive whole XAF amount, up to 9,000,000,000,000,000.";
  if (!validDeadline(draft.deadline)) errors.deadline = "Enter a valid date, or an exact UTC time and IANA timezone.";
  draft.milestones.forEach((m, i) => {
    if (!m.description.trim() || !m.acceptance_terms.trim() || !exactXaf(m.amount_minor) || !validDeadline(m.deadline)) errors[`milestone-${i}`] = "Complete the deliverable, exact nonnegative amount, deadline and acceptance terms.";
  });
  if (draft.milestones.length && !errors.amount && draft.milestones.every(m => exactXaf(m.amount_minor))) {
    if (draft.milestones.reduce((n,m) => n + BigInt(m.amount_minor), BigInt(0)) !== BigInt(draft.amount_minor)) errors.milestones = "Milestones must allocate the full agreement amount exactly.";
  }
  return errors;
}
