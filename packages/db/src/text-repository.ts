import { PDF_TEXT_EXTRACTOR, TEXT_LIMITS, extractKey, newId, type BodyTextFailure, type BodyTextState, type ExtractPayload } from '@learn/domain';
import type { Db } from './connection';

export interface ExtractJob { id: string; sha256: string; payload: ExtractPayload; attempts: number }

interface JobRow { id: string; state: string; attempts: number; error: string | null; payload_json: string }

/** Where the sha starts in a dedupe key (1-based), so a job's sha can be matched against the indexed assets column. */
const SHA_AT = extractKey('#').indexOf('#') + 1;
const KEY_SUFFIX = `:${PDF_TEXT_EXTRACTOR}`;
/** The jobs of this extractor version; an older version's jobs are never touched. */
const THIS_VERSION = `kind = 'extract' AND dedupe_key LIKE 'extract:%${KEY_SUFFIX}'`;
/** The PDF items that are not in the trash, with the sha of their original file. */
const LIVE_PDFS = `FROM items i JOIN item_assets ia ON ia.item_id = i.id AND ia.role = 'original'
                   JOIN assets a ON a.id = ia.asset_id WHERE i.type = 'pdf' AND i.deleted_at IS NULL`;

/** The queued jobs, newest first, whose file still has a PDF outside the trash (exported for its query-plan test). */
export const NEXT_JOB_SQL = `SELECT j.id, j.state, j.attempts, j.error, j.payload_json FROM jobs j
  WHERE j.state = 'queued' AND j.${THIS_VERSION.replace(/ AND /, ' AND j.')}
    AND EXISTS (SELECT 1 FROM assets a JOIN item_assets ia ON ia.asset_id = a.id AND ia.role = 'original'
         JOIN items i ON i.id = ia.item_id AND i.type = 'pdf' AND i.deleted_at IS NULL
         WHERE a.sha256 = substr(j.dedupe_key, ${SHA_AT}, 64))
  ORDER BY j.created_at DESC, j.rowid DESC`;

/** The PDF files that have no job yet, with the date of their newest item (exported for its query-plan test): each file's key is looked up in the unique index. */
export const BACKFILL_FILES_SQL = `SELECT a.sha256, MAX(i.created_at) AS created FROM items i JOIN item_assets ia ON ia.item_id = i.id AND ia.role = 'original'
  JOIN assets a ON a.id = ia.asset_id WHERE i.type = 'pdf'
  AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.dedupe_key = '${extractKey('#').slice(0, SHA_AT - 1)}' || a.sha256 || '${KEY_SUFFIX}')
  GROUP BY a.sha256 ORDER BY created, a.sha256`;

const parse = (row: JobRow): ExtractPayload => JSON.parse(row.payload_json) as ExtractPayload;
const toJob = (row: JobRow): ExtractJob => {
  const payload = parse(row);
  return { id: row.id, sha256: payload.sha256, payload, attempts: row.attempts };
};
const isFailure = (s: string | null): s is BodyTextFailure => s === 'locked' || s === 'damaged' || s === 'too-large' || s === 'gave-up';

/** The extraction jobs and page texts. Only main's repository layer writes them; the worker never touches the database. */
export class TextRepository {
  constructor(private readonly db: Db) {}

  private row(jobId: string): JobRow | undefined {
    return this.db.prepare('SELECT id, state, attempts, error, payload_json FROM jobs WHERE id = ?').get(jobId) as JobRow | undefined;
  }

  private rowOfSha(sha256: string): JobRow | undefined {
    return this.db.prepare('SELECT id, state, attempts, error, payload_json FROM jobs WHERE dedupe_key = ?').get(extractKey(sha256)) as JobRow | undefined;
  }

