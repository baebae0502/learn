import { bodyItemIds, bodyLikeChunks, bodyPages, type Db, type LibraryRepository } from '@learn/db';
import { LearnError, bodyQueryWords, hasBodyWords } from '@learn/domain';
import { mainStrings } from '../strings';

const cancelled = (): LearnError => new LearnError('CANCELLED', mainStrings.jobs.cancelled);

/**
 * The items with a page that holds every word of `query`. Without a body word (a single letter) nothing is searched. Words
 * of three letters go to the index in one statement; a query of two-letter words alone scans the page texts in chunks and
 * lets the process breathe between them, so a newer query can stop it.
 */
export async function searchBody(db: Db, query: string, signal: AbortSignal, chunk?: number): Promise<{ itemIds: string[]; searched: boolean }> {
  const words = bodyQueryWords(query);
  if (!hasBodyWords(words)) return { itemIds: [], searched: false };
  if (words.fts.length > 0) {
    const ids = bodyItemIds(db, words);
    if (signal.aborted) throw cancelled();
    return { itemIds: ids, searched: true };
  }
  const found = new Set<string>();
  for (const ids of bodyLikeChunks(db, words.like, chunk)) {
    for (const id of ids) found.add(id);
    await new Promise((resolve) => setImmediate(resolve));
    if (signal.aborted) throw cancelled();
  }
  return { itemIds: [...found], searched: true };
}

/** The pages of one PDF item that match, in page order. The trash has no body matches; a file that is not a PDF has no pages. */
export function searchPages(db: Db, repo: LibraryRepository, itemId: string, query: string): { pages: Array<{ pageIndex: number; snippet: string }>; total: number } {
  const none = { pages: [], total: 0 };
  const words = bodyQueryWords(query);
  if (!hasBodyWords(words)) return none;
  const detail = repo.getItemDetail(itemId);
  if (detail.item.type !== 'pdf') return none;
  const trashed = db.prepare('SELECT deleted_at IS NOT NULL FROM items WHERE id = ?').pluck().get(itemId);
  if (trashed) return none;
  return bodyPages(db, detail.file.sha256, words);
}
