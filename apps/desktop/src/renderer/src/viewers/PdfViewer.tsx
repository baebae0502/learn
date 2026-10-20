import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { assetUrl, type LibraryItem } from '@learn/domain';
import { t } from '../strings';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** pdf.js runtime data copied by scripts/copy-pdfjs-assets.mjs; same-origin in dev and production. */
const dataUrl = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;
const ZOOMS = [0.5, 1, 2] as const;

export function PdfViewer({ item }: { item: LibraryItem }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [zoom, setZoom] = useState<number>(1);
  const [rendered, setRendered] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setPageNum(1);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!doc || !canvas) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    void (async () => {
      const page = await doc.getPage(pageNum);
      if (cancelled) return;
      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: zoom * dpr });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
      canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
      task = page.render({ canvas, viewport });
      try {
        await task.promise;
        if (!cancelled) setRendered((n) => n + 1);
      } catch (e) {
        if (!cancelled && (e as Error)?.name !== 'RenderingCancelledException') setError(`${t.pdfError} ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, pageNum, zoom]);

  const total = doc?.numPages ?? 0;
  return (
    <div className="pdf-viewer">
      <div className="pdf-toolbar">
        <button className="secondary" data-testid="pdf-prev" disabled={pageNum <= 1} onClick={() => setPageNum((p) => p - 1)}>{t.pdfPrev}</button>
        <span data-testid="pdf-page-indicator">{total > 0 ? t.pdfPage(pageNum, total) : '…'}</span>
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
