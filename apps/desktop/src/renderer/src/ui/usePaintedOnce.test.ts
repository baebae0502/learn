import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Renderer tests run in node without a DOM: react is replaced by a one-component harness that keeps the hook's state and
// runs its layout effect once, as the first commit would.
let state: unknown;
let cleanup: (() => void) | void;
vi.mock('react', () => ({
  useState: (initial: unknown) => {
    state = initial;
    return [state, (v: unknown) => (state = v)];
  },
  useLayoutEffect: (effect: () => (() => void) | void) => {
    cleanup = effect();
  },
}));

import { usePaintedOnce } from './usePaintedOnce';

let frames: Array<() => void>;
const flushFrame = () => frames.splice(0).forEach((cb) => cb());

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  usePaintedOnce();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('usePaintedOnce', () => {
  it('is false at the first commit and while only one frame has come', () => {
    expect(state).toBe(false);
    flushFrame();
    expect(state).toBe(false);
  });

  it('turns true once the second frame, the painted one, has come', () => {
    flushFrame();
    flushFrame();
    expect(state).toBe(true);
  });

  it('turns true after 100 ms where no frames come (a hidden window)', () => {
    vi.advanceTimersByTime(99);
    expect(state).toBe(false);
    vi.advanceTimersByTime(1);
    expect(state).toBe(true);
  });

  it('is done after the frames: the fallback timer is gone and no frame is left waiting', () => {
    flushFrame();
    flushFrame();
    vi.advanceTimersByTime(1000);
    expect(state).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(frames).toHaveLength(0);
  });

  it('leaves nothing pending when the component unmounts first', () => {
    (cleanup as () => void)();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(state).toBe(false);
  });
});
