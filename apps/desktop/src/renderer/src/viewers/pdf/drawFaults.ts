import type { PDFDocumentProxy } from 'pdfjs-dist';

/** Renders still to be made to fail, by page number: a thumbnail's and a viewer page's. */
export interface DrawFaults {
  thumbnail: Record<number, number>;
  page: Record<number, number>;
  /** Starts of the viewer still to be made to fail (before pdf.js has the document). */
  start?: number;
  /** The renders are patched: faults set before this are not seen. */
  ready: boolean;
}

declare global {
  interface Window {
    __learnFaults?: DrawFaults;
  }
}

const PATCHED = Symbol('learn.drawFaults');

/**
 * E2E only (loaded on demand, behind the same gate as the anchor probe, so the product's bundle does not hold it): makes the next
 * renders of named pages fail, so the retry and the failed look can be shown without a broken PDF.
 */
export default async function installDrawFaults(doc: PDFDocumentProxy): Promise<void> {
  window.__learnFaults ??= { thumbnail: {}, page: {}, ready: false };
  const proto = Object.getPrototypeOf(await doc.getPage(1)) as Record<PropertyKey, unknown> & { render: (p: { canvas?: HTMLCanvasElement }) => unknown; pageNumber?: number };
  if (proto[PATCHED]) {
    window.__learnFaults.ready = true;
    return;
  }
  proto[PATCHED] = true;
  const render = proto.render;
  proto.render = function (this: { pageNumber: number }, params: { canvas?: HTMLCanvasElement }) {
    const kind = params.canvas?.dataset.purpose === 'thumbnail' ? 'thumbnail' : 'page';
    const faults = window.__learnFaults?.[kind];
    const left = faults?.[this.pageNumber] ?? 0;
    if (faults && left > 0) {
      faults[this.pageNumber] = left - 1;
      return { promise: Promise.reject(new Error('injected draw fault')), cancel() {}, onContinue: null, onError: null };
    }
    return render.call(this, params);
  };
  window.__learnFaults.ready = true;
}
