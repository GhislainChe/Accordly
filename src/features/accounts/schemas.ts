import { z } from "zod";
import { validUnicode } from "../agreements/canonical.ts";
const text = (max: number) => z.string().trim().min(1).max(max).refine(validUnicode);
export const emailSchema = z.email().max(320).transform((v) => v.toLowerCase());
export const passwordSchema = z.string().min(12).max(128).refine((v) => new TextEncoder().encode(v).length <= 72 && /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v) && /[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/.test(v) && validUnicode(v));
export const authAccountSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("signup"), full_name: text(200), email: emailSchema, password: passwordSchema }).strict(),
  z.object({ operation: z.literal("resend"), email: emailSchema }).strict(),
  z.object({ operation: z.literal("recover"), email: emailSchema }).strict(),
  z.object({ operation: z.literal("verify"), email: emailSchema, code: z.string().regex(/^\d{6}$/), purpose: z.enum(["signup", "recovery"]) }).strict(),
  z.object({ operation: z.literal("reset"), password: passwordSchema }).strict(),
]);
const mutation = { idempotency_key: z.uuid() };
const revision = z.string().regex(/^[1-9][0-9]{0,17}$/);
export const onboardingSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("preferences"), ...mutation, expected_revision: revision, full_name: text(200), work_kind: z.enum(["individual", "business"]), purpose: z.enum(["create", "review", "both"]) }).strict(),
  z.object({ operation: z.literal("complete"), ...mutation, expected_revision: revision, workspace_name: text(200) }).strict(),
  z.object({ operation: z.literal("use_existing"), ...mutation, expected_revision: revision, organization_id: z.uuid() }).strict(),
  z.object({ operation: z.literal("select_workspace"), ...mutation, organization_id: z.uuid() }).strict(),
]);
