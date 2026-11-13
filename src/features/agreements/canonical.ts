import { createHash } from "node:crypto";

export function validUnicode(value: string): boolean {
  if (value.includes("\0")) return false;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

// RFC 8785: ECMAScript primitive serialization, UTF-16 key ordering, and no
// Unicode normalization. The contract schema uses ASCII keys and integer money
// strings. Reject non-JSON values instead of silently dropping/converting them.
export function canonicalize(value: unknown, depth = 0): string {
  if (depth > 24) throw new Error("Canonical value exceeds nesting limit");
  if (value === null) return "null";
  if (typeof value === "string") {
    if (!validUnicode(value)) throw new Error("Invalid contract string");
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid JSON number");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${Array.from(value, (v) => canonicalize(v, depth + 1)).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${canonicalize(key, depth + 1)}:${canonicalize((value as Record<string, unknown>)[key], depth + 1)}`).join(",")}}`;
  }
  throw new Error("Unsupported canonical value");
}

export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}
