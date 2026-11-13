import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

export const secret = () => randomBytes(32).toString("base64url");
export const code = () => randomInt(0, 1000000).toString().padStart(6, "0");
export function credentialDigest(purpose: "invitation" | "session" | "proof", id: string, value: string) {
  return createHash("sha256").update(`accordly:${purpose}:v1:${id}:${value}`, "utf8").digest("hex");
}
export function challengeMac(key: string, id: string, purpose: "access" | "initial_signature" | "amendment_approval" | "amendment_rejection", value: string) {
  // The immutable challenge row binds its unique ID to intended email, invitation,
  // session, proposal and purpose. A code from another challenge cannot verify.
  return createHmac("sha256", Buffer.from(key, "base64url")).update(`accordly:challenge:v1:${id}:${purpose}:${value}`).digest("hex");
}
export function rateDigest(key: string, value: string) {
  return createHmac("sha256", Buffer.from(key, "base64url")).update(value).digest("hex");
}
