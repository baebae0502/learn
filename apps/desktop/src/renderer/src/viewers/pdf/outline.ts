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

/**
 * The page of every entry that goes to one. `isCancelled` is asked between entries: a document that is going away
 * rejects what is in flight, and nobody is left to read the answer.
 */
export async function outlinePages(doc: PDFDocumentProxy, rows: readonly OutlineRow[], isCancelled: () => boolean): Promise<Map<string, number>> {
  const pages = new Map<string, number>();
  for (const row of flattenOutline(rows)) {
    if (isCancelled()) break;
    if (row.dest === null) continue;
    try {
      const page = await pageOfDestination(doc, row.dest);
      if (page !== null) pages.set(row.id, page);
    } catch (e) {
      // An entry whose destination is broken just shows no page; a failure from the document closing is nobody's news.
      if (!isCancelled()) console.warn(`[pdf] outline entry skipped: ${(e as Error)?.name ?? 'Error'}`);
    }
  }
  return pages;
}
