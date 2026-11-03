import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import {
  buildPageText,
  findQuote,
  quadToRect,
  quoteAround,
  rectsToQuads,
  type ClientRect,
  type PageText,
  type PdfAnchor,
  type Quad,
} from '@learn/domain';

/** Screen boxes in client pixels, and how many pixels a point is at the current zoom. */
export interface ScreenBoxes {
  anchor: ClientRect;
  selection: ClientRect;
  pxPerPt: number;
}

/**
 * E2E only (ADR-0009 spike). The tests drive the real text layer through it: no screen action makes an anchor before
 * M9, so this is how the spike selects text and reads back what the anchor functions make of it.
 */
export interface LearnPdfProbe {
  /** A DOM selection over the page's text layer, from page-text offset `start` to `end` (UTF-16). */
  selectText(pageIndex: number, start: number, end: number): Promise<void>;
  /** The current selection as an anchor, or null when nothing in a text layer is selected. */
  anchorOfSelection(): PdfAnchor | null;
  anchorFromQuote(pageIndex: number, quote: string): Promise<PdfAnchor | 'NOT_FOUND'>;
  /** The quads of the same text, selected afresh at the zoom and rotation the viewer has now. */
  quadsOfText(pageIndex: number, start: number, end: number): Promise<Quad[]>;
  pageText(pageIndex: number): Promise<string>;
  /** `anchor` drawn back on the screen against the rectangles of the last selection. */
  screenBoxes(anchor: PdfAnchor): Promise<ScreenBoxes>;
}

declare global {
  interface Window {
    __learnPdf?: LearnPdfProbe;
  }
}

/** The parts of a pdf.js page view this file uses (the viewer returns `any`). */
interface PageView {
  div: HTMLElement;
  viewport: { scale: number; rotation: number; width: number; height: number; convertToPdfPoint(x: number, y: number): number[]; convertToViewportPoint(x: number, y: number): number[] };
  pdfPage: { rotate: number; getTextContent(o: { includeMarkedContent: boolean; disableNormalization: boolean }): Promise<{ items: Array<{ str?: string; hasEOL?: boolean }> }> };
  textLayer: { div: HTMLElement } | null;
  renderingState: number;
}
const RENDER_FINISHED = 3;
const CSS_UNITS = 96 / 72;
const READY_MS = 15_000;
/** The page and its layers are sized with round(down, …, var(--scale-round-*)), so on a large page they are a few pixels short of the viewport. */
const LAYER_ROUNDING_PX = 8;

