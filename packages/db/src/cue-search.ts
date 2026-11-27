import { TEXT_LIMITS, ftsMatch, likePattern, likeSnippet, type BodyWords, type TimeMatch } from '@learn/domain';
import type { Db } from './connection';

/**
 * A cue of up to this many characters is a row's snippet whole, and the row's two-line clamp ends it: a sentence that fits is never cut
 * at the snippet's token count. A longer one is cut around the match.
 */
export const WHOLE_CUE_CHARS = 60;
const wholeCueLength = (marked: string): number => marked.replace(/[\ue000\ue001]/g, '').length;

/** Cue texts of the videos outside the trash that still link the subtitle file. */
const LIVE_JOIN = `JOIN assets a ON a.sha256 = c.sha256
  JOIN item_assets ia ON ia.asset_id = a.id AND ia.role = 'subtitle'
  JOIN subtitle_tracks st ON st.item_id = ia.item_id AND st.asset_id = ia.asset_id
  JOIN items i ON i.id = ia.item_id AND i.deleted_at IS NULL AND i.type = 'video'`;
/** The same join with the order fixed: cue_texts is the outer loop, so an id range reads only its own rows. */
const CHUNK_JOIN = LIVE_JOIN.replace(/\bJOIN\b/g, 'CROSS JOIN');
const LIKE_CLAUSE = " AND c.text LIKE ? ESCAPE '\\'";

/** The videos with a cue that holds every word: one cue must have them all. */
export function cueItemIds(db: Db, words: BodyWords): string[] {
  const sql = `SELECT DISTINCT i.id FROM cue_texts_fts f JOIN cue_texts c ON c.id = f.rowid ${LIVE_JOIN}
               WHERE cue_texts_fts MATCH ?${LIKE_CLAUSE.repeat(words.like.length)}`;
  return db.prepare(sql).pluck().all(ftsMatch(words.fts), ...words.like.map(likePattern)) as string[];
}

/** The statement of one id range (exported for its query-plan test). */
export const CUE_LIKE_CHUNK_SQL = (likes: number): string =>
  `SELECT DISTINCT i.id FROM cue_texts c ${CHUNK_JOIN} WHERE c.id > ? AND c.id <= ?${LIKE_CLAUSE.repeat(likes)}`;

/** Two-letter words cannot use the index: the cues are scanned in id ranges so the caller can look at its abort signal between them. */
export function* cueLikeChunks(db: Db, like: readonly string[], chunk: number = TEXT_LIMITS.likeChunk): Generator<string[], void, void> {
  if (like.length === 0) return;
  const max = (db.prepare('SELECT MAX(id) FROM cue_texts').pluck().get() as number | null) ?? 0;
  const stmt = db.prepare(CUE_LIKE_CHUNK_SQL(like.length));
  const patterns = like.map(likePattern);
  for (let lo = 0; lo < max; lo += chunk) yield stmt.pluck().all(lo, lo + chunk, ...patterns) as string[];
}

/**
 * How one video's cues that match a trigram query are found; CROSS JOIN fixes the order of each plan.
 * - 'cues': the video's own cues are the outer loop and the index is asked for each by rowid. Right for a short file.
 * - 'index': the index is the outer loop (the word's matches in the whole library) and this video's are kept. A word on many
 *   cues of a thousand-cue video costs a quarter of what the walk costs.
 */
type CuesPlan = 'cues' | 'index';
/** The longest video whose cues are walked one by one; a longer one is read from the index. */
export const CUE_WALK_MAX = 64;

const TRACK_CUES = `subtitle_tracks st
  CROSS JOIN item_assets ia ON ia.item_id = st.item_id AND ia.asset_id = st.asset_id AND ia.role = 'subtitle'
  CROSS JOIN items i ON i.id = st.item_id AND i.deleted_at IS NULL AND i.type = 'video'
  CROSS JOIN assets a ON a.id = st.asset_id
  CROSS JOIN cue_texts c ON c.sha256 = a.sha256`;
const INDEX_CUES = `cue_texts_fts f
  CROSS JOIN cue_texts c ON c.id = f.rowid
  CROSS JOIN assets a ON a.sha256 = c.sha256
  CROSS JOIN subtitle_tracks st ON st.asset_id = a.id
  CROSS JOIN item_assets ia ON ia.item_id = st.item_id AND ia.asset_id = st.asset_id AND ia.role = 'subtitle'
  CROSS JOIN items i ON i.id = st.item_id AND i.deleted_at IS NULL AND i.type = 'video'`;
const CUES_FROM = (likes: number): string =>
  `FROM ${TRACK_CUES} CROSS JOIN cue_texts_fts f ON f.rowid = c.id WHERE st.item_id = ? AND cue_texts_fts MATCH ?${LIKE_CLAUSE.repeat(likes)}`;
/**
 * The index plan, bounded by the ids the video's cues lie in. The cues of one file are written together, so each track's lie in a range
 * of their own, and one attached later lies past the rest of the library. The index is handed the span of them all: a bound shortens the
 * read of a short word, while a long phrase costs about as much bounded as not, so one read beats one per range. The rows outside every
 * range are then dropped before the video's joins (`+f.rowid` is a filter, not a second bound for the index), and only its own are joined.
 */
const INDEX_FROM = (likes: number, ranges: number): string => {
  const own = ranges > 1 ? ` AND (${Array.from({ length: ranges }, () => '+f.rowid BETWEEN ? AND ?').join(' OR ')})` : '';
  return `FROM ${INDEX_CUES} WHERE st.item_id = ? AND cue_texts_fts MATCH ? AND f.rowid BETWEEN ? AND ?${own}${LIKE_CLAUSE.repeat(likes)}`;
};
const ITEM_ORDER = `ORDER BY c.start_ms, st.position LIMIT ${TEXT_LIMITS.pagesShown}`;

