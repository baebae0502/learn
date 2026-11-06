import { createStore, type StoreApi } from 'zustand/vanilla';
import type { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ReadingLocator, ReaderNav, ScrollModeName, SpreadModeName } from '@learn/domain';
import { emptyHistory, type History } from './history';

export type { ReaderNav };

/** A place of the page: what back and forward return to. */
export type PdfPlace = Pick<Extract<ReadingLocator, { kind: 'pdf' }>, 'pageIndex' | 'top' | 'left'>;

/** 1 is 100 %. */
export type ZoomValue = 'auto' | 'page-width' | 'page-fit' | number;

export interface PdfState {
  ready: boolean;
  /** Every page's size is known (pagesloaded): the fit is for the widest page, so the saved place is applied after it. */
  sized: boolean;
  /** The saved place is applied (or there was none): until then the page, the zoom and the rotation are the viewer's own start. */
  placed: boolean;
  pageNumber: number;
  pagesCount: number;
  scale: number;
  zoom: ZoomValue;
  rotation: 0 | 90 | 180 | 270;
  /** How the pages flow and pair up (a horizontal scroll has no spreads). */
  scroll: ScrollModeName;
  spread: SpreadModeName;
}

/** What the toolbar, the sidebar and the panels do to the open document, whoever mounts them. */
export interface PdfViewHandle {
  /** The one way to a page: pdf.js lands it flush and the room the mockup draws round it is added (viewers/pdf/placement). */
  place(target: { pageNumber: number; destArray?: unknown[] | null }): void;
  goToPage(pageNumber: number): void;
  /** A jump (a thumbnail, the page field): the place left is recorded for back, then the page is placed. */
  jumpToPage(pageNumber: number): void;
  historyBack(): void;
  historyForward(): void;
  next(): void;
  previous(): void;
  setZoom(zoom: ZoomValue): void;
  /**
   * Puts the viewer where it was left: the rotation, the zoom, then the page and the place in it (a saved value without
   * them opens at the top of the page, zoomed to fit). Done in one step, so no frame shows another place.
   */
  restore(saved: Extract<ReadingLocator, { kind: 'pdf' }> | undefined, pageIndex: number): void;
  /** The pages flow another way: the page in view stays in view. Horizontal also ends any spread. Not a jump (no history). */
  setScroll(mode: ScrollModeName): void;
  setSpread(mode: SpreadModeName): void;
  zoomIn(): void;
  zoomOut(): void;
  rotate(delta: 90 | -90): void;
  document(): PDFDocumentProxy | null;
  viewer(): PDFViewer | null;
  eventBus(): EventBus | null;
  linkService(): PDFLinkService | null;
}

export const INITIAL_PDF: PdfState = { ready: false, sized: false, placed: false, pageNumber: 1, pagesCount: 0, scale: 1, zoom: 'auto', rotation: 0, scroll: 'vertical', spread: 'none' };

/** Why the sidebar has no pages to list: the item is in the trash, asks for a password, or has nothing to show. */
export type NoPages = 'trashed' | 'locked' | 'none';

export interface ReaderStore {
  /** null while no PDF is open. */
  pdf: PdfState | null;
  handle: PdfViewHandle | null;
  /** Said by the host of the reader (the item's state) and by the PDF reader (the password): the sidebar shows the first. */
  noPages: Readonly<Record<'host' | 'reader', NoPages | null>>;
  /**
   * The back and forward list of this tab. It lives with the scope, so the view's teardown (a tab pushed out of the kept ones)
   * leaves it alone; a new run starts empty.
   */
  history: History<PdfPlace>;
  setHistory(h: History<PdfPlace>): void;
  setNoPages(source: 'host' | 'reader', reason: NoPages | null): void;
  setPdf(p: Partial<PdfState> | null): void;
  setHandle(h: PdfViewHandle | null): void;
}

/** One reader's state; the store of each document is made with its scope (viewers/readerScope). */
export function createReaderStore(): StoreApi<ReaderStore> {
  return createStore<ReaderStore>()((set) => ({
    pdf: null,
    handle: null,
    noPages: { host: null, reader: null },
    history: emptyHistory<PdfPlace>(),
    setHistory: (history) => set({ history }),
    setNoPages: (source, reason) => set((s) => (s.noPages[source] === reason ? s : { noPages: { ...s.noPages, [source]: reason } })),
    setPdf: (p) => set((s) => ({ pdf: p === null ? null : { ...(s.pdf ?? INITIAL_PDF), ...p } })),
    setHandle: (handle) => set({ handle }),
  }));
}

export { useReader } from '../readerScope';
