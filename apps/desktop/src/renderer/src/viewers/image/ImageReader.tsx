import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { assetUrl, type LibraryItem } from '@learn/domain';
import { api, ApiError, unwrap } from '../../api';
import { t } from '../../strings';
import { lastInput } from '../../ui/inputModality';
import { INITIAL_IMAGE, type ImageViewHandle } from '../pdf/readerStore';
import { ImageErrorNotice } from '../ReaderNotices';
import { useReaderScope, useReaderShown } from '../readerScope';
import { usePosition, type LatestPosition } from '../usePosition';
import {
  clampImageZoom, fitScale, imageLayout, imagePinchFactor, nextImageZoom, pointAt, rotatedSize, scrollFor, type ImageZoom, type Point, type Rotation, type Size,
} from './imageFit';
import { DEFAULT_IMAGE_VIEW, imageLocator, imageViewFrom, type ImageView } from './imageView';
import { ImageToolbar } from './ImageToolbar';

/** Saved 300 ms after the last change, as the PDF's page. */
const POSITION_SAVE = { kind: 'debounce', ms: 300 } as const;

/** What is drawn. `rev` lets a placement that changes none of the three still put the picture where its anchor says. */
interface Placement {
  zoom: ImageZoom;
  scale: number;
  rotation: Rotation;
  rev: number;
}
/** Where a placement puts the picture: its point `p` (upright picture, 0–1) at stage point `at`, the stage's centre when null. */
interface Anchor {
  p: Point;
  at: Point | null;
}

const centreOf = (size: Size): Point => ({ x: size.width / 2, y: size.height / 2 });

const logFailure = (what: string, e: unknown) => console.warn(`${what} failed`, e instanceof ApiError ? e.code : 'UNKNOWN');

/**
 * The image reader (spec 4.1–4.4): the 44 px toolbar over a stage that is an ordinary scroll area. The picture is decoded first and
 * shown only once the saved zoom, centre and turn are applied; fit and width follow the stage's size, a number stays. A picture that
 * cannot be decoded is a final state: the notice alone.
 */
