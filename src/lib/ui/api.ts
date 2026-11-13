"use client";
import { useRef, useState } from "react";

export function errorMessage(code: string) {
  const messages: Record<string, string> = {
    accounts_disabled: "Account registration and recovery are disabled here. Configure the approved local Auth setup; production prerequisites are not satisfied.",
    invalid_account_input: "Check your name and email. Passwords need at least 12 characters, uppercase, lowercase, a number and a symbol, and at most 72 UTF-8 bytes.",
    invalid_verification: "This code could not be verified. It may be invalid, expired or already used. Request a fresh code if needed.",
    invalid_recovery: "Fresh email recovery is required. The reset may not have completed; try signing in with your intended password or request a fresh recovery code.",
    account_action_uncertain: "The password action may have completed. Try signing in with your new password or request fresh recovery.",
    invalid_login: "We couldn’t sign you in. Check your email and password, and confirm that your account is verified.",
    origin_configuration_required: "The application origin is not configured. For the local demo, stop the server and run npm run demo (or npm run dev after demo setup).",
    auth_configuration_required: "Authentication is not configured. Start the saved local demo with npm run demo, or configure the application environment and restart it.",
    auth_unavailable: "The authentication service is unavailable. For the local demo, run npm run demo:setup to start its services, then restart the demo. Your password was not confirmed.",
    auth_rate_limited: "Too many sign-in attempts. Wait before trying again; authentication has not been bypassed.",
    authentication_required: "Your session has ended. Sign in again to continue.",
    verified_account_required: "A verified, active provider account is required.",
    forbidden: "You don’t have permission to perform this action.",
    not_found: "This agreement is unavailable or you don’t have access.",
    conflict: "The agreement changed or this action is no longer available. Refresh its status before continuing.",
    invalid_command: "Check the required fields, exact amount, dates and milestone totals, then try again.",
    invalid_capability: "Verification failed, or this invitation/session has expired or been revoked. Check your code; you may need a new invitation.",
    party_session_required: "Verify your invitation before reviewing this agreement.",
    rate_limited: "Too many requests. The shared verification limit has been reached. Try again after the hourly window resets.",
    signing_disabled: "Signing is disabled here. The local demonstration needs its verified local configuration.",
    local_recipient_required: "The local demo supports fictional example.test recipients only.",
    invalid_origin: "This page’s address does not match the configured application origin. Open the documented demo URL.",
  };
  return messages[code] ?? "The service is unavailable. Your action may not have completed. Retry the same action or refresh its status; do not create a second agreement.";
}
export async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "same-origin", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  let data;
  try { data = await response.json(); } catch { throw new Error(errorMessage("unavailable")); }
  if (!response.ok) throw new Error(errorMessage(data.error));
  return data as T;
}
export function useAction() {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const inFlight = useRef(false);
  async function run<T>(work: () => Promise<T>, success = ""): Promise<T | undefined> {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try { const result = await work(); setMessage(success); return result; }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Please try again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return { busy, error, message, run, setError, setMessage };
}
export function useIdempotency() {
  const keys = useRef(new Map<string, string>());
  return (command: Record<string, unknown>) => {
    const fingerprint = JSON.stringify(command);
    if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID());
    return { ...command, idempotency_key: keys.current.get(fingerprint)! };
  };
}
