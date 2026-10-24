import { describe, expect, it } from 'vitest';
import { median, percentile } from './percentile';

describe('percentile (nearest rank) and the median perf.json has always taken', () => {
  it('takes the nearest rank', () => {
    const xs = Array.from({ length: 20 }, (_, i) => 20 - i); // 20 … 1, unsorted on purpose
    expect(percentile(xs, 95)).toBe(19);
    expect(percentile(xs, 100)).toBe(20);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([3, 1, 2], 50)).toBe(2);
  });
  it('takes the upper middle for an even count, as perf.evidence.ts did', () => {
    expect(median([4, 1, 3, 2])).toBe(3);
    expect(median([5, 1, 3])).toBe(3);
  });
  it('refuses an empty list rather than report a number', () => {
    expect(() => percentile([], 95)).toThrow('no values');
  });
});
