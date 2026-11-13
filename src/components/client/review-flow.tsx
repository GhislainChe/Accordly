"use client";
import { useEffect, useRef, useState } from "react";
import type { SigningView, Snapshot } from "@/features/agreements/types";
import { AmendmentsPanel } from "@/components/amendments-panel";
import { ContractView } from "@/components/contract-view";
import { Field, Notice, Status } from "@/components/ui/primitives";
import { request, useAction, useIdempotency } from "@/lib/ui/api";
import { parsePrivateInvitation, consumePrivateFragment, type PrivateInvitation } from "@/features/signing/invitation-entry";

export function ReviewFlow({ enabled }: { enabled: boolean }) {
  const [invitation, setInvitation] = useState<PrivateInvitation | null>(null), [pasted, setPasted] = useState("");
  const [challenge, setChallenge] = useState<{ id: string; purpose: "access" | "consent" } | null>(null);
  const [view, setView] = useState<SigningView | null>(null), [proof, setProof] = useState<{ proof_id: string; proof_secret: string } | null>(null);
  const [checked, setChecked] = useState(false), [name, setName] = useState(""), [receipt, setReceipt] = useState<{ decision_id: string; signed_at: string } | null>(null);
  const [intent, setIntent] = useState<"approve" | "reject">("approve"), [rejection, setRejection] = useState("");
  const [code, setCode] = useState(""), action = useAction(), idempotent = useIdempotency(), initialized = useRef(false);
  const api = <T,>(body: unknown) => request<T>("/api/agreements/signing", body);
  async function refresh() {
    try { const result = await api<SigningView>({ operation: "read", ...(view ? { proposal_id: view.proposal_id } : {}) }); setView(result); return result; }
    catch (e) { setView(null); setProof(null); throw e; }
  }
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    // Remove all URL secret material before any request; keep it in component
    // memory only. No analytics, external resources, logs or browser storage.
    const fragment = consumePrivateFragment(window.location, window.history);
    void Promise.resolve().then(async () => {
      if (fragment) {
        const parsed = parsePrivateInvitation(fragment, window.location.origin);
        if (parsed) setInvitation(parsed); else action.setError("This invitation is malformed. Request a fresh private invitation.");
      } else if (enabled) {
        try { setView(await api<SigningView>({ operation: "read" })); } catch { /* Generic entry remains visible without a capability. */ }
      }
    });
    // Only initialize from the current browser URL once; never auto-send a code.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const snapshot: Snapshot | null = view ? JSON.parse(view.canonical_text) : null;
  const signed = !!view?.decisions.some((d) => d.slot_id === view.slot_id);
  async function startAccess() {
    if (!invitation) throw new Error("Open or paste your private invitation first.");
    const result = await api<{ challenge_id: string }>({ operation: "start_access", ...invitation });
    setChallenge({ id: result.challenge_id, purpose: "access" }); setCode("");
  }
  async function startConsent(decision: "approve" | "reject" = intent) {
    if (!view) return;
    const result = await api<{ challenge_id: string }>({ operation: "start_consent", proposal_id: view.proposal_id, digest: view.digest, action: view.proposal_kind === "amendment" ? (decision === "reject" ? "amendment_rejection" : "amendment_approval") : "initial_signature" });
    setIntent(decision); setProof(null); setChecked(false); setChallenge({ id: result.challenge_id, purpose: "consent" }); setCode("");
  }
  async function verify() {
    if (!challenge) return;
    if (challenge.purpose === "access") {
      if (!invitation) throw new Error("The invitation is no longer in memory. Reopen its original link.");
      await api({ operation: "verify_access", ...invitation, challenge_id: challenge.id, code });
      setInvitation(null); setPasted(""); setChallenge(null); setCode(""); await refresh();
    } else {
      const result = await api<{ proof_id: string; proof_secret: string }>({ operation: "verify_consent", challenge_id: challenge.id, code, action: view?.proposal_kind === "amendment" ? (intent === "reject" ? "amendment_rejection" : "amendment_approval") : "initial_signature" });
      setProof(result); setChecked(false); setChallenge(null); setCode("");
    }
  }
  return <><div id="agreement-review" className="review-title"><p className="eyebrow">A SHARED UNDERSTANDING</p><h1>{view ? snapshot?.title : "Your agreement, together."}</h1><p className="muted">{view ? "Review the exact version. Your consent is always a separate action." : "Verify your invitation to review the proposed terms. No account is required for a guest client."}</p></div>
    {!enabled && <Notice error>Signing is disabled. This workflow is available only in the configured local demonstration. It is not enabled for real contracts.</Notice>}
    {action.error && <Notice error>{action.error}</Notice>}{action.message && <Notice>{action.message}</Notice>}
    <div className={view ? "review-grid" : "entry-grid"}>{view && snapshot ? <ContractView snapshot={snapshot} digest={view.digest} canonicalText={view.canonical_text} /> : <section className="entry-story"><div className="entry-orbit" aria-hidden="true"><span>01</span><i>↗</i><span>02</span><i>↗</i><span>03</span></div><h2>Verify. Review.<br /><span>Move forward.</span></h2><p>A private invitation and a mailbox challenge protect access. Every required party signs the same frozen version.</p><div className="security-notes"><p>✓ No registration required for clients</p><p>✓ No signature implied by opening this page</p><p>✓ Original terms remain unchanged</p></div></section>}
      <aside className="stack"><section className="panel signing-card">
        {view && <div className="section-line"><span className="eyebrow">YOUR REVIEW</span><Status value={view.lifecycle} /></div>}
        {challenge ? <><span className="step-label">{challenge.purpose === "access" ? "01 · VERIFY ACCESS" : "03 · VERIFY SIGNING INTENT"}</span><h2>Check your mailbox.</h2><p>A six-digit code was sent to the intended address. It expires within 10 minutes and allows at most five failed attempts.</p><form className="stack" onSubmit={(e) => { e.preventDefault(); void action.run(verify, challenge.purpose === "access" ? "Mailbox verified. Review the frozen terms." : "Fresh verification complete. No signature has been recorded yet."); }}><Field label="Verification code" name="verification-code"><input id="verification-code" name="verification-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} className="code-input" /></Field><button className="button primary full" disabled={action.busy}>{action.busy ? "Verifying…" : "Verify code"}</button></form><button className="text-button" disabled={action.busy} onClick={() => void action.run(challenge.purpose === "access" ? startAccess : startConsent, "A new code was sent. The previous code no longer works.")}>Send a new code</button><p className="local-mail-note">Local test: ask the demo operator to read this challenge from the private mailbox.<br /><code>{challenge.id}</code><br />Codes are never displayed or fetched by this page.</p></> : !view ? <><span className="step-label">01 · SECURE ACCESS</span><h2>Let’s start with you.</h2><p>{invitation ? "Your invitation is ready. Send a code to the intended mailbox to continue." : "Open your private invitation link, or paste it below. The secret is kept in memory only."}</p>{!invitation && <form className="stack" onSubmit={(e) => { e.preventDefault(); const parsed = parsePrivateInvitation(pasted, window.location.origin); if (parsed) { setInvitation(parsed); setPasted(""); action.setError(""); } else action.setError("Paste a complete invitation link or its invitation-id.secret fragment."); }}><Field label="Private invitation" name="private-invitation"><textarea id="private-invitation" rows={3} value={pasted} onChange={(e) => setPasted(e.target.value)} required autoComplete="off" spellCheck={false} /></Field><button className="button secondary full" disabled={!enabled}>Use invitation</button></form>}{invitation && <button className="button primary full" disabled={action.busy || !enabled} onClick={() => void action.run(startAccess, "A verification code was sent.")}>{action.busy ? "Sending…" : "Send verification code"}<span aria-hidden="true">↗</span></button>}<p className="hint">Provider signers must also be signed in to their own verified account. Clients can continue as guests.</p></> : signed || view.proposal_state !== "pending" ? <><div className="activation-mark" aria-hidden="true">✓</div><h2>{view.proposal_state === "effective" ? "Version effective." : view.proposal_state === "pending" ? "Your decision is recorded." : `Proposal ${view.proposal_state}.`}</h2><p>{view.proposal_state === "effective" ? "All required signers approved this exact version. Its terms and evidence are preserved." : view.proposal_state === "pending" ? "This version is awaiting the remaining required decisions. Effective terms stay unchanged until unanimous approval." : "This proposal is closed. Its terms, decisions and history are preserved; it cannot collect further approvals."}</p>{receipt && <p className="hint">Receipt {receipt.decision_id}<br />Recorded {receipt.signed_at}</p>}<p className="signature-count">{view.decisions.filter((d) => d.decision !== "reject").length} / {snapshot?.parties.reduce((n, p) => n + (p.representatives?.length ?? 0), 0)} required signatures recorded</p><button className="button secondary full" disabled={action.busy} onClick={() => void action.run(refresh, "Latest status loaded.")}>Refresh signing status</button></> : proof ? <><span className="step-label">04 · EXPLICIT CONSENT</span><h2>Your signature.<br />Your decision.</h2><p>Your one-use verification is valid for at most five minutes. It is bound to this exact version.</p><form className="stack" onSubmit={(e) => { e.preventDefault(); if (!checked || !view || !proof) return; void action.run(async () => {
          const result = await api<{ decision_id: string; signed_at: string }>(idempotent({ operation: view.proposal_kind === "amendment" ? (intent === "reject" ? "amendment_reject" : "amendment_approval") : "initial_signature", proposal_id: view.proposal_id, digest: view.digest, proof_id: proof.proof_id, proof_secret: proof.proof_secret, ...(intent === "reject" ? { reason: rejection } : { affirmative: true, typed_name: name }), consent_text: view.consent_text, disclosure_version: view.disclosure_version })); setReceipt(result); setProof(null); setChecked(false); setName(""); await refresh();
        }, intent === "reject" ? "Your explicit rejection was recorded. Effective terms were not changed." : "Your signature was recorded."); }}>{intent === "reject" ? <Field label="Reason for rejection" name="rejection-reason"><textarea id="rejection-reason" required maxLength={2000} value={rejection} onChange={(e) => setRejection(e.target.value)} /></Field> : <Field label="Your full signing name" name="signing-name"><input id="signing-name" name="signing-name" required minLength={1} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}<blockquote className="consent-quote">{intent === "reject" ? "I explicitly reject this exact frozen amendment. This does not approve or change the effective agreement." : view.consent_text}</blockquote><label className="check-label"><input type="checkbox" required checked={checked} onChange={(e) => setChecked(e.target.checked)} />{intent === "reject" ? "I reviewed this frozen amendment and explicitly choose to reject it." : "I have reviewed the complete frozen agreement and explicitly consent to sign this exact version."}</label><p className="hint digest-hint">SHA-256: {view.digest}</p><button className="button primary full" disabled={action.busy || !checked || !(intent === "reject" ? rejection.trim() : name.trim())}>{action.busy ? "Recording signature…" : intent === "reject" ? "Reject this exact amendment" : "Sign this exact version"}</button></form><button className="text-button" disabled={action.busy} onClick={() => void action.run(startConsent)}>Verification expired? Request a fresh code</button></> : <><span className="step-label">02 · REVIEW THE TERMS</span><h2>Take a moment.<br />Read every detail.</h2><p>The full scope, price, deadlines and terms are shown alongside this panel. Check each required party and the controlling language.</p><p>When you’re ready, request a fresh mailbox code. Verifying that code will not sign the agreement.</p><button className="button primary full" disabled={action.busy} onClick={() => void action.run(() => startConsent("approve"), "A separate signing verification code was sent.")}>{action.busy ? "Sending…" : "Send signing verification code"}</button>{view.proposal_kind === "amendment" && <button className="button secondary full" disabled={action.busy} onClick={() => void action.run(() => startConsent("reject"), "A separate rejection verification code was sent. No decision has been recorded.")}>Verify to reject this amendment</button>}<button className="text-button" disabled={action.busy} onClick={() => void action.run(refresh)}>Refresh agreement status</button></>}
      </section><p className="identity-note">Mailbox verification proves access to a mailbox, not legal identity or corporate authority. This local demonstration does not provide qualified or certified electronic signatures.</p>{view && <button className="text-button" disabled={action.busy} onClick={() => void action.run(async () => { await api({ operation: "logout" }); setView(null); setProof(null); setChallenge(null); setReceipt(null); setChecked(false); setName(""); }, "Review session closed. A fresh invitation is needed to return.")}>Close this review session</button>}</aside>
    </div>{view?.lifecycle === "active" && <AmendmentsPanel agreementId={view.agreement_id} partySession onReview={(v) => { setView(v); setProof(null); setChecked(false); setChallenge(null); setReceipt(null); setIntent("approve"); setName(""); setRejection(""); }} />}</>;
}
