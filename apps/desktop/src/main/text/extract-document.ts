import fsp from 'node:fs/promises';
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs';
import { getDocument, PasswordException, VerbosityLevel } from 'pdfjs-dist';
import { TEXT_LIMITS } from '@learn/domain';
import { FsDataFactory } from './data-factory';
import type { ExtractRequest, WorkerMessage } from './messages';
import { cleanPageText, guardStoredText, type TextItemLike } from './page-text';

type Send = (m: WorkerMessage) => void;

/** One page's text read within the page limit; a longer page is cut and its stream cancelled. */
async function readPage(stream: ReadableStream<{ items: unknown[] }>, maxChars: number): Promise<string> {
  const reader = stream.getReader();
  let raw = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const item of value.items as TextItemLike[]) {
        if (typeof item.str === 'string') raw += item.str;
        if (item.hasEOL) raw += '\n';
      }
      if (raw.length > maxChars) {
        raw = raw.slice(0, maxChars);
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return raw;
}

/**
 * Opens one PDF with pdf.js in this process and sends its page texts in batches. Never throws: the outcome is always
 * a done or failed message. The file is untrusted input, which is why only the worker opens it.
 */
export async function extractDocument(req: ExtractRequest, send: Send): Promise<void> {
  const { jobId, limits } = req;
  const failed = (reason: 'locked' | 'damaged' | 'too-large'): void => send({ type: 'failed', jobId, reason });
  let loadingTask: ReturnType<typeof getDocument> | null = null;
  try {
    // pdf.js makes its "worker" in this thread from globalThis.pdfjsWorker when there is no Worker to start; imports are
    // hoisted, so the assignment sits here, before the first getDocument.
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = pdfjsWorker;
    let data: Uint8Array;
    try {
      if ((await fsp.stat(req.file)).size > limits.maxFileBytes) return failed('too-large');
      data = new Uint8Array(await fsp.readFile(req.file));
    } catch {
      return failed('damaged');
    }
    let pdf: Awaited<ReturnType<typeof getDocument>['promise']>;
    try {
      loadingTask = getDocument({
        data,
        BinaryDataFactory: FsDataFactory,
        cMapUrl: `${req.assetsDir}/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${req.assetsDir}/standard_fonts/`,
        useWorkerFetch: false,
        isOffscreenCanvasSupported: false,
        isImageDecoderSupported: false,
        useWasm: false,
        disableFontFace: true,
        useSystemFonts: false,
        enableXfa: false,
        verbosity: VerbosityLevel.ERRORS,
      } as Parameters<typeof getDocument>[0]);
      pdf = await loadingTask.promise;
    } catch (error) {
      return failed(error instanceof PasswordException ? 'locked' : 'damaged');
    }
    const numPages = pdf.numPages;
    send({ type: 'opened', jobId, pages: numPages });

    const last = Math.min(numPages, limits.maxPages);
    let truncated = numPages > limits.maxPages;
    let batch: string[] = [];
    let batchFrom = req.startPage;
    let batchChars = 0;
    let docChars = 0;
    let next = req.startPage;
    const flush = (): void => {
      if (batch.length === 0) return;
      send({ type: 'pages', jobId, from: batchFrom, texts: batch });
      batchFrom += batch.length;
      batch = [];
      batchChars = 0;
    };
    try {
      for (; next < last; ) {
        const page = await pdf.getPage(next + 1);
        let text: string;
        try {
          text = guardStoredText(cleanPageText(await readPage(page.streamTextContent(), limits.maxPageChars)), limits.maxPageChars);
        } finally {
          page.cleanup();
        }
        const room = limits.maxDocChars - docChars;
        if (text.length > room) {
          text = guardStoredText(text, room);
          truncated = true;
        }
        docChars += text.length;
        batch.push(text);
        batchChars += text.length;
        next += 1;
        if (batch.length >= TEXT_LIMITS.batchPages || batchChars >= TEXT_LIMITS.batchChars) flush();
        if (docChars >= limits.maxDocChars) {
          truncated = true;
          break;
        }
      }
    } catch {
      // A page pdf.js cannot read ends the document as damaged; the unsent rest of the batch is dropped with it.
      return failed('damaged');
    }
    flush();
    send({ type: 'done', jobId, pages: next, truncated });
  } finally {
    if (loadingTask) await loadingTask.destroy().catch(() => {});
  }
}
