import { describe, expect, it } from 'vitest';
import { limitFailures } from './budget';
import { READER_BUDGET_MS, frameGaps, readerLimits, allDone } from './reader-perf-math';

describe('reader-perf arithmetic (M7a spec 11)', () => {
  it('the budgets are the spec values', () => {
    expect(READER_BUDGET_MS).toEqual({ firstPage: 2000, scrollFrameP95: 16.7, zoomStep: 250, findFirstMatch: 500, thumbnailsVisible: 1000, popupCachedPaint: 100 });
  });
  it('frame gaps are the differences of consecutive frame times; fewer than two frames have none', () => {
    expect(frameGaps([0, 16, 33, 50])).toEqual([16, 17, 17]);
    expect(frameGaps([5])).toEqual([]);
    expect(frameGaps([])).toEqual([]);
  });
  it('a set of pages is done when every wanted page is in the done set; no wanted page is not done', () => {
    expect(allDone([2, 3], new Set([1, 2, 3]))).toBe(true);
    expect(allDone([2, 4], new Set([1, 2, 3]))).toBe(false);
    expect(allDone([], new Set([1]))).toBe(false);
  });
  it('the limits pair each value with its budget, and the Linux CI line is twice it', () => {
    const ok = { firstPage: 2000, scrollFrameP95: 33.4, zoomStep: 500, findFirstMatch: 1000, thumbnailsVisible: 2000, popupCachedPaint: 200 };
    expect(limitFailures(readerLimits(ok))).toEqual([]);
    expect(readerLimits(ok)).toHaveLength(6);
    const bad = limitFailures(readerLimits({ ...ok, zoomStep: 501, scrollFrameP95: 33.5 }));
    expect(bad).toHaveLength(2);
    expect(bad.join('\n')).toContain('zoom step');
  });
});
