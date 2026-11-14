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

  /** `n` lines of one column, `step` pt apart, 10 pt high, from baseline 700 down. */
  const spaced = (n: number, step: number, start = 56) => Array.from({ length: n }, (_, i) => line(start, start + 235, 700 - i * step));

  it('follows the text\'s own line spacing: single, 160 % and double spaced columns are one run each', () => {
    for (const step of [12, 17, 19, 24]) expect(markRuns(spaced(6, step), 0, 5), `${step} pt apart`).toEqual([{ from: 0, to: 5 }]);
  });

  it('splits a column where a figure (or a gap well past the column\'s own spacing) stands between its lines', () => {
    // Three lines, a figure 120 pt high, three more.
    const figure = [...spaced(3, 13), ...spaced(3, 13).map((l) => ({ ...l, base: l.base - 26 - 120 }))];
    expect(markRuns(figure, 0, 5)).toEqual([{ from: 0, to: 2 }, { from: 3, to: 5 }]);
    // A paragraph's extra 11 pt in single spaced text (a step of 24 among steps of 13): the mockup's bar is one per paragraph.
    const paragraphs = [...spaced(3, 13), ...spaced(3, 13).map((l) => ({ ...l, base: l.base - 39 + 1 - 12 }))];
    expect(markRuns(paragraphs, 0, 5)).toEqual([{ from: 0, to: 2 }, { from: 3, to: 5 }]);
    // Double spaced text keeps its runs whole: a step of 24 is its own spacing.
    expect(markRuns(spaced(4, 24), 0, 3)).toEqual([{ from: 0, to: 3 }]);
  });

  it('stands the bar a third of a narrow gutter from its own column (never under 3 pt), 12 pt in an open margin', () => {
    // A 13 pt gutter: column 1's lines end at 291, column 2's begin at 304.
    const quads = [glyphs(304, 539, 700), glyphs(304, 539, 687)];
    const narrow = marginOf(columns, 3, 4, quads, 0).bars[0]!;
    expect(narrow.at).toBe(304);
    expect(narrow.gap).toBeCloseTo(13 / 3 + 1.5);
    // Column 1 in the page's open margin.
    expect(marginOf(columns, 0, 1, [glyphs(56, 291, 700), glyphs(56, 291, 687)], 0, 0).bars[0]!.gap).toBe(12);
    // Text 9 pt from the page's edge: a third of 9 is 3; 6 pt from it, still 3.
    expect(marginOf([line(9, 200, 700)], 0, 0, [glyphs(9, 200, 700)], 0, 0).bars[0]!.gap).toBeCloseTo(3 + 1.5);
    expect(marginOf([line(6, 200, 700)], 0, 0, [glyphs(6, 200, 700)], 0, 0).bars[0]!.gap).toBeCloseTo(3 + 1.5);
  });

  it('measures a gutter to the column beside it, not to the lines on the run\'s own rows', () => {
    // Two columns of ten lines, 13 pt apart, a 13 pt gutter: column 1's lines end at 291 but for the two short ones beside the run.
    const page = [
      ...Array.from({ length: 10 }, (_, i) => line(56, i === 4 || i === 5 ? 200 : 291, 700 - i * 13)),
      ...Array.from({ length: 10 }, (_, i) => line(304, 539, 700 - i * 13)),
    ];
    const bar = marginOf(page, 14, 15, [glyphs(304, 539, 648), glyphs(304, 539, 635)], 0, 0).bars[0]!;
    expect(bar.gap).toBeCloseTo(13 / 3 + 1.5);
    // Every run of that column takes the same place: its first two lines, beside full ones, too.
    expect(marginOf(page, 10, 11, [glyphs(304, 539, 700), glyphs(304, 539, 687)], 0, 0).bars[0]!.gap).toBeCloseTo(bar.gap);
  });

  it('keeps 12 pt on a page of one column, and lets no one stray long line decide a gutter', () => {
    const single = Array.from({ length: 8 }, (_, i) => line(72, 520, 700 - i * 13));
    expect(marginOf(single, 2, 3, [glyphs(72, 520, 674), glyphs(72, 520, 661)], 0, 0).bars[0]!.gap).toBe(12);
    // Column 1 ends at 250 (54 pt of free space) but for one line that runs to 300.
    const stray = [
      ...Array.from({ length: 10 }, (_, i) => line(56, i === 3 ? 300 : 250, 700 - i * 13)),
      ...Array.from({ length: 10 }, (_, i) => line(304, 539, 700 - i * 13)),
    ];
    expect(marginOf(stray, 13, 14, [glyphs(304, 539, 661), glyphs(304, 539, 648)], 0, 0).bars[0]!.gap).toBe(12);
  });

  it('gives each run its own bar, where its lines begin, spanning its washed lines only', () => {
    // From the middle of column 1's second line to the middle of column 2's second line.
    const quads = [glyphs(150, 291, 687), glyphs(56, 291, 674), glyphs(304, 539, 700), glyphs(304, 420, 687)];
    const { bars } = marginOf(columns, 1, 4, quads, 0);
    expect(bars).toMatchObject([
      { at: 56, top: 695, bottom: 672, gap: 12 },
      { at: 304, top: 708, bottom: 685 },
    ]);
  });

  it('stands beside the column\'s edge for a first line set in, selected alone; never beside a column it does not join', () => {
    // A paragraph's last line, the next paragraph's first line set in by 10 pt, its second line.
    const page = [line(56, 291, 700), line(66, 291, 687), line(56, 291, 674)];
    expect(marginOf(page, 1, 1, [glyphs(66, 291, 687)], 0).bars).toMatchObject([{ at: 56, top: 695, bottom: 685 }]);
    // Column 2's first line: the line read before it is column 1's last, at the page's foot — not its neighbour.
    const two = [line(56, 291, 100), line(304, 539, 700), line(304, 539, 687)];
    expect(marginOf(two, 1, 1, [glyphs(304, 539, 700)], 0).bars).toMatchObject([{ at: 304, top: 708, bottom: 698 }]);
  });

  it('works in the text\'s own frame on a page set on its side (/Rotate): its lines run up the page', () => {
    const turn: Turn = 90;
    // Text running up (direction +y): a line at x = 100 (its baseline), from y 50 to 300; the next line at x = 113.
    const [u, v] = toFrame(turn, 100, 50);
    expect([u, v]).toEqual([50, -100]);
    const lines = [line(50, 300, -100), line(50, 300, -113)];
    const quads = [box(92, 102, 50, 300), box(105, 115, 50, 300)];
    expect(marginOf(lines, 0, 1, quads, turn).bars).toMatchObject([{ at: 50, top: -92, bottom: -115 }]);
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
    const { bars } = attachedGeometry([box(100, 300, 700, 712)], { turn: 0, bars: [{ at: 56, gap: 12, top: 712, bottom: 687 }, { at: 304, gap: 12, top: 712, bottom: 700 }] }, upright);
    expect(bars).toHaveLength(2);
    expect(bars[0]!.left).toBeCloseTo(44 / 600);
    expect(bars[0]!.width).toBeCloseTo(1.5 / 600);
    expect(bars[0]!.top).toBeCloseTo(88 / 800);
    expect(bars[0]!.height).toBeCloseTo(25 / 800);
    expect(bars[1]!.left).toBeCloseTo(292 / 600);
  });

  it('turns with the page: a quarter turn lays the bar along the top of the lines', () => {
    const { wash, bars } = attachedGeometry([box(100, 300, 700, 712)], { turn: 0, bars: [{ at: 100, gap: 12, top: 712, bottom: 700 }] }, turned);
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
    expect(attachedGeometry([box(4, 300, 700, 712)], { turn: 0, bars: [{ at: 4, gap: 12, top: 712, bottom: 700 }] }, upright).bars[0]!.left).toBe(0);
  });
});
