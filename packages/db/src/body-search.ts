import { TEXT_LIMITS, ftsMatch, likePattern, likeSnippet, type BodyWords } from '@learn/domain';
import type { Db } from './connection';

/** Page texts of the PDF items outside the trash. */
const LIVE_JOIN = `JOIN assets a ON a.sha256 = p.sha256
  JOIN item_assets ia ON ia.asset_id = a.id AND ia.role = 'original'
  JOIN items i ON i.id = ia.item_id AND i.deleted_at IS NULL AND i.type = 'pdf'`;
/** The same join with the order fixed: page_texts is the outer loop, so an id range reads only its own rows. */
const CHUNK_JOIN = LIVE_JOIN.replace(/\bJOIN\b/g, 'CROSS JOIN');
const LIKE_CLAUSE = " AND p.text LIKE ? ESCAPE '\\'";

/** The items with a page that holds every word: one page must have them all. */
export function bodyItemIds(db: Db, words: BodyWords): string[] {
  const sql = `SELECT DISTINCT i.id FROM page_texts_fts f JOIN page_texts p ON p.id = f.rowid ${LIVE_JOIN}
               WHERE page_texts_fts MATCH ?${LIKE_CLAUSE.repeat(words.like.length)}`;
  return db.prepare(sql).pluck().all(ftsMatch(words.fts), ...words.like.map(likePattern)) as string[];
}

/** Two-letter words cannot use the index: the table is scanned in id ranges so the caller can yield between them. */
/** The statement of one id range (exported for its query-plan test). */
export const LIKE_CHUNK_SQL = (likes: number): string =>
  `SELECT DISTINCT i.id FROM page_texts p ${CHUNK_JOIN} WHERE p.id > ? AND p.id <= ?${LIKE_CLAUSE.repeat(likes)}`;

export function* bodyLikeChunks(db: Db, like: readonly string[], chunk: number = TEXT_LIMITS.likeChunk): Generator<string[], void, void> {
  if (like.length === 0) return;
  const max = (db.prepare('SELECT MAX(id) FROM page_texts').pluck().get() as number | null) ?? 0;
  const stmt = db.prepare(LIKE_CHUNK_SQL(like.length));
  const patterns = like.map(likePattern);
  for (let lo = 0; lo < max; lo += chunk) yield stmt.pluck().all(lo, lo + chunk, ...patterns) as string[];
}

/**
 * The statements of one file's pages that match a trigram query. `page_texts` is the outer loop (CROSS JOIN fixes the order):
 * the file's own pages come from its (sha256, page_index) key in page order, and the index is asked for each of them by rowid —
 * not the other way round, which would read the matches of the whole library before keeping this file's.
 */
const PAGES_FROM = (likes: number): string =>
  `FROM page_texts p CROSS JOIN page_texts_fts f ON f.rowid = p.id WHERE p.sha256 = ? AND page_texts_fts MATCH ?${LIKE_CLAUSE.repeat(likes)}`;
export const PAGES_SQL = (likes: number): string =>
  `SELECT p.page_index AS pageIndex, snippet(page_texts_fts, 0, char(57344), char(57345), '…', 48) AS snippet ${PAGES_FROM(likes)} ORDER BY p.page_index LIMIT ${TEXT_LIMITS.pagesShown}`;
export const PAGES_COUNT_SQL = (likes: number): string => `SELECT COUNT(*) ${PAGES_FROM(likes)}`;

/** The pages of one file that match, in page order, with a snippet each; `total` counts all of them. */
export function bodyPages(db: Db, sha256: string, words: BodyWords): { pages: Array<{ pageIndex: number; snippet: string }>; total: number } {
  const likes = words.like.map(likePattern);
  if (words.fts.length > 0) {
    const args = [sha256, ftsMatch(words.fts), ...likes];
    const rows = db.prepare(PAGES_SQL(likes.length)).all(...args) as Array<{ pageIndex: number; snippet: string }>;
    // Fewer than the limit: that is all of them, and the count is the rows.
    const total = rows.length < TEXT_LIMITS.pagesShown ? rows.length : (db.prepare(PAGES_COUNT_SQL(likes.length)).pluck().get(...args) as number);
    return { pages: rows, total };
  }
  if (likes.length === 0) return { pages: [], total: 0 };
  const where = `p.sha256 = ?${LIKE_CLAUSE.repeat(likes.length)}`;
  const rows = db
    .prepare(`SELECT p.page_index AS pageIndex, p.text AS text FROM page_texts p WHERE ${where} ORDER BY p.page_index LIMIT ${TEXT_LIMITS.pagesShown}`)
    .all(sha256, ...likes) as Array<{ pageIndex: number; text: string }>;
  const total = db.prepare(`SELECT COUNT(*) FROM page_texts p WHERE ${where}`).pluck().get(sha256, ...likes) as number;
  return { pages: rows.map((r) => ({ pageIndex: r.pageIndex, snippet: likeSnippet(r.text, words.like) })), total };
}
