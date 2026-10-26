import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, FileX } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { LibraryItem } from '@learn/domain';
import { t } from '../strings';
import { IconButton } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Notice } from '../ui/Notice';
import { ratio, restorePageIndex } from './positionSaver';
import { PdfErrorNotice } from './ReaderNotices';
import { pdfSource, pdfjs } from './pdfjs';
import { usePosition } from './usePosition';

const ZOOMS = [0.5, 1, 2] as const;
const PAGE_SAVE = { kind: 'debounce', ms: 300 } as const;

export function PdfViewer({ item }: { item: LibraryItem }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastRender = useRef<RenderTask | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [zoom, setZoom] = useState<number>(1);
  const [rendered, setRendered] = useState(0);
  /** The document cannot be opened: the reader is replaced by the notice. */
  const [openFailed, setOpenFailed] = useState(false);
  /** One page could not be drawn: that page's stage says so; the toolbar stays, so the other pages can be reached. */
  const [pageFailed, setPageFailed] = useState<number | null>(null);
  const [restored, setRestored] = useState(false);
  const pos = usePosition(item, PAGE_SAVE);
  /** pdf.js messages are technical (and English): the error name goes to the log, the user gets our notice. */
  const logFailure = (e: unknown) => console.warn(`[pdf] open/render failed: ${(e as Error)?.name ?? 'Error'}`);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    setDoc(null);
    setPageNum(1);
    setRestored(false);
    setOpenFailed(false);
    setPageFailed(null);
    void pdfjs().then((lib) => {
      if (cancelled) return;
      task = lib.getDocument(pdfSource(item.assetId));
      task.promise.then(
        (d) => { if (!cancelled) setDoc(d); },
        (e: unknown) => {
          if (cancelled) return;
          logFailure(e);
          setOpenFailed(true);
        },
      );
    }).catch((e: unknown) => {
      // The pdf.js module itself did not load.
      if (cancelled) return;
      logFailure(e);
      setOpenFailed(true);
    });
    return () => {
      cancelled = true;
      void task?.destroy();
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
    setPageFailed(null);
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
        // A page of a document that opened (final review m2): that page says so, the others stay reachable.
        logFailure(e);
        setPageFailed(pageNum);
      }
    })();
    return () => {
      cancelled = true;
      lastRender.current?.cancel();
    };
  }, [doc, pageNum, zoom, restored]);

  const total = doc?.numPages ?? 0;
  // A final state (design-spec 6, rubric 8; C-2): no reader controls that cannot work, only the notice.
  if (openFailed) return <PdfErrorNotice item={item} />;
  const failedHere = pageFailed !== null && pageFailed === pageNum;
  return (
    <div className="reader">
      <div className="reader-toolbar" role="toolbar" aria-label={t.reader.pdfTools} data-testid="reader-toolbar">
        {/* Pages run top to bottom: up/down chevrons, never the toolbar's back chevron (m3). */}
        <IconButton icon={ChevronUp} label={t.reader.prevPage} testId="pdf-prev" isDisabled={pageNum <= 1} disabledReason={t.reader.firstPage} onPress={() => setPageNum((p) => p - 1)} />
        <span className="page-indicator num" data-testid="pdf-page-indicator">
          {total > 0 && restored ? t.reader.page(pageNum, total) : '…'}
        </span>
        <IconButton
          icon={ChevronDown}
          label={t.reader.nextPage}
          testId="pdf-next"
          isDisabled={pageNum >= total}
          disabledReason={total === 0 ? t.reader.opening : t.reader.lastPage}
          onPress={() => setPageNum((p) => p + 1)}
        />
        <span className="spacer" />
        <label className="zoom-select">
          <span>{t.reader.zoom}</span>
          {/* A native select (the zoom menu is M7) drawn like the mockup's trigger: text + the 12 px chevron (spec 5). */}
          <span className="select-wrap">
            <select data-testid="pdf-zoom" value={String(zoom)} onChange={(e) => setZoom(Number(e.target.value))}>
              {ZOOMS.map((z) => (
                <option key={z} value={String(z)}>
                  {z * 100}%
                </option>
              ))}
            </select>
            <Icon icon={ChevronDown} size="xs" />
          </span>
        </label>
      </div>
      {/* A named, focusable scroll area (keyboard scrolling) is a region: aria-label on a plain div names nothing
          (axe aria-prohibited-attr). */}
      <div className="pdf-stage" role="region" tabIndex={0} aria-label={t.reader.pdfStage}>
        <div className="pdf-page-wrap">
          <canvas ref={canvasRef} data-testid="pdf-canvas" data-rendered={rendered} data-failed={failedHere ? '' : undefined} />
        </div>
        {failedHere && (
          <div className="stage-center">
            <Notice icon={FileX} title={t.reader.pageErrorTitle} testId="pdf-page-error">
              {t.reader.pageErrorBody}
            </Notice>
          </div>
        )}
      </div>
    </div>
  );
}
