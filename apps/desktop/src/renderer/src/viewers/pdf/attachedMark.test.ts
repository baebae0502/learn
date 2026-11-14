import { describe, expect, it } from 'vitest';
import type { Quad } from '@learn/domain';
import { attachedGeometry, marginOf, markRuns, toFrame, type TextLine, type Turn } from './attachedMark';

/** An unturned 600 × 800 pt page at 100 % (one point a pixel here), and the same page a quarter turn clockwise. */
const upright = { width: 600, height: 800, scale: 1, convertToViewportPoint: (x: number, y: number) => [x, 800 - y] };
const turned = { width: 800, height: 600, scale: 1, convertToViewportPoint: (x: number, y: number) => [y, x] };
/** A line's quad: x from `x0` to `x1`, y from `y0` to `y1` (unrotated page space, y up). */
const box = (x0: number, x1: number, y0: number, y1: number): Quad => [x0, y1, x1, y1, x0, y0, x1, y0];
/** A text line of upright text: from `start` to `end`, its baseline `base`, 10 pt high. */
const line = (start: number, end: number, base: number, h = 10): TextLine => ({ start, end, base, h });
/** The glyph box of a line as the selection draws it: 2 pt under the baseline to 8 pt over it. */
const glyphs = (x0: number, x1: number, base: number): Quad => box(x0, x1, base - 2, base + 8);

describe('the runs of attached lines a bar stands beside (spec 8.4, mockup .attach-bar "spans the attached lines")', () => {
  // Two columns of three lines (column 1 read first), 13 pt apart.
  const columns = [line(56, 291, 700), line(56, 291, 687), line(56, 291, 674), line(304, 539, 700), line(304, 539, 687), line(304, 539, 674)];

  it('a passage across the column break is two runs: column 1\'s lines, then column 2\'s', () => {
    expect(markRuns(columns, 1, 4)).toEqual([{ from: 1, to: 2 }, { from: 3, to: 4 }]);
  });

  it('a title read after the body above it, and a figure\'s gap, start new runs', () => {
    // Two sentences, the title (read after them, above them), then the body after a gap of four lines.
    const page = [line(56, 400, 744), line(56, 380, 731), line(56, 200, 806, 14), line(56, 291, 680), line(56, 291, 667)];
    expect(markRuns(page, 0, 4)).toEqual([{ from: 0, to: 1 }, { from: 2, to: 2 }, { from: 3, to: 4 }]);
  });

  it('gives each run its own bar, where its lines begin, spanning its washed lines only', () => {
    // From the middle of column 1's second line to the middle of column 2's second line.
    const quads = [glyphs(150, 291, 687), glyphs(56, 291, 674), glyphs(304, 539, 700), glyphs(304, 420, 687)];
    const { bars } = marginOf(columns, 1, 4, quads, 0);
    expect(bars).toEqual([
      { at: 56, top: 695, bottom: 672 },
      { at: 304, top: 708, bottom: 685 },
    ]);
  });

  it('stands beside the column\'s edge for a first line set in, selected alone; never beside a column it does not join', () => {
    // A paragraph's last line, the next paragraph's first line set in by 10 pt, its second line.
    const page = [line(56, 291, 700), line(66, 291, 687), line(56, 291, 674)];
    expect(marginOf(page, 1, 1, [glyphs(66, 291, 687)], 0).bars).toEqual([{ at: 56, top: 695, bottom: 685 }]);
    // Column 2's first line: the line read before it is column 1's last, at the page's foot — not its neighbour.
    const two = [line(56, 291, 100), line(304, 539, 700), line(304, 539, 687)];
    expect(marginOf(two, 1, 1, [glyphs(304, 539, 700)], 0).bars).toEqual([{ at: 304, top: 708, bottom: 698 }]);
  });

  it('works in the text\'s own frame on a page set on its side (/Rotate): its lines run up the page', () => {
    const turn: Turn = 90;
    // Text running up (direction +y): a line at x = 100 (its baseline), from y 50 to 300; the next line at x = 113.
    const [u, v] = toFrame(turn, 100, 50);
    expect([u, v]).toEqual([50, -100]);
    const lines = [line(50, 300, -100), line(50, 300, -113)];
    const quads = [box(92, 102, 50, 300), box(105, 115, 50, 300)];
    expect(marginOf(lines, 0, 1, quads, turn).bars).toEqual([{ at: 50, top: -92, bottom: -115 }]);
  });
});

describe('the page mark drawn as shares of the page', () => {
  it('washes each line the passage covers', () => {
    const { wash } = attachedGeometry([box(100, 300, 700, 712), box(56, 200, 687, 699)], null, upright);
    expect(wash).toHaveLength(2);
    expect(wash[0]!.left).toBeCloseTo(100 / 600);
    expect(wash[0]!.top).toBeCloseTo(88 / 800);
    expect(wash[0]!.width).toBeCloseTo(200 / 600);
    expect(wash[0]!.height).toBeCloseTo(12 / 800);
    expect(wash[1]!.left).toBeCloseTo(56 / 600);
  });

  it('stands each bar 12 pt left of where its run begins, 1.5 pt wide, as tall as the run', () => {
    const { bars } = attachedGeometry([box(100, 300, 700, 712)], { turn: 0, bars: [{ at: 56, top: 712, bottom: 687 }, { at: 304, top: 712, bottom: 700 }] }, upright);
    expect(bars).toHaveLength(2);
    expect(bars[0]!.left).toBeCloseTo(44 / 600);
    expect(bars[0]!.width).toBeCloseTo(1.5 / 600);
    expect(bars[0]!.top).toBeCloseTo(88 / 800);
    expect(bars[0]!.height).toBeCloseTo(25 / 800);
    expect(bars[1]!.left).toBeCloseTo(292 / 600);
  });

  it('turns with the page: a quarter turn lays the bar along the top of the lines', () => {
    const { wash, bars } = attachedGeometry([box(100, 300, 700, 712)], { turn: 0, bars: [{ at: 100, top: 712, bottom: 700 }] }, turned);
    expect(wash[0]!.left).toBeCloseTo(700 / 800);
    expect(wash[0]!.top).toBeCloseTo(100 / 600);
    expect(bars[0]!.left).toBeCloseTo(700 / 800);
    expect(bars[0]!.width).toBeCloseTo(12 / 800);
    expect(bars[0]!.top).toBeCloseTo(88 / 600);
    expect(bars[0]!.height).toBeCloseTo(1.5 / 600);
  });

  it('without the text\'s frame (text set at an angle), stands a bar left of each run of washed lines on the screen', () => {
    // Two lines of one column and a line of another, at 200 %.
    const at200 = { ...upright, width: 1200, height: 1600, scale: 2, convertToViewportPoint: (x: number, y: number) => [2 * x, 2 * (800 - y)] };
    const { bars } = attachedGeometry([box(56, 291, 700, 710), box(56, 291, 687, 697), box(304, 539, 700, 710)], null, at200);
    expect(bars).toHaveLength(2);
    expect(bars[0]!.left * 1200).toBeCloseTo(112 - 24);
    expect(bars[0]!.width * 1200).toBeCloseTo(3);
    expect(bars[0]!.height * 1600).toBeCloseTo(46);
    expect(bars[1]!.left * 1200).toBeCloseTo(608 - 24);
  });

  it('keeps a bar on the page when the text starts at its edge', () => {
    expect(attachedGeometry([box(4, 300, 700, 712)], { turn: 0, bars: [{ at: 4, top: 712, bottom: 700 }] }, upright).bars[0]!.left).toBe(0);
  });
});
