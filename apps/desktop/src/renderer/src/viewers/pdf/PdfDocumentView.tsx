import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileX } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { t } from '../../strings';
import { Icon } from '../../ui/Icon';
import { pdfViewerModule, pdfjs } from '../pdfjs';
import { readWindowParams } from '../../ui/platform';
import { watchDevicePixelRatio } from './displayChange';
import { INITIAL_PDF, useReader, type PdfViewHandle, type ZoomValue } from './readerStore';
import { usePageColor } from './usePageColor';
import { usePinchZoom } from './usePinchZoom';
import { useReaderScope, useReaderShown } from '../readerScope';
import { fitScale, widestPage, type FitMode } from './fit';
import { roomAfterJump } from './placement';
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
  const scope = useReaderScope();
  const pdf = useReader((s) => s.pdf);
  const { resolved: pageColor } = usePageColor();
  usePinchZoom(scrollRef);
  /** The saved place is applied (PdfReader): until then a change of the stage's size is the stage settling, not a reason to fit again. */
  const restoredRef = useRef(restored);
  restoredRef.current = restored;
  /**
   * A kept tab that is not shown is display: none: its stage measures 0 and its scroll offset is lost with its box. Read by the
   * observers (set while rendering, so a callback in the same frame as the change already sees it) and by the view's own
   * hook, which the effect below calls when the tab is hidden or shown.
   */
  const shown = useReaderShown();
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const onShown = useRef<((shown: boolean) => void) | null>(null);
  useLayoutEffect(() => onShown.current?.(shown), [shown]);

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
    const store = scope.reader.getState();
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
        /**
         * The place the stage's top edge is at: the page and how far down it, as a share of the page's height. A point of the page
         * does not do for a quarter turn (the corner at the stage's top left is another corner afterwards); a share of the height
         * is the same on a turned page. Room above the page (its margin showing) is kept in pixels.
         */
        const placeInPage = (): { pageNumber: number; share: number; above: number } | null => {
          const div = viewer.getPageView(viewer.currentPageNumber - 1)?.div;
          if (!div?.clientHeight) return null;
          const into = container.scrollTop - (div.offsetTop + div.clientTop);
          return { pageNumber: viewer.currentPageNumber, share: Math.max(0, into) / div.clientHeight, above: Math.min(0, into) };
        };
        let turningFrom: { pageNumber: number; share: number; above: number } | null = null;
        /** Every page's size is known from pagesloaded on; before it the views hold the first page's size. */
        let pagesLoaded = false;
        const widestShown = () => {
          const turned = viewer.pagesRotation % 180 !== 0;
          const sizes: { width: number; height: number }[] = [];
          for (let i = 0; i < viewer.pagesCount; i++) {
            const v = viewer.getPageView(i);
            if (!v?.width || !v.scale) continue;
            const [w, h] = [v.width / v.scale, v.height / v.scale];
            sizes.push(turned ? { width: h, height: w } : { width: w, height: h });
          }
          return widestPage(sizes, viewer.pagesRotation as Rotation);
        };
        /** A fit asked for while the tab is hidden (its stage measures nothing): done once it is shown. */
        let fitWhenShown: FitMode | null = null;
        const fitTo = (mode: FitMode, again = true) => {
          if (!shownRef.current) {
            fitWhenShown = mode;
            return;
          }
          const view = viewer.getPageView(viewer.currentPageNumber - 1);
          if (!view?.width || !view.scale) return;
          const [width, height] = [container.clientWidth, container.clientHeight];
          // Auto and page width are sized to the widest page once every page's size is known, so no page needs the stage to scroll
          // sideways; before that, and for the whole-page fit, it is the page in view.
          const size = pagesLoaded && mode !== 'page-fit' ? widestShown() : { width: view.width / view.scale, height: view.height / view.scale };
          const scale = fitScale(mode, { width, height }, size);
          fitting = mode;
          try {
            viewer.currentScale = scale;
          } finally {
            fitting = null;
          }
          store.setPdf({ scale: viewer.currentScale, zoom: mode });
          // The new scale can bring the stage's scroll bar (or take it away), which changes the room the fit was computed for: once more,
          // for the size the stage has now. Only once: the bar cannot depend on this second scale in a way the first did not settle.
          if (again && (container.clientWidth !== width || container.clientHeight !== height)) fitTo(mode, false);
        };
        /**
         * Every jump to a page runs through here: pdf.js lands the page flush at the stage's edge and the room the mockup draws
         * round it (placement.ts) is added after. The viewer's own calls that pass allowNegativeOffset (a zoom keeping its place)
         * are left as they are; links and the outline reach this through the link service.
         */
        const scrollPageIntoView = viewer.scrollPageIntoView.bind(viewer);
        let jumped: { pageNumber: number; scrollTop: number; scrollLeft: number } | null = null;
        const jump = (args: Parameters<typeof scrollPageIntoView>[0], keepTop: boolean, keepLeft: boolean) => {
          scrollPageIntoView({ ...args, allowNegativeOffset: true });
          const div = viewer.getPageView(args.pageNumber - 1)?.div;
          const first = viewer.getPageView(0)?.div;
          if (!div || !first) return;
          const top = div.offsetTop + div.clientTop;
          const left = div.offsetLeft + div.clientLeft;
          const next = roomAfterJump({
            flow: 'vertical',
            page: { top, left, width: div.clientWidth, height: div.clientHeight },
            firstRow: Math.abs(top - (first.offsetTop + first.clientTop)) <= 1,
            stage: { scrollTop: container.scrollTop, scrollLeft: container.scrollLeft, width: container.clientWidth, height: container.clientHeight },
            keepTop,
            keepLeft,
          });
          if (next.scrollTop !== container.scrollTop) container.scrollTop = next.scrollTop;
          if (next.scrollLeft !== container.scrollLeft) container.scrollLeft = next.scrollLeft;
          jumped = { pageNumber: args.pageNumber, scrollTop: container.scrollTop, scrollLeft: container.scrollLeft };
        };
        /** A link that names a point of the page (an XYZ with a top or a left) is kept at that point. */
        const pointOf = (dest: unknown): { top: boolean; left: boolean } => {
          const d = Array.isArray(dest) ? (dest as unknown[]) : null;
          const xyz = (d?.[1] as { name?: string } | undefined)?.name === 'XYZ';
          return { top: xyz && d![3] != null, left: xyz && d![2] != null };
        };
        viewer.scrollPageIntoView = (args) => {
          if (args.allowNegativeOffset) return scrollPageIntoView(args);
          const keep = pointOf(args.destArray);
          jump(args, keep.top, keep.left);
        };
        const place: PdfViewHandle['place'] = ({ pageNumber, destArray }) => {
          if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > viewer.pagesCount) return;
          viewer.scrollPageIntoView({ pageNumber, destArray: destArray ?? undefined });
        };
        const handle: PdfViewHandle = {
          place,
          goToPage: (n) => place({ pageNumber: n }),
          next: () => place({ pageNumber: viewer.currentPageNumber + 1 }),
          previous: () => place({ pageNumber: viewer.currentPageNumber - 1 }),
          setZoom: (z) => {
            if (typeof z === 'number') viewer.currentScale = z;
            else fitTo(z);
          },
          restore: (saved, pageIndex) => {
            const zoom = saved?.zoom ?? 'auto';
            viewer.pagesRotation = saved?.rotation ?? 0;
            if (typeof zoom === 'number') viewer.currentScale = zoom;
            // The fit follows the current page, which is page 1 until the scroll below (R-21: a mixed-size document is fitted to the page in view, as pdf.js does).
            else fitTo(zoom);
            // Not a link: a place at the top or left edge of a page gets the room the mockup draws there (placement.ts), and one inside
            // the margin, which a saved place can be, comes back exactly.
            jump({ pageNumber: pageIndex + 1, destArray: [null, { name: 'XYZ' }, saved?.left ?? 0, saved?.top ?? null, null] }, false, false);
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
            // The place in view before the pages change shape: rotationchanging puts the reader back on it.
            turningFrom = placeInPage();
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
          fitTo('auto'); // page 1 is the current page here (R-21)
          store.setPdf({ ready: true, pagesCount: viewer.pagesCount, pageNumber: viewer.currentPageNumber, scale: viewer.currentScale, zoom: 'auto', rotation: viewer.pagesRotation as Rotation });
        });
        // Every page's size is known now: a mixed-size document is fitted once to its widest page (a fit before this had the page in view).
        eventBus.on('pagesloaded', () => {
          pagesLoaded = true;
          const zoom = scope.reader.getState().pdf?.zoom;
          if (zoom === 'auto' || zoom === 'page-width') {
            fitTo(zoom);
            viewer.update();
          }
          store.setPdf({ sized: true });
        });
        // pdf.js focuses a link's target page once its text is drawn, and the browser scrolls the page's top to the stage's edge to do
        // it, which takes back the room the jump left above the page. The room is put back (once, and only when the page sits flush).
        eventBus.on('textlayerrendered', (e: { pageNumber: number }) => {
          const kept = jumped;
          if (!kept || kept.pageNumber !== e.pageNumber) return;
          jumped = null;
          const div = viewer.getPageView(e.pageNumber - 1)?.div;
          if (!div || Math.abs(container.scrollTop - (div.offsetTop + div.clientTop)) > 1 || kept.scrollTop === container.scrollTop) return;
          container.scrollTop = kept.scrollTop;
          container.scrollLeft = kept.scrollLeft;
        });
        // pdf.js FindState: FOUND 0, NOT_FOUND 1, WRAPPED 2, PENDING 3.
        const reportFind = (e: { state?: number; matchesCount: { current: number; total: number } }) => {
          const { query } = scope.find.getState();
          const status = query.trim() === '' ? 'idle' : e.state === 1 ? 'notFound' : e.state === 2 ? 'wrapped' : 'found';
          scope.find.getState().report(status, e.matchesCount.total > 0 ? e.matchesCount : null);
        };
        eventBus.on('updatefindcontrolstate', reportFind);
        eventBus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) => {
          // The running count of a search still going keeps the status the control state gave.
          scope.find.getState().report(scope.find.getState().status === 'idle' ? 'found' : scope.find.getState().status, e.matchesCount.total > 0 ? e.matchesCount : null);
        });
        eventBus.on('pagechanging', (e: { pageNumber: number }) => store.setPdf({ pageNumber: e.pageNumber }));
        eventBus.on('scalechanging', (e: { scale: number; presetValue?: string }) => store.setPdf({ scale: e.scale, zoom: fitting ?? zoomOf(e.presetValue, e.scale) }));
        eventBus.on('rotationchanging', (e: { pagesRotation: number; pageNumber: number }) => {
          store.setPdf({ rotation: e.pagesRotation as Rotation });
          const from = turningFrom;
          turningFrom = null;
          if (!restoredRef.current) return;
          // A fit mode is sized for the turned page; the scroll position stays in pixels, which names another page once the pages change height.
          const zoom = scope.reader.getState().pdf?.zoom;
          if (isFitMode(zoom)) fitTo(zoom);
          const div = viewer.getPageView((from?.pageNumber ?? e.pageNumber) - 1)?.div;
          if (!div) return;
          container.scrollTop = div.offsetTop + div.clientTop + (from?.share ?? 0) * div.clientHeight + (from?.above ?? 0);
          viewer.update();
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
        // Loaded on demand, so the product's bundle does not hold them.
        let removeProbe: ((() => void) & { claim(): void }) | null = null;
        if (readWindowParams(window.location.search).e2e) {
          void import('./anchorProbe').then(({ default: installProbe }) => {
            if (!cancelled) removeProbe = installProbe({ doc, viewer, revisionId });
          });
        }
        // A fit mode (auto, page width, whole page) follows the stage when it changes size (the item panel, the window, full screen);
        // a number stays. One fit per frame; assigning the preset again keeps the page and the place in it (pdf.js keeps its location).
        let fitFrame = 0;
        const refit = () => {
          fitFrame = 0;
          if (!shownRef.current) return;
          const zoom = scope.reader.getState().pdf?.zoom;
          if (!restoredRef.current || typeof zoom !== 'string') return;
          fitTo(zoom);
          viewer.update();
        };
        // The border box: the stage's own size. Its content box shrinks by the scroll bar, and a fit that changes the page's height
        // toggles the bar, which would fit again without end (final re-review N-1). A callback for the same size is skipped as well.
        let lastWidth = -1;
        let lastHeight = -1;
        const stageObserver = new ResizeObserver((entries) => {
          // Hidden, the stage is 0 by 0: that is neither a size to fit to nor one to remember (the size from before the hiding is what a
          // later callback is compared with, so a stage that comes back the same size does not fit again).
          if (!shownRef.current) return;
          const box = entries[entries.length - 1]?.borderBoxSize?.[0];
          if (box && box.inlineSize === lastWidth && box.blockSize === lastHeight) return;
          if (box) {
            lastWidth = box.inlineSize;
            lastHeight = box.blockSize;
          }
          if (!fitFrame) fitFrame = requestAnimationFrame(refit);
        });
        stageObserver.observe(container, { box: 'border-box' });
        // The scroll offset of the shown stage, kept to put back: a box that was display: none starts at 0 when it is shown again.
        let scrolled = { top: 0, left: 0 };
        const onScroll = () => {
          if (shownRef.current) scrolled = { top: container.scrollTop, left: container.scrollLeft };
        };
        container.addEventListener('scroll', onScroll);
        let wasHidden = false;
        onShown.current = (visible) => {
          if (!visible) {
            wasHidden = true;
            // The jump's target belongs to the stage as it was: text layers drawn again on showing must not pull the scroll to it.
            jumped = null;
            return;
          }
          if (!wasHidden) return;
          wasHidden = false;
          container.scrollTop = scrolled.top;
          container.scrollLeft = scrolled.left;
          removeProbe?.claim();
          const mode = fitWhenShown;
          fitWhenShown = null;
          if (mode) fitTo(mode);
          // Once, for what the pages need to draw at this size; a stage that changed size is fitted by its observer in this frame.
          viewer.update();
        };
        teardown = () => {
          onShown.current = null;
          container.removeEventListener('scroll', onScroll);
          // Before the viewer lets go of the document: a fit scheduled for the next frame would draw pages of a document that is going away.
          stageObserver.disconnect();
          cancelAnimationFrame(fitFrame);
          removeProbe?.();
          stopWatchingDisplay();
          // A render the queue still has scheduled would draw a page whose document is going away ("pdfPage is not loaded").
          viewer.renderingQueue!.renderView = () => false;
          // This also detaches the find controller (pdf.js hands it null): its text extraction asks the document for pages.
          viewer.setDocument(null);
          scope.find.getState().reset();
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