interface PageModel { page: PageText; /** the span of each item with text, by item index; null for an empty item (pdf.js makes no span for it) */ spans: Array<HTMLElement | null>; view: PageView }

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function installAnchorProbe(o: { doc: PDFDocumentProxy; viewer: PDFViewer; revisionId: string }): () => void {
  const { doc, viewer, revisionId } = o;
  // The same request the viewer's text layer makes, so the items are the ones its spans were made from.
  const texts = new Map<number, Promise<{ page: PageText; empty: boolean[] }>>();
  /** anchorOfSelection is synchronous, so it reads the models the selections were made through. */
  const lastModels = new Map<number, PageModel>();
  const textOf = (pageIndex: number) => {
    let hit = texts.get(pageIndex);
    if (!hit) {
      hit = doc
        .getPage(pageIndex + 1)
        .then((p) => p.getTextContent({ includeMarkedContent: true, disableNormalization: true }))
        .then((c) => {
          const items = c.items.flatMap((i) => ('str' in i ? [i] : []));
          return { page: buildPageText(items), empty: items.map((i) => i.str === '') };
        });
      texts.set(pageIndex, hit);
    }
    return hit;
  };

  /** The page, scrolled to, drawn at the viewer's present zoom and rotation, its text layer laid out; with the span of each item. */
  async function model(pageIndex: number): Promise<PageModel> {
    viewer.currentPageNumber = pageIndex + 1;
    const { page, empty } = await textOf(pageIndex);
    const deadline = performance.now() + READY_MS;
    for (;;) {
      const view = viewer.getPageView(pageIndex) as PageView | undefined;
      const layer = view?.textLayer?.div;
      if (view && layer && view.renderingState === RENDER_FINISHED && layer.querySelector('.endOfContent')) {
        const box = layer.getBoundingClientRect();
        const v = view.viewport;
        const arrived =
          Math.abs(v.scale - viewer.currentScale * CSS_UNITS) < 1e-6 &&
          v.rotation === (viewer.pagesRotation + view.pdfPage.rotate) % 360 &&
          Math.abs(box.width - v.width) < LAYER_ROUNDING_PX &&
          Math.abs(box.height - v.height) < LAYER_ROUNDING_PX;
        if (arrived) {
          await nextFrame();
          await nextFrame();
          const spans = [...layer.querySelectorAll<HTMLElement>('span:not(.markedContent)')];
          const withText = empty.filter((e) => !e).length;
          // pdf.js makes a span for an item only when its string is not empty, in item order.
          if (spans.length !== withText) throw new Error(`text layer has ${spans.length} spans for ${withText} items with text`);
          let next = 0;
          const made = { page, spans: empty.map((e) => (e ? null : spans[next++]!)), view };
          lastModels.set(pageIndex, made);
          return made;
        }
      }
      if (performance.now() > deadline) {
        const v = view?.viewport;
        const box = view?.textLayer?.div.getBoundingClientRect();
        throw new Error(`page ${pageIndex + 1} did not settle at the viewer's zoom and rotation: ${JSON.stringify({ state: view?.renderingState, scale: v?.scale, want: viewer.currentScale * CSS_UNITS, rotation: v?.rotation, wantRotation: viewer.pagesRotation, w: v?.width, h: v?.height, box: box && [box.width, box.height] })}`);
      }
      await nextFrame();
    }
  }

  const textNode = (span: HTMLElement): Text => span.firstChild as Text;

  /** Item and offset of a page-text offset; an offset in a line end goes to the next item's head (a start) or the previous item's tail (an end). */
  function place(m: PageModel, at: number, edge: 'start' | 'end'): { item: number; offset: number } {
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

  function rangeOf(m: PageModel, start: number, end: number): Range {
    const from = place(m, start, 'start');
    const to = place(m, end, 'end');
    const range = document.createRange();
    range.setStart(textNode(m.spans[from.item]!), from.offset);
    range.setEnd(textNode(m.spans[to.item]!), to.offset);
    return range;
  }

  function select(range: Range) {
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** The client rectangles of the text the range covers, one set per span, so no element box (a marked-content wrapper) sneaks in. */
  function textRects(layer: HTMLElement, range: Range): DOMRect[] {
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

  function quadsOf(view: PageView, range: Range): Quad[] {
    const layer = view.textLayer!.div;
    const origin = layer.getBoundingClientRect();
    // The text sits at percentages of the layer, which the page's rounding leaves a few pixels off the viewport's size: measure in the layer.
    const kx = view.viewport.width / origin.width;
    const ky = view.viewport.height / origin.height;
    const rel = textRects(layer, range).map((r) => ({ left: (r.left - origin.left) * kx, top: (r.top - origin.top) * ky, right: (r.right - origin.left) * kx, bottom: (r.bottom - origin.top) * ky }));
    return rectsToQuads(rel, view.viewport);
  }

  /** The item and offset a boundary point of the selection stands for, or null outside a text layer's spans. */
  function offsetOf(m: PageModel, node: Node, offset: number, edge: 'start' | 'end'): number | null {
    let item = m.spans.findIndex((s) => s !== null && node === s.firstChild);
    if (item >= 0) return m.page.starts[item]! + offset;
    // A boundary in an element (the layer, a span): the first span after it (a start) or the last one before it (an end).
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

  const probe: LearnPdfProbe = {
    async selectText(pageIndex, start, end) {
      const m = await model(pageIndex);
      select(rangeOf(m, start, end));
    },
    anchorOfSelection() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
      const range = sel.getRangeAt(0);
      const pageEl = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>('.page');
      if (!pageEl) return null;
      const pageIndex = Number(pageEl.dataset['pageNumber']) - 1;
      const view = viewer.getPageView(pageIndex) as PageView;
      const cached = lastModels.get(pageIndex);
      if (!cached || cached.view !== view) throw new Error('select through selectText first: the page text of this page is not loaded');
      const start = offsetOf(cached, range.startContainer, range.startOffset, 'start');
      const end = offsetOf(cached, range.endContainer, range.endOffset, 'end');
      if (start === null || end === null || end <= start) return null;
      return {
        kind: 'pdf',
        revisionId,
        precision: 'span',
        pageIndex,
        quads: quadsOf(view, range),
        coordinateSpace: 'pdf-user-space',
        text: { quote: quoteAround(cached.page.text, { start, end }), position: { start, end } },
      };
    },
    async anchorFromQuote(pageIndex, quote) {
      const { page } = await textOf(pageIndex);
      const span = findQuote(page.text, quote);
      if (!span) return 'NOT_FOUND';
      await probe.selectText(pageIndex, span.start, span.end);
      return probe.anchorOfSelection() ?? 'NOT_FOUND';
    },
    async quadsOfText(pageIndex, start, end) {
      const m = await model(pageIndex);
      const range = rangeOf(m, start, end);
      select(range);
      return quadsOf(m.view, range);
    },
    async pageText(pageIndex) {
      return (await textOf(pageIndex)).page.text;
    },
    async screenBoxes(anchor) {
      const m = await model(anchor.pageIndex);
      const origin = m.view.textLayer!.div.getBoundingClientRect();
      const union = (rs: ClientRect[]): ClientRect => ({
        left: Math.min(...rs.map((r) => r.left)),
        top: Math.min(...rs.map((r) => r.top)),
        right: Math.max(...rs.map((r) => r.right)),
        bottom: Math.max(...rs.map((r) => r.bottom)),
      });
      const kx = origin.width / m.view.viewport.width;
      const ky = origin.height / m.view.viewport.height;
      const drawn = anchor.quads.map((q) => quadToRect(q, m.view.viewport)).map((r) => ({ left: r.left * kx + origin.left, top: r.top * ky + origin.top, right: r.right * kx + origin.left, bottom: r.bottom * ky + origin.top }));
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) throw new Error('nothing is selected');
      const rects = textRects(m.view.textLayer!.div, sel.getRangeAt(0)).filter((r) => r.width >= 0.5 && r.height >= 0.5);
      return { anchor: union(drawn), selection: union(rects), pxPerPt: m.view.viewport.scale };
    },
  };

  window.__learnPdf = probe;
  return () => {
    if (window.__learnPdf === probe) delete window.__learnPdf;
    window.getSelection()?.removeAllRanges();
  };
}
