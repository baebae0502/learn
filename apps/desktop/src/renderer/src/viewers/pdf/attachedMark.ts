import { quadToRect, type ClientRect, type PdfSpanAnchor, type Quad } from '@learn/domain';

/**
 * The page mark of the passage attached to a question (spec 8.4; approved mockup .attached and .attach-bar): a light wash over the
 * passage's lines and a bar in the margin left of where its lines begin — Learn's own mark, never the find colour. Drawn in the page's
 * own layer from the anchor's quads, as shares of the page, so a zoom keeps it in place; a turn draws it again (pagerendered).
 */

/** What the mark needs of a page's viewport: its size in pixels and the way a page point lands on it. */
export interface MarkViewport {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
}

/** A box of the page as shares (0–1) of its width and height. */
export interface PageShare {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The mockup's bar at 100 %: 16 px left of the text and 2 px wide — 12 and 1.5 points of the page. */
const BAR_GAP_PT = 12;
const BAR_WIDTH_PT = 1.5;

const clamp01 = (start: number, size: number) => Math.max(0, Math.min(start, 1 - size));

/** The wash of each quad, and the bar left of `lineStart` (page space) from the passage's top to its bottom, kept on the page. */
export function attachedGeometry(quads: readonly Quad[], lineStart: number, viewport: MarkViewport): { wash: PageShare[]; bar: PageShare } {
  const share = (r: ClientRect): PageShare => ({ left: r.left / viewport.width, top: r.top / viewport.height, width: (r.right - r.left) / viewport.width, height: (r.bottom - r.top) / viewport.height });
  const ys = quads.flatMap((q) => [q[1], q[5]]);
  const [top, bottom] = [Math.max(...ys), Math.min(...ys)];
  const x0 = lineStart - BAR_GAP_PT;
  const x1 = x0 + BAR_WIDTH_PT;
  const bar = share(quadToRect([x0, top, x1, top, x0, bottom, x1, bottom], viewport));
  return { wash: quads.map((q) => share(quadToRect(q, viewport))), bar: { ...bar, left: clamp01(bar.left, bar.width), top: clamp01(bar.top, bar.height) } };
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
 * The page's mark of `anchor` (none for null): the earlier one goes first. `lineStart`: where the passage's lines begin in page space
 * (AttachableSelection.lineStart); the passage's own left edge without it. The layer sits over the drawn page, under nothing that takes
 * a pointer: it takes none itself, so the text under it is still selected and its links still pressed.
 */
export function drawAttached(pageDiv: HTMLElement, anchor: PdfSpanAnchor | null, viewport: MarkViewport, lineStart?: number): void {
  pageDiv.querySelector(`:scope > .${LAYER}`)?.remove();
  if (anchor === null) return;
  const { wash, bar } = attachedGeometry(anchor.quads, lineStart ?? Math.min(...anchor.quads.map((q) => Math.min(q[0], q[4]))), viewport);
  const layer = document.createElement('div');
  layer.className = LAYER;
  layer.setAttribute('aria-hidden', 'true');
  layer.dataset['testid'] = 'pdf-attached';
  for (const s of wash) layer.append(box('attached', s));
  layer.append(box('attach-bar', bar));
  const drawn = pageDiv.querySelector(':scope > .canvasWrapper');
  if (drawn) drawn.after(layer);
  else pageDiv.prepend(layer);
}
