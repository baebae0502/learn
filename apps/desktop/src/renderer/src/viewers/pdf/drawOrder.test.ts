import { describe, expect, it } from 'vitest';
import { drawOrder } from './drawOrder';

describe('drawOrder', () => {
  it('draws the pages within three of the current one first, nearest first, then the rest by distance', () => {
    expect(drawOrder([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 6)).toEqual([6, 5, 7, 4, 8, 3, 9, 2, 10, 1, 11, 12]);
  });
  it('puts the near pages ahead of a far one that is on screen', () => {
    expect(drawOrder([40, 41, 42, 43, 44, 60], 42)).toEqual([42, 41, 43, 40, 44, 60]);
  });
  it('keeps what is given, and handles nothing on screen', () => {
    const visible = [3, 2];
    drawOrder(visible, 1);
    expect(visible).toEqual([3, 2]);
    expect(drawOrder([], 5)).toEqual([]);
  });
});