  /** One job per PDF file content that has none yet, older libraries included. Returns how many were added. */
  backfill(now: string): number {
    return this.db.transaction((): number => {
      const files = this.db.prepare(BACKFILL_FILES_SQL).all() as Array<{ sha256: string; created: string }>;
      const insert = this.db.prepare(
        `INSERT INTO jobs (id, kind, dedupe_key, state, attempts, payload_json, created_at, updated_at) VALUES (?, 'extract', ?, 'queued', 0, ?, ?, ?)
         ON CONFLICT(dedupe_key) DO NOTHING`,
      );
      let added = 0;
      for (const { sha256, created } of files) {
        const payload: ExtractPayload = { sha256, type: 'pdf', nextPage: 0, pages: null, chars: 0, truncated: false };
        added += insert.run(newId(), extractKey(sha256), JSON.stringify(payload), created, now).changes;
      }
      return added;
    })();
  }

  requeueInterrupted(now: string): number {
    return this.db.prepare(`UPDATE jobs SET state = 'queued', updated_at = ? WHERE state = 'interrupted' AND ${THIS_VERSION}`).run(now).changes;
  }

  /** The newest queued job whose file still has a PDF outside the trash. */
  next(skip?: ReadonlySet<string>): ExtractJob | undefined {
    const rows = this.db
      .prepare(NEXT_JOB_SQL)
      .iterate() as Iterable<JobRow>;
    for (const row of rows) {
      const job = toJob(row);
      if (!skip?.has(job.sha256)) return job;
    }
    return undefined;
  }

