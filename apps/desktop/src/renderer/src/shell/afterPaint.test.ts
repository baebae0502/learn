import { describe, expect, it, vi } from 'vitest';
import { afterPaint } from './DemoOverlay';

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
});
