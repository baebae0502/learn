import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { buildPageText, quoteAround, rectsToQuads, TUTOR_LIMITS, type PageText, type PdfSpanAnchor, type Quad } from '@learn/domain';

/**
 * A selection in a page's text layer as a span anchor of that page (spec 8.4, ADR-0009): its page-text offsets, its quads and its quote.
 * The product's attached passage is made here, and the anchor spike's E2E probe (anchorProbe.ts) reads its anchors through the same code.
 */

/** The parts of a pdf.js page view this file uses (the viewer returns `any`). */
export interface PageView {
  div: HTMLElement;
  viewport: { scale: number; rotation: number; width: number; height: number; convertToPdfPoint(x: number, y: number): number[]; convertToViewportPoint(x: number, y: number): number[] };
  pdfPage: { rotate: number; getTextContent(o: { includeMarkedContent: boolean; disableNormalization: boolean }): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }> };
  textLayer: { div: HTMLElement } | null;
  renderingState: number;
}

/** An item's line as lineStartOf reads it: whether a line ends after it, and the start of its baseline and its height (page space); null: drawn at an angle. */
export interface ItemLine {
  hasEOL: boolean;
  at: { x: number; y: number; h: number } | null;
}

/** A page's text as its text layer was made from it: the text, which items are empty (no span), and each item's line. */
export interface LoadedText {
  page: PageText;
  empty: boolean[];
  lines: ItemLine[];
}

/** A page's text with the span of each item that has text, by item index; null for an empty item (pdf.js makes no span for it). */
export interface PageModel {
  page: PageText;
  spans: Array<HTMLElement | null>;
  view: PageView;
}

interface TextItem {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
}

const texts = new WeakMap<PDFDocumentProxy, Map<number, Promise<LoadedText>>>();

/** An upright item's baseline start and height; null for one turned or skewed. */
function lineOf(item: TextItem): ItemLine['at'] {
  const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = item.transform ?? [];
  return a > 0 && d > 0 && Math.abs(b) < 1e-6 && Math.abs(c) < 1e-6 ? { x, y, h: Math.hypot(c, d) } : null;
}

/** The page's text, read once per document: the same request the viewer's text layer makes, so the items are the ones its spans were made from. */
export function pageTextOf(doc: PDFDocumentProxy, pageIndex: number): Promise<LoadedText> {
  let pages = texts.get(doc);
  if (!pages) texts.set(doc, (pages = new Map()));
  let hit = pages.get(pageIndex);
  if (!hit) {
    hit = doc
      .getPage(pageIndex + 1)
      .then((p) => p.getTextContent({ includeMarkedContent: true, disableNormalization: true }))
      .then((c) => {
        const items = c.items.flatMap((i) => ('str' in i ? [i as TextItem] : []));
        return {
          page: buildPageText(items.map((i) => ({ str: i.str, hasEOL: i.hasEOL === true }))),
          empty: items.map((i) => i.str === ''),
          lines: items.map((i) => ({ hasEOL: i.hasEOL === true, at: lineOf(i) })),
        };
      });
    pages.set(pageIndex, hit);
  }
  return hit;
}

/** The text layer's spans of a drawn page, matched to the page's items: pdf.js makes a span for an item only when its string is not empty, in item order. */
export function layerModel(view: PageView, text: Pick<LoadedText, 'page' | 'empty'>): PageModel {
  const spans = [...view.textLayer!.div.querySelectorAll<HTMLElement>('span:not(.markedContent)')];
  const withText = text.empty.filter((e) => !e).length;
  if (spans.length !== withText) throw new Error(`text layer has ${spans.length} spans for ${withText} items with text`);
  let next = 0;
  return { page: text.page, spans: text.empty.map((e) => (e ? null : spans[next++]!)), view };
}

const textNode = (span: HTMLElement): Text => span.firstChild as Text;

