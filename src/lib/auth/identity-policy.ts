import { z } from "zod";
import { GatewayError } from "../security/errors.ts";

const identitySchema = z.object({ id: z.uuid(), email: z.email(), email_confirmed_at: z.iso.datetime(),
  is_anonymous: z.literal(false), role: z.literal("authenticated"), aud: z.literal("authenticated"),
  banned_until: z.string().nullable().optional(),
});
export function verifiedIdentity(user: unknown, error: unknown) {
  if (error || !user) throw new GatewayError(401, "authentication_required");
  const result = identitySchema.safeParse(user);
  if (!result.success || (result.data.banned_until && (!Number.isFinite(Date.parse(result.data.banned_until)) || Date.parse(result.data.banned_until) > Date.now()))) throw new GatewayError(403, "verified_account_required");
  return Object.freeze({ authUserId: result.data.id, email: result.data.email });
}
