import { describe, expect, it } from 'vitest';
import { APP_PERMISSIONS, appMayUse } from './permissions';

const ASSET = 'learn://app/asset/7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';

describe('what our pages may use (security.ts permission handlers, P-6)', () => {
  it('allows full screen and clipboard writes to app pages only', () => {
    for (const permission of ['fullscreen', 'clipboard-sanitized-write']) {
      expect(appMayUse(permission, 'learn://app/index.html?window=main', null), permission).toBe(true);
      expect(appMayUse(permission, ASSET, null), permission).toBe(false); // asset bytes never act as a page
      expect(appMayUse(permission, 'https://example.org/', null), permission).toBe(false);
    }
    expect(appMayUse('clipboard-sanitized-write', 'http://localhost:5173/', 'http://localhost:5173')).toBe(true);
  });
  it('never allows reading the clipboard, or anything else', () => {
    for (const permission of ['clipboard-read', 'media', 'geolocation', 'notifications', 'openExternal']) {
      expect(appMayUse(permission, 'learn://app/index.html', null), permission).toBe(false);
    }
    expect([...APP_PERMISSIONS].sort()).toEqual(['clipboard-sanitized-write', 'fullscreen']);
  });
});
