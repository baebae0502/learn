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

/** The pages of one file that match, in page order, with a snippet each; `total` counts all of them. */
export function bodyPages(db: Db, sha256: string, words: BodyWords): { pages: Array<{ pageIndex: number; snippet: string }>; total: number } {
  const likes = words.like.map(likePattern);
  if (words.fts.length > 0) {
    const where = `page_texts_fts MATCH ? AND p.sha256 = ?${LIKE_CLAUSE.repeat(likes.length)}`;
    const match = ftsMatch(words.fts);
    const rows = db
      .prepare(
        `SELECT p.page_index AS pageIndex, snippet(page_texts_fts, 0, char(57344), char(57345), '…', 48) AS snippet
         FROM page_texts_fts f JOIN page_texts p ON p.id = f.rowid WHERE ${where} ORDER BY p.page_index LIMIT ${TEXT_LIMITS.pagesShown}`,
      )
      .all(match, sha256, ...likes) as Array<{ pageIndex: number; snippet: string }>;
    const total = db
      .prepare(`SELECT COUNT(*) FROM page_texts_fts f JOIN page_texts p ON p.id = f.rowid WHERE ${where}`)
      .pluck()
      .get(match, sha256, ...likes) as number;
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
