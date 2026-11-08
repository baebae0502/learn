/** A page's vertical extent in the scroller's content (offsetTop to offsetTop + height). */
export interface PageSpan {
  number: number;
  top: number;
  bottom: number;
}

export interface ScrollBox {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** Sub-pixel layout: a page this close to the edge counts as in view. */
const SLACK = 1;

/**
 * The furthest page the reader has in view (spec 5: "가장 멀리 본 쪽"). pdf.js reports the page at the top of the stage as the
 * current one; with several pages on screen (a slide deck at 자동 맞춤, a portrait PDF at 70 %) the pages below it are seen too.
 * At the end of the scroll the last page is counted, whatever its height; elsewhere the last page that is wholly in view, or the
 * top page when none is (a page taller than the stage).
 */
export function furthestPageSeen(topPage: number, pagesCount: number, box: ScrollBox, visible: readonly PageSpan[], mode: 'scroll' | 'page' = 'scroll'): number {
  // A page at a time has nothing to scroll through when the page fits the stage: the end of the scroll is the end of the document
  // only when the last page is the one shown.
  const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - SLACK;
  if (pagesCount > 0 && atEnd && (mode === 'scroll' || visible.some((p) => p.number === pagesCount) || topPage === pagesCount)) return pagesCount;
  let furthest = topPage;
  for (const p of visible) {
    if (p.top >= box.scrollTop - SLACK && p.bottom <= box.scrollTop + box.clientHeight + SLACK && p.number > furthest) furthest = p.number;
  }
  return furthest;
}
