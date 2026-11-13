import { domainToASCII } from "node:url";
import { z } from "zod";
import { validUnicode } from "./canonical.ts";

const text = (maximum: number) => z.string().min(1).max(maximum).refine((v) => v.trim().length > 0 && validUnicode(v));
const uuid = z.uuid();
const revision = z.string().regex(/^[1-9][0-9]{0,17}$/);
const money = z.string().regex(/^(0|[1-9][0-9]{0,15})$/).pipe(z.string().refine((v) => BigInt(v) <= BigInt("9000000000000000")));
const email = z.email().max(320).transform((value) => {
  const at = value.lastIndexOf("@");
  return `${value.slice(0, at)}@${domainToASCII(value.slice(at + 1)).toLowerCase()}`;
});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const parsed = new Date(`${v}T00:00:00.000Z`);
  return Number(v.slice(0, 4)) > 0 && Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === v;
});
export const deadlineSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("date"), date }).strict(),
  z.object({ kind: z.literal("instant"), at: z.iso.datetime({ precision: 3 }), timezone: text(100).refine((v) => {
    try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; }
  }) }).strict(),
]);
export const draftSchema = z.object({
  scope: text(20000), terms: text(40000), amount_minor: money.pipe(z.string().refine((v) => BigInt(v) > BigInt(0))),
  currency_code: z.literal("XAF"), currency_exponent: z.literal(0),
  content_language: z.enum(["en", "fr"]), deadline: deadlineSchema,
  milestones: z.array(z.object({ description: text(10000), amount_minor: money, deadline: deadlineSchema, acceptance_terms: text(20000) }).strict()).max(50),
  attachments: z.array(z.never()).length(0),
}).strict().superRefine((value, ctx) => {
  if (!money.safeParse(value.amount_minor).success || value.milestones.some((m) => !money.safeParse(m.amount_minor).success)) return;
  if (value.milestones.length && value.milestones.reduce((sum, m) => sum + BigInt(m.amount_minor), BigInt(0)) !== BigInt(value.amount_minor)) {
    ctx.addIssue({ code: "custom", path: ["milestones"], message: "Milestones must allocate the total exactly" });
  }
});

export const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create_draft"), resource_id: uuid, idempotency_key: uuid, input: z.object({ title: text(300).transform((v) => v.trim()), draft: draftSchema }).strict() }).strict(),
  z.object({ operation: z.literal("update_draft"), resource_id: uuid, idempotency_key: uuid, input: z.object({ expected_revision: revision, draft: draftSchema }).strict() }).strict(),
  z.object({ operation: z.literal("set_parties"), resource_id: uuid, idempotency_key: uuid, input: z.object({ expected_revision: revision,
    provider: z.object({ legal_name: text(300), representative_name: text(200) }).strict(),
    client: z.object({ legal_name: text(300), representative_name: text(200), email }).strict(),
  }).strict() }).strict(),
  z.object({ operation: z.literal("set_access"), resource_id: uuid, idempotency_key: uuid, input: z.object({ expected_revision: revision, principal_id: uuid, grant_type: z.enum(["provider_read", "provider_edit", "provider_issue", "client_review"]), active: z.boolean() }).strict() }).strict(),
  z.object({ operation: z.literal("freeze"), resource_id: uuid, idempotency_key: uuid, input: z.object({ expected_revision: revision }).strict() }).strict(),
]);
export type AgreementCommand = z.infer<typeof commandSchema>;
export const agreementIdSchema = uuid;
