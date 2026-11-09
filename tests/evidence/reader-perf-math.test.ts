import { describe, expect, it } from 'vitest';
import { limitFailures } from './budget';
import { READER_BUDGET_MS, frameGaps, readerLimits } from './reader-perf-math';

describe('reader-perf arithmetic (M7a spec 11)', () => {
  it('the budgets are the spec values', () => {
    expect(READER_BUDGET_MS).toEqual({ firstPage: 2000, scrollFrameP95: 16.7, zoomStep: 250, findFirstMatch: 500, thumbnailsVisible: 1000, popupCachedPaint: 100, imageFirstFrame: 500 });
  });
  it('frame gaps are the differences of consecutive frame times; fewer than two frames have none', () => {
    expect(frameGaps([0, 16, 33, 50])).toEqual([16, 17, 17]);
    expect(frameGaps([5])).toEqual([]);
    expect(frameGaps([])).toEqual([]);
  });
  it('the limits pair each value with its budget, and the Linux CI line is twice it', () => {
    const ok = { firstPage: 2000, scrollFrameP95: 33.4, zoomStep: 500, findFirstMatch: 1000, thumbnailsVisible: 2000, popupCachedPaint: 200, imageFirstFrame: 1000 };
    expect(limitFailures(readerLimits(ok))).toEqual([]);
    expect(readerLimits(ok)).toHaveLength(7);
    const bad = limitFailures(readerLimits({ ...ok, zoomStep: 501, scrollFrameP95: 33.5, imageFirstFrame: 1000.1 }));
    expect(bad).toHaveLength(3);
    expect(bad.join('\n')).toContain('zoom step');
    expect(bad.join('\n')).toContain('image tab open');
  });
});
