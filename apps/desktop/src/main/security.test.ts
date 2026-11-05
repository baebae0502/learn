import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { on: vi.fn() }, session: {}, shell: {} }));

const { isExternalOpenUrl } = await import('./security');

describe('which addresses a window-open may hand to the system', () => {
  it('allows web pages and mail links, whatever their case', () => {
    for (const url of ['https://example.org/learn', 'http://example.org', 'mailto:learn@example.org', 'HTTPS://EXAMPLE.ORG', 'MAILTO:a@b.c']) expect(isExternalOpenUrl(url), url).toBe(true);
  });
  it('refuses everything else', () => {
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', '', 'tel:123', 'ftp://example.org', ' https://example.org']) expect(isExternalOpenUrl(url), url).toBe(false);
  });
});
