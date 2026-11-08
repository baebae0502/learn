import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractKey } from '@learn/domain';
import { LibraryRepository, NEXT_JOB_SQL, TextRepository, type Db } from '../src/index';
import { freshDb, seedItem } from './fixtures';

let db: Db;
let texts: TextRepository;
const T = (n: number) => `2026-11-0${n}T00:00:00.000Z`;
beforeEach(() => {
  db = freshDb();
  texts = new TextRepository(db);
});
afterEach(() => db.close());

const jobRows = () => db.prepare('SELECT dedupe_key, state FROM jobs ORDER BY rowid').all();
const setPayload = (sha: string, patch: Record<string, unknown>, state?: string, error?: string) => {
  const row = db.prepare('SELECT payload_json FROM jobs WHERE dedupe_key = ?').get(extractKey(sha)) as { payload_json: string };
  db.prepare('UPDATE jobs SET payload_json = ?, state = COALESCE(?, state), error = ? WHERE dedupe_key = ?')
    .run(JSON.stringify({ ...JSON.parse(row.payload_json), ...patch }), state ?? null, error ?? null, extractKey(sha));
};
const pageRows = (sha: string) => db.prepare('SELECT page_index, text FROM page_texts WHERE sha256 = ? ORDER BY page_index').all(sha);
/** A running job for a fresh PDF. */
function running(): { sha: string; jobId: string } {
  const { asset } = seedItem(db);
  texts.backfill(T(1));
  const { id } = texts.next()!;
  texts.start(id, T(1));
  return { sha: asset.sha256, jobId: id };
}

describe('backfill', () => {
  it('queues one job per PDF content (managed, linked and duplicate items alike), none for videos and images, and only once', () => {
    const managed = seedItem(db, { sha: 'a'.repeat(64) });
    seedItem(db, { sha: 'a'.repeat(64), mode: 'linked' });
    seedItem(db, { reuseAsset: managed.asset });
    const video = seedItem(db, { type: 'video' });
    const image = seedItem(db, { type: 'image' });
    expect(texts.backfill(T(1))).toBe(1); // positive control: the PDF got one
    expect(jobRows()).toEqual([{ dedupe_key: extractKey('a'.repeat(64)), state: 'queued' }]);
    expect(texts.backfill(T(2))).toBe(0);
    expect(jobRows()).toHaveLength(1);
    expect(jobRows().some((j) => JSON.stringify(j).includes(video.asset.sha256) || JSON.stringify(j).includes(image.asset.sha256))).toBe(false);
  });
});

describe('next', () => {
  it('gives the newest queued job first, skipping trashed files and the shas asked to skip', () => {
    const a = seedItem(db);
    const b = seedItem(db);
    const c = seedItem(db);
    for (const [x, n] of [[a, 1], [b, 3], [c, 2]] as const) {
      texts.backfill(T(n)); // one new job per call would add all; insert one at a time instead
      db.prepare('UPDATE jobs SET created_at = ? WHERE dedupe_key = ?').run(T(n), extractKey(x.asset.sha256));
    }
    expect(texts.next()?.sha256).toBe(b.asset.sha256);
    expect(texts.next(new Set([b.asset.sha256]))?.sha256).toBe(c.asset.sha256);
    new LibraryRepository(db).trash([b.itemId]);
    expect(texts.next()?.sha256).toBe(c.asset.sha256);
    expect(texts.next(new Set([c.asset.sha256, a.asset.sha256]))).toBeUndefined();
  });
});

describe('attempts and restarts', () => {
  it('counts an attempt at every start and gives up at the fourth', () => {
    const { sha, jobId } = running();
    expect(jobRows()).toEqual([{ dedupe_key: extractKey(sha), state: 'running' }]);
    expect(texts.jobs()[0]).toMatchObject({ attempts: 1, state: 'running' });
    texts.release(jobId, T(2));
    expect(texts.jobs()[0]).toMatchObject({ attempts: 1, state: 'queued' });
    for (let n = 2; n <= 3; n++) {
      expect(texts.start(jobId, T(2))).toMatchObject({ job: { attempts: n } });
      texts.release(jobId, T(2));
    }
    expect(texts.start(jobId, T(3))).toEqual({ gaveUp: true });
    expect(texts.stateOf(sha)).toEqual({ state: 'failed', reason: 'gave-up' });
  });

  it('puts interrupted jobs of this version back with their place kept', () => {
    const { sha, jobId } = running();
    texts.writePages(jobId, 0, ['a', 'b'], T(2));
    db.prepare(`UPDATE jobs SET state = 'interrupted'`).run();
    db.prepare(`INSERT INTO jobs (id, kind, dedupe_key, state, payload_json, created_at, updated_at) VALUES ('old', 'extract', ?, 'interrupted', '{}', ?, ?)`)
      .run(`extract:${sha}:text-v0`, T(1), T(1));
    expect(texts.requeueInterrupted(T(3))).toBe(1);
    expect(db.prepare(`SELECT state FROM jobs WHERE id = 'old'`).pluck().get()).toBe('interrupted');
    expect(texts.next()?.payload.nextPage).toBe(2);
  });
});

