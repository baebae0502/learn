import { useCallback, useRef, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { DRAG_THRESHOLD, dropSlot, edgeScroll, type HeaderCell } from '../library/columnDrag';
import { currentPlatform } from '../ui/platform';

const REORDERING = 'is-reordering';
const DRAGGING = 'is-dragging';

/**
 * Dragging a reader tab sideways in the strip's scrolling box (spec 3.5): the tab follows the pointer, its neighbours step aside
 * (the box's `is-reordering` class animates that move; reduced motion makes it instant), the library's tab is not in the box and so
 * cannot be passed, esc or a lost pointer cancels, and the click the release makes is swallowed. The boundary the pointer is
 * nearest to decides the place (columnDrag.ts, as the table's column drag does). The state is kept in the DOM while it runs: a
 * render per pointer move would cost more than it shows.
 */
export function useTabReorder(scroll: RefObject<HTMLElement | null>, move: (itemId: string, toIndex: number) => void) {
  const swallowClick = useRef(false);
  const abort = useRef<(() => void) | null>(null);
  const latest = useRef(move);
  latest.current = move;

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const box = scroll.current;
      const target = e.target as Element;
      const item = target.closest<HTMLElement>('.tab-item');
      if (e.button !== 0 || (e.ctrlKey && currentPlatform() === 'darwin') || !box || !item || !box.contains(item) || target.closest('.close')) return;
      abort.current?.();

      const items = [...box.querySelectorAll<HTMLElement>(':scope > .tab-item')];
      const from = items.indexOf(item);
      const id = item.querySelector<HTMLElement>('[role="tab"]')?.dataset['itemId'];
      if (from < 0 || id === undefined || items.length < 2) return;

      // Cells in the box's content coordinates, so a sideways scroll while dragging moves the pointer's place and not theirs.
      const start = box.getBoundingClientRect();
      const scroll0 = box.scrollLeft;
      const cells: HeaderCell[] = items.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left - start.left + scroll0, right: r.right - start.left + scroll0 };
      });
      const width = cells[from]!.right - cells[from]!.left;
      const gap = from + 1 < cells.length ? cells[from + 1]!.left - cells[from]!.right : from > 0 ? cells[from]!.left - cells[from - 1]!.right : 0;
      const pointerId = e.pointerId;
      const x0 = e.clientX;
      const y0 = e.clientY;
      let x = x0;
      let active = false;
      let cancelled = false;
      let to: number | null = null;
      let frame = 0;

      const clear = () => {
        box.classList.remove(REORDERING);
        for (const el of items) {
          el.classList.remove(DRAGGING);
          el.style.transform = '';
        }
      };
      const update = () => {
        const dx = x - x0 + (box.scrollLeft - scroll0);
        // The tab stays within the span of the reader tabs.
        const lo = cells[0]!.left - cells[from]!.left;
        const hi = cells[cells.length - 1]!.right - cells[from]!.right;
        item.style.transform = `translateX(${Math.min(hi, Math.max(lo, dx))}px)`;
        const hit = dropSlot(cells, 0, from, x - start.left + box.scrollLeft);
        const slot = hit === null ? from : hit.slot;
        to = hit === null ? null : slot > from ? slot - 1 : slot;
        items.forEach((el, i) => {
          if (i === from) return;
          const stepAside = slot > from + 1 && i > from && i < slot ? -(width + gap) : slot < from && i >= slot && i < from ? width + gap : 0;
          el.style.transform = stepAside === 0 ? '' : `translateX(${stepAside}px)`;
        });
      };
      const tick = () => {
        frame = requestAnimationFrame(tick);
        const box1 = box.getBoundingClientRect();
        const before = box.scrollLeft;
        box.scrollLeft = before + edgeScroll(x, box1.left, box1.right);
        if (box.scrollLeft !== before) update();
      };
      const onMove = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        x = ev.clientX;
        if (cancelled) return;
        if (!active) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_THRESHOLD) return;
          active = true;
          swallowClick.current = true;
          box.classList.add(REORDERING);
          item.classList.add(DRAGGING);
          frame = requestAnimationFrame(tick);
        }
        update();
      };
      const end = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('blur', onCancel);
        window.removeEventListener('keydown', onKey, true);
        cancelAnimationFrame(frame);
        abort.current = null;
        // The click the release makes comes in the same task: swallow it, then forget.
        if (active) setTimeout(() => (swallowClick.current = false), 0);
      };
      const onUp = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const drop = active && !cancelled ? to : null;
        end();
        clear();
        if (drop !== null) latest.current(id, drop);
      };
      const onCancel = () => {
        cancelled = true;
        end();
        clear();
      };
      // esc ends a drag that is running, and only then: it is the drag's, not a dialog's or the palette's.
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key !== 'Escape' || !active || cancelled) return;
        ev.preventDefault();
        ev.stopPropagation();
        onCancel();
      };
      abort.current = onCancel;
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      window.addEventListener('blur', onCancel);
      window.addEventListener('keydown', onKey, true);
    },
    [scroll],
  );

  const onClickCapture = useCallback((e: MouseEvent<HTMLElement>) => {
    if (!swallowClick.current) return;
    swallowClick.current = false;
    e.stopPropagation();
    e.preventDefault();
  }, []);

  return { onPointerDown, onClickCapture };
}
