import { describe, expect, it, vi } from 'vitest';
import { applyShade, pickSettled, resolveTheme, shownTheme } from './theme';

/** No frames in node: the test runs the "after the next frame" callbacks itself. */
function frames() {
  const queue: Array<() => void> = [];
  return { afterFrame: (fn: () => void) => void queue.push(fn), draw: () => queue.splice(0).forEach((fn) => fn()) };
}

describe('the page theme (T13M-m6, T13R4-m1)', () => {
  it('resolves 시스템 설정 from the system appearance, and light / dark as picked', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('switches at once on every platform and says so after the next frame (no crossfade: Mac run 2, critique m1)', () => {
    const root = { dataset: { theme: 'light' } as DOMStringMap };
    const f = frames();
    const onShown = vi.fn();
    expect(applyShade(root, 'dark', { onShown, afterFrame: f.afterFrame })).toBe(true);
    expect(root.dataset['theme']).toBe('dark');
    expect(onShown).not.toHaveBeenCalled(); // not before it is drawn: main applies nothing native yet
    f.draw();
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the page already has that theme, and says at once that it is shown (main may be waiting)', () => {
    const root = { dataset: { theme: 'dark' } as DOMStringMap };
    const onShown = vi.fn();
    expect(applyShade(root, 'dark', { onShown })).toBe(false);
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it('shows the tile just picked until the saved pref comes round to it', () => {
    expect(shownTheme('dark', 'system')).toBe('dark');
    expect(shownTheme(null, 'system')).toBe('system');
    expect(pickSettled('dark', 'system')).toBe(false);
    expect(pickSettled('dark', 'dark')).toBe(true);
    expect(pickSettled(null, 'dark')).toBe(false);
  });
});
