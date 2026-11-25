import { bodyItemIds, bodyLikeChunks, bodyPages, cueItemIds, cueLikeChunks, cueMatches, type Db } from '@learn/db';
import { LearnError, bodyQueryWords, hasBodyWords, type BodyMatches } from '@learn/domain';
import { mainStrings } from '../strings';

const cancelled = (): LearnError => new LearnError('CANCELLED', mainStrings.jobs.cancelled);

/**
 * The items with a page (a PDF) or a cue (a video) that holds every word of `query`. Without a body word (a single letter)
 * nothing is searched. Words of three letters go to the index in one statement each for pages and cues; a query of two-letter
 * words alone scans the page texts and then the cue texts in chunks and lets the process breathe between them, so a newer
 * query can stop it.
 */
export async function searchBody(db: Db, query: string, signal: AbortSignal, chunk?: number): Promise<{ itemIds: string[]; searched: boolean }> {
  const words = bodyQueryWords(query);
  if (!hasBodyWords(words)) return { itemIds: [], searched: false };
  if (words.fts.length > 0) {
    // A newer query may have come while this one waited: the statement is not started for nothing.
    if (signal.aborted) throw cancelled();
    const ids = new Set(bodyItemIds(db, words));
    if (signal.aborted) throw cancelled();
    for (const id of cueItemIds(db, words)) ids.add(id);
    if (signal.aborted) throw cancelled();
    return { itemIds: [...ids], searched: true };
  }
  const found = new Set<string>();
  for (const chunks of [bodyLikeChunks(db, words.like, chunk), cueLikeChunks(db, words.like, chunk)]) {
    for (const ids of chunks) {
      for (const id of ids) found.add(id);
      await new Promise((resolve) => setImmediate(resolve));
      if (signal.aborted) throw cancelled();
    }
  }
  return { itemIds: [...found], searched: true };
}

/**
 * The matches of one item: a PDF's pages in page order, a video's cues by start time. The trash has no body matches; any other
 * kind of item has none.
 */
export function searchMatches(db: Db, itemId: string, query: string): BodyMatches {
  const none: BodyMatches = { matches: [], total: 0 };
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
  if (row.deletedAt !== null) return none;
  if (row.type === 'pdf') {
    const { pages, total } = bodyPages(db, row.sha256, words);
    return { matches: pages.map((p) => ({ kind: 'page' as const, pageIndex: p.pageIndex, snippet: p.snippet })), total };
  }
  if (row.type === 'video') return cueMatches(db, itemId, words);
  return none;
}
