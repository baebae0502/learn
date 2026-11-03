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

/** Opens the asset's document; a protected one asks for its password through `submit`, which is kept in memory only. */
export function usePdfDocument(assetId: string): PdfOpen {
  const [state, setState] = useState<PdfOpen>({ status: 'opening' });
  const answer = useRef<((password: string) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
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
      void task?.destroy();
    };
  }, [assetId]);

  return state;
}
