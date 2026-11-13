"use client";
import { useState } from "react";
import type { Draft } from "@/features/agreements/types";
import { Field } from "@/components/ui/primitives";

function DeadlineFields({ name, value }: { name: string; value?: Draft["deadline"] }) {
  const [kind, setKind] = useState(value?.kind ?? "date");
  return <div className="deadline-fields"><Field label="Deadline format" name={`${name}-kind`}><select id={`${name}-kind`} name={`${name}-kind`} value={kind} onChange={(e) => setKind(e.target.value as "date" | "instant")}><option value="date">Date only</option><option value="instant">UTC time + timezone</option></select></Field>{kind === "date" ? <Field label="Deadline" name={`${name}-date`}><input id={`${name}-date`} name={`${name}-date`} type="date" required defaultValue={value?.kind === "date" ? value.date : ""} /></Field> : <><Field label="Exact time (UTC)" name={`${name}-at`}><input id={`${name}-at`} name={`${name}-at`} type="datetime-local" step="0.001" required defaultValue={value?.kind === "instant" ? value.at.slice(0, -1) : ""} /></Field><Field label="IANA timezone" name={`${name}-zone`}><input id={`${name}-zone`} name={`${name}-zone`} required defaultValue={value?.kind === "instant" ? value.timezone : "Africa/Douala"} maxLength={100} /></Field></>}</div>;
}
function deadline(form: FormData, name: string): Draft["deadline"] {
  return form.get(`${name}-kind`) === "date" ? { kind: "date", date: String(form.get(`${name}-date`)) } : { kind: "instant", at: new Date(`${form.get(`${name}-at`)}Z`).toISOString(), timezone: String(form.get(`${name}-zone`)) };
}
export function DraftForm({ initial, create, busy, onSave }: { initial?: Draft; create?: boolean; busy: boolean; onSave: (draft: Draft, title: string) => Promise<void> }) {
  const [milestones, setMilestones] = useState<{ key: string; value?: Draft["milestones"][number] }[]>(() => initial?.milestones.map((m, i) => ({ key: `milestone-${i}`, value: m })) ?? []);
  const [validation, setValidation] = useState("");
  return <form className="stack" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); setValidation("");
    try {
      const amount = String(form.get("amount"));
      const entries = milestones.map((m) => ({ description: String(form.get(`${m.key}-description`)), amount_minor: String(form.get(`${m.key}-amount`)), acceptance_terms: String(form.get(`${m.key}-acceptance`)), deadline: deadline(form, m.key) }));
      if (!/^[1-9][0-9]{0,15}$/.test(amount) || BigInt(amount) > BigInt("9000000000000000")) throw new Error("Enter a positive whole XAF amount within the supported limit.");
      if (entries.some((m) => !/^(0|[1-9][0-9]{0,15})$/.test(m.amount_minor))) throw new Error("Milestone amounts must be exact nonnegative whole francs.");
      if (entries.length && entries.reduce((n, m) => n + BigInt(m.amount_minor), BigInt(0)) !== BigInt(amount)) throw new Error("Milestone amounts must add up to the full agreement amount.");
      void onSave({ scope: String(form.get("scope")), terms: String(form.get("terms")), amount_minor: amount, currency_code: "XAF", currency_exponent: 0, content_language: form.get("language") as "en" | "fr", deadline: deadline(form, "project"), milestones: entries, attachments: [] }, String(form.get("title") ?? ""));
    } catch (error) { setValidation(error instanceof Error ? error.message : "Check the date and amount fields."); }
  }}>
    {create && <Field label="Agreement title" name="title"><input id="title" name="title" required maxLength={300} placeholder="e.g. Studio website engagement" /></Field>}
    <Field label="Project scope" name="scope" hint="Describe the deliverables, boundaries and what is included."><textarea id="scope" name="scope" required maxLength={20000} rows={5} defaultValue={initial?.scope} placeholder="What will you deliver?" /></Field>
    <div className="form-grid"><Field label="Total amount (XAF)" name="amount" hint="Whole francs only. Amounts are stored exactly."><input id="amount" name="amount" required inputMode="numeric" pattern="[1-9][0-9]{0,15}" defaultValue={initial?.amount_minor} placeholder="250000" /></Field><Field label="Controlling language" name="language"><select id="language" name="language" defaultValue={initial?.content_language ?? "en"}><option value="en">English</option><option value="fr">French</option></select></Field></div>
    <DeadlineFields name="project" value={initial?.deadline} />
    <Field label="Agreement terms" name="terms" hint="Plain text. These exact terms are preserved when the version is frozen."><textarea id="terms" name="terms" required maxLength={40000} rows={5} defaultValue={initial?.terms} placeholder="Responsibilities, revisions, acceptance and other agreed terms…" /></Field>
    <fieldset className="milestone-group"><legend>Milestones <span className="muted">(optional)</span></legend><p className="hint">If used, milestones must allocate the full amount. Attachments are not supported yet.</p>{milestones.map((m, i) => <div className="milestone-editor" key={m.key}><div className="section-line"><strong>Milestone {i + 1}</strong><button type="button" className="text-button" aria-label={`Remove milestone ${i + 1}`} onClick={() => setMilestones((v) => v.filter((x) => x.key !== m.key))}>Remove</button></div><div className="form-grid"><Field label="Deliverable" name={`${m.key}-description`}><input id={`${m.key}-description`} name={`${m.key}-description`} required maxLength={10000} defaultValue={m.value?.description} /></Field><Field label="Amount (XAF)" name={`${m.key}-amount`}><input id={`${m.key}-amount`} name={`${m.key}-amount`} required pattern="(0|[1-9][0-9]{0,15})" inputMode="numeric" defaultValue={m.value?.amount_minor} /></Field></div><DeadlineFields name={m.key} value={m.value?.deadline} /><Field label="Acceptance terms" name={`${m.key}-acceptance`}><textarea id={`${m.key}-acceptance`} name={`${m.key}-acceptance`} required maxLength={20000} defaultValue={m.value?.acceptance_terms} rows={2} /></Field></div>)}<button className="button secondary" type="button" disabled={milestones.length >= 50} onClick={() => setMilestones((v) => [...v, { key: crypto.randomUUID() }])}>＋ Add milestone</button></fieldset>
    {validation && <p className="notice error" role="alert">{validation}</p>}<div className="form-actions"><p className="hint">{create ? "A draft is private preparation. Creating one records no signature." : "Saving updates the draft only. Frozen terms cannot be edited."}</p><button className="button primary" disabled={busy}>{busy ? "Saving…" : create ? "Create agreement draft" : "Save draft"}</button></div>
  </form>;
}
