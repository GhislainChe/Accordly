"use client";
import { useState } from "react";
import Link from "next/link";
import type { AgreementView } from "@/features/agreements/types";
import { request, useAction, useIdempotency } from "@/lib/ui/api";
import { AgreementComposer } from "./agreement-composer";
import { previewParties } from "./model";
import { StudioHeader } from "./studio-header";

function partyFields(data: AgreementView) {
  const parties = previewParties(data.parties, data.representatives), provider = parties.find(p => p.side === "provider"), client = parties.find(p => p.side === "client");
  return { provider: { legal_name: provider?.legal_name ?? "", representative_name: provider?.signer ?? "" }, client: { legal_name: client?.legal_name ?? "", representative_name: client?.signer ?? "", email: client?.contact_email ?? "" } };
}
export function DraftStudio({ data, onReload }: { data: AgreementView; onReload: () => Promise<AgreementView> }) {
  const action = useAction(), idempotent = useIdempotency();
  const [fields, setFields] = useState(() => partyFields(data)), [baseline, setBaseline] = useState(() => JSON.stringify(partyFields(data)));
  const [confirmRevision, setConfirmRevision] = useState<string | null>(null);
  const partiesDirty = JSON.stringify(fields) !== baseline;
  const parties = (["provider", "client"] as const).map(side => ({ side, legal_name: fields[side].legal_name, signer: fields[side].representative_name, contact_email: side === "client" ? fields.client.email : data.parties.find(p => p.side === "provider")?.contact_email ?? "" }));
  const ready = data.parties.some(p => p.side === "provider") && data.parties.some(p => p.side === "client");
  async function command(operation: string, input: unknown) { await request("/api/agreements/commands", idempotent({ operation, resource_id: data.id, input })); return onReload(); }
  return <><StudioHeader /><Link href="/app" className="studio-back">← Back to workspace</Link>
    {action.error && <div className="studio-notice studio-error" role="alert">{action.error}</div>}{action.message && <div className="studio-notice" role="status">{action.message}</div>}
    <AgreementComposer initial={data.draft!.payload} title={data.title} busy={action.busy} parties={parties} externalDirty={partiesDirty}
      onSave={async draft => (await action.run(async () => { await command("update_draft", { expected_revision: data.revision, draft }); setConfirmRevision(null); return true; }, "Draft saved. No version was frozen.")) === true}
      partyEditor={<section className="studio-party-editor"><h2 className="studio-section-title">05 · The parties</h2><p className="studio-hint">The provider signer is your verified account. Enter the intended client; these details do not verify or sign for them.</p><form onSubmit={async event => {
        event.preventDefault(); const submitted = fields;
        await action.run(async () => { const fresh = await command("set_parties", { expected_revision: data.revision, ...submitted }); const savedFields = partyFields(fresh); setFields(savedFields); setBaseline(JSON.stringify(savedFields)); setConfirmRevision(null); }, "Parties saved. No consent was recorded.");
      }}><fieldset disabled={action.busy}>{(["provider", "client"] as const).map(side => <div key={side}><p className="studio-label">{side === "provider" ? "Provider" : "Client"}</p><label htmlFor={`studio-${side}-legal`}>{side === "provider" ? "Provider legal name" : "Client legal name"}<input id={`studio-${side}-legal`} required maxLength={300} value={fields[side].legal_name} onChange={e => { setConfirmRevision(null); setFields(current => ({ ...current, [side]: { ...current[side], legal_name: e.target.value } })); }} /></label><label htmlFor={`studio-${side}-signer`}>{side === "provider" ? "Your signer name" : "Client signer name"}<input id={`studio-${side}-signer`} required maxLength={200} value={fields[side].representative_name} onChange={e => { setConfirmRevision(null); setFields(current => ({ ...current, [side]: { ...current[side], representative_name: e.target.value } })); }} /></label></div>)}<label htmlFor="studio-client-email">Client email<input id="studio-client-email" type="email" required maxLength={320} value={fields.client.email} onChange={e => { setConfirmRevision(null); setFields(current => ({ ...current, client: { ...current.client, email: e.target.value } })); }} /></label><p className="studio-hint">Each party requires its own mailbox and signer. Local demonstrations use fictional example.test recipients.</p><button className="studio-outline-button" disabled={action.busy}>Save parties</button></fieldset></form></section>}
      actions={dirty => <section className="studio-freeze"><p className="studio-kicker">WHEN THE SAVED RECORD IS READY</p><h2>Freeze one exact version.</h2><p>Review the preview, save all changes, then intentionally freeze the saved scope, price, deadlines and parties. Frozen terms cannot be edited; later changes require the existing amendment process.</p>{dirty || partiesDirty ? <p className="studio-hint">Save your unsaved terms and party details before freezing.</p> : !ready ? <p className="studio-hint">Save both designated parties before freezing.</p> : null}{data.permissions.issue ? <><label className="studio-check"><input type="checkbox" checked={confirmRevision === data.revision && !dirty && !partiesDirty} disabled={action.busy || dirty || partiesDirty || !ready} onChange={e => setConfirmRevision(e.target.checked ? data.revision : null)} />I reviewed the saved terms and parties. Freeze this exact version for signing.</label><button type="button" className="studio-button" disabled={action.busy || dirty || partiesDirty || !ready || confirmRevision !== data.revision} onClick={() => void action.run(async () => { await command("freeze", { expected_revision: data.revision }); setConfirmRevision(null); }, "Version frozen. Use the existing invitation flow for each signer.")}>Freeze agreement</button><p className="studio-hint">Freezing does not invite, sign or activate. The server validates the canonical version and required signer quorum.</p></> : <p className="studio-hint">Your current permissions do not allow freezing this agreement.</p>}</section>}
    />
  </>;
}
