import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { assetUrl, type LibraryItem } from '@learn/domain';
import { t } from '../strings/legacy';
import { ratio, restorePageIndex } from './positionSaver';
import { usePosition } from './usePosition';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** pdf.js runtime data copied by scripts/copy-pdfjs-assets.mjs; same-origin in dev and production. */
const dataUrl = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;
const ZOOMS = [0.5, 1, 2] as const;
const PAGE_SAVE = { kind: 'debounce', ms: 300 } as const;

export function PdfViewer({ item }: { item: LibraryItem }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastRender = useRef<RenderTask | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [zoom, setZoom] = useState<number>(1);
  const [rendered, setRendered] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const pos = usePosition(item, PAGE_SAVE);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setPageNum(1);
    setRestored(false);
    setError(null);
    const task = pdfjs.getDocument({
      url: assetUrl(item.assetId),
      cMapUrl: dataUrl('cmaps'),
      cMapPacked: true,
      standardFontDataUrl: dataUrl('standard_fonts'),
      wasmUrl: dataUrl('wasm'),
      iccUrl: dataUrl('iccs'),
      enableXfa: false,
    });
    task.promise.then(
      (d) => { if (!cancelled) setDoc(d); },
      (e: unknown) => { if (!cancelled) setError(`${t.pdfError} ${(e as Error)?.message ?? ''}`); },
    );
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [item.assetId]);

  // Apply the saved page once, before the first render, so the viewer never flashes page 1.
  useEffect(() => {
    if (!doc || !pos.loaded || restored) return;
    const index = restorePageIndex(pos.saved?.locator, doc.numPages);
    pos.markRestored({ kind: 'pdf', pageIndex: index });
    setPageNum(index + 1);
    setRestored(true);
  }, [doc, pos.loaded, pos.saved, pos.markRestored, restored]);

  useEffect(() => {
    if (!restored || !doc) return;
    pos.update({ kind: 'pdf', pageIndex: pageNum - 1 }, ratio(pageNum, doc.numPages));
  }, [pageNum, restored, doc, pos.update]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas || !restored) return;
    let cancelled = false;
    void (async () => {
      const prev = lastRender.current;
      if (prev) {
        prev.cancel();
        await prev.promise.catch(() => {});
      }
      if (cancelled) return;
      try {
        const page = await doc.getPage(pageNum);
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: zoom * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const task = page.render({ canvas, viewport });
        lastRender.current = task;
        await task.promise;
        if (!cancelled) setRendered((n) => n + 1);
      } catch (e) {
        if (cancelled || (e as Error)?.name === 'RenderingCancelledException') return;
        setError(`${t.pdfError} ${(e as Error)?.message ?? ''}`);
      }
    })();
    return () => {
      cancelled = true;
      lastRender.current?.cancel();
    };
  }, [doc, pageNum, zoom, restored]);

  const total = doc?.numPages ?? 0;
  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button className="secondary" data-testid="pdf-prev" disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)}>{t.pdfPrev}</button>
        <span data-testid="pdf-page-indicator">{total > 0 && restored ? t.pdfPage(pageNum, total) : '…'}</span>
        <button className="secondary" data-testid="pdf-next" disabled={pageNum >= total} onClick={() => setPageNum((p) => p + 1)}>{t.pdfNext}</button>
        <label>
          {t.pdfZoom}{' '}
          <select data-testid="pdf-zoom" value={String(zoom)} onChange={(e) => setZoom(Number(e.target.value))}>
            {ZOOMS.map((z) => <option key={z} value={String(z)}>{z * 100}%</option>)}
          </select>
        </label>
      </div>
      {error && <p className="error" role="alert" data-testid="pdf-error">{error}</p>}
      <div className="pdf-stage">
        <canvas ref={canvasRef} data-testid="pdf-canvas" data-rendered={rendered} />
      </div>
    </div>
  );
}
