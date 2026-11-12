import { describe, expect, it } from 'vitest';
import type { Quad } from '@learn/domain';
import { attachedGeometry } from './attachedMark';

/** An unturned 600 × 800 pt page at 100 % (one point a pixel here), and the same page a quarter turn clockwise. */
const upright = { width: 600, height: 800, convertToViewportPoint: (x: number, y: number) => [x, 800 - y] };
const turned = { width: 800, height: 600, convertToViewportPoint: (x: number, y: number) => [y, x] };
/** A line's quad: x from `x0` to `x1`, y from `y0` to `y1` (unrotated page space, y up). */
const line = (x0: number, x1: number, y0: number, y1: number): Quad => [x0, y1, x1, y1, x0, y0, x1, y0];

describe('the page mark of an attached passage (spec 8.4, mockup .attached and .attach-bar)', () => {
  it('washes each line the passage covers, as shares of the page', () => {
    const { wash } = attachedGeometry([line(100, 300, 700, 712), line(56, 200, 687, 699)], 56, upright);
    expect(wash).toHaveLength(2);
    expect(wash[0]!.left).toBeCloseTo(100 / 600);
    expect(wash[0]!.top).toBeCloseTo(88 / 800);
    expect(wash[0]!.width).toBeCloseTo(200 / 600);
    expect(wash[0]!.height).toBeCloseTo(12 / 800);
    expect(wash[1]!.left).toBeCloseTo(56 / 600);
  });

  it('stands the bar 12 pt left of where the lines begin, 1.5 pt wide, from the first line\'s top to the last line\'s bottom', () => {
    const { bar } = attachedGeometry([line(100, 300, 700, 712), line(56, 200, 687, 699)], 56, upright);
    expect(bar.left).toBeCloseTo(44 / 600);
    expect(bar.width).toBeCloseTo(1.5 / 600);
    expect(bar.top).toBeCloseTo(88 / 800);
    expect(bar.height).toBeCloseTo(25 / 800);
  });

  it('turns with the page: a quarter turn lays the bar along the top of the lines', () => {
    const { wash, bar } = attachedGeometry([line(100, 300, 700, 712)], 100, turned);
    expect(wash[0]!.left).toBeCloseTo(700 / 800);
    expect(wash[0]!.top).toBeCloseTo(100 / 600);
    expect(bar.left).toBeCloseTo(700 / 800);
    expect(bar.width).toBeCloseTo(12 / 800);
    expect(bar.top).toBeCloseTo(88 / 600);
    expect(bar.height).toBeCloseTo(1.5 / 600);
  });

  it('keeps the bar on the page when the text starts at its edge', () => {
    expect(attachedGeometry([line(4, 300, 700, 712)], 4, upright).bar.left).toBe(0);
  });
});
