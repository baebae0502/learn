/** A page's place in the stage's scroll box (its offset plus its client border), in CSS px. */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}
export interface StageBox {
  scrollTop: number;
  scrollLeft: number;
  width: number;
  height: number;
}
/** The 'page' scroll mode flows like the vertical one. */
export type Flow = 'vertical' | 'horizontal';

/** The room the mockup draws: before the first row, between rows, and beside a page the stage scrolls sideways over. */
export const ROOM = { first: 24, between: 12, side: 24 } as const;

/** pdf.js lands a page flush at the stage's edge; a place within this of the edge counts as flush. */
const FLUSH = 1;

/**
 * Where the stage scrolls once pdf.js has put a page flush at its edge: the room before the page is added only to a place
 * that landed flush, so a point inside the page (a link's XYZ with a top or left) stays where the link says.
 * The first axis follows the flow; the other axis gets the side room only when the page is larger than the stage there.
 */
export function roomAfterJump(o: { flow: Flow; page: Box; firstRow: boolean; stage: StageBox; keepTop: boolean; keepLeft: boolean }): { scrollTop: number; scrollLeft: number } {
  const { page, stage } = o;
  let { scrollTop, scrollLeft } = stage;
  const before = o.firstRow ? ROOM.first : ROOM.between;
  const flushTop = Math.abs(stage.scrollTop - page.top) <= FLUSH;
  const flushLeft = Math.abs(stage.scrollLeft - page.left) <= FLUSH;
  if (o.flow === 'vertical') {
    if (!o.keepTop && flushTop) scrollTop = Math.max(0, page.top - before);
    if (!o.keepLeft && page.width > stage.width && flushLeft) scrollLeft = Math.max(0, page.left - ROOM.side);
  } else {
    if (!o.keepLeft && flushLeft) scrollLeft = Math.max(0, page.left - before);
    if (!o.keepTop && page.height > stage.height && flushTop) scrollTop = Math.max(0, page.top - ROOM.side);
  }
  return { scrollTop, scrollLeft };
}
