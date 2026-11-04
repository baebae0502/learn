import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileX } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { t } from '../../strings';
import { Icon } from '../../ui/Icon';
import { pdfViewerModule, pdfjs } from '../pdfjs';
import { readWindowParams } from '../../ui/platform';
import { useFind } from './findStore';
import { installAnchorProbe } from './anchorProbe';
import { watchDevicePixelRatio } from './displayChange';
import { INITIAL_PDF, useReader, type PdfViewHandle, type ZoomValue } from './readerStore';
import { usePageColor } from './usePageColor';
import { usePinchZoom } from './usePinchZoom';
import { fitScale, type FitMode } from './fit';
import { nextZoom } from './zoom';

type Rotation = 0 | 90 | 180 | 270;
const PRESETS: readonly string[] = ['auto', 'page-width', 'page-fit'];
const isFitMode = (z: unknown): z is FitMode => typeof z === 'string' && PRESETS.includes(z);

/** The zoom a scalechanging event stands for: a preset keeps its name, anything else is the number. */
const zoomOf = (presetValue: string | undefined, scale: number): ZoomValue =>
  presetValue && PRESETS.includes(presetValue) ? (presetValue as ZoomValue) : scale;

/**
 * Owns the pdf.js viewer for one open document: the scroll container, the pages, the text and link layers. The viewer
 * fills the store (state and handle) for whatever else the reader mounts; React never renders into the pages.
 */
