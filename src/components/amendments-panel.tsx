"use client";
import { versionPresentation } from "@/features/amendments/presentation";
import { useEffect, useState } from "react";
import type { Draft, SigningView } from "@/features/agreements/types";
import type { AmendmentsView, AmendmentReview, AmendmentDraft } from "@/features/amendments/types";
import { DraftForm } from "@/components/provider/draft-form";
import { ContractView } from "@/components/contract-view";
import { Field, Notice, Status } from "@/components/ui/primitives";
import { request, useAction, useIdempotency } from "@/lib/ui/api";

export function AmendmentsPanel({ agreementId, partySession = false, onReview }: { agreementId: string; partySession?: boolean; onReview?: (view: SigningView) => void }) {
  const [data, setData] = useState<AmendmentsView | null>(null), [review, setReview] = useState<AmendmentReview | null>(null);
  const [editing, setEditing] = useState<AmendmentDraft | "new" | null>(null), [change, setChange] = useState(""), [reason, setReason] = useState(""), [delta, setDelta] = useState("0"), [revisionOf, setRevisionOf] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [feedback, setFeedback] = useState(""), [confirmed, setConfirmed] = useState(false), [link, setLink] = useState<string | null>(null);
  const action = useAction(), idempotent = useIdempotency();
  const endpoint = `/api/agreements/${partySession ? "party-amendments" : "amendments"}`;
  const api = <T,>(input: Record<string, unknown>) => request<T>(endpoint, { ...input, agreement_id: agreementId });
  async function reload(proposalId = review?.proposal_id) {
    const next = await api<AmendmentsView>({ operation: "amendment_list" }); setData(next); setMore(next.proposals.length === 50);
    if (proposalId) setReview(await api<AmendmentReview>({ operation: "amendment_review", proposal_id: proposalId }));
  }
  useEffect(() => { let live = true; void request<AmendmentsView>(endpoint, { operation: "amendment_list", agreement_id: agreementId }).then((v) => { if (live) { setData(v); setMore(v.proposals.length === 50); } }).catch((e) => { if (live) action.setError(e.message); }); return () => { live = false; }; /* Reload explicitly after mutations. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreementId, endpoint]);
  function edit(d: AmendmentDraft | "new", revises: string | null = null) {
    setEditing(d); setChange(d === "new" ? "" : d.payload.requested_change); setReason(d === "new" ? "" : d.payload.reason); setDelta(d === "new" ? "0" : d.payload.delta_minor); setRevisionOf(d === "new" ? revises : d.payload.revises_proposal_id); setConfirmed(false);
  }
  async function save(draft: Draft) {
    if (!data || !editing) return;
    if (!/^(0|-?[1-9][0-9]{0,15})$/.test(delta) || BigInt(data.effective.snapshot.amount_minor) + BigInt(delta) !== BigInt(draft.amount_minor)) throw new Error("The revised total must equal the effective amount plus the exact price difference.");
    const payload = { draft, requested_change: change, reason, delta_minor: delta, revises_proposal_id: revisionOf };
    await api(idempotent({ operation: editing === "new" ? "amendment_create" : "amendment_save", base_version_id: data.effective_version_id, payload, ...(editing === "new" ? {} : { draft_id: editing.id, expected_revision: editing.revision }) })); setEditing(null); await reload();
  }
  async function openSigning() {
    if (!review) return;
    const v = await request<SigningView>("/api/agreements/signing", { operation: "read", proposal_id: review.proposal_id });
    onReview?.(v); document.getElementById("agreement-review")?.scrollIntoView({ behavior: "smooth" });
  }
  async function invite(slotId: string, access = false) {
    const result = await request<{ development_invitation?: { invitation_id: string; token: string } }>("/api/agreements/signing", idempotent({ operation: access ? "invite_access" : "invite_amendment", agreement_id: agreementId, slot_id: slotId }));
    if (!result.development_invitation) throw new Error("This request was already committed. Its secret is not recoverable. Deliberately issue a fresh invitation with a new action after reloading.");
    setLink(`${location.origin}/invite#${result.development_invitation.invitation_id}.${result.development_invitation.token}`);
  }
  return <section className="panel form-panel stack" aria-label="Amendments"><div className="section-line"><div><p className="eyebrow">FORMAL CHANGE MANAGEMENT</p><h2>Amendments & signed history</h2></div><button className="button secondary" disabled={action.busy} onClick={() => void action.run(reload)}>Refresh amendments</button></div>
    {action.error && <Notice error>{action.error}</Notice>}{action.message && <Notice>{action.message}</Notice>}
    {!data ? <p>Loading authorized agreement history…</p> : <>
      <p>Currently effective: <strong>Version {data.effective.snapshot.version_number} · {BigInt(data.effective.snapshot.amount_minor).toLocaleString("en-GB")} XAF</strong>. Original terms and every frozen proposal remain preserved.</p>
      {data.can_propose && !editing && <button className="button primary" disabled={action.busy} onClick={() => edit("new")}>Request an amendment</button>}
      {editing && <div className="stack"><h3>{editing === "new" ? "New change request" : "Edit your unsubmitted draft"}</h3><p>No signature is implied. Edit the full proposed terms, including milestones, to match the revised total.</p>
        <Field name="amendment-change" label="Requested change"><textarea id="amendment-change" maxLength={4000} value={change} onChange={(e) => setChange(e.target.value)} rows={3} /></Field>
        <Field name="amendment-reason" label="Reason for the change"><textarea id="amendment-reason" maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></Field>
        <Field name="amendment-delta" label="Price difference (whole XAF; negative or zero allowed)"><input id="amendment-delta" inputMode="text" value={delta} onChange={(e) => setDelta(e.target.value)} pattern="(0|-?[1-9][0-9]{0,15})" /></Field>
        <DraftForm key={editing === "new" ? `new-${revisionOf}` : `${editing.id}-${editing.revision}`} initial={editing === "new" ? data.effective.snapshot : editing.payload.draft} busy={action.busy} onSave={async (draft) => { await action.run(() => save(draft), "Amendment draft saved. Review and freeze it separately."); }} />
        <button className="text-button" onClick={() => setEditing(null)}>Cancel editing</button></div>}
      <h3>Your unsubmitted drafts</h3><p className="hint">Up to 50 recent private drafts. Other parties see a change only after you freeze it.</p>
      {data.drafts.map((d) => <div className="stack" key={d.id}><p><strong>{d.payload.requested_change}</strong><br />{d.payload.reason}<br />Proposed total: {d.payload.draft.amount_minor} XAF · draft revision {d.revision}</p><details><summary>Review all saved proposed terms</summary><pre className="canonical-json">{JSON.stringify(d.payload, null, 2)}</pre></details>
        <div className="title-actions"><button className="button secondary" disabled={action.busy || d.base_version_id !== data.effective_version_id} onClick={() => edit(d)}>Edit draft</button><button className="button secondary" disabled={action.busy} onClick={() => void action.run(async () => { setReview(null); const v = await api<{ proposal_id: string }>(idempotent({ operation: "amendment_submit", draft_id: d.id, expected_revision: d.revision })); setReview(await api({ operation: "amendment_review", proposal_id: v.proposal_id })); setConfirmed(false); await reload(v.proposal_id); }, "Exact amendment terms frozen. Fresh explicit approvals are still required.")}>Freeze saved amendment for review</button></div></div>)}
      <h3>Frozen proposals and original agreement</h3><p className="hint">Newest first. Multiple proposals may share a base. The first unanimous approval wins; other proposals on that base become superseded.</p>
      <ul className="stack">{data.proposals.map((p) => <li key={p.id}><div className="section-line"><span>Version {p.version_number} · {p.diff.requested_change ?? "Original agreement"} {p.diff.after_amount_minor && `· ${p.diff.after_amount_minor} XAF`}</span><Status value={versionPresentation(p.state, p.version_id, data.effective_version_id)} /></div><p className="hint">Submitted {new Date(p.submitted_at).toISOString()} · proposer {p.proposer_name ?? p.proposer_principal_id}</p><button className="button secondary" disabled={action.busy} onClick={() => void action.run(async () => { setReview(await api({ operation: "amendment_review", proposal_id: p.id })); setFeedback(""); setConfirmed(false); setLink(null); })}>Review Version {p.version_number}</button></li>)}</ul>
      {more && <button className="button secondary" disabled={action.busy} onClick={() => void action.run(async () => { const older = await api<AmendmentsView>({ operation: "amendment_list", before_version_number: data.proposals.at(-1)?.version_number }); setMore(older.proposals.length === 50); setData({ ...older, proposals: [...data.proposals, ...older.proposals] }); })}>Load older versions</button>}
      {review && <div className="stack"><h3>Version {review.candidate.snapshot.version_number} · {review.kind}</h3><Status value={versionPresentation(review.state, review.candidate.version_id, data.effective_version_id)} /><p><strong>{review.diff.requested_change}</strong><br />{review.reason}</p>
        {review.base && <><p>Price difference: <strong>{review.diff.delta_minor} XAF</strong>. Base digest: <code className="digest-hint">{review.base.digest}</code></p><div className="form-grid"><details><summary>Before — signed base Version {review.base.snapshot.version_number}</summary><ContractView snapshot={review.base.snapshot} digest={review.base.digest} /></details><details open><summary>Proposed — Version {review.candidate.snapshot.version_number}</summary><ContractView snapshot={review.candidate.snapshot} digest={review.candidate.digest} /></details></div></>}
        {!review.base && <ContractView snapshot={review.candidate.snapshot} digest={review.candidate.digest} />}
        <h4>Designated party decisions</h4><ul>{review.slots.map((s) => <li key={s.slot_id}>{s.display_name} · {s.decision ?? "pending"}{s.signed_at ? ` · ${s.signed_at}` : ""}
          {!partySession && ((review.kind === "amendment" && review.state === "pending") || (review.state === "effective" && review.candidate.version_id === data.effective_version_id)) && <button className="text-button" disabled={action.busy} onClick={() => void action.run(() => invite(s.slot_id, review.state === "effective"))}>Create private {review.state === "effective" ? "access" : "approval"} invitation for {s.expected_email}</button>}</li>)}</ul>
        {review.feedback.map((f, i) => <p key={i}><strong>{f.actor_name}: {f.kind.replaceAll("_", " ")}</strong> — {f.reason} ({f.occurred_at})</p>)}
        {review.kind === "amendment" && review.state === "pending" && data.can_propose && <>
          {partySession && <button className="button primary" disabled={action.busy} onClick={() => void action.run(openSigning)}>Open exact amendment for verified approval or rejection</button>}
          <Field name="amendment-feedback" label="Revision request or withdrawal reason"><textarea id="amendment-feedback" maxLength={2000} rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></Field>
          <label className="check-label"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Close this frozen proposal. Existing approvals will stay historical and cannot activate it.</label>
          <div className="title-actions"><button className="button secondary" disabled={!confirmed || !feedback.trim() || action.busy || review.slots.some((s) => s.slot_id === review.own_slot_id && !!s.decision)} onClick={() => void action.run(async () => { await api(idempotent({ operation: "amendment_revisions", proposal_id: review.proposal_id, reason: feedback })); await reload(); setConfirmed(false); }, "Revisions requested. A new frozen proposal and fresh approvals are required.")}>Request revisions</button>
            {review.proposer_principal_id === data.actor_id && <button className="button secondary" disabled={!confirmed || !feedback.trim() || action.busy} onClick={() => void action.run(async () => { await api(idempotent({ operation: "amendment_withdraw", proposal_id: review.proposal_id, reason: feedback })); await reload(); setConfirmed(false); }, "Proposal withdrawn.")}>Withdraw my proposal</button>}</div></>}
        {review.kind === "amendment" && ["rejected", "withdrawn", "superseded", "expired"].includes(review.state) && data.can_propose && <button className="button secondary" onClick={() => edit("new", review.proposal_id)}>Prepare a replacement against current effective terms</button>}
      </div>}
      {link && <Notice><p>Local-only private invitation, shown once. Keep it private and open client invitations in a separate browser profile.</p><textarea aria-label="Private amendment invitation" value={link} readOnly rows={3} spellCheck={false} autoComplete="off" /><a className="button secondary" href={link} target="_blank" rel="noreferrer" referrerPolicy="no-referrer">Open private review</a><button className="text-button" onClick={() => setLink(null)}>Hide secret</button></Notice>}
    </>}
  </section>;
}
