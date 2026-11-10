import fsp from 'node:fs/promises';
import path from 'node:path';

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * pdf.js's BinaryDataFactory in the worker: cMaps and standard fonts come from the app's own folder through fs, because
 * the worker is a utility process that pdf.js takes for a browser (and would fetch() them). Nothing else is readable.
 */
export class FsDataFactory {
  readonly #cMapUrl: string | null;
  readonly #fontUrl: string | null;

  constructor(o: { cMapUrl: string | null; standardFontDataUrl: string | null; wasmUrl?: string | null }) {
    this.#cMapUrl = o.cMapUrl;
    this.#fontUrl = o.standardFontDataUrl;
  }

  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const base = kind === 'cMapUrl' ? this.#cMapUrl : kind === 'standardFontDataUrl' ? this.#fontUrl : null;
    if (base === null) throw new Error(`pdf.js data of kind ${kind} is not served`);
    if (!SAFE_NAME.test(filename)) throw new Error('pdf.js data: unusable file name');
    const full = path.join(base, filename);
    if (path.relative(base, full).startsWith('..')) throw new Error('pdf.js data: outside its folder');
    return new Uint8Array(await fsp.readFile(full));
  }
}
