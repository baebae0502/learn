import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { RenderTask } from 'pdfjs-dist';
import { useVirtualizer } from '@tanstack/react-virtual';
import { t } from '../../strings';
import { createThumbnailCache, type ThumbnailCache } from './thumbnailCache';
import { useReader } from './readerStore';
import { usePageColor } from './usePageColor';

/** A thumbnail's width in px (the sidebar's 240 minus its gutters leaves room for it). */
const THUMB_WIDTH = 120; /* local: thumbnail width */
/** The page number under the thumbnail and the gap to the next one, in px (the row's height besides the page). */
const ROW_EXTRA = 38; /* local: 14 px label + 6 px gap + 12 px + the ring's room */
/** A page that is not known yet is drawn as the first page is, or as a letter page. */
const FALLBACK_RATIO = 1.294;
/** The pages around the current one that are drawn before the others on screen. */
const NEAR = 3;

/** The pages to draw, the nearest to the current page first: ±3 around it, then the rest of what is on screen. */
export function drawOrder(visible: readonly number[], current: number): number[] {
  const near = (n: number) => Math.abs(n - current) <= NEAR;
  return [...visible].sort((a, b) => Number(near(b)) - Number(near(a)) || Math.abs(a - current) - Math.abs(b - current));
}

/**
 * The pages as small pictures (spec 4.7), virtualised: only the rows in view exist, and only they are drawn, one at a time, the
 * ones around the current page first. A picture is kept as an ImageBitmap in a cache of 60; whatever leaves the cache or the
 * list is closed. The page is drawn by the same document the viewer reads, so every render is cancelled when the list or
 * the document goes.
 */
export function ThumbnailList() {
  const handle = useReader((s) => s.handle);
  const doc = handle?.document() ?? null;
  const total = useReader((s) => s.pdf?.pagesCount ?? 0);
  const current = useReader((s) => s.pdf?.pageNumber ?? 1);
  const { resolved: pageColor } = usePageColor();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [ratios, setRatios] = useState<ReadonlyMap<number, number>>(new Map());
  const [drawn, setDrawn] = useState(0);
  const cacheRef = useRef<ThumbnailCache | null>(null);
  const wantRef = useRef<number[]>([]);
  const wakeRef = useRef<(() => void) | null>(null);

  const ratioOf = (page: number) => ratios.get(page) ?? ratios.get(1) ?? FALLBACK_RATIO;
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => Math.round(ratioOf(i + 1) * THUMB_WIDTH) + ROW_EXTRA,
    overscan: 2,
  });
  const items = virtualizer.getVirtualItems();
  const visibleKey = items.map((i) => i.index + 1).join(',');

  // What to draw next: read by the drawing loop, which is woken when it changes.
  useEffect(() => {
    wantRef.current = drawOrder(visibleKey === '' ? [] : visibleKey.split(',').map(Number), current);
    wakeRef.current?.();
  }, [visibleKey, current]);

  // The row that is current comes into view when the page changes (the first time: the restored page).
  useLayoutEffect(() => {
    if (total > 0) virtualizer.scrollToIndex(current - 1, { align: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a page change scrolls the list
  }, [current, total]);

  useEffect(() => {
    if (!doc) return;
    const cache = createThumbnailCache();
    cacheRef.current = cache;
    let cancelled = false;
    let task: RenderTask | null = null;
    const failed = new Set<number>();
    setRatios(new Map());
    setDrawn(0);

    const draw = async (pageNumber: number) => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const natural = page.getViewport({ scale: 1 });
      setRatios((before) => (before.get(pageNumber) === natural.height / natural.width ? before : new Map(before).set(pageNumber, natural.height / natural.width)));
      const viewport = page.getViewport({ scale: (THUMB_WIDTH / natural.width) * window.devicePixelRatio });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      task = page.render({ canvas, viewport });
      await task.promise;
      task = null;
      if (cancelled) return;
      const bitmap = await createImageBitmap(canvas);
      if (cancelled) {
        bitmap.close();
        return;
      }
      cache.set(pageNumber, bitmap);
      setDrawn((n) => n + 1);
    };

    const run = async () => {
      while (!cancelled) {
        const next = wantRef.current.find((n) => !failed.has(n) && cache.get(n) === undefined);
        if (next === undefined) {
          await new Promise<void>((resolve) => {
            wakeRef.current = resolve;
          });
          continue;
        }
        try {
          await draw(next);
        } catch (e) {
          // A render cancelled or a page asked of a closing document is the list going away, not a failure to report.
          if (cancelled) return;
          failed.add(next);
          console.warn(`[pdf] thumbnail failed: ${(e as Error)?.name ?? 'Error'}`);
        }
      }
    };
    void run();

    return () => {
      cancelled = true;
      task?.cancel();
      wakeRef.current?.();
      wakeRef.current = null;
      cache.clear();
      cacheRef.current = null;
    };
  }, [doc]);

  const goTo = (page: number) => handle?.goToPage(page);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (e.key === 'ArrowDown') goTo(Math.min(total, current + 1));
    else if (e.key === 'ArrowUp') goTo(Math.max(1, current - 1));
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={scrollRef}
      className="nav-thumbs"
      role="listbox"
      tabIndex={0}
      aria-label={t.reader.thumbnailList}
      data-testid="pdf-thumbnails"
      data-page-color={pageColor}
      onKeyDown={onKeyDown}
    >
      <div className="nav-thumbs-inner" style={{ height: virtualizer.getTotalSize() }}>
        {items.map((row) => {
          const page = row.index + 1;
          return (
            <div
              key={row.key}
              ref={virtualizer.measureElement}
              data-index={row.index}
              role="option"
              aria-selected={page === current}
              aria-label={String(page)}
              className="nav-thumb"
              data-testid="pdf-thumb"
              data-page={page}
              data-current={page === current ? 'true' : undefined}
              style={{ transform: `translateY(${row.start}px)` }}
              onClick={() => goTo(page)}
            >
              <div className="nav-thumb-page" style={{ aspectRatio: `1 / ${ratioOf(page)}` }}>
                <ThumbnailCanvas page={page} cacheRef={cacheRef} drawn={drawn} />
              </div>
              <span className="lbl num">{page}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The picture of one page, copied out of the cache when it is there; an empty paper box until then. */
function ThumbnailCanvas({ page, cacheRef, drawn }: { page: number; cacheRef: { current: ThumbnailCache | null }; drawn: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [has, setHas] = useState(false);
  useLayoutEffect(() => {
    const el = canvas.current;
    // Read and drawn in one step: nothing can close the bitmap between the two.
    const bitmap = cacheRef.current?.get(page);
    if (!el || !bitmap) {
      setHas(false);
      return;
    }
    el.width = bitmap.width;
    el.height = bitmap.height;
    try {
      el.getContext('2d')?.drawImage(bitmap, 0, 0);
      setHas(true);
    } catch {
      // A canvas that gives no context leaves the paper box empty; one page's picture is not worth the reader.
      setHas(false);
    }
  }, [page, drawn, cacheRef]);
  return <canvas ref={canvas} className="nav-thumb-canvas" data-drawn={has ? '' : undefined} aria-hidden="true" />;
}
