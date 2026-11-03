import * as lib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { assetUrl } from '@learn/domain';

let ready: Promise<typeof lib> | null = null;

/** pdf.js with its worker set, once, whichever needs it first: the reader or the item panel's page count. */
export function pdfjs(): Promise<typeof import('pdfjs-dist')> {
  ready ??= Promise.resolve().then(() => {
    lib.GlobalWorkerOptions.workerSrc = workerUrl;
    return lib;
  });
  return ready;
}

/** pdf.js runtime data copied by scripts/copy-pdfjs-assets.mjs; same-origin in dev and production. */
const dataUrl = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;

/** getDocument's source for an asset, with the runtime data every caller needs. */
export const pdfSource = (assetId: string) => ({
  url: assetUrl(assetId),
  cMapUrl: dataUrl('cmaps'),
  cMapPacked: true,
  standardFontDataUrl: dataUrl('standard_fonts'),
  wasmUrl: dataUrl('wasm'),
  iccUrl: dataUrl('iccs'),
  enableXfa: false,
});

let viewerReady: Promise<typeof import('pdfjs-dist/web/pdf_viewer.mjs')> | null = null;

/**
 * The pdf.js viewer components. pdf_viewer.mjs reads the core from `globalThis.pdfjsLib` when it is evaluated, so the
 * core is published there first and the viewer is imported only afterwards (a static import would run before it).
 */
export function pdfViewerModule(): Promise<typeof import('pdfjs-dist/web/pdf_viewer.mjs')> {
  viewerReady ??= pdfjs()
    .then((lib) => {
      (globalThis as { pdfjsLib?: unknown }).pdfjsLib = lib;
      return import('pdfjs-dist/web/pdf_viewer.mjs');
    })
    .catch((e: unknown) => {
      viewerReady = null; // a failed load is tried again on the next open
      throw e;
    });
  return viewerReady;
}
