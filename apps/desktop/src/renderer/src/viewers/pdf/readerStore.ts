import { create } from 'zustand';
import type { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { readWindowParams } from '../../ui/platform';

/** 1 is 100 %. */
export type ZoomValue = 'auto' | 'page-width' | 'page-fit' | number;

export interface PdfState {
  ready: boolean;
  pageNumber: number;
  pagesCount: number;
  scale: number;
  zoom: ZoomValue;
  rotation: 0 | 90 | 180 | 270;
}

/** What the toolbar, the sidebar and the panels do to the open document, whoever mounts them. */
export interface PdfViewHandle {
  goToPage(pageNumber: number): void;
  next(): void;
  previous(): void;
  setZoom(zoom: ZoomValue): void;
  zoomIn(): void;
  zoomOut(): void;
  rotate(delta: 90 | -90): void;
  document(): PDFDocumentProxy | null;
  viewer(): PDFViewer | null;
  eventBus(): EventBus | null;
  linkService(): PDFLinkService | null;
}

export const INITIAL_PDF: PdfState = { ready: false, pageNumber: 1, pagesCount: 0, scale: 1, zoom: 'auto', rotation: 0 };

interface ReaderStore {
  /** null while no PDF is open. */
  pdf: PdfState | null;
  handle: PdfViewHandle | null;
  setPdf(p: Partial<PdfState> | null): void;
  setHandle(h: PdfViewHandle | null): void;
}

export const useReader = create<ReaderStore>()((set) => ({
  pdf: null,
  handle: null,
  setPdf: (p) => set((s) => ({ pdf: p === null ? null : { ...(s.pdf ?? INITIAL_PDF), ...p } })),
  setHandle: (handle) => set({ handle }),
}));

declare global {
  interface Window {
    /** E2E only (the page's address carries e2e=1 in an unpackaged test run): lets tests drive the reader's handle. */
    __learnReader?: typeof useReader;
  }
}
if (typeof window !== 'undefined' && readWindowParams(window.location.search).e2e) window.__learnReader = useReader;
