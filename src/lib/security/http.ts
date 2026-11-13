import { applicationOrigin } from "../db/config.ts";
import { GatewayError, safeGatewayError } from "./errors.ts";

export function jsonResponse(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
export function errorResponse(error: unknown) {
  const safe = safeGatewayError(error);
  return jsonResponse({ error: safe.code }, safe.status);
}

// Native JSON supplies syntax validation. This bounded scanner additionally
// rejects duplicate (including escaped-equivalent) keys and excessive nesting,
// before those ambiguities can be hidden by JSON.parse's last-value behavior.
function unambiguousJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  let position = 0;
  const whitespace = () => { while (/\s/.test(text[position] ?? "") && position < text.length) position++; };
  const string = () => {
    const start = position++;
    while (position < text.length) {
      if (text[position] === "\\") position += 2;
      else if (text[position++] === '"') break;
    }
    return JSON.parse(text.slice(start, position)) as string;
  };
  const value = (depth: number) => {
    if (depth > 24) throw new Error("JSON nesting limit");
    whitespace();
    if (text[position] === "{") {
      position++; whitespace();
      const keys = new Set<string>();
      while (text[position] !== "}") {
        whitespace(); const key = string();
        if (keys.has(key)) throw new Error("Duplicate JSON key");
        keys.add(key); whitespace(); position++;
        value(depth + 1); whitespace();
        if (text[position] === "}") break;
        position++;
      }
      position++;
    } else if (text[position] === "[") {
      position++; whitespace();
      while (text[position] !== "]") {
        value(depth + 1); whitespace();
        if (text[position] === "]") break;
        position++;
      }
      position++;
    } else if (text[position] === '"') string();
    else while (position < text.length && !/[\s,}\]]/.test(text[position])) position++;
  };
  value(0);
  return parsed;
}
export async function mutationBody(request: Request) {
  if (request.headers.get("origin") !== applicationOrigin(process.env)) throw new GatewayError(403, "invalid_origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new GatewayError(403, "invalid_origin");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new GatewayError(415, "json_required");
  if (!request.body) throw new GatewayError(400, "invalid_json");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new GatewayError(408, "body_timeout")); void reader.cancel(); }, 5000); });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      length += value.length;
      if (length > 131072) { await reader.cancel(); throw new GatewayError(413, "request_too_large"); }
      chunks.push(value);
    }
  } finally { clearTimeout(timer); }
  try { return unambiguousJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new GatewayError(400, "invalid_json"); }
}
