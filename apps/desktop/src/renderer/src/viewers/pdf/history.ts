/**
 * Back and forward as two ends of one list: the places a jump left, and the place the reader was at when it went back.
 * `entries[index]` is the place of the reader's present; a null is a slot that has not been written yet (the present).
 * Going back writes where the reader is into the slot it leaves, so going forward comes back to that place and not to the
 * jump's target.
 */
export interface History<T> {
  readonly entries: readonly (T | null)[];
  readonly index: number;
}

export const HISTORY_MAX = 50;

export function emptyHistory<T>(): History<T> {
  return { entries: [null], index: 0 };
}

/** A jump leaves `here`: it is written into the present slot, what lay ahead is dropped, and a new present slot follows. */
export function recordJump<T>(h: History<T>, here: T): History<T> {
  const kept = [...h.entries.slice(0, h.index), here, null];
  const entries = kept.length > HISTORY_MAX ? kept.slice(kept.length - HISTORY_MAX) : kept;
  return { entries, index: entries.length - 1 };
}

export const canGoBack = (h: History<unknown>): boolean => h.index > 0;
export const canGoForward = (h: History<unknown>): boolean => h.index < h.entries.length - 1;

function step<T>(h: History<T>, here: T, to: number): { history: History<T>; target: T } | null {
  const target = h.entries[to];
  if (target === null || target === undefined) return null;
  const entries = h.entries.slice();
  entries[h.index] = here;
  return { history: { entries, index: to }, target };
}

export function goBack<T>(h: History<T>, here: T): { history: History<T>; target: T } | null {
  return canGoBack(h) ? step(h, here, h.index - 1) : null;
}

export function goForward<T>(h: History<T>, here: T): { history: History<T>; target: T } | null {
  return canGoForward(h) ? step(h, here, h.index + 1) : null;
}