describe('writePages', () => {
  it('replaces old rows at page 0, continues at the next page, and refuses a repeated page', () => {
    const { sha, jobId } = running();
    db.prepare('INSERT INTO page_texts (sha256, page_index, text) VALUES (?, 7, ?)').run(sha, 'stale');
    expect(texts.writePages(jobId, 0, ['p0', 'p1'], T(2))).toBe(true);
    expect(pageRows(sha)).toEqual([{ page_index: 0, text: 'p0' }, { page_index: 1, text: 'p1' }]);
    expect(texts.writePages(jobId, 2, ['p2'], T(2))).toBe(true);
    expect(texts.pageCount(sha)).toBe(3);
    expect(() => texts.writePages(jobId, 0, ['again'], T(2))).toThrow(); // the job is at page 3
    expect(pageRows(sha)).toHaveLength(3);
    expect(db.prepare('SELECT progress FROM jobs').pluck().get()).toBeNull(); // pages unknown until opened
    texts.opened(jobId, 6, T(2));
    texts.writePages(jobId, 3, ['p3', 'p4', 'p5'], T(2));
    expect(db.prepare('SELECT progress FROM jobs').pluck().get()).toBe(1);
  });

  it('writes nothing when the job is gone or no longer running', () => {
    const { sha, jobId } = running();
    expect(texts.writePages(jobId, 0, ['p0'], T(2))).toBe(true); // positive control
    texts.release(jobId, T(2));
    expect(texts.writePages(jobId, 1, ['p1'], T(2))).toBe(false);
    texts.start(jobId, T(2));
    db.prepare('DELETE FROM jobs').run();
    expect(texts.writePages(jobId, 1, ['p1'], T(2))).toBe(false);
    expect(pageRows(sha)).toEqual([{ page_index: 0, text: 'p0' }]);
  });
});

describe('stateOf', () => {
  it('reads the job: pending, done, empty, truncated, failed', () => {
    const { asset } = seedItem(db);
    const sha = asset.sha256;
    expect(texts.stateOf(sha)).toEqual({ state: 'pending' });
    texts.backfill(T(1));
    expect(texts.stateOf(sha)).toEqual({ state: 'pending' });
    // pages (the document's count) differs from nextPage (the pages read): the state counts the pages read
    setPayload(sha, { nextPage: 12, pages: 40, chars: 500 }, 'done');
    expect(texts.stateOf(sha)).toEqual({ state: 'done', pages: 12, truncated: false });
    setPayload(sha, { chars: 50 });
    expect(texts.stateOf(sha)).toEqual({ state: 'empty', pages: 12 });
    setPayload(sha, { chars: 130 }); // 130 >= 10 x 12 (done by pages read), < 10 x 40 (empty by the document count)
    expect(texts.stateOf(sha)).toEqual({ state: 'done', pages: 12, truncated: false });
    setPayload(sha, { nextPage: 0, pages: 0, chars: 0 }); // nothing read: at least one page's worth is needed
    expect(texts.stateOf(sha)).toEqual({ state: 'empty', pages: 0 });
    setPayload(sha, { nextPage: 12, pages: 40, chars: 50, truncated: true });
    expect(texts.stateOf(sha)).toEqual({ state: 'done', pages: 12, truncated: true });
    setPayload(sha, {}, 'failed', 'locked');
    expect(texts.stateOf(sha)).toEqual({ state: 'failed', reason: 'locked' });
  });

  it('finish and fail record the outcome', () => {
    const { sha, jobId } = running();
    texts.writePages(jobId, 0, ['x'.repeat(200)], T(2));
    texts.finish(jobId, { pages: 1, truncated: false }, T(3));
    expect(texts.stateOf(sha)).toEqual({ state: 'done', pages: 1, truncated: false });
    texts.fail(jobId, 'damaged', T(3));
    expect(texts.stateOf(sha)).toEqual({ state: 'failed', reason: 'damaged' });
  });
});

