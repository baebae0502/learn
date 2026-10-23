import { describe, expect, it } from 'vitest';
import { windowUrl } from './window-url';

const o = { platform: 'linux' as NodeJS.Platform, deterministic: false, vibrancy: false, demo: false };

describe('windowUrl', () => {
  it('tags every window with its kind and platform', () => {
    expect(windowUrl('learn://app/index.html', 'main', o)).toBe('learn://app/index.html?window=main&platform=linux');
    expect(windowUrl('http://localhost:5173', 'settings', { ...o, platform: 'darwin' })).toBe('http://localhost:5173/?window=settings&platform=darwin');
  });
  it('adds det=1 for deterministic renders, vibrancy only to the main window, demo to the main and settings windows', () => {
    const all = { platform: 'darwin' as NodeJS.Platform, deterministic: true, vibrancy: true, demo: true };
    expect(windowUrl('learn://app/index.html', 'main', all)).toBe('learn://app/index.html?window=main&platform=darwin&det=1&vibrancy=1&demo=1');
    expect(windowUrl('learn://app/index.html', 'settings', all)).toBe('learn://app/index.html?window=settings&platform=darwin&det=1&demo=1');
    expect(windowUrl('learn://app/index.html', 'sheet', all)).toBe('learn://app/index.html?window=sheet&platform=darwin&det=1');
  });
});
