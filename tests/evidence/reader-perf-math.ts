// The arithmetic of reader-perf.json (M7a spec 11), apart from the app so it is unit-tested.
import type { Limit } from './budget';

/** M7a spec 11; ms. Linux CI fails beyond twice each (budget.ts); the Mac reports. */
export const READER_BUDGET_MS = { firstPage: 2000, scrollFrameP95: 16.7, zoomStep: 250, findFirstMatch: 500, thumbnailsVisible: 1000, popupCachedPaint: 100 } as const;

/** Differences of consecutive frame times (ms); none for fewer than two frames. */
export function frameGaps(times: readonly number[]): number[] {
  return times.slice(1).map((t, i) => t - times[i]!);
}

const WHAT: Record<keyof typeof READER_BUDGET_MS, string> = {
  firstPage: 'first page (median of 5)',
  scrollFrameP95: 'scroll frame gap p95',
  zoomStep: 'zoom step (median of 10)',
  findFirstMatch: 'find first match (median of 5)',
  thumbnailsVisible: 'thumbnails visible (median of 5)',
  popupCachedPaint: 'cached translation pop-up paint p95',
};

export function readerLimits(values: Readonly<Record<keyof typeof READER_BUDGET_MS, number>>): Limit[] {
  return (Object.keys(READER_BUDGET_MS) as Array<keyof typeof READER_BUDGET_MS>).map((k) => ({ what: WHAT[k], value: values[k], budget: READER_BUDGET_MS[k] }));
}
