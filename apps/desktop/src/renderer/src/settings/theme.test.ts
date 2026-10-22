import { describe, expect, it, vi } from 'vitest';
import { applyShade, crossfades, pickSettled, resolveTheme, shownTheme } from './theme';

/** A View Transition stand-in: runs the update when told, and resolves updateCallbackDone after it. */
function transition() {
  let run: (() => void) | null = null;
  let resolveDone!: () => void;
  const updateCallbackDone = new Promise<void>((resolve) => (resolveDone = resolve));
  const start = vi.fn((update: () => void) => {
    run = () => {
      update();
      resolveDone();
    };
    return { updateCallbackDone };
  });
  return { start, update: () => run?.() };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
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

  it('crossfades a change the viewer sees, as a View Transition, and says it is shown once the update is made', async () => {
    const root = { dataset: { theme: 'light' } as DOMStringMap };
    const t = transition();
    const onShown = vi.fn();
    expect(applyShade(root, 'dark', { animate: true, still: false, startViewTransition: t.start, onShown })).toBe(true);
    expect(t.start).toHaveBeenCalledTimes(1);
    await flush();
    // The old state is still being captured: nothing is shown yet, so main applies nothing native yet.
    expect(root.dataset['theme']).toBe('light');
    expect(onShown).not.toHaveBeenCalled();
    t.update();
    await flush();
    expect(root.dataset['theme']).toBe('dark');
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it('switches at once on the first paint, with reduced motion, in a deterministic page, or without the API, and says so after the next frame', () => {
    for (const opts of [
      { animate: false, still: false },
      { animate: true, still: true },
      { animate: true, still: false, startViewTransition: undefined },
    ]) {
      const root = { dataset: {} as DOMStringMap };
      const t = transition();
      const f = frames();
      const onShown = vi.fn();
      const startViewTransition = 'startViewTransition' in opts ? opts.startViewTransition : t.start;
      expect(applyShade(root, 'dark', { ...opts, startViewTransition, onShown, afterFrame: f.afterFrame })).toBe(true);
      expect(t.start).not.toHaveBeenCalled();
      expect(root.dataset['theme']).toBe('dark');
      expect(onShown).not.toHaveBeenCalled();
      f.draw();
      expect(onShown).toHaveBeenCalledTimes(1);
    }
  });

  it('a transition that cannot start falls back to the instant change', () => {
    const root = { dataset: { theme: 'light' } as DOMStringMap };
    const f = frames();
    const onShown = vi.fn();
    const startViewTransition = () => {
      throw new Error('InvalidStateError');
    };
    expect(applyShade(root, 'dark', { animate: true, still: false, startViewTransition, onShown, afterFrame: f.afterFrame })).toBe(true);
    expect(root.dataset['theme']).toBe('dark');
    f.draw();
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the page already has that theme, and says at once that it is shown (main may be waiting)', () => {
    const root = { dataset: { theme: 'dark' } as DOMStringMap };
    const t = transition();
    const onShown = vi.fn();
    expect(applyShade(root, 'dark', { animate: true, still: false, startViewTransition: t.start, onShown })).toBe(false);
    expect(t.start).not.toHaveBeenCalled();
    expect(onShown).toHaveBeenCalledTimes(1);
  });

  it('crossfades on macOS only (the AppKit lag it covers); elsewhere a change is instant (T13R4-m1)', () => {
    expect(crossfades('darwin')).toBe(true);
    expect(crossfades('linux')).toBe(false);
    expect(crossfades('win32')).toBe(false);
  });

  it('shows the tile just picked until the saved pref comes round to it', () => {
    expect(shownTheme('dark', 'system')).toBe('dark');
    expect(shownTheme(null, 'system')).toBe('system');
    expect(pickSettled('dark', 'system')).toBe(false);
    expect(pickSettled('dark', 'dark')).toBe(true);
    expect(pickSettled(null, 'dark')).toBe(false);
  });
});
