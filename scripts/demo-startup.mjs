export async function checkDemoAuth(env, fetcher = fetch) {
  const fail = (message) => new Error(`${message} Run npm run demo:setup for the owned local project, then restart the demo. Existing data is not reset.`);
  let url;
  try { url = new URL(env?.NEXT_PUBLIC_SUPABASE_URL); } catch { throw fail("Local demo Auth configuration is missing."); }
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:' || url.port !== '55621' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || env.ACCORDLY_APP_ORIGIN !== 'http://localhost:3000' || !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')) throw fail("Local demo Auth configuration is invalid.");
  let response;
  try { response = await fetcher(`${url.origin}/auth/v1/health`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }, signal: AbortSignal.timeout(5000), redirect: 'error' }); }
  catch { throw fail("Local Supabase Auth is unreachable; the application has not been started."); }
  if (!response.ok) throw fail([401,403].includes(response.status) ? "The saved local Auth key is no longer accepted." : "Local Supabase Auth is not healthy.");
}
