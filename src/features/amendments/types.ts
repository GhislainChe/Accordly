import type { Draft, Snapshot } from "../agreements/types";
export type AmendmentPayload = { draft: Draft; requested_change: string; reason: string; delta_minor: string; revises_proposal_id: string | null };
export type AmendmentDraft = { id: string; revision: string; base_version_id: string; payload: AmendmentPayload };
export type VersionTerms = { version_id: string; digest: string; snapshot: Snapshot };
export type ProposalRow = { id: string; version_id: string; version_number: string; base_version_id: string | null; state: string; submitted_at: string; expires_at: string; proposer_principal_id: string; proposer_name?: string; diff: { requested_change?: string; delta_minor?: string; before_amount_minor?: string; after_amount_minor?: string } };
export type AmendmentsView = { actor_id: string; can_propose: boolean; effective_version_id: string; effective: VersionTerms; drafts: AmendmentDraft[]; proposals: ProposalRow[] };
export type AmendmentReview = { proposal_id: string; kind: string; state: string; proposer_principal_id: string; reason: string; own_slot_id: string | null; candidate: VersionTerms; base: VersionTerms | null; diff: ProposalRow["diff"]; slots: { slot_id: string; display_name: string; expected_email: string; decision: string | null; signed_at: string | null }[]; feedback: { kind: string; reason: string; actor_name: string; occurred_at: string }[] };
