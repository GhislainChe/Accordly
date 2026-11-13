import { z } from "zod";
import { draftSchema } from "../agreements/schemas.ts";
import { validUnicode } from "../agreements/canonical.ts";
const id = z.uuid();
const revision = z.string().regex(/^[1-9][0-9]{0,17}$/);
const text = (max: number) => z.string().min(1).max(max).refine((v) => !!v.trim() && validUnicode(v));
export const deltaSchema = z.string().regex(/^(0|-?[1-9][0-9]{0,15})$/).pipe(z.string().refine((v) => BigInt(v) >= -BigInt("9000000000000000") && BigInt(v) <= BigInt("9000000000000000")));
export function revisedAmount(base: string, delta: string): string {
  if (!/^[1-9][0-9]{0,15}$/.test(base) || !deltaSchema.safeParse(delta).success || BigInt(base) > BigInt("9000000000000000")) throw new Error("Invalid exact amount");
  const total = BigInt(base) + BigInt(delta);
  if (total < BigInt(1) || total > BigInt("9000000000000000")) throw new Error("Revised total is outside the supported range");
  return total.toString();
}
export const amendmentPayloadSchema = z.object({ draft: draftSchema, requested_change: text(4000), reason: text(2000), delta_minor: deltaSchema, revises_proposal_id: id.nullable() }).strict();
const common = { agreement_id: id };
const mutation = { ...common, idempotency_key: id };
export const amendmentSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("amendment_list"), ...common, before_version_number: revision.optional() }).strict(),
  z.object({ operation: z.literal("amendment_review"), ...common, proposal_id: id }).strict(),
  z.object({ operation: z.literal("amendment_create"), ...mutation, base_version_id: id, payload: amendmentPayloadSchema }).strict(),
  z.object({ operation: z.literal("amendment_save"), ...mutation, base_version_id: id, draft_id: id, expected_revision: revision, payload: amendmentPayloadSchema }).strict(),
  z.object({ operation: z.literal("amendment_submit"), ...mutation, draft_id: id, expected_revision: revision }).strict(),
  z.object({ operation: z.literal("amendment_revisions"), ...mutation, proposal_id: id, reason: text(2000) }).strict(),
  z.object({ operation: z.literal("amendment_withdraw"), ...mutation, proposal_id: id, reason: text(2000) }).strict(),
]);
