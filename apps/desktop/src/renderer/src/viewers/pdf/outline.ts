import type { PDFDocumentProxy } from 'pdfjs-dist';

export type PdfOutlineNode = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>[number];

export interface OutlineRow {
  /** The path from the top: '0.2.1' is the second child's third child... of the first entry. */
  id: string;
  title: string;
  depth: number;
  dest: string | unknown[] | null;
  url: string | null;
  children: OutlineRow[];
}

/** An entry without a title is still an entry the reader can go to. */
const UNTITLED = '–';

export function outlineRows(nodes: readonly PdfOutlineNode[] | null, parent = '', depth = 0): OutlineRow[] {
  if (!nodes) return [];
  return nodes.map((node, i) => {
    const id = parent === '' ? String(i) : `${parent}.${i}`;
    const title = node.title.trim();
    return {
      id,
      title: title === '' ? UNTITLED : title,
      depth,
      dest: node.dest ?? null,
      url: node.url ?? null,
      children: outlineRows(node.items, id, depth + 1),
    };
  });
}

const fold = (s: string) => s.normalize('NFC').toLowerCase();

/** The rows whose title holds the query, with the ancestors that lead to them (PDF text may be NFD, a typed query NFC). */
export function filterOutline(rows: readonly OutlineRow[], query: string): OutlineRow[] {
  const needle = fold(query.trim());
  if (needle === '') return rows as OutlineRow[];
  const keep = (list: readonly OutlineRow[]): OutlineRow[] =>
    list.flatMap((row) => {
      const children = keep(row.children);
      return fold(row.title).includes(needle) || children.length > 0 ? [{ ...row, children }] : [];
    });
  return keep(rows);
}

/** Every row in reading order, children after their parent. */
export function flattenOutline(rows: readonly OutlineRow[]): OutlineRow[] {
  return rows.flatMap((row) => [row, ...flattenOutline(row.children)]);
}

/** The last entry, in reading order, that starts on or before the page: where the reader is in the outline. */
export function currentOutlineId(rows: readonly OutlineRow[], pages: ReadonlyMap<string, number>, page: number): string | null {
  let current: string | null = null;
  for (const row of flattenOutline(rows)) {
    const at = pages.get(row.id);
    if (at !== undefined && at <= page) current = row.id;
  }
  return current;
}

/** The page number (from 1) a destination points at, or null when it names none. */
async function pageOfDestination(doc: PDFDocumentProxy, dest: string | unknown[]): Promise<number | null> {
  const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
  const target = explicit?.[0];
  if (target === null || target === undefined) return null;
  if (typeof target === 'number') return target + 1;
  if (typeof target === 'object') return (await doc.getPageIndex(target as Parameters<PDFDocumentProxy['getPageIndex']>[0])) + 1;
  return null;
}

/** Entries asked at once: a long outline fills in a batch at a time instead of one answer after another. */
export const OUTLINE_BATCH = 32; /* local: entries per batch */

/**
 * The page of every entry that goes to one, asked a batch at a time. `onBatch` gets the pages found so far after each batch
 * (the numbers appear in order); `isCancelled` is asked before each batch and each entry: a document that is going away
 * rejects what is in flight, and nobody is left to read the answer.
 */
export async function outlinePages(
  doc: PDFDocumentProxy,
  rows: readonly OutlineRow[],
  isCancelled: () => boolean,
  onBatch?: (pages: ReadonlyMap<string, number>) => void,
): Promise<Map<string, number>> {
  const pages = new Map<string, number>();
  const all = flattenOutline(rows);
  for (let at = 0; at < all.length; at += OUTLINE_BATCH) {
    if (isCancelled()) break;
    const batch = all.slice(at, at + OUTLINE_BATCH);
    const found = await Promise.all(
      batch.map(async (row): Promise<number | null> => {
        if (row.dest === null) return null;
        try {
          return await pageOfDestination(doc, row.dest);
        } catch (e) {
          // An entry whose destination is broken just shows no page; a failure from the document closing is nobody's news.
          if (!isCancelled()) console.warn(`[pdf] outline entry skipped: ${(e as Error)?.name ?? 'Error'}`);
          return null;
        }
      }),
    );
    if (isCancelled()) break;
    batch.forEach((row, i) => {
      const page = found[i];
      if (page !== null && page !== undefined) pages.set(row.id, page);
    });
    onBatch?.(new Map(pages));
  }
  return pages;
}

/** After the user scrolls the outline themselves, the reader's page does not pull it back for this long. */
export const OUTLINE_FOLLOW_PAUSE_MS = 2000;

/** The scrollTop that shows row `index` of a virtual list by the least movement, or null when it is already in view. */
export function outlineScrollTarget(o: { index: number; rowHeight: number; scrollTop: number; viewport: number }): number | null {
  const top = o.index * o.rowHeight;
  const bottom = top + o.rowHeight;
  if (top < o.scrollTop) return top;
  if (bottom > o.scrollTop + o.viewport) return Math.max(0, bottom - o.viewport);
  return null;
}