export interface CueRange {
  lo: number;
  hi: number;
}

/** The ids each of the video's tracks' cues lie in, in id order, with how many cues the video has in all. */
function trackRanges(db: Db, itemId: string): { n: number; ranges: CueRange[] } {
  const rows = db
    .prepare(
      `SELECT COUNT(*) AS n, MIN(c.id) AS lo, MAX(c.id) AS hi FROM subtitle_tracks st JOIN assets a ON a.id = st.asset_id JOIN cue_texts c ON c.sha256 = a.sha256
       WHERE st.item_id = ? GROUP BY a.sha256 ORDER BY lo`,
    )
    .all(itemId) as Array<{ n: number; lo: number; hi: number }>;
  // Ranges that meet are one: the filter has a term per range that is apart.
  const ranges: CueRange[] = [];
  for (const { lo, hi } of rows) {
    const prev = ranges.at(-1);
    if (prev && lo <= prev.hi + 1) prev.hi = Math.max(prev.hi, hi);
    else ranges.push({ lo, hi });
  }
  return { n: rows.reduce((sum, r) => sum + r.n, 0), ranges };
}

/** The id ranges the index plan reads for a video (exported for its test). */
export const cueRanges = (db: Db, itemId: string): CueRange[] => trackRanges(db, itemId).ranges;

/** The index plan's rows for a video whose cues lie in `ranges` ranges (exported for its query-plan test). */
export const CUE_INDEX_SQL = (likes: number, ranges: number): string => `SELECT c.id AS id ${INDEX_FROM(likes, ranges)}`;

/**
 * The cues of one video that match, by start time (the first track's on a tie), a snippet each; `total` counts all of them.
 * `track` is the subtitle's asset id only when the video has two or more tracks.
 */
export function cueMatches(db: Db, itemId: string, words: BodyWords): { matches: TimeMatch[]; total: number } {
  const likes = words.like.map(likePattern);
  if (words.fts.length === 0 && likes.length === 0) return { matches: [], total: 0 };
  const tracks = db.prepare('SELECT COUNT(*) FROM subtitle_tracks WHERE item_id = ?').pluck().get(itemId) as number;
  const trackOf = (assetId: string): string | null => (tracks >= 2 ? assetId : null);
  if (words.fts.length > 0) {
    const { n, ranges } = trackRanges(db, itemId);
    const plan: CuesPlan = n <= CUE_WALK_MAX ? 'cues' : 'index';
    const match = ftsMatch(words.fts);
    const [from, args] =
      plan === 'cues'
        ? [CUES_FROM(likes.length), [itemId, match, ...likes]]
        : [INDEX_FROM(likes.length, ranges.length), [itemId, match, ranges[0]!.lo, ranges.at(-1)!.hi, ...(ranges.length > 1 ? ranges.flatMap((r) => [r.lo, r.hi]) : []), ...likes]];
    // The twenty rows are chosen first, and counted in the same read: a snippet is computed for each of them only, not for every matching cue.
    const chosen = db
      .prepare(`SELECT c.id AS id, c.start_ms AS startMs, st.asset_id AS assetId, COUNT(*) OVER () AS total ${from} ${ITEM_ORDER}`)
      .all(...args) as Array<{ id: number; startMs: number; assetId: string; total: number }>;
    // One statement for the chosen cues: an aux function asked with `rowid = ?` beside MATCH answered another cue's text (two tracks with the
    // same start gave the second one the first one's sentence), and a rowid list does not.
    const ids = chosen.map((r) => r.id);
    // Without rows the statement below would hold `rowid IN ()` and match the whole library's index for nothing.
    if (ids.length === 0) return { matches: [], total: 0 };
    const shown = new Map<number, string>();
    const marked = db
      .prepare(
        `SELECT rowid AS id, snippet(cue_texts_fts, 0, char(57344), char(57345), '…', 48) AS cut, highlight(cue_texts_fts, 0, char(57344), char(57345)) AS whole
         FROM cue_texts_fts WHERE cue_texts_fts MATCH ? AND rowid IN (${ids.map(() => '?').join(',')})`,
      )
      .all(match, ...ids) as Array<{ id: number; cut: string; whole: string }>;
    for (const m of marked) shown.set(m.id, wholeCueLength(m.whole) <= WHOLE_CUE_CHARS ? m.whole : m.cut);
    const rows = chosen.map((r) => ({ startMs: r.startMs, assetId: r.assetId, snippet: shown.get(r.id) ?? '' }));
    return { matches: rows.map((r) => ({ kind: 'time', startMs: r.startMs, snippet: r.snippet, track: trackOf(r.assetId) })), total: chosen[0]!.total };
  }
  const from = `FROM ${TRACK_CUES} WHERE st.item_id = ?${LIKE_CLAUSE.repeat(likes.length)}`;
  const rows = db
    .prepare(`SELECT c.start_ms AS startMs, st.asset_id AS assetId, c.text AS text ${from} ${ITEM_ORDER}`)
    .all(itemId, ...likes) as Array<{ startMs: number; assetId: string; text: string }>;
  const total = rows.length < TEXT_LIMITS.pagesShown ? rows.length : (db.prepare(`SELECT COUNT(*) ${from}`).pluck().get(itemId, ...likes) as number);
  return { matches: rows.map((r) => ({ kind: 'time', startMs: r.startMs, snippet: likeSnippet(r.text, words.like, WHOLE_CUE_CHARS), track: trackOf(r.assetId) })), total };
}
