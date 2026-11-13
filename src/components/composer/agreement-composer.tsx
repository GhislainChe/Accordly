"use client";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Draft } from "@/features/agreements/types";
import { AgreementPreview } from "./document-preview";
import { composerErrors, emptyDraft, type PreviewParty } from "./model";
import { useUnsavedChanges } from "./use-unsaved";
import "./composer.css";
const mobileQuery = "(max-width: 900px)";
const subscribe = (listener: () => void) => { const media = window.matchMedia(mobileQuery); media.addEventListener("change", listener); return () => media.removeEventListener("change", listener); };
const mobileSnapshot = () => window.matchMedia(mobileQuery).matches;
const serverSnapshot = () => false;

function DeadlineEditor({ id, value, onChange }: { id: string; value: Draft["deadline"]; onChange: (deadline: Draft["deadline"]) => void }) {
  return <div className="studio-deadline"><label htmlFor={`${id}-kind`}>Deadline format<select id={`${id}-kind`} value={value.kind} onChange={e => onChange(e.target.value === "date" ? { kind: "date", date: "" } : { kind: "instant", at: "", timezone: "Africa/Douala" })}><option value="date">Date only</option><option value="instant">Exact UTC time + timezone</option></select></label>{value.kind === "date" ? <label htmlFor={`${id}-date`}>Deadline<input id={`${id}-date`} type="date" required value={value.date} onChange={e => onChange({ kind: "date", date: e.target.value })} /></label> : <><label htmlFor={`${id}-at`}>Exact time (UTC)<input id={`${id}-at`} type="datetime-local" step="0.001" required value={value.at.replace(/Z$/, "")} onChange={e => onChange({ ...value, at: e.target.value ? new Date(`${e.target.value}Z`).toISOString() : "" })} /></label><label htmlFor={`${id}-zone`}>IANA timezone<input id={`${id}-zone`} required maxLength={100} value={value.timezone} onChange={e => onChange({ ...value, timezone: e.target.value })} /></label></>}</div>;
}
export function AgreementComposer({ initial, title: savedTitle = "", create = false, busy, parties = [], externalDirty = false, introduction, partyEditor, actions, onSave }: {
  initial?: Draft; title?: string; create?: boolean; busy: boolean; parties?: PreviewParty[]; externalDirty?: boolean; introduction?: ReactNode; partyEditor?: ReactNode;
  actions?: (dirty: boolean) => ReactNode; onSave: (draft: Draft, title: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Draft>(() => initial ?? emptyDraft());
  const [title, setTitle] = useState(savedTitle), [baseline, setBaseline] = useState(() => JSON.stringify({ draft: initial ?? emptyDraft(), title: savedTitle }));
  const [view, setView] = useState("split"), [attempted, setAttempted] = useState(false), [touched, setTouched] = useState(false), [saved, setSaved] = useState(false);
  const mobile = useSyncExternalStore(subscribe, mobileSnapshot, serverSnapshot);
  const effectiveView = mobile && view === "split" ? "edit" : view;
  const formId = useId(), form = useRef<HTMLFormElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const dirty = JSON.stringify({ draft, title }) !== baseline;
  const navigation = useUnsavedChanges(dirty || externalDirty), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (navigation.pending) dialog.current?.showModal(); else dialog.current?.close(); }, [navigation.pending]);
  const errors = composerErrors(draft, title), showErrors = attempted || touched;
  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setSaved(false); setDraft(current => ({ ...current, [key]: value })); }
  const error = (key: string) => showErrors && errors[key] ? <p className="studio-error" id={`${formId}-${key}-error`}>{errors[key]}</p> : null;
  const errorProps = (key: string) => ({ "aria-invalid": showErrors && !!errors[key], "aria-describedby": showErrors && errors[key] ? `${formId}-${key}-error` : undefined });
  return <div className={`agreement-studio studio-view-${effectiveView}`}>
    <dialog ref={dialog} className="studio-leave-dialog" aria-labelledby={`${formId}-leave-title`} aria-describedby={`${formId}-leave-description`} onCancel={navigation.stay}><h2 id={`${formId}-leave-title`}>Keep your changes?</h2><p id={`${formId}-leave-description`}>This draft has unsaved changes. Save them before leaving, or leave without saving.</p><div><button type="button" className="studio-outline-button" onClick={navigation.stay} autoFocus>Keep editing</button><button type="button" className="studio-button" onClick={navigation.leave}>Leave without saving</button></div></dialog>
    <div className="studio-toolbar"><div><p className="studio-kicker">LIVE AGREEMENT COMPOSER</p><h1>{create ? "Make the agreement clear." : "Shape the agreed details."}</h1><p>Record the terms you’ve already agreed upon.</p></div><span className="studio-save-state" role="status">{busy ? "Saving / processing…" : dirty || externalDirty ? "Unsaved changes · no autosave" : create ? "Not saved yet" : saved ? "Draft saved" : "Saved draft"}</span></div>
    <div className="studio-controls"><div role="group" aria-label="Composer view"><button type="button" className="studio-both" aria-pressed={effectiveView === "split"} onClick={() => setView("split")}>Editor & preview</button><button type="button" aria-pressed={effectiveView === "edit"} onClick={() => setView("edit")}>Edit</button><button type="button" aria-pressed={effectiveView === "preview"} onClick={() => setView("preview")}>Preview agreement</button></div><button className="studio-button" type="submit" form={formId} disabled={busy}>Save draft</button></div>
    <div className="studio-panes"><div className="studio-editor" aria-label="Agreement editor">
      {introduction}
      <form id={formId} ref={form} noValidate onBlur={() => setTouched(true)} onSubmit={async e => {
        e.preventDefault(); if (busy) return; setAttempted(true); setSaved(false);
        if (Object.keys(errors).length || !e.currentTarget.checkValidity()) { setView("edit"); requestAnimationFrame(() => { const invalid = form.current?.querySelector<HTMLElement>('[aria-invalid="true"], :invalid'); (invalid ?? heading.current)?.focus(); }); return; }
        const submitted = JSON.stringify({ draft, title });
        if (await onSave(draft, title.trim())) { setBaseline(submitted); setSaved(true); if (!externalDirty) navigation.release(); }
      }}>
        <fieldset disabled={busy}><legend className="studio-section-title">01 · The work</legend><h2 ref={heading} tabIndex={-1} className="studio-sr-only">Agreement fields</h2>
          <label htmlFor="composer-title">Agreement title<input id="composer-title" required maxLength={300} value={title} readOnly={!create} onChange={e => { setTitle(e.target.value); setSaved(false); }} placeholder="e.g. Brand identity design" {...errorProps("title")} /></label>{error("title")}{!create && <p className="studio-hint">The saved title is fixed by the existing agreement workflow.</p>}
          <label htmlFor="composer-scope">Scope & deliverables<textarea id="composer-scope" required maxLength={20000} rows={6} value={draft.scope} onChange={e => change("scope", e.target.value)} placeholder="Describe what is included and what will be delivered." {...errorProps("scope")} /></label>{error("scope")}
          <div className="studio-section-title">02 · Price & timing</div>
          <div className="studio-field-grid"><label htmlFor="composer-amount">Total amount (XAF)<input id="composer-amount" required inputMode="numeric" pattern="[1-9][0-9]{0,15}" value={draft.amount_minor} onChange={e => change("amount_minor", e.target.value)} placeholder="75000" {...errorProps("amount")} /></label><label htmlFor="composer-language">Controlling language<select id="composer-language" value={draft.content_language} onChange={e => change("content_language", e.target.value as "en" | "fr")}><option value="en">English</option><option value="fr">French</option></select></label></div>{error("amount")}<p className="studio-hint">Exact whole francs. XAF is the currently supported currency.</p>
          <DeadlineEditor id="composer-project" value={draft.deadline} onChange={value => change("deadline", value)} />{error("deadline")}
          <div className="studio-section-title">03 · Additional agreed terms</div><label htmlFor="composer-terms">Agreement terms<textarea id="composer-terms" required maxLength={40000} rows={6} value={draft.terms} onChange={e => change("terms", e.target.value)} placeholder="Payment arrangements, responsibilities, revisions and acceptance already agreed." {...errorProps("terms")} /></label>{error("terms")}
          <div className="studio-section-title">04 · Milestones <span>Optional</span></div><p className="studio-hint">If used, milestone amounts must allocate the full total. Deliverables without separate milestones belong in scope.</p>
          {draft.milestones.map((milestone,i) => <div className="studio-milestone" key={i}><div className="studio-row"><h3>Milestone {i + 1}</h3><button type="button" className="studio-text-button" aria-label={`Remove milestone ${i + 1}`} onClick={() => change("milestones", draft.milestones.filter((_,index) => i !== index))}>Remove</button></div><label htmlFor={`composer-m-${i}-description`}>Deliverable<input id={`composer-m-${i}-description`} required maxLength={10000} value={milestone.description} onChange={e => change("milestones", draft.milestones.map((m,index) => i === index ? { ...m, description:e.target.value } : m))} /></label><label htmlFor={`composer-m-${i}-amount`}>Amount (XAF)<input id={`composer-m-${i}-amount`} required pattern="(0|[1-9][0-9]{0,15})" inputMode="numeric" value={milestone.amount_minor} onChange={e => change("milestones", draft.milestones.map((m,index) => i === index ? { ...m, amount_minor:e.target.value } : m))} /></label><DeadlineEditor id={`composer-m-${i}`} value={milestone.deadline} onChange={value => change("milestones", draft.milestones.map((m,index) => i === index ? { ...m, deadline:value } : m))} /><label htmlFor={`composer-m-${i}-acceptance`}>Acceptance terms<textarea id={`composer-m-${i}-acceptance`} required maxLength={20000} rows={2} value={milestone.acceptance_terms} onChange={e => change("milestones", draft.milestones.map((m,index) => i === index ? { ...m, acceptance_terms:e.target.value } : m))} /></label>{error(`milestone-${i}`)}</div>)}
          {error("milestones")}<button type="button" className="studio-outline-button" disabled={draft.milestones.length >= 50} onClick={() => change("milestones", [...draft.milestones, { description: "", amount_minor: "", deadline: draft.deadline, acceptance_terms: "" }])}>+ Add milestone</button>
          {attempted && Object.keys(errors).length > 0 && <p className="studio-error" role="alert">Check the marked fields and milestone totals before saving.</p>}
          <div className="studio-save-row"><p className="studio-hint">{create ? "Save the terms first, then add the two designated parties. No invitation or signature is created." : "Saving changes only the draft. Save party details separately before freezing."}</p><button className="studio-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save draft"}</button></div>
        </fieldset>
      </form>{partyEditor}{actions?.(dirty)}
    </div><div className="studio-preview-pane" aria-label="Agreement preview"><div className="studio-preview-caption"><span>YOUR AGREEMENT, TAKING SHAPE</span><span>Private draft preview</span></div><AgreementPreview title={title} draft={draft} parties={parties} /></div></div>
  </div>;
}
