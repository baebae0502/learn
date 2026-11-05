import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ net: { fetch: vi.fn() } }));
const { ALLOWED_REMOTE_HOSTS, remoteFetch } = await import('./net-policy');
const { net } = await import('electron');

describe('remoteFetch', () => {
  it('allows the translation host only', () => {
    expect(ALLOWED_REMOTE_HOSTS).toEqual(['translate.googleapis.com']);
  });
  it.each([
    'https://example.org/', 'http://translate.googleapis.com/translate_a/single', 'https://translate.googleapis.com.evil.org/',
    'https://evil.org@translate.googleapis.com.evil.org/', 'https://translate.googleapis.com:8443/', 'file:///etc/passwd', 'not a url',
  ])('refuses %s without a request', async (url) => {
    await expect(remoteFetch(url, {})).rejects.toThrow('REMOTE_HOST_REFUSED');
    expect(net.fetch).not.toHaveBeenCalled();
  });
  it('passes the allowed address to net.fetch', async () => {
    const res = new Response('x');
    vi.mocked(net.fetch).mockResolvedValueOnce(res);
    await expect(remoteFetch('https://translate.googleapis.com/translate_a/single?client=gtx', { method: 'POST' })).resolves.toBe(res);
    expect(net.fetch).toHaveBeenCalledWith('https://translate.googleapis.com/translate_a/single?client=gtx', { method: 'POST', redirect: 'error', credentials: 'omit' });
  });
  it('sends and keeps no cookies of the host, whatever the caller asked (final review m-7)', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response('x'));
    await remoteFetch('https://translate.googleapis.com/x', { credentials: 'include' });
    expect(vi.mocked(net.fetch).mock.lastCall?.[1]).toMatchObject({ credentials: 'omit' });
  });
  it('never follows a redirect, whatever the caller asked', async () => {
    vi.mocked(net.fetch).mockResolvedValueOnce(new Response('x'));
    await remoteFetch('https://translate.googleapis.com/x', { redirect: 'follow' });
    expect(vi.mocked(net.fetch).mock.lastCall?.[1]).toMatchObject({ redirect: 'error' });
  });
});
