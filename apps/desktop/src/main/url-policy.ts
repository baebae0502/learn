/**
 * Node's URL.origin is "null" for non-special schemes such as learn:, so compare protocol + host.
 * The dev server origin is allowed only in unpackaged dev runs (caller passes null otherwise).
 */
export function isAllowedAppUrl(rawUrl: string, devOrigin: string | null): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  // Asset bytes live under /asset/ on the app origin; they must never act as an app page (navigation or IPC caller).
  if (u.protocol === 'learn:' && u.host === 'app') return !u.pathname.startsWith('/asset/');
  return devOrigin !== null && u.origin === devOrigin;
}
