import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileX } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { t } from '../../strings';
import { Icon } from '../../ui/Icon';
import { pdfViewerModule, pdfjs } from '../pdfjs';
import { readWindowParams } from '../../ui/platform';
import { installAnchorProbe } from './anchorProbe';
import { watchDevicePixelRatio } from './displayChange';
import { INITIAL_PDF, useReader, type PdfViewHandle, type ZoomValue } from './readerStore';
import { usePageColor } from './usePageColor';
import { usePinchZoom } from './usePinchZoom';
import { nextZoom } from './zoom';

type Rotation = 0 | 90 | 180 | 270;
const PRESETS: readonly string[] = ['auto', 'page-width', 'page-fit'];

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
        const { EventBus, PDFLinkService, PDFViewer, LinkTarget } = viewerLib;
        const eventBus = new EventBus();
        const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
        const viewer = new PDFViewer({
          container,
          viewer: viewerEl,
          eventBus,
          linkService,
          textLayerMode: 1,
          annotationMode: lib.AnnotationMode.ENABLE,
          removePageBorders: true,
        });
        linkService.setViewer(viewer);
        const doneOnce = new Set<number>();
        /** One host element per page that failed: pdf.js empties a page's div when it redraws it, so React renders into a host it can still find. */
        const failed = new Map<number, HTMLElement>();
        const handle: PdfViewHandle = {
          goToPage: (n) => {
            if (Number.isInteger(n) && n >= 1 && n <= viewer.pagesCount) viewer.currentPageNumber = n;
          },
          next: () => void viewer.nextPage(),
          previous: () => void viewer.previousPage(),
          setZoom: (z) => {
            if (typeof z === 'number') viewer.currentScale = z;
            else viewer.currentScaleValue = z;
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
          viewer.currentScaleValue = 'auto';
          store.setPdf({ ready: true, pagesCount: viewer.pagesCount, pageNumber: viewer.currentPageNumber, scale: viewer.currentScale, zoom: 'auto', rotation: viewer.pagesRotation as Rotation });
        });
        eventBus.on('pagechanging', (e: { pageNumber: number }) => store.setPdf({ pageNumber: e.pageNumber }));
        eventBus.on('scalechanging', (e: { scale: number; presetValue?: string }) => store.setPdf({ scale: e.scale, zoom: zoomOf(e.presetValue, e.scale) }));
        eventBus.on('rotationchanging', (e: { pagesRotation: number }) => store.setPdf({ rotation: e.pagesRotation as Rotation }));
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
        teardown = () => {
          removeProbe?.();
          stopWatchingDisplay();
          viewer.setDocument(null);
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
