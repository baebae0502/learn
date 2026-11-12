import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { findQuote, quadToRect, type ClientRect, type PdfAnchor, type Quad } from '@learn/domain';
import { layerModel, offsetOf, pageTextOf, quadsOf, rangeOf, spanAnchor, textRects, type PageModel, type PageView } from './selectionAnchor';

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

const RENDER_FINISHED = 3;
const CSS_UNITS = 96 / 72;
const READY_MS = 15_000;
/** The page and its layers are sized with round(down, …, var(--scale-round-*)), so on a large page they are a few pixels short of the viewport. */
const LAYER_ROUNDING_PX = 8;

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function installAnchorProbe(o: { doc: PDFDocumentProxy; viewer: PDFViewer; revisionId: string }): (() => void) & { claim(): void } {
  const { doc, viewer, revisionId } = o;
  /** anchorOfSelection is synchronous, so it reads the models the selections were made through. */
  const lastModels = new Map<number, PageModel>();
  const textOf = (pageIndex: number) => pageTextOf(doc, pageIndex);

  /** The page, scrolled to, drawn at the viewer's present zoom and rotation, its text layer laid out; with the span of each item. */
  async function model(pageIndex: number): Promise<PageModel> {
    viewer.currentPageNumber = pageIndex + 1;
    const text = await textOf(pageIndex);
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
          const made = layerModel(view, text);
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

  function select(range: Range) {
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
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
      return spanAnchor(cached, range, { start, end, revisionId, pageIndex });
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
  const remove = () => {
    if (window.__learnPdf === probe) delete window.__learnPdf;
    window.getSelection()?.removeAllRanges();
  };
  // Several readers can be mounted: the one that has the screen takes the hook back when its tab is shown.
  return Object.assign(remove, { claim: () => void (window.__learnPdf = probe) });
}

/** The default export is what the reader loads on demand (it does not name the probe, so the product's bundle does not either). */
export default installAnchorProbe;
