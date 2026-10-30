import { useEffect, useRef } from 'react';
import type { LibraryItem } from '@learn/domain';
import { useLibrary } from '../state/library-store';
import { afterPaint } from '../ui/afterPaint';

/** One table per window. Its rows outside the viewport are not in the DOM: the virtualizer draws them on scroll. */
const GRID = '[data-testid="library-table"]';
const SCROLLER = '[data-testid="library-scroller"]';
const rowEl = (id: string) => document.querySelector<HTMLElement>(`${GRID} [data-testid="item-row"][data-item-id="${CSS.escape(id)}"]`);

/** What scrolls the rows: the table's scroller, below the header row (which sits outside it and only follows it sideways). */
export function tableScroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>(SCROLLER);
}

/** The scrollTop that puts row `index` in the middle of a `viewport`-tall view (never above the top). */
export function centredScrollTop(index: number, rowHeight: number, viewport: number): number {
  return Math.max(0, Math.round(index * rowHeight - (viewport - rowHeight) / 2));
}

/** Whole inside the scroller's view (the column header is above it). */
function fullyShown(row: HTMLElement, scroller: HTMLElement): boolean {
  const r = row.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  return r.top >= view.top && r.bottom <= view.bottom;
}

/**
 * Brings row `index` (`id`) fully into view, centred, unless it already is. A row that is not drawn yet is first
 * scrolled near its place (rows have one height), so the virtualizer draws it; the next painted frame centres it exactly.
 */
export function revealRow(index: number, id: string): void {
  const scroller = tableScroller();
  if (!scroller) return;
  const shown = rowEl(id);
  if (shown && fullyShown(shown, scroller)) return;
  if (!shown) {
    const height = scroller.querySelector<HTMLElement>('[data-testid="item-row"]')?.getBoundingClientRect().height ?? 28;
    scroller.scrollTop = centredScrollTop(index, height, scroller.clientHeight);
  }
  afterPaint(() => {
    const row = rowEl(id);
    if (!row) return;
    // A row wider than the table (a narrow window with the item panel) would have its left edge pulled into view by
    // scrollIntoView's horizontal alignment, shifting every column: only the vertical position is for us to change.
    const left = scroller.scrollLeft;
    row.scrollIntoView({ block: 'center' });
    scroller.scrollLeft = left;
  });
}

/**
 * Once per mount (the table mounts again on the return from the reader): shows `revealId`'s row after a painted frame,
 * when the virtualizer has measured its viewport. Marked done only when it ran: StrictMode's second mount cancels the
 * first mount's pending frame.
 */
export function useRevealRow(rows: readonly LibraryItem[], revealId: string | null | undefined): void {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !revealId) return;
    const index = rows.findIndex((r) => r.id === revealId);
    if (index < 0) {
      done.current = true;
      return;
    }
    return afterPaint(() => {
      done.current = true;
      revealRow(index, revealId);
    });
  }, [rows, revealId]);
}

const firstRow = () => document.querySelector<HTMLElement>(`${GRID} [data-testid="item-row"][data-index="0"]`);

/**
 * Quick search's ↓ (spec 4.1): the first result takes the keyboard focus, selected alone, as an arrow key selects in
 * the table. A table scrolled down has no first row drawn: it scrolls to the top and focuses the row once drawn.
 */
export function focusFirstRow(): void {
  const focus = () => {
    const row = firstRow();
    const id = row?.dataset['itemId'];
    if (!row || !id) return;
    useLibrary.getState().setSelected([id]);
    row.focus();
  };
  if (firstRow()) return focus();
  const scroller = tableScroller();
  if (scroller) scroller.scrollTop = 0;
  afterPaint(focus);
}