/** Item and offset of a page-text offset; an offset in a line end goes to the next item's head (a start) or the previous item's tail (an end). */
export function place(m: PageModel, at: number, edge: 'start' | 'end'): { item: number; offset: number } {
  const { starts } = m.page;
  const len = (i: number) => (m.spans[i] ? textNode(m.spans[i]!).length : 0);
  const candidates = starts.map((s, i) => ({ s, i, e: s + len(i) })).filter((c) => m.spans[c.i]);
  const back = [...candidates].reverse();
  const hit =
    edge === 'start'
      ? (candidates.find((c) => at >= c.s && at < c.e) ?? candidates.find((c) => c.s >= at))
      : (back.find((c) => at > c.s && at <= c.e) ?? back.find((c) => c.e <= at));
  if (!hit) throw new Error(`offset ${at} is not in the text layer`);
  return { item: hit.i, offset: Math.max(0, Math.min(at - hit.s, hit.e - hit.s)) };
}

/** A DOM range over the page's text layer from page-text offset `start` to `end`. */
export function rangeOf(m: PageModel, start: number, end: number): Range {
  const from = place(m, start, 'start');
  const to = place(m, end, 'end');
  const range = document.createRange();
  range.setStart(textNode(m.spans[from.item]!), from.offset);
  range.setEnd(textNode(m.spans[to.item]!), to.offset);
  return range;
}

/** The client rectangles of the text the range covers, one set per span, so no element box (a marked-content wrapper) sneaks in. */
export function textRects(layer: HTMLElement, range: Range): DOMRect[] {
  const rects: DOMRect[] = [];
  for (const span of layer.querySelectorAll<HTMLElement>('span:not(.markedContent)')) {
    const node = span.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE || !range.intersectsNode(node)) continue;
    const piece = document.createRange();
    piece.selectNodeContents(node);
    if (range.compareBoundaryPoints(Range.START_TO_START, piece) > 0) piece.setStart(range.startContainer, range.startOffset);
    if (range.compareBoundaryPoints(Range.END_TO_END, piece) < 0) piece.setEnd(range.endContainer, range.endOffset);
    rects.push(...piece.getClientRects());
  }
  return rects;
}

/** The quads, in the page's unrotated space, of the text of this page's layer that the range covers. */
export function quadsOf(view: PageView, range: Range): Quad[] {
  const layer = view.textLayer!.div;
  const origin = layer.getBoundingClientRect();
  // The text sits at percentages of the layer, which the page's rounding leaves a few pixels off the viewport's size: measure in the layer.
  const kx = view.viewport.width / origin.width;
  const ky = view.viewport.height / origin.height;
  const rel = textRects(layer, range).map((r) => ({ left: (r.left - origin.left) * kx, top: (r.top - origin.top) * ky, right: (r.right - origin.left) * kx, bottom: (r.bottom - origin.top) * ky }));
  return rectsToQuads(rel, view.viewport);
}

/** The page-text offset a boundary point of a selection stands for, or null outside the page's spans. */
export function offsetOf(m: PageModel, node: Node, offset: number, edge: 'start' | 'end'): number | null {
  let item = m.spans.findIndex((s) => s !== null && node === s.firstChild);
  if (item >= 0) return m.page.starts[item]! + offset;
  // A boundary in an element (the layer, a span) or on another page: the first span after it (a start) or the last one before it (an end).
  const probe = document.createRange();
  probe.setStart(node, offset);
  probe.collapse(true);
  const placed = m.spans.map((s, i) => ({ s, i })).filter((x): x is { s: HTMLElement; i: number } => x.s !== null);
  const after = placed.find((x) => probe.comparePoint(textNode(x.s), 0) >= 0);
  const before = [...placed].reverse().find((x) => probe.comparePoint(textNode(x.s), textNode(x.s).length) <= 0);
  item = edge === 'start' ? (after?.i ?? -1) : (before?.i ?? -1);
  if (item < 0) return null;
  return edge === 'start' ? m.page.starts[item]! : m.page.starts[item]! + textNode(m.spans[item]!).length;
}

