"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AgreementRow, AgreementView } from "@/features/agreements/types";
import { Status } from "@/components/ui/primitives";
import { currentVersion, exactAmount, updatedDate } from "./presentation";
export function DetailPanel({ agreement, onClose, onResolved }: { agreement: AgreementRow; onClose: () => void; onResolved?: (detail: AgreementView | null) => void }) {
  const [data, setData] = useState<AgreementView | null>(null), [error, setError] = useState(""), [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const stacked = window.matchMedia("(max-width: 850px)").matches;
    const target = stacked ? heading.current?.closest("section") : heading.current;
    target?.scrollIntoView({ block: stacked ? "start" : "nearest", behavior: "auto" });
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    onResolved?.(null);
    async function read() {
      try {
        const response = await fetch(`/api/provider/${agreement.id}`, { credentials: "same-origin", cache: "no-store", signal: abort.signal });
        if (!response.ok) throw new Error(response.status === 401 ? "Your session could not be verified. Sign in again to continue." : [403,404].includes(response.status) ? "This agreement is no longer available to this account." : "Agreement details are unavailable. Please try again.");
        const result: AgreementView = await response.json();
        if (result.id !== agreement.id || result.organization_id !== agreement.organization_id) throw new Error("Agreement details could not be verified.");
        if (!abort.signal.aborted) { setData(result); onResolved?.(result); }
      } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error && /^(This agreement|Your session|Agreement details)/.test(e.message) ? e.message : "Agreement details are unavailable. Please try again."); }
    }
    void read(); return () => abort.abort();
  }, [agreement.id, agreement.organization_id, attempt, onResolved]);
  function refresh() { setData(null); setError(""); setAttempt(n => n + 1); }
  const version = data ? currentVersion(data) : undefined, terms = version?.snapshot ?? data?.draft?.payload, parties = version?.snapshot.parties ?? data?.parties ?? [];
  const scope = terms?.scope ? Array.from(terms.scope) : [];
  const excerpt = scope.slice(0,180).join("").trimEnd() + (scope.length > 180 ? "…" : "");
  return <section className="flow-detail" id="flow-detail-panel" aria-labelledby="flow-detail-title" onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
    <div className="flow-detail-heading"><div><p className="flow-eyebrow">{data ? version ? `Version ${version.version_number} · ${data.effective_version_id ? "Current effective" : "Frozen for approval"}` : data.effective_version_id ? "Effective version unavailable" : data.lifecycle === "preparing" ? "Draft · not frozen" : "Frozen version unavailable" : "AGREEMENT DETAILS"}</p><h2 id="flow-detail-title" ref={heading} tabIndex={-1}>{agreement.title}</h2></div><div className="flow-detail-heading-actions">{data && <Status value={data.lifecycle} />}<button className="flow-icon-button" onClick={onClose} aria-label="Close agreement details">×</button></div></div>
    {error ? <div className="flow-detail-state" role="alert"><p>{error}</p><button className="flow-button flow-secondary" onClick={refresh}>Try again</button><Link href="/login" className="flow-text-link">Sign in</Link></div> : !data ? <p className="flow-detail-state" role="status">Loading authorized details…</p> : <>
      <div className="flow-selection-overview"><div>{excerpt ? <><p className="flow-caption flow-excerpt-label">Scope excerpt</p><p className="flow-selection-summary">{excerpt}</p></> : <p className="flow-selection-summary">Open the agreement to review its saved terms and next steps.</p>}{terms && <p className="flow-selection-amount">{exactAmount(terms.amount_minor, terms.currency_code, terms.currency_exponent)} <span>{data.lifecycle === "preparing" ? "Proposed amount" : data.effective_version_id ? "Current effective amount" : "Frozen proposed amount"}</span></p>}</div><Link className="flow-button" href={`/app/agreements/${data.id}`}>{data.lifecycle === "preparing" && data.permissions.edit ? "Continue draft" : "Open agreement"}<span aria-hidden="true">→</span></Link></div>
      <details className="flow-more-details"><summary>Participants, version & history</summary><div className="flow-detail-expanded"><dl className="flow-facts"><div><dt>{data.effective_version_id ? "Current effective version" : version ? "Frozen version · awaiting approval" : "Version"}</dt><dd>{version ? `Version ${version.version_number}` : data.effective_version_id ? "Not available in this view" : "Draft · not frozen"}</dd></div><div><dt>Last listed update</dt><dd>{updatedDate(agreement.updated_at)} · UTC</dd></div></dl><div className="flow-parties"><h3>Participants</h3>{parties.length ? parties.map(p => <div key={p.id}><span className="flow-caption">{p.side === "provider" ? "Provider" : "Client"}</span><p>{p.legal_name}</p></div>) : <p className="flow-muted">No parties have been added yet.</p>}</div>{data.versions.filter(v => v.id !== version?.id).length > 0 && <div className="flow-history"><h3>Other frozen versions</h3><ul>{data.versions.filter(v => v.id !== version?.id).map(v => <li key={v.id}>Version {v.version_number} · {v.id === data.effective_version_id ? "Current effective" : "Historical frozen version"}</li>)}</ul><p className="flow-caption">Historical versions do not replace current effective terms. Approval outcomes remain in agreement history.</p></div>}<button className="flow-text-link" onClick={refresh}>Refresh details</button>{version && <p className="flow-caption">Frozen terms are read-only. Signed history and amendments remain in the agreement view.</p>}</div></details>
    </>}
  </section>;
}