  /** Takes a queued job (counting the attempt); a job already tried three times is given up instead. */
  start(jobId: string, now: string): { job: ExtractJob } | { gaveUp: true } | undefined {
    return this.db.transaction((): { job: ExtractJob } | { gaveUp: true } | undefined => {
      const row = this.row(jobId);
      if (!row || row.state !== 'queued') return undefined;
      if (row.attempts >= TEXT_LIMITS.attempts) {
        this.fail(jobId, 'gave-up', now);
        return { gaveUp: true };
      }
      this.db.prepare(`UPDATE jobs SET state = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(now, jobId);
      return { job: toJob({ ...row, attempts: row.attempts + 1 }) };
    })();
  }

  /** The worker opened the file and counted its pages. */
  opened(jobId: string, pages: number, now: string): boolean {
    const row = this.row(jobId);
    if (!row || row.state !== 'running') return false;
    const payload = { ...parse(row), pages };
    this.db.prepare('UPDATE jobs SET payload_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(payload), now, jobId);
    return true;
  }

  /**
   * One batch of pages, written only while its job still runs (a purge or a restart may have ended it). Returns false
   * and writes nothing otherwise. A batch must continue where the last one stopped.
   */
  writePages(jobId: string, from: number, texts: readonly string[], now: string): boolean {
    return this.db.transaction((): boolean => {
      const row = this.row(jobId);
      if (!row || row.state !== 'running') return false;
      const payload = parse(row);
      if (payload.nextPage !== from) throw new Error(`page batch starts at ${from}, the job expects ${payload.nextPage}`);
      if (from === 0) this.db.prepare('DELETE FROM page_texts WHERE sha256 = ?').run(payload.sha256);
      const insert = this.db.prepare('INSERT INTO page_texts (sha256, page_index, text) VALUES (?, ?, ?)');
      let chars = 0;
      texts.forEach((text, k) => {
        insert.run(payload.sha256, from + k, text);
        chars += text.length;
      });
      const nextPage = from + texts.length;
      const next: ExtractPayload = { ...payload, nextPage, chars: payload.chars + chars };
      this.db
        .prepare('UPDATE jobs SET payload_json = ?, progress = ?, updated_at = ? WHERE id = ?')
        .run(JSON.stringify(next), next.pages ? nextPage / next.pages : null, now, jobId);
      return true;
    })();
  }

  /** Marks a running job done; a job that was stopped or released meanwhile stays as it is. */
  finish(jobId: string, r: { pages: number; truncated: boolean }, now: string): void {
    const row = this.row(jobId);
    if (!row || row.state !== 'running') return;
    const payload: ExtractPayload = { ...parse(row), pages: r.pages, truncated: r.truncated };
    this.db.prepare(`UPDATE jobs SET state = 'done', progress = 1, error = NULL, payload_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(payload), now, jobId);
  }

  fail(jobId: string, reason: BodyTextFailure, now: string): void {
    this.db.prepare(`UPDATE jobs SET state = 'failed', error = ?, updated_at = ? WHERE id = ?`).run(reason, now, jobId);
  }

  /** Back to the queue without a new attempt (the attempt was counted when it started). */
  release(jobId: string, now: string): void {
    this.db.prepare(`UPDATE jobs SET state = 'queued', updated_at = ? WHERE id = ? AND state = 'running'`).run(now, jobId);
  }

  /** Back to the queue and the attempt given back: the run was stopped by the trash, not by a failure (spec 5.7). */
  requeue(jobId: string, now: string): void {
    this.db
      .prepare(`UPDATE jobs SET state = 'queued', attempts = MAX(attempts - 1, 0), updated_at = ? WHERE id = ? AND state = 'running'`)
      .run(now, jobId);
  }

  /** Whether the file has a job, in any state (an indexed lookup by the dedupe key). */
  hasJob(sha256: string): boolean {
    return this.db.prepare('SELECT 1 FROM jobs WHERE dedupe_key = ? LIMIT 1').get(extractKey(sha256)) !== undefined;
  }

  hasLiveItem(sha256: string): boolean {
    return (
      this.db
        .prepare(`SELECT 1 ${LIVE_PDFS} AND a.sha256 = ? LIMIT 1`)
        .get(sha256) !== undefined
    );
  }

  stateOf(sha256: string): BodyTextState {
    const row = this.rowOfSha(sha256);
    if (!row) return { state: 'pending' };
    if (row.state === 'failed') return isFailure(row.error) ? { state: 'failed', reason: row.error } : { state: 'failed', reason: 'damaged' };
    if (row.state !== 'done') return { state: 'pending' };
    const payload = parse(row);
    const pages = payload.nextPage;
    if (!payload.truncated && payload.chars < TEXT_LIMITS.emptyPerPage * Math.max(1, pages)) return { state: 'empty', pages };
    return { state: 'done', pages, truncated: payload.truncated };
  }

  /**
   * Of the PDF items outside the trash, how many have an answer (read or failed) — counted by item, not by file. An item whose
   * original is missing is left out: nothing reads it until it is back, so it would hold the index unfinished for as long as a
   * drive is unplugged.
   */
  progress(): { done: number; total: number } {
    const r = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN j.state IN ('done', 'failed') THEN 1 ELSE 0 END), 0) AS done
         ${LIVE_PDFS.replace('WHERE', `LEFT JOIN jobs j ON j.dedupe_key = 'extract:' || a.sha256 || '${KEY_SUFFIX}' WHERE`)}
           AND a.availability <> 'missing'`,
      )
      .get() as { total: number; done: number };
    return { done: r.done, total: r.total };
  }

  pageCount(sha256: string): number {
    return (this.db.prepare('SELECT COUNT(*) FROM page_texts WHERE sha256 = ?').pluck().get(sha256) as number) ?? 0;
  }

  /** Every item (trash included) whose original file has this content. */
  itemIdsOfSha(sha256: string): string[] {
    return this.db
      .prepare(`SELECT i.id FROM items i JOIN item_assets ia ON ia.item_id = i.id AND ia.role = 'original'
                JOIN assets a ON a.id = ia.asset_id WHERE a.sha256 = ? ORDER BY i.rowid`)
      .pluck()
      .all(sha256) as string[];
  }

  jobs(): Array<{ sha256: string; state: string; attempts: number; nextPage: number; error: string | null }> {
    const rows = this.db.prepare(`SELECT id, state, attempts, error, payload_json FROM jobs WHERE ${THIS_VERSION} ORDER BY rowid`).all() as JobRow[];
    return rows.map((r) => {
      const p = parse(r);
      return { sha256: p.sha256, state: r.state, attempts: r.attempts, nextPage: p.nextPage, error: r.error };
    });
  }
}
