export function uiContentSecurityPolicy(nonce: string, development: boolean) {
  if (!/^[A-Za-z0-9+/=]{20,64}$/.test(nonce)) throw new Error("Invalid CSP nonce");
  return `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'${development ? " ws://localhost:* ws://127.0.0.1:*" : ""}; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'`;
}
