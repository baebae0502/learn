import type { SpreadModeName } from '@learn/domain';

/**
 * The first page of the spread a page is in. pdf.js pairs 1·2, 3·4 … for odd spreads, and leaves page 1 alone and pairs 2·3,
 * 4·5 … for even ones (it builds them from the page index, pdf_viewer's _updateSpreadMode).
 */
export function spreadStart(page: number, mode: SpreadModeName): number {
  if (mode === 'none') return page;
  if (mode === 'odd') return page % 2 === 1 ? page : page - 1;
  return page === 1 ? 1 : page % 2 === 0 ? page : page - 1;
}

/** The page a next / previous step goes to (the first page of the neighbour spread), or null past either end. */
export function spreadStep(page: number, total: number, mode: SpreadModeName, direction: 'next' | 'previous'): number | null {
  const start = spreadStart(page, mode);
  if (direction === 'next') {
    const end = mode === 'none' ? start : start === 1 && mode === 'even' ? 1 : start + 1;
    return end + 1 <= total ? end + 1 : null;
  }
  if (start <= 1) return null;
  return spreadStart(start - 1, mode);
}
