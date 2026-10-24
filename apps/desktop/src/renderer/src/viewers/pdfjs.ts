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
