import { describe, expect, it } from 'vitest';
import { centredScrollTop } from './tableDom';

describe('the table scrolls a row it brings back into the middle of the view (spec 3.3)', () => {
  it('centres the row, never above the top', () => {
    expect(centredScrollTop(100, 28, 600)).toBe(2514); // 100 × 28 − (600 − 28) / 2
    expect(centredScrollTop(5, 28, 600)).toBe(0);
    expect(centredScrollTop(0, 24, 300)).toBe(0);
  });
});