/** The span anchor of the page text from `start` to `end`, its quads those of `range` on this page; null when the range draws nothing. */
export function spanAnchor(m: PageModel, range: Range, o: { start: number; end: number; revisionId: string; pageIndex: number }): PdfSpanAnchor | null {
  const quads = quadsOf(m.view, range);
  if (quads.length === 0) return null;
  return {
    kind: 'pdf',
    revisionId: o.revisionId,
    precision: 'span',
    pageIndex: o.pageIndex,
    quads,
    coordinateSpace: 'pdf-user-space',
    text: { quote: quoteAround(m.page.text, { start: o.start, end: o.end }), position: { start: o.start, end: o.end } },
  };
}

/** At most 4,000 characters of the selection's first page (J46), never ending inside a surrogate pair; `long` when it was cut. */
export function clipAttached(text: string): { text: string; long: boolean } {
  const max = TUTOR_LIMITS.selectionChars;
  if (text.length <= max) return { text, long: false };
  const head = text.slice(0, max);
  return { text: /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head, long: true };
}

/**
 * Where the line of item `first` begins, in page space: the leftmost item on its baseline among the items read with it since the last
 * line end (a column beside it is another line of the text, read before or after). Null when the item is not upright.
 */
export function lineStartOf(items: readonly ItemLine[], first: number): number | null {
  const at = items[first]?.at;
  if (!at) return null;
  let x = at.x;
  for (let i = first - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.hasEOL) break;
    if (item.at && Math.abs(item.at.y - at.y) <= at.h / 2) x = Math.min(x, item.at.x);
  }
  return x;
}

/**
 * What a question carries of a selection (spec 8.4, J46): the span anchor of its start page and that page's text of it (at most 4,000
 * characters), `multipage` when it went on to another page, `long` when it was cut, and `lineStart` — the page-space x where the lines
 * it covers begin, which the page mark's bar stands left of.
 */
export interface AttachableSelection {
  anchor: PdfSpanAnchor;
  text: string;
  pageIndex: number;
  multipage: boolean;
  long: boolean;
  lineStart: number;
}

const elementOf = (node: Node): Element | null => (node instanceof Element ? node : node.parentElement);

/** The live selection in the text layer as a span anchor of its start page (quads + text.quote), or null outside a text layer. */
export async function attachableSelection(o: { doc: PDFDocumentProxy; viewer: PDFViewer; revisionId: string; range: Range }): Promise<AttachableSelection | null> {
  const { range } = o;
  const startEl = elementOf(range.startContainer);
  const pageEl = startEl?.closest<HTMLElement>('.page');
  if (!pageEl || !startEl?.closest('.textLayer')) return null;
  const pageIndex = Number(pageEl.dataset['pageNumber']) - 1;
  const view = o.viewer.getPageView(pageIndex) as PageView | undefined;
  if (!view?.textLayer || view.div !== pageEl) return null;
  const multipage = elementOf(range.endContainer)?.closest('.page') !== pageEl;
  const text = await pageTextOf(o.doc, pageIndex);
  // The layer may have been drawn again meanwhile (a zoom): the selection's nodes went with it.
  if (!range.startContainer.isConnected || view.textLayer === null) return null;
  let m: PageModel;
  try {
    m = layerModel(view, text);
  } catch {
    return null; // the layer is still being laid out
  }
  const start = offsetOf(m, range.startContainer, range.startOffset, 'start');
  const end = offsetOf(m, range.endContainer, range.endOffset, 'end');
  if (start === null || end === null || end <= start) return null;
  const whole = m.page.text.slice(start, end);
  if (whole.trim() === '') return null;
  const kept = clipAttached(whole);
  const stop = start + kept.text.length;
  const anchor = spanAnchor(m, kept.long ? rangeOf(m, start, stop) : range, { start, end: stop, revisionId: o.revisionId, pageIndex });
  if (anchor === null) return null;
  const left = Math.min(...anchor.quads.map((q) => Math.min(q[0], q[4])));
  const lineStart = Math.min(left, lineStartOf(text.lines, place(m, start, 'start').item) ?? left);
  return { anchor, text: kept.text, pageIndex, multipage, long: kept.long, lineStart };
}
