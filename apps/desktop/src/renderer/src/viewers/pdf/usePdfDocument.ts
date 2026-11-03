import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
import { pdfSource, pdfjs } from '../pdfjs';

export type PdfOpen =
  | { status: 'opening' }
  | { status: 'ready'; doc: PDFDocumentProxy }
  | { status: 'password'; wrong: boolean; checking: boolean; submit(password: string): void }
  | { status: 'failed' };

/** pdf.js messages are technical (and English): the error name goes to the log, the user gets our notice. */
const logFailure = (e: unknown) => console.warn(`[pdf] open/render failed: ${(e as Error)?.name ?? 'Error'}`);

/** How long a closing document waits for its first page before it is destroyed anyway. */
const DESTROY_WAIT_MS = 2000;

/** Opens the asset's document; a protected one asks for its password through `submit`, which is kept in memory only. */
export function usePdfDocument(assetId: string): PdfOpen {
  const [state, setState] = useState<PdfOpen>({ status: 'opening' });
  const answer = useRef<((password: string) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    let loadedDoc: PDFDocumentProxy | null = null;
    setState({ status: 'opening' });
    answer.current = null;
    void pdfjs()
      .then((lib) => {
        if (cancelled) return;
        task = lib.getDocument(pdfSource(assetId));
        task.onPassword = (update: (password: string) => void, reason: number) => {
          if (cancelled) return;
          answer.current = update;
          setState({
            status: 'password',
            wrong: reason === lib.PasswordResponses.INCORRECT_PASSWORD,
            checking: false,
            submit: (password) => {
              setState((s) => (s.status === 'password' ? { ...s, checking: true } : s));
              answer.current?.(password);
            },
          });
        };
        task.promise.then(
          (doc) => {
            loadedDoc = doc;
            if (!cancelled) setState({ status: 'ready', doc });
          },
          (e: unknown) => {
            if (cancelled) return;
            logFailure(e);
            setState({ status: 'failed' });
          },
        );
      })
      .catch((e: unknown) => {
        // The pdf.js module itself did not load.
        if (cancelled) return;
        logFailure(e);
        setState({ status: 'failed' });
      });
    return () => {
      cancelled = true;
      answer.current = null;
      // The view that shows the document detaches its viewer in its own cleanup, which React runs after this one when the reader
      // unmounts, so the task is never destroyed in this pass. A viewer that was just attached still has the request for page 1
      // in flight: destroying the task under it fails that request after the viewer has been reset, and nothing is left to
      // handle the failure. So the task goes once that request has settled (the document hands out the same promise to
      // everyone who asks), or after a moment if the worker never answers.
      const closing = task;
      const loaded = loadedDoc;
      const destroy = () => void closing?.destroy();
      if (!loaded) {
        queueMicrotask(destroy);
        return;
      }
      const settled = loaded.getPage(1).then(() => undefined, () => undefined);
      void Promise.race([settled, new Promise<void>((resolve) => setTimeout(resolve, DESTROY_WAIT_MS))]).then(destroy);
    };
  }, [assetId]);

  return state;
}
