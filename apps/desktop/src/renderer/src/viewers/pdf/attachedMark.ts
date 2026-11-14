import { quadToRect, type ClientRect, type PdfSpanAnchor, type Quad } from '@learn/domain';

/**
 * The page mark of the passage attached to a question (spec 8.4; approved mockup .attached and .attach-bar): a light wash over the
 * passage's lines and, in the margin, a bar beside each run of them — Learn's own mark, never the find colour. Drawn in the page's own
 * layer from the anchor's quads, as shares of the page, so a zoom keeps it in place; a redraw (a turn) draws it again.
 */

/** What the mark needs of a page's viewport: its size in pixels, its pixels per point, and the way a page point lands on it. */
export interface MarkViewport {
  width: number;
  height: number;
  scale: number;
  convertToViewportPoint(x: number, y: number): number[];
}

/** A box of the page as shares (0–1) of its width and height. */
export interface PageShare {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The direction the page's text runs in, counter-clockwise in page space: 0 for upright text, 90 for a page set on its side (/Rotate). */
export type Turn = 0 | 90 | 180 | 270;

/**
 * One line of the page's text, in reading order, in the text's own frame: `start` and `end` along the text, `base` its baseline across
 * it (larger is higher up), `h` its height.
 */
export interface TextLine {
  start: number;
  end: number;
  base: number;
  h: number;
}

/**
 * A bar in the text's own frame: `at` where the lines it stands beside begin, `gap` how far before them its far edge stands, `top` and
 * `bottom` across them.
 */
export interface MarkBar {
  at: number;
  gap: number;
  top: number;
  bottom: number;
}

/** Where an attached passage's bars stand: the direction of its text, and one bar per run of attached lines. */
export interface MarkMargin {
  turn: Turn;
  bars: MarkBar[];
}

/** The mockup's bar at 100 %: 16 px left of the text and 2 px wide — 12 and 1.5 points of the page. */
const BAR_GAP_PT = 12;
const BAR_WIDTH_PT = 1.5;
/** Free space left of a run under this (a narrow gutter, text near the page's edge): the bar stands a third of it from its own lines. */
const NARROW_PT = 24;
const NEAREST_PT = 3;
/** The furthest the next line of a run ever sits below the one before it, in line heights: farther is a figure or another block. */
const RUN_CAP = 3;
/** Within that, a step past this many times the run's own line step (its lower median) is a gap too: a new paragraph, a small figure. */
const RUN_SPREAD = 1.5;

const COS: Record<Turn, number> = { 0: 1, 90: 0, 180: -1, 270: 0 };
const SIN: Record<Turn, number> = { 0: 0, 90: 1, 180: 0, 270: -1 };
/** A page point in the text's frame: along the text, then across it (up). */
export const toFrame = (turn: Turn, x: number, y: number): [number, number] => [x * COS[turn] + y * SIN[turn], -x * SIN[turn] + y * COS[turn]];
const fromFrame = (turn: Turn, u: number, v: number): [number, number] => [u * COS[turn] - v * SIN[turn], u * SIN[turn] + v * COS[turn]];

/** Line `b` can go on with line `a`'s run: below it, within `limit` pt, overlapping it along the text (the same column). */
const near = (a: TextLine, b: TextLine, limit: number): boolean => b.base < a.base && a.base - b.base <= limit && b.start < a.end && a.start < b.end;
const capOf = (a: TextLine, b: TextLine): number => RUN_CAP * Math.max(a.h, b.h);

/** The step a run's lines may take, from the run's own spacing: its lower median step, times 1.5 (no more than the cap). */
function stepLimit(lines: readonly TextLine[], from: number, to: number): number {
  const steps = lines.slice(from + 1, to + 1).map((l, i) => lines[from + i]!.base - l.base).sort((a, b) => a - b);
  const cap = RUN_CAP * Math.max(...lines.slice(from, to + 1).map((l) => l.h));
  return steps.length === 0 ? cap : Math.min(cap, RUN_SPREAD * steps[Math.floor((steps.length - 1) / 2)]!);
}

/**
 * Lines `first`..`last` (reading order) cut into runs of consecutive lines, each line just below the one before in the same column, at
 * the column's own spacing (single, 1.6 or double spaced alike): a line above the one before (the next column, or a title read after
 * the body), one more than three line heights below it (a figure), or one well past the run's own step (a new paragraph) starts a
 * new run.
 */
export function markRuns(lines: readonly TextLine[], first: number, last: number): Array<{ from: number; to: number }> {
  const loose: Array<{ from: number; to: number }> = [];
  for (let k = first; k <= last; k++) {
    const run = loose.at(-1);
    if (run && near(lines[k - 1]!, lines[k]!, capOf(lines[k - 1]!, lines[k]!))) run.to = k;
    else loose.push({ from: k, to: k });
  }
  return loose.flatMap(({ from, to }) => {
    const limit = stepLimit(lines, from, to);
    const runs = [{ from, to: from }];
    for (let k = from + 1; k <= to; k++) {
      if (lines[k - 1]!.base - lines[k]!.base <= limit) runs.at(-1)!.to = k;
      else runs.push({ from: k, to: k });
    }
    return runs;
  });
}

/** A quad's box in the text's frame. */
function frameBox(q: Quad, turn: Turn): { u0: number; u1: number; v0: number; v1: number } {
  const pts = [0, 2, 4, 6].map((i) => toFrame(turn, q[i]!, q[i + 1]!));
  const us = pts.map((p) => p[0]);
  const vs = pts.map((p) => p[1]);
  return { u0: Math.min(...us), u1: Math.max(...us), v0: Math.min(...vs), v1: Math.max(...vs) };
}

/**
 * One bar per run of the attached lines `first`..`last`: it stands left of where the run's lines begin — the column's edge, also for a
 * first line set in (the line before or after, when it would go on with the run, says where the column begins) — and spans the washed
 * lines of the run, top to bottom.
 */
export function marginOf(lines: readonly TextLine[], first: number, last: number, quads: readonly Quad[], turn: Turn, pageStart = -Infinity): MarkMargin {
  const boxes = quads.map((q) => frameBox(q, turn));
  const bars = markRuns(lines, first, last).flatMap(({ from, to }): MarkBar[] => {
    const run = lines.slice(from, to + 1);
    const limit = stepLimit(lines, from, to);
    const starts = run.map((l) => l.start);
    const before = lines[from - 1];
    const after = lines[to + 1];
    if (before && near(before, lines[from]!, limit)) starts.push(before.start);
    if (after && near(lines[to]!, after, limit)) starts.push(after.start);
    const at = Math.min(...starts);
    const h = Math.max(...run.map((l) => l.h));
    const [lowBase, highBase] = [Math.min(...run.map((l) => l.base)), Math.max(...run.map((l) => l.base))];
    const [u0, u1] = [Math.min(...run.map((l) => l.start)), Math.max(...run.map((l) => l.end))];
    const mine = boxes.filter((b) => (b.v0 + b.v1) / 2 >= lowBase - h / 2 && (b.v0 + b.v1) / 2 <= highBase + h && b.u0 < u1 && u0 < b.u1);
    if (mine.length === 0) return [];
    // The free space left of the run: to the nearest text on its lines (another column) or the page's edge. A narrow one puts the bar a
    // third of the way out from its own lines, so it reads as theirs and not as the right edge of the column beside it.
    const beside = lines.filter((l) => l.end <= at + 0.5 && l.base >= lowBase - h / 2 && l.base <= highBase + h / 2).map((l) => l.end);
    const free = at - Math.max(pageStart, ...beside);
    const gap = free < NARROW_PT ? Math.max(NEAREST_PT, free / 3) + BAR_WIDTH_PT : BAR_GAP_PT;
    return [{ at, gap, top: Math.max(...mine.map((b) => b.v1)), bottom: Math.min(...mine.map((b) => b.v0)) }];
  });
  return { turn, bars };
}

const clamp01 = (start: number, size: number) => Math.max(0, Math.min(start, 1 - size));

/** Screen boxes cut into runs the same way, top to bottom: one below another (within half a line) and overlapping it across. */
function screenRuns(rects: readonly ClientRect[]): ClientRect[] {
  const runs: ClientRect[] = [];
  const open: ClientRect[] = [];
  for (const r of [...rects].sort((a, b) => a.top - b.top)) {
    const h = r.bottom - r.top;
    const run = open.find((o) => r.top >= o.bottom - h / 2 && r.top - o.bottom <= h / 2 && r.left < o.right && o.left < r.right);
    if (run) {
      run.left = Math.min(run.left, r.left);
      run.right = Math.max(run.right, r.right);
      run.bottom = Math.max(run.bottom, r.bottom);
    } else {
      const made = { ...r };
      open.push(made);
      runs.push(made);
    }
  }
  return runs;
}

/**
 * The wash of each quad, and the bars: from `margin` in the text's own frame (12 pt left of where each run's lines begin — less in a
 * narrow gutter — 1.5 pt wide, turning with the page); without one (text set at an angle), left of each run of washed lines on the screen. Kept on the page.
 */
export function attachedGeometry(quads: readonly Quad[], margin: MarkMargin | null, viewport: MarkViewport): { wash: PageShare[]; bars: PageShare[] } {
  const share = (r: ClientRect): PageShare => ({ left: r.left / viewport.width, top: r.top / viewport.height, width: (r.right - r.left) / viewport.width, height: (r.bottom - r.top) / viewport.height });
  const kept = (s: PageShare): PageShare => ({ ...s, left: clamp01(s.left, s.width), top: clamp01(s.top, s.height) });
  const rects = quads.map((q) => quadToRect(q, viewport));
  let bars: PageShare[];
  if (margin !== null && margin.bars.length > 0) {
    bars = margin.bars.map((b) => {
      const [u0, u1] = [b.at - b.gap, b.at - b.gap + BAR_WIDTH_PT];
      const pts = [[u0, b.top], [u1, b.top], [u0, b.bottom], [u1, b.bottom]].map(([u, v]) => fromFrame(margin.turn, u!, v!));
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      return kept(share(quadToRect([x0, y1, x1, y1, x0, y0, x1, y0], viewport)));
    });
  } else {
    const gap = BAR_GAP_PT * viewport.scale;
    const width = BAR_WIDTH_PT * viewport.scale;
    bars = screenRuns(rects).map((r) => kept(share({ left: r.left - gap, right: r.left - gap + width, top: r.top, bottom: r.bottom })));
  }
  return { wash: rects.map(share), bars };
}

const LAYER = 'attached-layer';
const percent = (x: number) => `${(x * 100).toFixed(4)}%`;

function box(className: string, s: PageShare): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.style.left = percent(s.left);
  el.style.top = percent(s.top);
  el.style.width = percent(s.width);
  el.style.height = percent(s.height);
  return el;
}

/**
 * The page's mark of `anchor` (none for null): the earlier one goes first. `margin`: where its bars stand
 * (AttachableSelection.margin); without one, left of each run of washed lines on the screen. The layer sits over the drawn page and
 * takes no pointer, so the text under it is still selected and its links still pressed.
 */
export function drawAttached(pageDiv: HTMLElement, anchor: PdfSpanAnchor | null, viewport: MarkViewport, margin: MarkMargin | null = null): void {
  pageDiv.querySelector(`:scope > .${LAYER}`)?.remove();
  if (anchor === null) return;
  const { wash, bars } = attachedGeometry(anchor.quads, margin, viewport);
  const layer = document.createElement('div');
  layer.className = LAYER;
  layer.setAttribute('aria-hidden', 'true');
  layer.dataset['testid'] = 'pdf-attached';
  for (const s of wash) layer.append(box('attached', s));
  for (const s of bars) layer.append(box('attach-bar', s));
  const drawn = pageDiv.querySelector(':scope > .canvasWrapper');
  if (drawn) drawn.after(layer);
  else pageDiv.prepend(layer);
}
