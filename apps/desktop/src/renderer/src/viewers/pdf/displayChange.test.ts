import { describe, expect, it, vi } from 'vitest';
import { watchDevicePixelRatio } from './displayChange';

/** A window whose pixel ratio can change: every matchMedia query remembers its listener. */
function fakeWindow(ratio: number) {
  const queries: Array<{ media: string; listeners: Set<() => void> }> = [];
  const win = {
    devicePixelRatio: ratio,
    matchMedia: (media: string) => {
      const q = { media, listeners: new Set<() => void>() };
      queries.push(q);
      return {
        media,
        addEventListener: (_: string, l: () => void) => q.listeners.add(l),
        removeEventListener: (_: string, l: () => void) => q.listeners.delete(l),
      } as unknown as MediaQueryList;
    },
  };
  return { win, queries, fire: () => queries.at(-1)!.listeners.forEach((l) => l()) };
}

describe('device pixel ratio', () => {
  it('matches the ratio in force, and again the new one after each change', () => {
    const f = fakeWindow(2);
    const onChange = vi.fn();
    watchDevicePixelRatio(onChange, f.win);
    expect(f.queries.map((q) => q.media)).toEqual(['(resolution: 2dppx)']);
    f.win.devicePixelRatio = 1;
    f.fire();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(f.queries.map((q) => q.media)).toEqual(['(resolution: 2dppx)', '(resolution: 1dppx)']);
    f.win.devicePixelRatio = 2;
    f.fire();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
  it('stops listening once stopped', () => {
    const f = fakeWindow(2);
    const onChange = vi.fn();
    const stop = watchDevicePixelRatio(onChange, f.win);
    const listeners = f.queries[0]!.listeners;
    stop();
    expect(listeners.size).toBe(0);
  });
});
