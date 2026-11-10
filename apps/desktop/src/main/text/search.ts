import { bodyItemIds, bodyLikeChunks, bodyPages, type Db } from '@learn/db';
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
    // A newer query may have come while this one waited: the statement is not started for nothing.
    if (signal.aborted) throw cancelled();
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
export function searchPages(db: Db, itemId: string, query: string): { pages: Array<{ pageIndex: number; snippet: string }>; total: number } {
  const none = { pages: [], total: 0 };
  const words = bodyQueryWords(query);
  if (!hasBodyWords(words)) return none;
  const row = db
    .prepare(
      `SELECT i.type, i.deleted_at AS deletedAt, a.sha256
       FROM items i JOIN item_assets ia ON ia.item_id = i.id AND ia.role = 'original' JOIN assets a ON a.id = ia.asset_id
       WHERE i.id = ?`,
    )
    .get(itemId) as { type: string; deletedAt: string | null; sha256: string } | undefined;
  if (!row) throw new LearnError('NOT_FOUND', mainStrings.itemFile.noItem);
  if (row.type !== 'pdf' || row.deletedAt !== null) return none;
  return bodyPages(db, row.sha256, words);
}
