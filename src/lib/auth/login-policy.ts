import { GatewayError, safeGatewayError } from "../security/errors.ts";

export function authLoginFailure(error: { name?: string; status?: number; code?: string }): GatewayError {
  if (error.code === "invalid_api_key") return new GatewayError(503, "auth_configuration_required");
  if (error.status === 429) return new GatewayError(429, "auth_rate_limited");
  if (error.name === "AuthRetryableFetchError" || error.status === 0 || (error.status !== undefined && error.status >= 500)) return new GatewayError(503, "auth_unavailable");
  if (error.status !== undefined && error.status >= 400 && error.status < 500) return new GatewayError(401, "invalid_login");
  return new GatewayError(503, "auth_unavailable");
}
export function loginDiagnostic(error: unknown) {
  const safe = safeGatewayError(error);
  const category = ["origin_configuration_required", "auth_configuration_required"].includes(safe.code) ? "configuration"
    : safe.code === "auth_unavailable" ? "connectivity_or_auth_service"
    : safe.code === "auth_rate_limited" ? "rate_limit"
    : safe.code === "invalid_login" ? "credentials_or_account"
    : safe.code === "gateway_unavailable" ? "application_exception" : "request_rejected";
  // Never serialize the original exception, request, email, password or SDK response.
  return { event: "auth.login.rejected", category, status: safe.status };
}
