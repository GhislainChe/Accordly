import { z } from "zod";
import { validUnicode } from "../agreements/canonical.ts";
const id = z.uuid();
const bearer = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const code = z.string().regex(/^\d{6}$/);
const text = (n: number) => z.string().min(1).max(n).refine((v) => v.trim().length > 0 && validUnicode(v));
export const signingSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("list_slots"), agreement_id: id }).strict(),
  z.object({ operation: z.literal("invite"), agreement_id: id, slot_id: id, idempotency_key: id }).strict(),
  z.object({ operation: z.literal("invite_access"), agreement_id: id, slot_id: id, idempotency_key: id }).strict(),
  z.object({ operation: z.literal("invite_amendment"), agreement_id: id, slot_id: id, idempotency_key: id }).strict(),
  z.object({ operation: z.literal("revoke_invitation"), agreement_id: id, slot_id: id, idempotency_key: id }).strict(),
  z.object({ operation: z.literal("start_access"), invitation_id: id, token: bearer }).strict(),
  z.object({ operation: z.literal("verify_access"), invitation_id: id, token: bearer, challenge_id: id, code }).strict(),
  z.object({ operation: z.literal("read"), proposal_id: id.optional() }).strict(),
  z.object({ operation: z.literal("logout") }).strict(),
  z.object({ operation: z.literal("start_consent"), proposal_id: id, digest, action: z.enum(["initial_signature", "amendment_approval", "amendment_rejection"]).optional() }).strict(),
  z.object({ operation: z.literal("verify_consent"), challenge_id: id, code, action: z.enum(["initial_signature", "amendment_approval", "amendment_rejection"]).optional() }).strict(),
  z.object({ operation: z.literal("initial_signature"), proposal_id: id, digest, proof_id: id, proof_secret: bearer, affirmative: z.literal(true), typed_name: text(200), consent_text: text(20000), disclosure_version: text(100), idempotency_key: id }).strict(),
  z.object({ operation: z.literal("amendment_approval"), proposal_id: id, digest, proof_id: id, proof_secret: bearer, affirmative: z.literal(true), typed_name: text(200), consent_text: text(20000), disclosure_version: text(100), idempotency_key: id }).strict(),
  z.object({ operation: z.literal("amendment_reject"), proposal_id: id, digest, proof_id: id, proof_secret: bearer, reason: text(2000), consent_text: text(20000), disclosure_version: text(100), idempotency_key: id }).strict(),
]);
export const sessionCookieSchema = z.string().regex(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
