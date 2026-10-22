import { describe, expect, it, vi } from 'vitest';
import { applyShade, pickSettled, resolveTheme, shownTheme } from './theme';

describe('the page theme (T13M-m6)', () => {
  it('resolves 시스템 설정 from the system appearance, and light / dark as picked', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('crossfades a change the viewer sees, as a View Transition', () => {
    const root = { dataset: { theme: 'light' } as DOMStringMap };
    const startViewTransition = vi.fn((update: () => void) => update());
    expect(applyShade(root, 'dark', { animate: true, still: false, startViewTransition })).toBe(true);
    expect(startViewTransition).toHaveBeenCalledTimes(1);
    expect(root.dataset['theme']).toBe('dark');
  });

  it('switches at once on the first paint, with reduced motion, in a deterministic page, or without the API', () => {
    for (const opts of [
      { animate: false, still: false },
      { animate: true, still: true },
      { animate: true, still: false, startViewTransition: undefined },
    ]) {
      const root = { dataset: {} as DOMStringMap };
      const startViewTransition = vi.fn();
      expect(applyShade(root, 'dark', { startViewTransition: 'startViewTransition' in opts ? opts.startViewTransition : startViewTransition, ...opts })).toBe(true);
      expect(startViewTransition).not.toHaveBeenCalled();
      expect(root.dataset['theme']).toBe('dark');
    }
  });

  it('does nothing when the page already has that theme', () => {
    const root = { dataset: { theme: 'dark' } as DOMStringMap };
    const startViewTransition = vi.fn();
    expect(applyShade(root, 'dark', { animate: true, still: false, startViewTransition })).toBe(false);
    expect(startViewTransition).not.toHaveBeenCalled();
  });

  it('shows the tile just picked until the saved pref comes round to it', () => {
    expect(shownTheme('dark', 'system')).toBe('dark');
    expect(shownTheme(null, 'system')).toBe('system');
    expect(pickSettled('dark', 'system')).toBe(false);
    expect(pickSettled('dark', 'dark')).toBe(true);
    expect(pickSettled(null, 'dark')).toBe(false);
  });
});
