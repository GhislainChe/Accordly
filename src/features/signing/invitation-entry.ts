export type PrivateInvitation = { invitation_id: string; token: string };
export function parsePrivateInvitation(value: string, origin: string): PrivateInvitation | null {
  let fragment = value.trim();
  if (fragment.startsWith("http://") || fragment.startsWith("https://")) {
    try { const url = new URL(fragment); if (url.origin !== origin || url.pathname !== "/invite" || url.search) return null; fragment = url.hash.slice(1); } catch { return null; }
  }
  if (fragment.startsWith("#")) fragment = fragment.slice(1);
  const match = fragment.match(/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/);
  return match ? { invitation_id: match[1], token: match[2] } : null;
}
export function consumePrivateFragment(location: Pick<Location, "hash" | "search" | "pathname">, history: Pick<History, "replaceState">): string {
  const fragment = location.hash.slice(1);
  if (location.hash || location.search) history.replaceState(null, "", location.pathname);
  return fragment;
}
