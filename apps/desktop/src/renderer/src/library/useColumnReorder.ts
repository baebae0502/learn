import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { ColumnConfig, LibraryColumnId, LibraryColumnSpec } from '@learn/domain';
import { currentPlatform } from '../ui/platform';
import { DRAG_THRESHOLD, dropSlot, edgeScroll, type HeaderCell } from './columnDrag';
import { moveColumn, pinnedCount } from './columns';

/** A header drag in progress: the cell being dragged, where its insertion line stands, and its ghost's width. */
export interface ColumnDrag {
  id: LibraryColumnId;
  /** px from the header row's left edge; null while the column would land where it is. */
  lineX: number | null;
  /** The dragged cell's width, which its ghost keeps (`ghostRef` carries the ghost under the pointer). */
  width: number;
}

interface Options {
  head: RefObject<HTMLElement | null>;
  clip: RefObject<HTMLElement | null>;
  scroller: RefObject<HTMLElement | null>;
  visible: readonly LibraryColumnSpec[];
  forced: readonly LibraryColumnId[];
  columns: ColumnConfig;
  onColumnsChange(next: ColumnConfig): void;
}

/**
 * Reorders the columns by dragging a header cell (M5 spec 5.1; one element's own pointer drag, not HTML5 drag and drop).
 * The press is watched on `window`, not captured: a captured pointer would send the release (and the click) to the
 * header row instead of the sort button, and a press that does not move 4 px must still sort. Past the threshold the
 * cell is marked, its ghost follows the pointer sideways, a line shows the boundary nearest the pointer (never before the
 * title or a forced column), the table scrolls sideways near either edge, esc ends the drag without a save, and the
 * release saves the new order.
 */
export function useColumnReorder(options: Options): {
  drag: ColumnDrag | null;
  onPointerDown(e: ReactPointerEvent<HTMLElement>): void;
  onClickCapture(e: MouseEvent<HTMLElement>): void;
  /** The ghost's element: its left edge is set here, at every move, without a render of the table. */
  ghostRef(el: HTMLElement | null): void;
} {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const [drag, setDrag] = useState<ColumnDrag | null>(null);
  const swallowClick = useRef(false);
  const abort = useRef<(() => void) | null>(null);
  useEffect(() => () => abort.current?.(), []);
  const ghost = useRef<HTMLElement | null>(null);
  /** Puts the ghost under the pointer; set while a drag runs. */
  const placeGhost = useRef<(() => void) | null>(null);
  const ghostRef = useCallback((el: HTMLElement | null) => {
    ghost.current = el;
    placeGhost.current?.(); // where the pointer is now, before the ghost is first painted
  }, []);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || (e.ctrlKey && currentPlatform() === 'darwin')) return; // ⌃-click is the context menu on macOS
    if (!(e.target instanceof Element) || e.target.closest('[role="separator"]')) return; // a column edge has its own drag
    const cell = e.target.closest<HTMLElement>('[role="columnheader"]');
    const id = cell?.dataset['col'] as LibraryColumnId | undefined;
    const ids = latest.current.visible.map((c) => c.id);
    const pinned = pinnedCount(ids, latest.current.forced);
    const from = id === undefined ? -1 : ids.indexOf(id);
    if (id === undefined || from < pinned || !cell) return; // the title and the forced columns stay
    abort.current?.();

    const pointerId = e.pointerId;
    const origin = { x: e.clientX, y: e.clientY };
    const pressed = cell.getBoundingClientRect();
    const grab = e.clientX - pressed.left; // the ghost keeps the cell's place under the pointer
    const width = pressed.width;
    let x = e.clientX;
    let active = false;
    let cancelled = false;
    let slot: number | null = null;
    let line: number | null | undefined; // the last value given to React
    let frame = 0;

    // Sideways only, from the pinned columns' right edge to the visible strip's: the header's own coordinates, so a sideways
    // scroll of the table moves it with the cells. The header row is wider than the strip when the columns overflow, and the
    // strip clips it, so the right bound is where the strip ends, not the row.
    const place = () => {
      const head = latest.current.head.current;
      const el = ghost.current;
      if (!head || !el) return;
      const strip = latest.current.clip.current;
      const box = head.getBoundingClientRect();
      const right = strip ? Math.min(box.width, strip.scrollLeft + strip.clientWidth) : box.width;
      const lead = head.querySelectorAll<HTMLElement>('[role="columnheader"]')[pinned - 1]?.getBoundingClientRect().right ?? box.left;
      el.style.left = `${Math.max(lead - box.left, Math.min(x - grab - box.left, right - width))}px`;
    };
    const update = () => {
      const head = latest.current.head.current;
      if (!head) return;
      const cells: HeaderCell[] = [...head.querySelectorAll<HTMLElement>('[role="columnheader"]')].map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right };
      });
      const hit = dropSlot(cells, pinned, from, x);
      slot = hit === null ? null : hit.slot;
      const box = head.getBoundingClientRect();
      const next = hit === null ? null : Math.min(Math.max(hit.at - box.left, 1), box.width - 1);
      if (next !== line) {
        line = next;
        setDrag({ id, lineX: next, width });
      }
      place();
    };
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const { clip, scroller } = latest.current;
      const view = scroller.current;
      const strip = clip.current;
      if (!view || !strip) return;
      const box = strip.getBoundingClientRect();
      const before = view.scrollLeft;
      view.scrollLeft = before + edgeScroll(x, box.left, box.right);
      if (view.scrollLeft === before) return;
      strip.scrollLeft = view.scrollLeft; // the header follows at once, so the boundaries measured next are the painted ones
      update();
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      x = ev.clientX;
      if (cancelled) return;
      if (!active) {
        if (Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) < DRAG_THRESHOLD) return;
        active = true;
        swallowClick.current = true;
        placeGhost.current = place;
        frame = requestAnimationFrame(tick);
      }
      update();
    };
    const end = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onAbort);
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(frame);
      placeGhost.current = null;
      setDrag(null);
      abort.current = null;
      // The click the release makes (if it lands on the same button) comes in the same task: swallow it, then forget.
      if (active) {
        setTimeout(() => {
          swallowClick.current = false;
        }, 0);
      }
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const to = active && !cancelled ? slot : null;
      end();
      if (to === null) return;
      const { columns, forced, onColumnsChange } = latest.current;
      onColumnsChange(moveColumn(columns, forced, id, to));
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cancelled = true;
      end();
    };
    const onAbort = () => {
      cancelled = true;
      end();
    };
    // esc ends a drag that is running, and only then: it is the drag's, not the table's (which clears the selection).
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !active || cancelled) return;
      ev.preventDefault();
      ev.stopPropagation();
      cancelled = true;
      cancelAnimationFrame(frame);
      placeGhost.current = null;
      line = undefined;
      setDrag(null);
    };
    abort.current = onAbort;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onAbort);
    window.addEventListener('keydown', onKey, true);
  }, []);

  const onClickCapture = useCallback((e: MouseEvent<HTMLElement>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  }, []);

  return { drag, onPointerDown, onClickCapture, ghostRef };
}
