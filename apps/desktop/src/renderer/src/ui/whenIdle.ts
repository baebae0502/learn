import type { Pending } from './afterPaint';

/**
 * Runs `fn` at the window's next idle moment, or after `timeoutMs` at the latest: a window nobody touches can go
 * without idle periods, and work waiting for one would then wait for the first keystroke. The latest moment has a
 * timer of its own as well as the idle callback's timeout, so it holds even where idle callbacks are held back (a
 * window that has not painted yet, a machine busy starting up).
 */
export function whenIdle(fn: () => void, timeoutMs: number): Pending {
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    cancelIdleCallback(id);
    clearTimeout(timer);
    fn();
  };
  const id = requestIdleCallback(once, { timeout: timeoutMs });
  const timer = setTimeout(once, timeoutMs);
  return () => {
    done = true;
    cancelIdleCallback(id);
    clearTimeout(timer);
  };
}