export function PdfDocumentView({ doc, revisionId, restored, onFailed }: { doc: PDFDocumentProxy; revisionId: string; restored: boolean; onFailed(): void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const [pageDivs, setPageDivs] = useState<ReadonlyMap<number, HTMLElement>>(new Map());
  const [rendered, setRendered] = useState(0);
  const pdf = useReader((s) => s.pdf);
  const { resolved: pageColor } = usePageColor();
  usePinchZoom(scrollRef);
  /** The saved place is applied (PdfReader): until then a change of the stage's size is the stage settling, not a reason to fit again. */
  const restoredRef = useRef(restored);
  restoredRef.current = restored;

  useEffect(() => {
    const container = scrollRef.current;
    const viewerEl = viewerRef.current;
    if (!container || !viewerEl) return;
    let cancelled = false;
    let teardown: (() => void) | null = null;
    const fail = (e: unknown) => {
      if (cancelled) return;
      console.warn(`[pdf] open/render failed: ${(e as Error)?.name ?? 'Error'}`);
      onFailed();
    };
    const store = useReader.getState();
    void Promise.all([pdfViewerModule(), pdfjs()])
      .then(([viewerLib, lib]) => {
        if (cancelled) return;
        const { EventBus, PDFFindController, PDFLinkService, PDFViewer, LinkTarget } = viewerLib;
        const eventBus = new EventBus();
        const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
        // The controller searches the document's text whether or not the find bar is open; the bar only asks and shows.
        const findController = new PDFFindController({ linkService, eventBus, updateMatchesCountOnProgress: true });
        const viewer = new PDFViewer({
          container,
          findController,
          viewer: viewerEl,
          eventBus,
          linkService,
          textLayerMode: 1,
          annotationMode: lib.AnnotationMode.ENABLE,
        });
        linkService.setViewer(viewer);
        const doneOnce = new Set<number>();
        /** One host element per page that failed: pdf.js empties a page's div when it redraws it, so React renders into a host it can still find. */
        const failed = new Map<number, HTMLElement>();
        /**
         * A fit mode is sized here, not by pdf.js: its fit keeps no room round the page when page borders are off, and the mockup
         * keeps 24 on every side (fit.ts). The number goes in as the viewer's scale; the preset keeps its name in the store, and
         * the scalechanging of this very assignment (it carries no preset) is not read as a zoom the reader chose.
         */
        let fitting: FitMode | null = null;
        const fitTo = (mode: FitMode) => {
          const view = viewer.getPageView(viewer.currentPageNumber - 1);
          if (!view?.width || !view.scale) return;
          const scale = fitScale(mode, { width: container.clientWidth, height: container.clientHeight }, { width: view.width / view.scale, height: view.height / view.scale });
          fitting = mode;
          try {
            viewer.currentScale = scale;
          } finally {
            fitting = null;
          }
          store.setPdf({ scale: viewer.currentScale, zoom: mode });
        };
        const handle: PdfViewHandle = {
          goToPage: (n) => {
            if (Number.isInteger(n) && n >= 1 && n <= viewer.pagesCount) viewer.currentPageNumber = n;
          },
          next: () => void viewer.nextPage(),
          previous: () => void viewer.previousPage(),
          setZoom: (z) => {
            if (typeof z === 'number') viewer.currentScale = z;
            else fitTo(z);
          },
          restore: (saved, pageIndex) => {
            const zoom = saved?.zoom ?? 'auto';
            viewer.pagesRotation = saved?.rotation ?? 0;
            if (typeof zoom === 'number') viewer.currentScale = zoom;
            else fitTo(zoom);
            viewer.scrollPageIntoView({ pageNumber: pageIndex + 1, destArray: [null, { name: 'XYZ' }, saved?.left ?? 0, saved?.top ?? null, null] });
            // A place at the top of a page keeps the room above it (24 over the first page, 12 between pages), as the mockup draws it.
            const pageDiv = viewer.getPageView(pageIndex)?.div;
            if (pageDiv && Math.abs(container.scrollTop - (pageDiv.offsetTop + pageDiv.clientTop)) <= 1) container.scrollTop -= pageIndex === 0 ? 24 : 12;
            // Reports the place the viewer is at now, so the saver starts from it and saves only what the reader changes.
            viewer.update();
            store.setPdf({ placed: true, pageNumber: pageIndex + 1, scale: viewer.currentScale, zoom, rotation: viewer.pagesRotation as Rotation });
          },
          zoomIn: () => {
            viewer.currentScale = nextZoom(viewer.currentScale, 1);
          },
          zoomOut: () => {
            viewer.currentScale = nextZoom(viewer.currentScale, -1);
          },
          rotate: (delta) => {
            viewer.pagesRotation = (viewer.pagesRotation + delta + 360) % 360;
          },
          document: () => doc,
          viewer: () => viewer,
          eventBus: () => eventBus,
          linkService: () => linkService,
        };
        let pagesInitialised = false;
        eventBus.on('pagesinit', () => {
          pagesInitialised = true;
          fitTo('auto');
          store.setPdf({ ready: true, pagesCount: viewer.pagesCount, pageNumber: viewer.currentPageNumber, scale: viewer.currentScale, zoom: 'auto', rotation: viewer.pagesRotation as Rotation });
        });
        // pdf.js FindState: FOUND 0, NOT_FOUND 1, WRAPPED 2, PENDING 3.
        const reportFind = (e: { state?: number; matchesCount: { current: number; total: number } }) => {
          const { query } = useFind.getState();
          const status = query.trim() === '' ? 'idle' : e.state === 1 ? 'notFound' : e.state === 2 ? 'wrapped' : 'found';
          useFind.getState().report(status, e.matchesCount.total > 0 ? e.matchesCount : null);
        };
        eventBus.on('updatefindcontrolstate', reportFind);
        eventBus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) => {
          // The running count of a search still going keeps the status the control state gave.
          useFind.getState().report(useFind.getState().status === 'idle' ? 'found' : useFind.getState().status, e.matchesCount.total > 0 ? e.matchesCount : null);
        });
        eventBus.on('pagechanging', (e: { pageNumber: number }) => store.setPdf({ pageNumber: e.pageNumber }));
        eventBus.on('scalechanging', (e: { scale: number; presetValue?: string }) => store.setPdf({ scale: e.scale, zoom: fitting ?? zoomOf(e.presetValue, e.scale) }));
        eventBus.on('rotationchanging', (e: { pagesRotation: number }) => {
          store.setPdf({ rotation: e.pagesRotation as Rotation });
          if (!restoredRef.current) return;
          // A fit mode is sized for the turned page.
          const zoom = useReader.getState().pdf?.zoom;
          if (isFitMode(zoom)) fitTo(zoom);
        });
        eventBus.on('pagerendered', (e: { pageNumber: number; source: { div: HTMLElement }; error?: unknown }) => {
          if (e.error) {
            console.warn(`[pdf] open/render failed: ${(e.error as Error)?.name ?? 'Error'}`);
            let host = failed.get(e.pageNumber);
            if (!host) {
              host = document.createElement('div');
              host.className = 'pdf-page-error-host';
              failed.set(e.pageNumber, host);
            }
            if (!host.isConnected) e.source.div.append(host);
            setPageDivs(new Map(failed));
            return;
          }
          if (failed.delete(e.pageNumber)) setPageDivs(new Map(failed));
          doneOnce.add(e.pageNumber);
          setRendered(doneOnce.size);
        });
        store.setPdf({ ...INITIAL_PDF, pagesCount: doc.numPages });
        store.setHandle(handle);
        viewer.setDocument(doc);
        linkService.setDocument(doc);
        // pdf.js rejects its pages promise when the first page or the permissions cannot be read. Before pagesinit there is
        // nothing to show and the reader says so; later it is only logged, so a view that works is never replaced.
        viewer.pagesPromise?.catch((e: unknown) => {
          if (!pagesInitialised) fail(e);
          else if (!cancelled) console.warn(`[pdf] open/render failed: ${(e as Error)?.name ?? 'Error'}`);
        });
        // The pages are drawn at the display's pixel ratio: moving to another screen draws them again.
        const stopWatchingDisplay = watchDevicePixelRatio(() => viewer.refresh());
        // E2E only: the spike's selection and anchor hooks (the window's address carries e2e=1 only in an unpackaged test run).
        const removeProbe = readWindowParams(window.location.search).e2e ? installAnchorProbe({ doc, viewer, revisionId }) : null;
        // A fit mode (auto, page width, whole page) follows the stage when it changes size (the item panel, the window, full screen);
        // a number stays. One fit per frame; assigning the preset again keeps the page and the place in it (pdf.js keeps its location).
        let fitFrame = 0;
        const refit = () => {
          fitFrame = 0;
          const zoom = useReader.getState().pdf?.zoom;
          if (!restoredRef.current || typeof zoom !== 'string') return;
          fitTo(zoom);
          viewer.update();
        };
        // The border box: the stage's own size. Its content box shrinks by the scroll bar, and a fit that changes the page's height
        // toggles the bar, which would fit again without end (final re-review N-1). A callback for the same size is skipped as well.
        let lastWidth = -1;
        let lastHeight = -1;
        const stageObserver = new ResizeObserver((entries) => {
          const box = entries[entries.length - 1]?.borderBoxSize?.[0];
          if (box && box.inlineSize === lastWidth && box.blockSize === lastHeight) return;
          if (box) {
            lastWidth = box.inlineSize;
            lastHeight = box.blockSize;
          }
          if (!fitFrame) fitFrame = requestAnimationFrame(refit);
        });
        stageObserver.observe(container, { box: 'border-box' });
        teardown = () => {
          // Before the viewer lets go of the document: a fit scheduled for the next frame would draw pages of a document that is going away.
          stageObserver.disconnect();
          cancelAnimationFrame(fitFrame);
          removeProbe?.();
          stopWatchingDisplay();
          // A render the queue still has scheduled would draw a page whose document is going away ("pdfPage is not loaded").
          viewer.renderingQueue!.renderView = () => false;
          // This also detaches the find controller (pdf.js hands it null): its text extraction asks the document for pages.
          viewer.setDocument(null);
          useFind.getState().reset();
          store.setHandle(null);
          store.setPdf(null);
        };
      })
      .catch(fail);
    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [doc, revisionId]); // onFailed is a state setter of the reader

  return (
    <>
      <div ref={scrollRef} className="pdf-scroll" data-testid="pdf-scroll" data-restored={restored ? '' : undefined}>
        <div
          ref={viewerRef}
          className="pdfViewer"
          data-testid="pdf-viewer"
          data-pages={pdf?.pagesCount ?? 0}
          data-page={pdf?.pageNumber ?? 1}
          data-scale={pdf?.scale ?? 1}
          data-zoom={String(pdf?.zoom ?? 'auto')}
          data-page-color={pageColor}
          data-rotation={pdf?.rotation ?? 0}
          data-rendered={rendered}
        />
      </div>
      {[...pageDivs].map(([n, host]) =>
        createPortal(
          <div className="pdf-page-error" role="status" data-testid="pdf-page-error">
            <Icon icon={FileX} size="lg" />
            <strong>{t.reader.pageErrorTitle}</strong>
            <span>{t.reader.pageErrorBody}</span>
          </div>,
          host,
          n,
        ),
      )}
    </>
  );
}
