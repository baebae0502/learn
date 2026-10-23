import { describe, expect, it, vi } from 'vitest';
import { afterPaint, afterPaintOr } from './afterPaint';

/** Animation frames by hand: each draw() runs the callbacks queued before it, as one frame does. */
function frames() {
  let queue: Array<{ id: number; cb: () => void }> = [];
  let next = 1;
  return {
    raf: (cb: () => void) => {
      queue.push({ id: next, cb });
      return next++;
    },
    cancel: (id: number) => void (queue = queue.filter((f) => f.id !== id)),
    draw: () => {
      const now = queue;
      queue = [];
      for (const f of now) f.cb();
    },
  };
}

describe('overlay countdowns start on the first painted frame (Mac run 2, critique m2, n3)', () => {
  it('runs after the second frame: the first has painted what was set before it', () => {
    const f = frames();
    const fn = vi.fn();
    afterPaint(fn, f.raf, f.cancel);
    f.draw(); // the frame that paints the caption or the ring
    expect(fn).not.toHaveBeenCalled();
    f.draw();
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('can be cancelled before either frame', () => {
    const f = frames();
    const fn = vi.fn();
    const cancel = afterPaint(fn, f.raf, f.cancel);
    f.draw();
    cancel();
    f.draw();
    f.draw();
    expect(fn).not.toHaveBeenCalled();
  });
  it('afterPaintOr: the painted frame, or the fallback where no frames come; once either way', () => {
    vi.useFakeTimers();
    try {
      const f = frames();
      const fn = vi.fn();
      afterPaintOr(1000, fn, f.raf, f.cancel);
      f.draw();
      f.draw();
      expect(fn).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      expect(fn).toHaveBeenCalledTimes(1);
      const hidden = vi.fn();
      afterPaintOr(1000, hidden, f.raf, f.cancel); // a window that draws no frames
      vi.advanceTimersByTime(999);
      expect(hidden).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(hidden).toHaveBeenCalledTimes(1);
      f.draw();
      f.draw();
      expect(hidden).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
