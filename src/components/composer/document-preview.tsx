import type { Draft } from "@/features/agreements/types";
import { exactXaf, validDeadline, type PreviewParty } from "./model";

export function PreviewDeadline({ value }: { value: Draft["deadline"] }) {
  if (!validDeadline(value)) return <span className="studio-placeholder">Deadline not complete</span>;
  return value.kind === "date" ? <span>{value.date} <small>· date only</small></span> : <span>{value.at}<br /><small>Agreed timezone: {value.timezone}</small></span>;
}
function Text({ value, missing }: { value: string; missing: string }) { return value.trim() ? <p className="studio-preserve">{value}</p> : <p className="studio-placeholder">{missing}</p>; }
export function AgreementPreview({ title, draft, parties }: { title: string; draft: Draft; parties: PreviewParty[] }) {
  return <article className="studio-document" aria-label="Live unsigned agreement preview">
    <header><div className="studio-document-top"><span>AGREEMENT PREVIEW</span><strong>DRAFT / NOT SIGNED</strong></div><h2>{title.trim() || "Untitled agreement"}</h2><p className="studio-document-note">{draft.content_language === "fr" ? "French" : "English"} controls · Unsaved edits may be shown</p></header>
    <section className="studio-document-parties"><h3>The parties</h3><div className="studio-party-grid">{(["provider", "client"] as const).map(side => { const party = parties.find(p => p.side === side); return <div key={side}><span className="studio-label">{side === "provider" ? "Provider" : "Client"}</span><h4>{party?.legal_name.trim() || "Not provided"}</h4>{party?.contact_email && <p>{party.contact_email}</p>}{party?.signer && <p>Designated signer: {party.signer}</p>}</div>; })}</div></section>
    <section><h3>Scope & deliverables</h3><Text value={draft.scope} missing="Your agreed scope and deliverables will appear here." /></section>
    <section><h3>Financial terms & deadline</h3><div className="studio-document-facts"><div><span className="studio-label">Total agreed amount</span><strong>{exactXaf(draft.amount_minor) ?? "Amount not complete"}</strong></div><div><span className="studio-label">Project deadline</span><PreviewDeadline value={draft.deadline} /></div></div></section>
    {draft.milestones.length > 0 && <section><h3>Milestones</h3>{draft.milestones.map((m,i) => <div className="studio-document-milestone" key={i}><h4>{i + 1}. {m.description.trim() || "Deliverable not provided"}</h4><p>{exactXaf(m.amount_minor) ?? "Amount not complete"} · <PreviewDeadline value={m.deadline} /></p><Text value={m.acceptance_terms} missing="Acceptance terms not provided." /></div>)}</section>}
    <section><h3>Additional agreed terms</h3><Text value={draft.terms} missing="Your agreed terms will appear here. No clauses are added automatically." /></section>
    <section><h3>Future signing</h3><p className="studio-document-note">No signatures or consent have been recorded. After freezing, each designated signer must review the exact frozen version through the existing verified signing flow.</p><div className="studio-party-grid">{(["provider", "client"] as const).map(side => <div className="studio-signature" key={side}><span className="studio-label">{side}</span><p>{parties.find(p => p.side === side)?.signer.trim() || "Signer not provided"}</p><small>Not signed</small></div>)}</div></section>
    <footer>Live presentation only · No version number or digest exists until the server freezes a version. Final consent disclosures and signer bindings appear in the frozen review. No attachments.</footer>
  </article>;
}
