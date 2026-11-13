"use client";
import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { AgreementView, Workspace } from "@/features/agreements/types";
import { canvasMode, modes, visibleAgreements, currentVersion, type CanvasMode } from "./presentation";
import { DocumentPreview } from "./document-preview";
import { DetailPanel } from "./detail-panel";
import { FlowIcon } from "./icons";
const modeLabels = { canvas: "My Canvas", create: "Create", review: "Review", explore: "Explore" };
export function FlowCanvas({ data, limited }: { data: Workspace; limited: boolean }) {
  const params = useSearchParams(), mode = canvasMode(params.get("mode"));
  const [query, setQuery] = useState(""), [status, setStatus] = useState("all"), [limit, setLimit] = useState(12);
  const [selectionMetadata, setSelectionMetadata] = useState<{ id: string; organization: string; counterparty?: string } | null>(null);
  const resolveMetadata = useCallback((detail: AgreementView | null) => {
    if (!detail) { setSelectionMetadata(null); return; }
    const parties = currentVersion(detail)?.snapshot.parties ?? detail.parties;
    setSelectionMetadata({ id: detail.id, organization: detail.organization_id, counterparty: parties.find(p => p.side === "client")?.legal_name });
  }, []);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]), documents = useRef(new Map<string, HTMLButtonElement>());
  const organization = data.organizations.find(o => o.id === data.selected_organization_id);
  const canCreate = !!organization && organization.status === "active" && ["owner", "admin", "editor"].includes(organization.role);
  const rows = data.agreements.filter(a => a.organization_id === data.selected_organization_id);
  const matching = visibleAgreements(rows, mode, mode === "explore" ? query : "", mode === "explore" ? status : "all");
  const visible = matching.slice(0, mode === "canvas" ? 6 : limit);
  const selected = mode === "create" ? undefined : matching.find(a => a.id === params.get("document"));
  function navigate(nextMode: CanvasMode, id?: string, replace = false) {
    const url = new URL(window.location.href);
    if (nextMode === "canvas") url.searchParams.delete("mode"); else url.searchParams.set("mode", nextMode);
    if (id) url.searchParams.set("document", id); else url.searchParams.delete("document");
    if (replace) window.history.replaceState(null, "", url); else window.history.pushState(null, "", url);
  }
  function close() { const id = selected?.id; navigate(mode, undefined, true); const target = id ? documents.current.get(id) : null; (target ?? tabs.current[modes.indexOf(mode)])?.focus(); }
  return <><div className="flow-mode-bar"><div role="tablist" aria-label="Workspace modes" className="flow-modes">{modes.map((item, i) => <button key={item} ref={node => { tabs.current[i] = node; }} className={item === "canvas" ? "flow-canvas-mode" : "flow-mode-card"} role="tab" id={`flow-tab-${item}`} aria-controls="flow-mode-panel" aria-selected={mode === item} tabIndex={mode === item ? 0 : -1} onClick={() => { if (mode !== item) navigate(item); }} onKeyDown={e => {
    const next = e.key === "ArrowRight" ? (i + 1) % modes.length : e.key === "ArrowLeft" ? (i + modes.length - 1) % modes.length : e.key === "Home" ? 0 : e.key === "End" ? modes.length - 1 : undefined;
    if (next !== undefined) { e.preventDefault(); tabs.current[next]?.focus(); navigate(modes[next]); }
  }}>{item !== "canvas" && <FlowIcon kind={item} />}<span className="flow-mode-label">{modeLabels[item]}</span>{item !== "canvas" && <span className="flow-mode-hint">{item === "create" ? "New agreement" : item === "review" ? "Signing in progress" : "Your documents"}</span>}</button>)}</div></div>
    <section className="flow-mode-panel" id="flow-mode-panel" role="tabpanel" aria-labelledby={`flow-tab-${mode}`} tabIndex={0}>
      {mode === "create" ? <div className="flow-start"><div className="flow-start-icon" aria-hidden="true"><FlowIcon kind="create" /></div><span className="flow-eyebrow">A CLEAR BEGINNING</span><h2>Put your next project into words.</h2><p>Define the scope, price and deadlines. Add your parties, then freeze one shared version for approval.</p>{canCreate ? <Link className="flow-button" href="/app/agreements/new">New agreement <span aria-hidden="true">→</span></Link> : <p className="flow-notice">Your current membership does not permit creating agreements in this workspace. Ask an authorized workspace owner for access.</p>}<p className="flow-caption">Uses the existing secure draft workflow. Starting a draft does not invite, sign or activate an agreement.</p></div> : <>
        <div className="flow-section-heading"><div><h2>{mode === "canvas" ? "On your canvas" : mode === "review" ? "Signing in progress" : "Everything in its place."}</h2><p>{mode === "canvas" ? "Previews show metadata, not contractual text." : mode === "review" ? "Workspace agreements awaiting signatures, not a personal signing queue." : "Browse your agreements and their histories in this workspace."}</p></div><div className="flow-library-tools"><span className="flow-results" role="status">{matching.length} {matching.length === 1 ? "document" : "documents"}</span>{mode === "canvas" && canCreate && <Link className="flow-create-link" href="/app/agreements/new">New agreement <span aria-hidden="true">＋</span></Link>}</div></div>
        {mode === "review" && <p className="flow-notice">A verified personal review queue is not available yet. An agreement awaiting signatures does not mean your signature is required. Open its details and use your authorized invitation to review or sign.</p>}
        {mode === "explore" && <div className="flow-filters"><div><label htmlFor="flow-search">Search loaded titles</label><input id="flow-search" type="search" value={query} maxLength={300} onChange={e => { setQuery(e.target.value); setLimit(12); }} placeholder="Find an agreement…" /></div><div><label htmlFor="flow-status">Agreement status</label><select id="flow-status" value={status} onChange={e => { setStatus(e.target.value); setLimit(12); }}><option value="all">All statuses</option><option value="preparing">Draft</option><option value="awaiting_signatures">Awaiting signatures</option><option value="active">Active</option></select></div></div>}
        {limited && <p className="flow-caption flow-limit">This view uses the latest 200 agreements accessible to your account across its workspaces, filtered to this workspace. Older records may be missing. Search is limited to loaded titles.</p>}
        <div className={`flow-stage${selected ? " has-selection" : ""}`}><div className="flow-canvas-surface">{visible.length ? <><ul className="flow-documents" aria-label="Agreement previews">{visible.map(a => <li key={a.id}><DocumentPreview agreement={a} selected={selected?.id === a.id} counterparty={selected?.id === a.id && selectionMetadata?.id === a.id && selectionMetadata.organization === a.organization_id ? selectionMetadata.counterparty : undefined} onSelect={() => navigate(mode, a.id, true)} buttonRef={node => { if (node) documents.current.set(a.id, node); else documents.current.delete(a.id); }} /></li>)}</ul>{matching.length > visible.length && (mode === "canvas" ? <button className="flow-text-link flow-more" onClick={() => navigate("explore")}>Explore all loaded agreements →</button> : <button className="flow-button flow-secondary flow-more" onClick={() => setLimit(n => n + 12)}>Show more agreements</button>)}</> : <div className="flow-empty"><span className="flow-empty-paper" aria-hidden="true">≡</span><h3>{mode === "explore" && (query || status !== "all") ? "A little space to look again." : mode === "review" ? "No signing in progress here." : "A clear beginning."}</h3><p>{mode === "explore" && (query || status !== "all") ? "No loaded agreements match these filters." : limited ? "No records for this workspace were found in the loaded collection." : mode === "review" ? "No loaded agreements are awaiting signatures. This is not confirmation that you have no personal signing tasks." : "Your agreements will appear here once you create one."}</p>{mode === "explore" && (query || status !== "all") ? <button className="flow-text-link" onClick={() => { setQuery(""); setStatus("all"); }}>Clear filters</button> : canCreate && mode !== "review" ? <Link className="flow-button" href="/app/agreements/new">Create your first agreement</Link> : null}</div>}</div>
          {selected && <DetailPanel key={`${selected.organization_id}:${selected.id}`} agreement={selected} onClose={close} onResolved={resolveMetadata} />}
        </div></>}
    </section></>;
}





