/** How far a press must move before it is a drag, not a click (px): a trackpad press wobbles 1–3 px; Windows' own threshold is 4. */
export const DRAG_THRESHOLD = 4;
/** The band inside each edge of the visible header where a drag scrolls the table sideways (px), and its fastest step per frame. */
export const EDGE_BAND = 32;
export const EDGE_SPEED = 16;

/** A header cell's left and right edge in page pixels. */
export interface HeaderCell {
  left: number;
  right: number;
}

/**
 * The boundary a dragged header would take for a pointer at `x`: boundary `s` lies before cell `s` (the last one after
 * the last cell). The nearest one wins (the earlier on a tie); boundaries before the first `pinned` cells are not
 * offered. Null where the column would land where it is: before itself or right after itself. `at` is the boundary's x.
 */
export function dropSlot(cells: readonly HeaderCell[], pinned: number, from: number, x: number): { slot: number; at: number } | null {
  let best: { slot: number; at: number } | null = null;
  for (let slot = pinned; slot <= cells.length; slot++) {
    const at = slot < cells.length ? cells[slot]!.left : cells[cells.length - 1]!.right;
    if (best === null || Math.abs(x - at) < Math.abs(x - best.at)) best = { slot, at };
  }
  return best === null || best.slot === from || best.slot === from + 1 ? null : best;
}

/** The sideways step for a pointer at `x` over a header spanning [left, right]: negative toward the left edge, 0 in the middle. */
export function edgeScroll(x: number, left: number, right: number): number {
  if (x < left + EDGE_BAND) return -Math.ceil(EDGE_SPEED * Math.min(1, (left + EDGE_BAND - x) / EDGE_BAND));
  if (x > right - EDGE_BAND) return Math.ceil(EDGE_SPEED * Math.min(1, (x - (right - EDGE_BAND)) / EDGE_BAND));
  return 0;
}

/** The pixels a wheel over the header moves the table by: ⇧ + wheel is a sideways step; lines (mode 1) are 16 px, pages (mode 2) the view's. */
export function wheelSteps(e: { deltaX: number; deltaY: number; deltaMode: number; shiftKey: boolean }, view: { width: number; height: number }): { x: number; y: number } {
  const swapped = e.shiftKey && e.deltaX === 0;
  const unit = (page: number) => (e.deltaMode === 2 ? page : e.deltaMode === 1 ? 16 : 1);
  const x = swapped ? e.deltaY : e.deltaX;
  const y = swapped ? 0 : e.deltaY;
  return { x: x * unit(view.width), y: y * unit(view.height) };
}
