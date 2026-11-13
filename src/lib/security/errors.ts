export class GatewayError extends Error {
  public readonly status: number;
  public readonly code: string;
  constructor(status: number, code: string, message = code) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
  }
}

export function safeGatewayError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code === "42501") return new GatewayError(403, "forbidden");
  if (["P4090", "23505", "40001", "40P01"].includes(code)) return new GatewayError(409, "conflict");
  if (code === "P4040") return new GatewayError(404, "not_found");
  if (["23514", "23503", "22023", "22P02", "22003", "22007", "22008"].includes(code)) return new GatewayError(422, "invalid_command");
  return new GatewayError(503, "gateway_unavailable");
}
