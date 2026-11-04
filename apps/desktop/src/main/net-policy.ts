import { net } from 'electron';

/**
 * The only remote hosts main talks to (ADR-0012): translation. Everything else the app does is local; a new host is a
 * decision of its own, not a side effect of a new engine.
 */
export const ALLOWED_REMOTE_HOSTS: readonly string[] = ['translate.googleapis.com'];

/** net.fetch for https and the hosts above; anything else is refused before a request is made. */
export async function remoteFetch(url: string, init: RequestInit): Promise<Response> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('REMOTE_HOST_REFUSED');
  }
  if (parsed.protocol !== 'https:' || parsed.port !== '' || !ALLOWED_REMOTE_HOSTS.includes(parsed.hostname)) throw new Error('REMOTE_HOST_REFUSED');
  // A redirect could carry the request to a host that is not on the list.
  // credentials 'omit': the app's default session neither sends the host a cookie nor keeps the one it answers with.
  return net.fetch(url, { ...init, redirect: 'error', credentials: 'omit' });
}