describe('progress', () => {
  it('counts live PDF items with an answer, by item, never trashed ones, videos or images', () => {
    const a = seedItem(db);
    const b = seedItem(db);
    const c = seedItem(db);
    const d = seedItem(db);
    const dup = seedItem(db, { reuseAsset: a.asset });
    seedItem(db, { type: 'video' });
    seedItem(db, { type: 'image' });
    texts.backfill(T(1));
    expect(texts.progress()).toEqual({ done: 0, total: 5 });
    setPayload(a.asset.sha256, {}, 'done');
    setPayload(b.asset.sha256, {}, 'failed', 'damaged');
    setPayload(d.asset.sha256, {}, 'done');
    new LibraryRepository(db).trash([d.itemId]);
    expect(texts.progress()).toEqual({ done: 3, total: 4 }); // a and its duplicate, b; c still waits
    expect(c.itemId).not.toBe(dup.itemId);
  });
});

describe('lookups', () => {
  it('finds live items and every item of a sha', () => {
    const a = seedItem(db);
    const dup = seedItem(db, { reuseAsset: a.asset });
    expect(texts.hasLiveItem(a.asset.sha256)).toBe(true);
    new LibraryRepository(db).trash([a.itemId, dup.itemId]);
    expect(texts.hasLiveItem(a.asset.sha256)).toBe(false);
    expect(texts.itemIdsOfSha(a.asset.sha256).sort()).toEqual([a.itemId, dup.itemId].sort());
  });
});

describe('finish', () => {
  it('marks only a running job done: a late finish after a release or a stop changes nothing', () => {
    const { sha, jobId } = running();
    texts.writePages(jobId, 0, ['x'.repeat(200)], T(2));
    texts.release(jobId, T(2));
    texts.finish(jobId, { pages: 1, truncated: false }, T(3));
    expect(texts.jobs()[0]).toMatchObject({ state: 'queued' });
    expect(texts.stateOf(sha)).toEqual({ state: 'pending' });
    texts.start(jobId, T(3)); // positive control: while it runs, finish works
    texts.finish(jobId, { pages: 1, truncated: false }, T(3));
    expect(texts.jobs()[0]).toMatchObject({ state: 'done' });
    texts.fail(jobId, 'damaged', T(4));
    texts.finish(jobId, { pages: 1, truncated: false }, T(5));
    expect(texts.stateOf(sha)).toEqual({ state: 'failed', reason: 'damaged' });
  });
});

describe('backfill order and plan', () => {
  it('stamps a job with its newest PDF item, trashed ones included, so next() goes newest first', () => {
    const old = seedItem(db, { sha: '1'.repeat(64) });
    const older = seedItem(db, { sha: '2'.repeat(64) });
    const trashed = seedItem(db, { sha: '3'.repeat(64) });
    db.prepare('UPDATE items SET created_at = ? WHERE id = ?').run(T(2), old.itemId);
    db.prepare('UPDATE items SET created_at = ? WHERE id = ?').run(T(1), older.itemId);
    const dup = seedItem(db, { reuseAsset: old.asset }); // a later item of the first file lifts its job
    db.prepare('UPDATE items SET created_at = ? WHERE id = ?').run(T(3), dup.itemId);
    db.prepare('UPDATE items SET created_at = ? WHERE id = ?').run(T(2), trashed.itemId);
    new LibraryRepository(db).trash([trashed.itemId]);
    expect(texts.backfill(T(9))).toBe(3); // positive control: the trashed PDF has its job too
    expect(db.prepare('SELECT dedupe_key, created_at, updated_at FROM jobs ORDER BY created_at').all()).toEqual([
      { dedupe_key: extractKey('2'.repeat(64)), created_at: T(1), updated_at: T(9) },
      { dedupe_key: extractKey('3'.repeat(64)), created_at: T(2), updated_at: T(9) },
      { dedupe_key: extractKey('1'.repeat(64)), created_at: T(3), updated_at: T(9) },
    ]);
    const made = seedItem(db, { sha: '4'.repeat(64) }); // one queued by an import, newest
    db.prepare(`INSERT INTO jobs (id, kind, dedupe_key, state, payload_json, created_at, updated_at) VALUES ('imp', 'extract', ?, 'queued', ?, ?, ?)`)
      .run(extractKey(made.asset.sha256), JSON.stringify({ sha256: made.asset.sha256, type: 'pdf', nextPage: 0, pages: null, chars: 0, truncated: false }), T(5), T(5));
    const order: string[] = [];
    const skip = new Set<string>();
    for (let job = texts.next(skip); job; job = texts.next(skip)) { order.push(job.sha256); skip.add(job.sha256); }
    expect(order).toEqual(['4'.repeat(64), '1'.repeat(64), '2'.repeat(64)]); // the trashed file's job waits
  });

  it('looks each job up by the sha index, never scanning the assets per job', () => {
    seedItem(db);
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${NEXT_JOB_SQL}`).all() as Array<{ detail: string }>).map((r) => r.detail).join('\n');
    expect(plan).toMatch(/SEARCH a USING (COVERING )?INDEX assets_sha256/);
    expect(plan).not.toMatch(/SCAN a\b/);
  });
});
