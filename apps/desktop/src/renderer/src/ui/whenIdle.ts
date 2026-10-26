import type { Pending } from './afterPaint';

/**
 * Runs `fn` at the window's next idle moment, or after `timeoutMs` at the latest: a window nobody touches can go
 * without idle periods, and work waiting for one would then wait for the first keystroke.
 */
export function whenIdle(fn: () => void, timeoutMs: number): Pending {
  const id = requestIdleCallback(fn, { timeout: timeoutMs });
  return () => cancelIdleCallback(id);
}