export function ImageReader({ item }: { item: LibraryItem }) {
  const scope = useReaderScope();
  const shown = useReaderShown();
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  /** The last place reported, for the save that the unmount flushes. */
  const latest = useRef<LatestPosition | null>(null);
  const pos = usePosition(item, POSITION_SAVE, () => latest.current);
  const [natural, setNatural] = useState<Size | null>(null);
  const naturalRef = useRef(natural);
  naturalRef.current = natural;
  const [failed, setFailed] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const placementRef = useRef(placement);
  placementRef.current = placement;
  /** A placement asked for and not yet drawn: the next step starts from it, not from what the stage still shows. */
  const pending = useRef<{ placement: Omit<Placement, 'rev'>; anchor: Anchor } | null>(null);
  /** A fit is made once more when its own scroll bar changed the room (or took it away); once, so it cannot go round. */
  const refitted = useRef(false);
  /** The view as last placed or scrolled: what is saved, and where a hidden tab comes back to. */
  const view = useRef<ImageView>({ ...DEFAULT_IMAGE_VIEW });
  /** The scroll a placement set: its scroll event is no move of the reader's. */
  const placedScroll = useRef<Point | null>(null);
  const restored = useRef(false);
  const progressSent = useRef(false);
  const [pannable, setPannable] = useState(false);
  const pannableRef = useRef(pannable);
  pannableRef.current = pannable;
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);

  const stageSize = (): Size => {
    const el = stageRef.current;
    return el ? { width: el.clientWidth, height: el.clientHeight } : { width: 0, height: 0 };
  };
  const scaleFor = (nat: Size, zoom: ImageZoom, rotation: Rotation, size: Size): number => (typeof zoom === 'number' ? clampImageZoom(zoom) : fitScale(nat, rotation, size, zoom));

  /** Asks for a placement: drawn in the next commit, where its anchor's scroll is set before the frame is painted. */
  const place = (zoom: ImageZoom, rotation: Rotation, anchor: Anchor) => {
    const nat = naturalRef.current;
    if (!nat) return;
    const scale = scaleFor(nat, zoom, rotation, stageSize());
    pending.current = { placement: { zoom, scale, rotation }, anchor };
    refitted.current = false;
    setPlacement((prev) => ({ zoom, scale, rotation, rev: (prev?.rev ?? 0) + 1 }));
  };

  /** What is drawn now, or what is about to be: the base of the next step. */
  const current = (): { zoom: ImageZoom; scale: number; rotation: Rotation } | null => pending.current?.placement ?? placementRef.current;

  /** The point of the picture at stage point `at` (the centre when null), as the stage shows it now. */
  const pointUnder = (at: Point | null): Point => {
    const el = stageRef.current;
    const nat = naturalRef.current;
    const p = placementRef.current;
    if (!el || !nat || !p) return { x: view.current.cx, y: view.current.cy };
    const size = stageSize();
    return pointAt(imageLayout(nat, p.rotation, size, p.scale), p.rotation, { x: el.scrollLeft, y: el.scrollTop }, at ?? centreOf(size));
  };

  /**
   * A new zoom or turn that keeps the picture point at `at` (the stage's centre when null) where it is. A step asked for before the last
   * one is drawn keeps that one's anchor: the stage does not show it yet.
   */
  const zoomAbout = (zoom: ImageZoom, rotation: Rotation, at: Point | null) => {
    if (!restored.current) return;
    place(zoom, rotation, pending.current?.anchor ?? { p: pointUnder(at), at });
  };

  const record = () => {
    if (!restored.current) return;
    const locator = imageLocator(view.current);
    latest.current = { locator, progress: null };
    pos.update(locator, null);
  };

  const handle = useRef<ImageViewHandle>({
    zoomIn: () => act.current.step(1),
    zoomOut: () => act.current.step(-1),
    setZoom: (z) => act.current.setZoom(z),
    rotate: (delta) => act.current.rotate(delta),
  });
  const act = useRef({ step: (_dir: 1 | -1) => {}, setZoom: (_z: ImageZoom) => {}, rotate: (_d: 90 | -90) => {}, pinch: (_e: WheelEvent) => {}, refit: () => {} });
  act.current = {
    step: (dir) => {
      const c = current();
      if (c) zoomAbout(nextImageZoom(c.scale, dir), c.rotation, null);
    },
    setZoom: (z) => {
      const c = current();
      if (c) zoomAbout(typeof z === 'number' ? clampImageZoom(z) : z, c.rotation, null);
    },
    rotate: (delta) => {
      const c = current();
      if (c) zoomAbout(c.zoom, (((c.rotation + delta) % 360) + 360) % 360 as Rotation, null);
    },
    pinch: (e) => {
      const c = current();
      const el = stageRef.current;
      if (!c || !el || !restored.current) return;
      const factor = imagePinchFactor(c.scale, e.deltaY);
      if (factor === null) return;
      const box = el.getBoundingClientRect();
      zoomAbout(clampImageZoom(c.scale * factor), c.rotation, { x: e.clientX - box.left, y: e.clientY - box.top });
    },
    // The stage changed size: a fit is made again, a number stays; either way the centre is kept.
    refit: () => {
      const c = current();
      if (!c || !restored.current || !shownRef.current) return;
      place(c.zoom, c.rotation, pending.current?.anchor ?? { p: { x: view.current.cx, y: view.current.cy }, at: null });
    },
  };

  // The store says what the toolbar and the commands see; it goes with the reader.
  useEffect(() => {
    scope.reader.getState().setImage({ ...INITIAL_IMAGE });
    return () => {
      const store = scope.reader.getState();
      store.setImageHandle(null);
      store.setImage(null);
      scope.imageCentre.current = null;
    };
  }, [scope]);

  // Decoded before it is placed: the size Chromium draws (its EXIF orientation applied) is the one laid out. One it cannot decode is a final state.
  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    let cancelled = false;
    img.decode().then(
      () => {
        if (cancelled) return;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) setNatural({ width: img.naturalWidth, height: img.naturalHeight });
        else setFailed(true);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [item.assetId]);
  useEffect(() => {
    if (natural) scope.reader.getState().setImage({ natural });
  }, [natural, scope]);
  useEffect(() => {
    if (!failed) return;
    scope.reader.getState().setImageHandle(null);
    scope.reader.getState().setImage({ status: 'error' });
  }, [failed, scope]);

  // Opened with the screen, the stage takes the keys (scrolling, ⌘+): the row that opened it is in a panel that just hid. A tab chosen in
  // the strip by keyboard keeps the focus there, as a kept reader shown again does.
  useLayoutEffect(() => {
    if (!shownRef.current) return;
    const onTab = document.activeElement instanceof Element && document.activeElement.closest('.tab-bar') !== null;
    if (onTab && lastInput() === 'keyboard') return;
    stageRef.current?.focus({ preventScroll: true });
  }, []);

  // The saved place, once the picture is decoded, the place is known and the tab is shown (a hidden stage measures nothing).
  useLayoutEffect(() => {
    if (restored.current || pending.current || failed || !natural || !pos.loaded || !shown) return;
    const v = imageViewFrom(pos.saved?.locator);
    view.current = v;
    place(v.zoom, v.rotation, { p: v.zoom === 'fit' ? { x: 0.5, y: 0.5 } : { x: v.cx, y: v.cy }, at: null });
  }, [natural, pos.loaded, pos.saved, shown, failed]);

  // A placement drawn: the scroll its anchor asks for, set before the frame is painted; then the view it leaves is reported and saved.
  useLayoutEffect(() => {
    const el = stageRef.current;
    const nat = naturalRef.current;
    const ask = pending.current;
    if (!placement || !el || !nat || !ask || !shownRef.current) return;
    const size = stageSize();
    if (typeof placement.zoom !== 'number' && !refitted.current) {
      const again = fitScale(nat, placement.rotation, size, placement.zoom);
      if (Math.abs(again - placement.scale) > 1e-9) {
        refitted.current = true;
        pending.current = { placement: { ...ask.placement, scale: again }, anchor: ask.anchor };
        setPlacement({ ...placement, scale: again, rev: placement.rev + 1 });
        return;
      }
    }
    pending.current = null;
    const at = ask.anchor.at ?? centreOf(size);
    const layout = imageLayout(nat, placement.rotation, size, placement.scale);
    const target = scrollFor(layout, placement.rotation, size, ask.anchor.p, at);
    el.scrollLeft = target.x;
    el.scrollTop = target.y;
    const applied = { x: el.scrollLeft, y: el.scrollTop };
    placedScroll.current = applied;
    // Where the anchor landed as asked (a scroll is in whole pixels), its own point is the centre; a clamped one leaves another.
    const landed = ask.anchor.at === null && Math.abs(applied.x - target.x) < 1 && Math.abs(applied.y - target.y) < 1;
    const centre = landed ? ask.anchor.p : pointAt(layout, placement.rotation, applied, centreOf(size));
    view.current = { zoom: placement.zoom, rotation: placement.rotation, cx: centre.x, cy: centre.y };
    scope.imageCentre.current = { cx: centre.x, cy: centre.y };
    setPannable(layout.content.width > size.width + 0.5 || layout.content.height > size.height + 0.5);
    const store = scope.reader.getState();
    store.setImage({ zoom: placement.zoom, scale: placement.scale, rotation: placement.rotation });
    if (!restored.current) {
      restored.current = true;
      const locator = imageLocator(view.current);
      pos.markRestored(locator);
      latest.current = { locator, progress: null };
      store.setImage({ status: 'shown' });
      store.setImageHandle(handle.current);
      // The first picture of each open marks the item read; the saver itself would skip a place equal to the one it starts from.
      if (!progressSent.current) {
        progressSent.current = true;
        unwrap(api().reader.savePosition({ itemId: item.id, revisionId: item.revisionId, locator, progress: 1 })).catch((e: unknown) => logFailure('reader.savePosition', e));
      }
    } else record();
  }, [placement]);

  // Shown again: a hidden stage lost its scroll, and the window may have changed meanwhile. Placed once from the view it kept: a fit to the
  // stage it has now, a number at its centre.
  const wasHidden = useRef(!shown);
  useLayoutEffect(() => {
    if (!shown) {
      wasHidden.current = true;
      return;
    }
    if (!wasHidden.current) return;
    wasHidden.current = false;
    const c = current();
    if (restored.current && c) place(c.zoom, c.rotation, { p: { x: view.current.cx, y: view.current.cy }, at: null });
  }, [shown]);

  // The stage's own size (the window, the sidebar): one placement per frame, only while shown. The border box, so a scroll bar a fit
  // brings or takes away is not a change of size.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let frame = 0;
    let lastWidth = -1;
    let lastHeight = -1;
    const observer = new ResizeObserver((entries) => {
      if (!shownRef.current) return;
      const box = entries[entries.length - 1]?.borderBoxSize?.[0];
      if (box && box.inlineSize === lastWidth && box.blockSize === lastHeight) return;
      if (box) {
        lastWidth = box.inlineSize;
        lastHeight = box.blockSize;
      }
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          act.current.refit();
        });
      }
    });
    observer.observe(el, { box: 'border-box' });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [failed]);

  // A pinch is a wheel with ctrl: the reader's zoom about the pointer, never the page's. Not passive, so it can be cancelled.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      act.current.pinch(e);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [failed]);

  if (failed) return <ImageErrorNotice item={item} />;

  const onScroll = () => {
    const el = stageRef.current;
    const nat = naturalRef.current;
    const p = placementRef.current;
    if (!el || !nat || !p || !restored.current || pending.current || !shownRef.current) return;
    const now = { x: el.scrollLeft, y: el.scrollTop };
    const set = placedScroll.current;
    if (set && Math.abs(set.x - now.x) < 1 && Math.abs(set.y - now.y) < 1) return;
    placedScroll.current = null;
    const size = stageSize();
    const c = pointAt(imageLayout(nat, p.rotation, size, p.scale), p.rotation, now, centreOf(size));
    view.current = { ...view.current, cx: c.x, cy: c.y };
    scope.imageCentre.current = { cx: c.x, cy: c.y };
    record();
  };

  // A drag moves a picture larger than the stage (the hand). The press itself still focuses the stage as a click does (a pointer's focus, so
  // no ring); the stage selects nothing and its picture does not drag. A press on a scroll bar is the bar's.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = stageRef.current;
    if (!el || e.button !== 0 || !pannableRef.current) return;
    const box = el.getBoundingClientRect();
    if (e.clientX - box.left >= el.clientWidth || e.clientY - box.top >= el.clientHeight) return;
    el.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    setPanning(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const el = stageRef.current;
    if (!d || !el || d.id !== e.pointerId) return;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    if (stageRef.current?.hasPointerCapture(e.pointerId)) stageRef.current.releasePointerCapture(e.pointerId);
    setPanning(false);
  };
  // The side buttons of a mouse would take the window back in the browser's own history.
  const onSideButton = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  };

  const box = placement && natural ? rotatedSize(natural, placement.rotation) : null;
  const canvas: CSSProperties | undefined =
    placement && box ? { width: `calc(${box.width * placement.scale}px + 2 * var(--space-24))`, height: `calc(${box.height * placement.scale}px + 2 * var(--space-24))` } : undefined;
  const picture: CSSProperties | undefined =
    placement && box && natural
      ? {
          width: natural.width * placement.scale,
          height: natural.height * placement.scale,
          transform: `translate(-50%, -50%) rotate(${placement.rotation}deg)`,
        }
      : undefined;
  return (
    <div className="reader image-reader">
      <ImageToolbar onEscape={() => stageRef.current?.focus()} />
      <div className="image-frame">
        <div
          ref={stageRef}
          className="image-stage"
          role="region"
          aria-label={t.reader.imageStage}
          aria-busy={placement === null || undefined}
          tabIndex={0}
          data-testid="image-stage"
          data-pannable={pannable ? '' : undefined}
          data-panning={panning ? '' : undefined}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onMouseDown={onSideButton}
          onMouseUp={onSideButton}
        >
          <div className="image-canvas" data-pending={placement === null ? '' : undefined} style={canvas}>
            <div className="image-box" style={box && placement ? { width: box.width * placement.scale, height: box.height * placement.scale } : undefined}>
              <img ref={imgRef} src={assetUrl(item.assetId)} alt={item.title} decoding="async" draggable={false} style={picture} onError={() => setFailed(true)} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
