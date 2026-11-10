import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileX } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { ScrollModeName, SpreadModeName } from '@learn/domain';
import { t } from '../../strings';
import { Icon } from '../../ui/Icon';
import { pdfViewerModule, pdfjs } from '../pdfjs';
import { readWindowParams } from '../../ui/platform';
import { watchDevicePixelRatio } from './displayChange';
import { INITIAL_PDF, useReader, type PdfPlace, type PdfViewHandle, type ZoomValue } from './readerStore';
import { goBack, goForward, recordJump } from './history';
import { linkHistory } from './historyAdapter';
import { usePageColor } from './usePageColor';
import { usePinchZoom } from './usePinchZoom';
import { useReaderScope, useReaderShown } from '../readerScope';
import { fitScale, tallestHeight, widestPage, type FitLayout, type FitMode } from './fit';
import { roomAfterJump } from './placement';
import { spreadStep } from './spread';
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
export function PdfDocumentView({ doc, revisionId, restored, onFailed, onScroller }: { doc: PDFDocumentProxy; revisionId: string; restored: boolean; onFailed(): void; onScroller?(node: HTMLElement | null): void }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** The scroller is known to the reader (its find bar's scroll bar watch) as it mounts and as it goes, so a view that attaches again is watched again. */
  const setScroller = useCallback(
    (node: HTMLDivElement | null) => {
      scrollRef.current = node;
      onScroller?.(node);
    },
    [onScroller],
  );
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
        const { EventBus, PDFFindController, PDFLinkService, PDFViewer, LinkTarget, ScrollMode, SpreadMode } = viewerLib;
        const SCROLL_OF: Record<ScrollModeName, number> = { vertical: ScrollMode.VERTICAL, horizontal: ScrollMode.HORIZONTAL, page: ScrollMode.PAGE };
        const SPREAD_OF: Record<SpreadModeName, number> = { none: SpreadMode.NONE, odd: SpreadMode.ODD, even: SpreadMode.EVEN };
        /** The modes the viewer is in (it can refuse a scroll mode, a document with too many pages), by name. */
        const scrollNow = (): ScrollModeName => (viewer.scrollMode === ScrollMode.HORIZONTAL ? 'horizontal' : viewer.scrollMode === ScrollMode.PAGE ? 'page' : 'vertical');
        const spreadNow = (): SpreadModeName => (viewer.spreadMode === SpreadMode.ODD ? 'odd' : viewer.spreadMode === SpreadMode.EVEN ? 'even' : 'none');
        /** The class goes with the mode in the same call: a jump right after the change must measure the new layout, which a rendered attribute would not give. */
        const markScroll = () => viewerEl.classList.toggle('scrollPage', viewer.scrollMode === ScrollMode.PAGE);
        const layoutNow = (): FitLayout => ({ flow: scrollNow(), columns: spreadNow() === 'none' ? 1 : 2 });
        /**
         * The stage as a text layer's notice found it, before any listener ran: pdf.js's late focus of a link's target (an internal
         * listener, run first) scrolls it, and a scroll made in the same task as the notice has no scroll event yet. Null outside
         * that notice and while the tab is hidden. The bus takes no new own property, so its dispatch is overridden in a subclass.
         */
        let stageAtLayer: { top: number; left: number } | null = null;
        const stageNow = () => ({ top: container.scrollTop, left: container.scrollLeft });
        class StageEventBus extends EventBus {
          override dispatch(name: string, data: object): void {
            if (name !== 'textlayerrendered') {
              super.dispatch(name, data);
              return;
            }
            stageAtLayer = shownRef.current ? stageNow() : null;
            try {
              super.dispatch(name, data);
            } finally {
              stageAtLayer = null;
            }
          }
        }
        const eventBus = new StageEventBus();
        const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
        // The controller searches the document's text whether or not the find bar is open; the bar only asks and shows.
        const findController = new PDFFindController({ linkService, eventBus, updateMatchesCountOnProgress: true });
        // pdf.js disconnects its own container observer and scroll listener when this aborts (the end of the view, in teardown).
        // The option is read by pdf_viewer.mjs 6.4.299 (BaseViewer) but missing from its typings, hence the spread.
        const lifetime = new AbortController();
        const viewer = new PDFViewer({
          ...{ abortSignal: lifetime.signal },
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
        /** The pages that failed once and were drawn again: a second failure is shown, a success makes the next failure a first one. */
        const redrawn = new Set<number>();
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
          const widest = widestPage(sizes, viewer.pagesRotation as Rotation);
          // A row of pages (and a page at a time) is fitted to the stage's height by its tallest page, so no taller page spills past the stage.
          return scrollNow() !== 'vertical' ? { width: widest.width, height: tallestHeight(sizes, viewer.pagesRotation as Rotation) } : widest;
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
          const scale = fitScale(mode, { width, height }, size, layoutNow());
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
        // The scroll offset of the shown stage, kept to put back: a box that was display: none starts at 0 when it is shown again.
        let scrolled = { top: 0, left: 0 };
        const jump = (args: Parameters<typeof scrollPageIntoView>[0], keepTop: boolean, keepLeft: boolean) => {
          scrollPageIntoView({ ...args, allowNegativeOffset: true });
          const div = viewer.getPageView(args.pageNumber - 1)?.div;
          const first = viewer.getPageView(0)?.div;
          if (!div || !first) return;
          const top = div.offsetTop + div.clientTop;
          const left = div.offsetLeft + div.clientLeft;
          const scroll = scrollNow();
          const flow = scroll === 'horizontal' ? 'horizontal' : 'vertical';
          const next = roomAfterJump({
            flow,
            page: { top, left, width: div.clientWidth, height: div.clientHeight },
            // A page at a time has one page in the tree, so none is the first row: each has 12 above it, as the fit leaves.
            firstRow: scroll !== 'page' && (flow === 'horizontal' ? Math.abs(left - (first.offsetLeft + first.clientLeft)) : Math.abs(top - (first.offsetTop + first.clientTop))) <= 1,
            stage: { scrollTop: container.scrollTop, scrollLeft: container.scrollLeft, width: container.clientWidth, height: container.clientHeight },
            keepTop,
            keepLeft,
          });
          if (next.scrollTop !== container.scrollTop) container.scrollTop = next.scrollTop;
          if (next.scrollLeft !== container.scrollLeft) container.scrollLeft = next.scrollLeft;
          jumped = { pageNumber: args.pageNumber, scrollTop: container.scrollTop, scrollLeft: container.scrollLeft };
          // The landing is where the stage is now, as place() leaves it: a text layer that arrives before this scroll is reported is no move away.
          if (shownRef.current) scrolled = { top: container.scrollTop, left: container.scrollLeft };
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
          // pdf.js records the place a zoom keeps (its location) only in the frame after its scroll event: a zoom before then kept the
          // place from before the move and took the reader back there (Mac run 42451371771: ↓ at 125 %, 100 %, ↓ stayed on page 2). The
          // location is taken now, as its update() would take it — and only the location: update() also makes the most visible page the
          // current one in a row or a spread, an earlier page at the document's end, where the stage cannot move, so the last page was
          // never reached.
          const { first } = viewer._getVisiblePages() as { first?: unknown };
          if (first) {
            viewer._updateLocation(first);
            // And reported now, as update() reports it a frame later: the reader's place is saved from that report, so a quit or a
            // closed tab in the frame after a turn kept the page from before it. Only the report: no current page is picked, as above.
            eventBus.dispatch('updateviewarea', { source: viewer, location: viewer._location });
          }
        };
        const place: PdfViewHandle['place'] = ({ pageNumber, destArray }) => {
          if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > viewer.pagesCount) return;
          // Any placed move (the chevrons, a page field, back and forward) leaves a pending link jump behind.
          leaveLink();
          viewer.scrollPageIntoView({ pageNumber, destArray: destArray ?? undefined });
          // What a late focus of an abandoned page goes back to: the stage as this move left it, not the last scroll event's.
          scrolled = { top: container.scrollTop, left: container.scrollLeft };
        };
        /**
         * The place the reader is at, read from the viewer now (a scroll's report can still be on its way). Back and forward
         * write it into the list before they leave it, and a jump writes it before it goes.
         */
        let reported: PdfPlace | null = null;
        eventBus.on('updateviewarea', (e: { location: { pageNumber: number; top: number; left: number } }) => {
          reported = { pageIndex: e.location.pageNumber - 1, top: e.location.top, left: e.location.left };
        });
        const hereNow = (): PdfPlace | null => {
          // Before the saved place is applied the viewer reports its own start (page 1): that is no place of the reader's.
          if (!scope.reader.getState().pdf?.placed) return null;
          viewer.update();
          return reported;
        };
        const recordHere = () => {
          const here = hereNow();
          if (here) store.setHistory(recordJump(scope.reader.getState().history, here));
        };
        /**
         * pdf.js focuses the target page's text layer once it is drawn (goToDestination's one-shot listener, an internal one that runs
         * before ours), and the browser scrolls the focused page into view. A reader who has already left that jump (back, forward,
         * another jump) must not be taken to it by a text layer that was slow: the page is remembered here, and when its layer arrives
         * the scroll goes back to where the stage was when the notice came, before that focus moved it (stageAtLayer).
         */
        let linkTarget: number | null = null;
        const abandoned = new Set<number>();
        const leaveLink = () => {
          if (linkTarget !== null) abandoned.add(linkTarget);
          linkTarget = null;
          jumped = null;
        };
        eventBus.on('textlayerrendered', (e: { pageNumber: number }) => {
          // The last scroll event can be older than the stage: a scroll set in the task this notice came in is reported next frame.
          const here = stageAtLayer ?? scrolled;
          if (linkTarget === e.pageNumber) {
            linkTarget = null;
            // A scroll of the reader's own since the jump (wheel, scroll bar, keys) leaves the link as a move of ours does.
            const landed = jumped?.pageNumber === e.pageNumber ? jumped : null;
            if (landed && (Math.abs(here.top - landed.scrollTop) > 2 || Math.abs(here.left - landed.scrollLeft) > 2)) {
              abandoned.add(e.pageNumber);
              jumped = null;
            }
          }
          if (!abandoned.delete(e.pageNumber) || !shownRef.current) return;
          container.scrollTop = here.top;
          container.scrollLeft = here.left;
        });
        const step = (direction: 'back' | 'forward') => {
          const here = hereNow();
          if (!here) return;
          leaveLink();
          const moved = (direction === 'back' ? goBack : goForward)(scope.reader.getState().history, here);
          if (!moved) return;
          store.setHistory(moved.history);
          const { pageIndex, top, left } = moved.target;
          // A point, so a place inside a page comes back exactly (placement.ts keeps what a link names).
          place({ pageNumber: pageIndex + 1, destArray: [null, { name: 'XYZ' }, left ?? 0, top ?? null, null] });
        };
        linkService.setHistory(
          linkHistory({
            jump: (pageNumber) => {
              leaveLink();
              linkTarget = pageNumber;
              recordHere();
            },
            back: () => step('back'),
            forward: () => step('forward'),
          }),
        );
        const stepPage = (direction: 'next' | 'previous') => {
          const target = spreadStep(viewer.currentPageNumber, viewer.pagesCount, spreadNow(), direction);
          if (target !== null) place({ pageNumber: target });
        };
        /**
         * Another scroll or spread mode. The spread goes first (a horizontal flow has none), then the flow; the page in view stays in
         * view with the room the mockup draws, and a fit is sized again for the new layout. No jump: nothing is recorded for back.
         */
        const setModes = (scroll: ScrollModeName, spread: SpreadModeName) => {
          const page = viewer.currentPageNumber;
          const zoom = scope.reader.getState().pdf?.zoom;
          leaveLink();
          viewer.spreadMode = SPREAD_OF[scroll === 'horizontal' ? 'none' : spread];
          viewer.scrollMode = SCROLL_OF[scroll];
          markScroll();
          store.setPdf({ scroll: scrollNow(), spread: spreadNow() });
          if (isFitMode(zoom)) fitTo(zoom);
          if (page >= 1 && page <= viewer.pagesCount) jump({ pageNumber: page }, false, false);
          viewer.update();
        };
        const handle: PdfViewHandle = {
          place,
          goToPage: (n) => place({ pageNumber: n }),
          jumpToPage: (n) => {
            if (!Number.isInteger(n) || n < 1 || n > viewer.pagesCount) return;
            // The page already shown is no jump: back would only lead to where the reader is.
            if (n !== viewer.currentPageNumber) {
              leaveLink();
              recordHere();
            }
            place({ pageNumber: n });
          },
          historyBack: () => step('back'),
          historyForward: () => step('forward'),
          // A spread turns two pages at a time, to the first page of the next one.
          next: () => stepPage('next'),
          previous: () => stepPage('previous'),
          setScroll: (mode) => setModes(mode, mode === 'horizontal' ? 'none' : spreadNow()),
          setSpread: (mode) => {
            if (scrollNow() !== 'horizontal') setModes(scrollNow(), mode);
          },
          setZoom: (z) => {
            if (typeof z === 'number') viewer.currentScale = z;
            else fitTo(z);
          },
          restore: (saved, pageIndex, at = 'saved') => {
            const zoom = saved?.zoom ?? 'auto';
            // The modes come first: the zoom is fitted to the layout and the place is a place of that layout.
            const scroll = saved?.scroll ?? 'vertical';
            viewer.spreadMode = SPREAD_OF[scroll === 'horizontal' ? 'none' : (saved?.spread ?? 'none')];
            viewer.scrollMode = SCROLL_OF[scroll];
            markScroll();
            // In the store before the viewer reports, so the saver's first baseline carries the modes.
            store.setPdf({ scroll: scrollNow(), spread: spreadNow() });
            viewer.pagesRotation = saved?.rotation ?? 0;
            if (typeof zoom === 'number') viewer.currentScale = zoom;
            // The fit follows the current page, which is page 1 until the scroll below (R-21: a mixed-size document is fitted to the page in view, as pdf.js does).
            else fitTo(zoom);
            // Not a link: a place at the top or left edge of a page gets the room the mockup draws there (placement.ts), and one inside
            // the margin, which a saved place can be, comes back exactly. A page asked for lands as place() lands it; the saved
            // point belongs to another page.
            if (at === 'page') jump({ pageNumber: pageIndex + 1 }, false, false);
            else jump({ pageNumber: pageIndex + 1, destArray: [null, { name: 'XYZ' }, saved?.left ?? 0, saved?.top ?? null, null] }, false, false);
            // Reports the place the viewer is at now, so the saver starts from it and saves only what the reader changes.
            viewer.update();
            store.setPdf({ placed: true, pageNumber: pageIndex + 1, scale: viewer.currentScale, zoom, rotation: viewer.pagesRotation as Rotation, scroll: scrollNow(), spread: spreadNow() });
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
          // A sideways flow keeps the page, not a share of its height: the page is put back flush with its room.
          if (scrollNow() === 'horizontal') {
            jump({ pageNumber: from?.pageNumber ?? e.pageNumber }, false, false);
            viewer.update();
            return;
          }
          const div = viewer.getPageView((from?.pageNumber ?? e.pageNumber) - 1)?.div;
          if (!div) return;
          container.scrollTop = div.offsetTop + div.clientTop + (from?.share ?? 0) * div.clientHeight + (from?.above ?? 0);
          viewer.update();
        });
        eventBus.on('pagerendered', (e: { pageNumber: number; source: { div: HTMLElement }; error?: unknown }) => {
          if (e.error) {
            console.warn(`[pdf] open/render failed: ${(e.error as Error)?.name ?? 'Error'}`);
            if (!redrawn.has(e.pageNumber)) {
              // Once more: the page is reset and the viewer draws it again while it is in view (or when it comes into view).
              redrawn.add(e.pageNumber);
              requestAnimationFrame(() => {
                if (cancelled) return;
                viewer.getPageView(e.pageNumber - 1)?.reset();
                viewer.update();
              });
              return;
            }
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
          redrawn.delete(e.pageNumber);
          if (failed.delete(e.pageNumber)) setPageDivs(new Map(failed));
          doneOnce.add(e.pageNumber);
          setRendered(doneOnce.size);
        });
        store.setPdf({ ...INITIAL_PDF, pagesCount: doc.numPages });
        store.setHandle(handle);
        // E2E only: a viewer that fails to start, to show the notice that stands in for it.
        if (readWindowParams(window.location.search).e2e && window.__learnFaults?.start) {
          window.__learnFaults.start -= 1;
          throw new Error('injected start fault');
        }
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
          void import('./drawFaults').then(({ default: installFaults }) => (cancelled ? undefined : installFaults(doc)));
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
          lifetime.abort();
          scope.find.getState().reset();
          store.setHandle(null);
          store.setPdf(null);
        };
      })
      .catch((e: unknown) => {
        // A start that threw before the teardown exists leaves no handle behind: whoever reads the store sees no viewer.
        if (!teardown && !cancelled) {
          store.setHandle(null);
          store.setPdf(null);
        }
        fail(e);
      });
    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [doc, revisionId]); // onFailed is a state setter of the reader

  return (
    <>
      <div ref={setScroller} className="pdf-scroll" data-testid="pdf-scroll" data-restored={restored ? '' : undefined}>
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
          data-scroll={pdf?.scroll ?? 'vertical'}
          data-spread={pdf?.spread ?? 'none'}
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
