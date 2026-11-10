import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryRepository, TextRepository, migrate, openDatabase, type Db } from '@learn/db';
import { TEXT_LIMITS, newId } from '@learn/domain';
import type { ExtractEvents, ExtractOutcome, TextExtractor } from './extractor';
import type { ExtractRequest } from './messages';
import { createThrottle } from '../jobs/throttle';
import { EVENTS_KEPT, createTextScheduler, type TextScheduler } from './scheduler';

let db: Db;
let repo: TextRepository;
const T = (n: number) => `2026-11-0${n}T00:00:00.000Z`;

beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, { dbFile: null });
  repo = new TextRepository(db);
});
afterEach(() => db.close());

let seq = 0;
/** A PDF item with a file of its own, created on day `day` (the job's age). */
function addPdf(day: number): { itemId: string; sha: string } {
  seq += 1;
  const sha = seq.toString(16).padStart(64, '0');
  const assetId = newId();
  const itemId = newId();
  new LibraryRepository(db).insertImported({
    item: { id: itemId, type: 'pdf', title: `item ${seq}`, createdAt: T(day) },
    asset: {
      id: assetId, sha256: sha, storageMode: 'managed', relativePath: `assets/${sha.slice(0, 2)}/${sha}`, externalPath: null, originalName: 'a.pdf',
      mime: 'application/pdf', size: 10, availability: 'available', createdAt: T(day), checkedAt: T(day),
    },
    assetIsNew: true,
    revision: { id: newId(), createdAt: T(day) },
    job: null,
  });
  return { itemId, sha };
}

type Step = (req: Omit<ExtractRequest, 'type'>, events: ExtractEvents) => Promise<ExtractOutcome> | ExtractOutcome;
const pageTexts = (from: number, n: number) => Array.from({ length: n }, (_, k) => `page ${from + k}`);
/** Opens a file of `pages` pages and sends it in batches of `size`, from the request's start page. */
const reads =
  (pages: number, size = 20, truncated = false): Step =>
  async (req, events) => {
    events.opened(pages);
    for (let from = req.startPage; from < pages; from += size) {
      if (!(await events.pages(from, pageTexts(from, Math.min(size, pages - from))))) return { kind: 'stopped' };
    }
    return { kind: 'done', pages, truncated };
  };

class FakeExtractor implements TextExtractor {
  calls: Array<Omit<ExtractRequest, 'type'>> = [];
  stops = 0;
  disposed = false;
  private stopNow: (() => void) | null = null;
  constructor(private script: Step[]) {}
  async run(req: Omit<ExtractRequest, 'type'>, events: ExtractEvents): Promise<ExtractOutcome> {
    this.calls.push(req);
    const step = this.script.shift();
    if (!step) throw new Error('fake extractor: no step left');
    const stopped = new Promise<ExtractOutcome>((resolve) => {
      this.stopNow = () => resolve({ kind: 'stopped' });
    });
    return Promise.race([Promise.resolve(step(req, events)), stopped]);
  }
  stop(): void {
    this.stops += 1;
    this.stopNow?.();
  }
  dispose(): void {
    this.disposed = true;
    this.stop();
  }
}

interface Rig {
  s: TextScheduler;
  x: FakeExtractor;
  delays: Array<{ ms: number; go: () => void }>;
  announced: string[][];
  progress: { request: number; now: number };
  busy: { value: boolean; release: () => void };
  files: Map<string, string | null>;
  /** With `throttle`: the index progress as each notice that really left would have read it. */
  sent: Array<{ done: number; total: number }>;
}
function rig(script: Step[], o: { paused?: boolean; files?: (sha: string) => string | null; throttle?: boolean } = {}): Rig {
  const x = new FakeExtractor(script);
  const delays: Rig['delays'] = [];
  const announced: string[][] = [];
  const progress = { request: 0, now: 0 };
  let idleWaiters: Array<() => void> = [];
  const busy = {
    value: false,
    release: () => {
      busy.value = false;
      const w = idleWaiters;
      idleWaiters = [];
      for (const go of w) go();
    },
  };
  const files = new Map<string, string | null>();
  const sent: Rig['sent'] = [];
  const notice = createThrottle(() => void sent.push(repo.progress()), 1000);
  const s = createTextScheduler({
    repo: () => repo,
    extractor: x,
    laneBusy: () => busy.value,
    laneIdle: () => (busy.value ? new Promise<void>((r) => idleWaiters.push(r)) : Promise.resolve()),
    file: o.files ?? ((sha) => (files.has(sha) ? files.get(sha)! : `/files/${sha.slice(0, 4)}.pdf`)),
    assetsDir: '/assets',
    announce: (ids) => void announced.push(ids),
    progress: () => {
      progress.request += 1;
      if (o.throttle) notice.request();
    },
    progressNow: () => {
      progress.now += 1;
      if (o.throttle) notice.flush();
    },
    paused: o.paused ?? false,
    now: () => T(9),
    delay: (ms) => new Promise<void>((go) => delays.push({ ms, go })),
  });
  return { s, x, delays, announced, progress, busy, files, sent };
}
/** Both signals the first start waits for, the delay (when there is one) elapsed. */
async function startUp(r: Rig): Promise<void> {
  r.s.firstIdle();
  r.s.startupChecked();
  for (const d of r.delays.splice(0)) d.go();
  await r.s.idle();
}
const job = (sha: string) => repo.jobs().find((j) => j.sha256 === sha)!;
const tick = () => new Promise<void>((r) => setImmediate(r));
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !cond(); i++) await tick();
  expect(cond()).toBe(true);
}

describe('when the first job may start (P-29)', () => {
  it('waits for the window\'s first idle, then for the startup check, then five seconds; reads after that', async () => {
    const a = addPdf(1);
    const r = rig([reads(3)]);
    r.s.startupChecked();
    await tick();
    expect(r.delays).toEqual([]);
    expect(r.x.calls).toHaveLength(0);
    r.s.firstIdle();
    expect(r.delays.map((d) => d.ms)).toEqual([TEXT_LIMITS.startDelayMs]);
    await tick();
    expect(r.x.calls).toHaveLength(0); // the five seconds have not passed
    r.delays[0]!.go();
    await r.s.idle();
    expect(r.x.calls).toHaveLength(1); // positive control for every "not yet" above
    expect(job(a.sha)).toMatchObject({ state: 'done', nextPage: 3 });
  });

  it('a first idle alone starts nothing, even when told to run now; the startup check then starts it at once', async () => {
    const a = addPdf(1);
    const r = rig([reads(2)], { paused: true });
    r.s.firstIdle();
    r.s.control('now');
    await tick();
    expect(r.x.calls).toHaveLength(0);
    expect(r.delays).toEqual([]);
    r.s.startupChecked();
    await r.s.idle();
    expect(r.x.calls).toHaveLength(1);
    expect(r.delays).toEqual([]); // 'now' skips the delay
    expect(job(a.sha).state).toBe('done');
  });

  it('wakes the interrupted jobs and the older PDFs on the first start (P-29)', async () => {
    const a = addPdf(1);
    repo.backfill(T(1));
    repo.start(repo.next()!.id, T(1));
    db.prepare(`UPDATE jobs SET state = 'interrupted'`).run();
    const b = addPdf(2); // no job yet: the backfill finds it
    const r = rig([reads(2), reads(2)]);
    await startUp(r);
    expect(r.x.calls.map((c) => c.file)).toEqual([`/files/${b.sha.slice(0, 4)}.pdf`, `/files/${a.sha.slice(0, 4)}.pdf`]);
    expect(job(a.sha)).toMatchObject({ state: 'done', attempts: 2 });
  });
});

describe('paused (P-13)', () => {
  it('does nothing until resume, then reads', async () => {
    const a = addPdf(1);
    const r = rig([reads(2)], { paused: true });
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.wake();
    await tick();
    await tick();
    expect(r.x.calls).toHaveLength(0);
    expect(r.delays).toEqual([]);
    r.s.control('resume');
    for (const d of r.delays.splice(0)) d.go();
    await r.s.idle();
    expect(r.x.calls).toHaveLength(1);
    expect(job(a.sha).state).toBe('done');
  });

  it('idle() does not resolve while a paused scheduler has a job waiting', async () => {
    addPdf(1);
    repo.backfill(T(1));
    const r = rig([reads(1)], { paused: true });
    const settled = vi.fn();
    void r.s.idle().then(settled);
    await tick();
    expect(settled).not.toHaveBeenCalled();
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    await until(() => settled.mock.calls.length > 0);
    expect(r.x.calls).toHaveLength(1);
  });
});

describe('the work line', () => {
  it('starts nothing while it is busy, and a running job runs to its end; starts again when it is free', async () => {
    const a = addPdf(1);
    const b = addPdf(2);
    let continueFirst = (): void => {};
    const first: Step = async (req, events) => {
      events.opened(2);
      await new Promise<void>((go) => (continueFirst = go));
      await events.pages(0, pageTexts(0, 2));
      return { kind: 'done', pages: 2, truncated: false };
    };
    const r = rig([first, reads(2)]);
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    await until(() => r.x.calls.length === 1);
    r.busy.value = true; // an import starts while the first job runs
    continueFirst();
    await until(() => job(b.sha).state === 'done');
    expect(job(a.sha).state).toBe('queued'); // b is newest; it ran first
    // b is done; a waits for the line
    expect(r.x.calls).toHaveLength(1);
    await tick();
    await tick();
    expect(r.x.calls).toHaveLength(1);
    r.busy.release();
    await r.s.idle();
    expect(r.x.calls).toHaveLength(2); // the positive control: free again, it starts
    expect(job(a.sha).state).toBe('done');
  });

  it('wake() after an import reads the new file (the backfill runs on every wake)', async () => {
    const a = addPdf(1);
    const r = rig([reads(1), reads(1)]);
    await startUp(r);
    expect(job(a.sha).state).toBe('done');
    const b = addPdf(3);
    expect(repo.jobs().some((j) => j.sha256 === b.sha)).toBe(false);
    r.s.wake();
    await r.s.idle();
    expect(job(b.sha).state).toBe('done');
  });
});

describe('order and results', () => {
  it('reads the newest job first and tells the progress to refresh: each batch, and at the end of a job and of the queue', async () => {
    const old = addPdf(1);
    const fresh = addPdf(5);
    const r = rig([reads(25), reads(1)]);
    await startUp(r);
    expect(r.x.calls.map((c) => c.file)).toEqual([`/files/${fresh.sha.slice(0, 4)}.pdf`, `/files/${old.sha.slice(0, 4)}.pdf`]);
    expect(r.x.calls[0]).toMatchObject({ startPage: 0, assetsDir: '/assets', limits: { maxPages: 5000, maxPageChars: 100_000, maxDocChars: 10_000_000, maxFileBytes: 512 * 1024 * 1024 } });
    expect(repo.pageCount(fresh.sha)).toBe(25);
    expect(r.progress.request).toBeGreaterThanOrEqual(3); // two batches of the first, one of the second
    expect(r.progress.now).toBe(1); // a job end only asks; the empty queue sends
    expect(r.announced).toEqual([[fresh.itemId], [old.itemId]]);
  });

  it('a run of short jobs sends no notice per job end: the first one, then the final flush', async () => {
    for (let day = 1; day <= 5; day++) addPdf(day);
    const r = rig([reads(1), reads(1), reads(1), reads(1), reads(1)], { throttle: true });
    await startUp(r);
    expect(repo.jobs().every((j) => j.state === 'done')).toBe(true);
    expect(r.progress.request).toBeGreaterThanOrEqual(10); // positive control: every batch and every job end asked
    expect(r.sent.length).toBeLessThanOrEqual(2);
    expect(r.sent.at(-1)).toEqual({ done: 5, total: 5 });
  });

  it('a file the worker could not open ends failed with its reason; both outcomes are announced', async () => {
    const a = addPdf(1);
    const b = addPdf(2);
    const r = rig([async () => ({ kind: 'failed', reason: 'locked' }), reads(3)]);
    await startUp(r);
    expect(job(b.sha)).toMatchObject({ state: 'failed', error: 'locked' });
    expect(job(a.sha)).toMatchObject({ state: 'done', nextPage: 3 });
    expect(repo.stateOf(b.sha)).toEqual({ state: 'failed', reason: 'locked' });
    expect(r.announced).toEqual([[b.itemId], [a.itemId]]);
  });

  it('a resumed job starts at nextPage and gets what is left of the document budget; done.pages is the end page', async () => {
    const a = addPdf(1);
    repo.backfill(T(1));
    const j = repo.next()!;
    repo.start(j.id, T(1));
    repo.opened(j.id, 60, T(1));
    repo.writePages(j.id, 0, ['x'.repeat(100), 'y'.repeat(100)], T(1));
    repo.release(j.id, T(1));
    const r = rig([reads(60)]);
    await startUp(r);
    expect(r.x.calls[0]).toMatchObject({ startPage: 2, limits: { maxDocChars: TEXT_LIMITS.maxDocChars - 200 } });
    expect(job(a.sha)).toMatchObject({ state: 'done', nextPage: 60 });
    expect(repo.pageCount(a.sha)).toBe(60);
  });

  it('truncated is stored; every page is guarded: marks are taken out and the length is cut', async () => {
    const a = addPdf(1);
    const marked = `abc${'z'.repeat(TEXT_LIMITS.maxPageChars + 5)}`;
    const r = rig([async (_req, events) => {
      events.opened(1);
      await events.pages(0, [marked]);
      return { kind: 'done', pages: 1, truncated: true };
    }]);
    await startUp(r);
    const text = db.prepare('SELECT text FROM page_texts WHERE sha256 = ?').pluck().get(a.sha) as string;
    expect(text.startsWith('abc')).toBe(true);
    expect(text).toHaveLength(TEXT_LIMITS.maxPageChars);
    expect(repo.stateOf(a.sha)).toMatchObject({ state: 'done', truncated: true });
  });

  it('a crash puts the job back in the queue with its attempt counted (and no announcement)', async () => {
    const a = addPdf(1);
    const r = rig([async () => { r.busy.value = true; return { kind: 'crashed' }; }]);
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    await until(() => job(a.sha).state === 'queued' && job(a.sha).attempts === 1);
    await tick();
    expect(r.announced).toEqual([]);
    expect(r.x.calls).toHaveLength(1);
  });

  it.each(['crashed', 'timeout', 'bad-message'] as const)('%s counts one attempt and the job is tried again; the third failure ends in gave-up, announced', async (kind) => {
    const a = addPdf(1);
    const r = rig([async () => ({ kind }), async () => ({ kind }), async () => ({ kind }), async () => ({ kind: 'done', pages: 1, truncated: false })], { throttle: true });
    await startUp(r);
    expect(r.x.calls).toHaveLength(3); // the fourth step was not used
    expect(r.sent.at(-1)).toEqual({ done: 1, total: 1 }); // the final notice after the give-up counts the job as answered
    expect(job(a.sha)).toMatchObject({ state: 'failed', error: 'gave-up', attempts: 3 });
    expect(repo.stateOf(a.sha)).toEqual({ state: 'failed', reason: 'gave-up' });
    expect(r.announced).toEqual([[a.itemId]]);
  });

  it('a job that gave up ends with a notice that counts it as answered', async () => {
    const a = addPdf(1);
    const r = rig([async () => ({ kind: 'crashed' }), async () => ({ kind: 'crashed' }), async () => ({ kind: 'crashed' })], { throttle: true });
    await startUp(r);
    expect(job(a.sha).state).toBe('failed');
    expect(r.sent.at(-1)).toEqual({ done: 1, total: 1 }); // what the last notice that left says: the job is done with
    expect(r.sent.some((p) => p.done === 0)).toBe(true); // positive control: the earlier notices still counted it open
  });

  it('a batch that is not written (the job is no longer running) stops the worker', async () => {
    const a = addPdf(1);
    let stops = 0;
    const r = rig([async (_req, events) => {
      events.opened(40);
      db.prepare(`UPDATE jobs SET state = 'interrupted'`).run();
      const keep = await events.pages(0, pageTexts(0, 20));
      if (!keep) stops += 1;
      return keep ? { kind: 'done', pages: 40, truncated: false } : { kind: 'stopped' };
    }]);
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    await until(() => stops === 1);
    expect(repo.pageCount(a.sha)).toBe(0);
    await r.s.idle();
  });

  it('an unavailable file is skipped for the session without an attempt; the other jobs run', async () => {
    const gone = addPdf(5);
    const ok = addPdf(1);
    const r = rig([reads(2)], { files: (sha) => (sha === gone.sha ? null : `/files/ok.pdf`) });
    await startUp(r);
    expect(r.x.calls.map((c) => c.file)).toEqual(['/files/ok.pdf']);
    expect(job(gone.sha)).toMatchObject({ state: 'queued', attempts: 0 });
    expect(job(ok.sha).state).toBe('done');
    // still skipped on the next wake
    r.s.wake();
    await r.s.idle();
    expect(job(gone.sha).attempts).toBe(0);
  });

  it('idle() resolves after the last job, and at once when nothing is queued', async () => {
    const r = rig([]);
    await startUp(r);
    await r.s.idle();
    const a = addPdf(1);
    const r2 = rig([reads(1)]);
    const done = vi.fn();
    void r2.s.idle().then(done);
    r2.s.firstIdle();
    r2.s.startupChecked();
    r2.s.control('now');
    await until(() => done.mock.calls.length === 1);
    expect(job(a.sha).state).toBe('done');
  });
});

describe('hold (E2E)', () => {
  it('holds the next batch once 40 pages are written; null lets the job finish', async () => {
    const a = addPdf(1);
    const r = rig([reads(100)]);
    r.s.hold(40);
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    await until(() => r.s.held());
    expect(job(a.sha)).toMatchObject({ state: 'running', nextPage: 40 });
    expect(repo.pageCount(a.sha)).toBe(40);
    await tick();
    expect(repo.pageCount(a.sha)).toBe(40);
    r.s.hold(null);
    expect(r.s.held()).toBe(false);
    await r.s.idle();
    expect(repo.pageCount(a.sha)).toBe(100);
    expect(job(a.sha).state).toBe('done');
  });

  it('stats count the pages written and the time of every batch', async () => {
    addPdf(1);
    const r = rig([reads(45)]);
    await startUp(r);
    const st = r.s.stats();
    expect(st.pagesWritten).toBe(45);
    expect(st.batchMs).toHaveLength(3);
    expect(st.activeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('the trash, restore and purge (spec 5.7)', () => {
  it('a change of the PDF counts asks for the index progress even when no job runs; another change does not', async () => {
    const r = rig([]);
    expect(r.progress.request).toBe(0);
    for (const [k, reason] of (['trash', 'restore', 'purge', 'import'] as const).entries()) {
      r.s.libraryChanged(reason);
      expect(r.progress.request, reason).toBe(k + 1);
    }
    r.s.libraryChanged('metadata');
    r.s.libraryChanged('collections');
    expect(r.progress.request).toBe(4);
  });

  it('trashing the last live PDF stops the job and leaves it queued; restoring continues from nextPage', async () => {
    const a = addPdf(1);
    const r = rig([reads(100), reads(100)]);
    r.s.hold(40);
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    await until(() => r.s.held());
    new LibraryRepository(db).trash([a.itemId]);
    r.s.libraryChanged('trash');
    expect(r.x.stops).toBe(1);
    await until(() => !r.s.held() && job(a.sha).state === 'queued');
    expect(job(a.sha)).toMatchObject({ state: 'queued', nextPage: 40, attempts: 0 });
    await r.s.idle(); // a trashed file has nothing to read: idle
    expect(r.x.calls).toHaveLength(1);
    r.s.hold(null);
    new LibraryRepository(db).restore([a.itemId]);
    r.s.libraryChanged('restore');
    await r.s.idle();
    expect(r.x.calls).toHaveLength(2);
    expect(r.x.calls[1]!.startPage).toBe(40);
    expect(repo.pageCount(a.sha)).toBe(100);
    expect(job(a.sha).state).toBe('done');
  });

  it('a stop by the trash costs no attempt: three trash and restore rounds of a running job, and it still finishes; a crash does count', async () => {
    const a = addPdf(1);
    const crash = rig([async () => { crash.busy.value = true; return { kind: 'crashed' }; }]);
    crash.s.firstIdle();
    crash.s.startupChecked();
    crash.s.control('now');
    await until(() => job(a.sha).state === 'queued' && job(a.sha).attempts === 1); // positive control: a failure is counted
    db.prepare('DELETE FROM jobs').run();
    const r = rig([reads(100), reads(100), reads(100), reads(100)]);
    r.s.hold(20);
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    const lib = new LibraryRepository(db);
    for (let round = 0; round < 3; round++) {
      await until(() => r.s.held());
      lib.trash([a.itemId]);
      r.s.libraryChanged('trash');
      await until(() => !r.s.held() && job(a.sha)?.state === 'queued' && r.x.calls.length === round + 1);
      expect(job(a.sha).attempts).toBe(0);
      lib.restore([a.itemId]);
      r.s.libraryChanged('restore');
    }
    await until(() => r.s.held());
    r.s.hold(null);
    await r.s.idle();
    expect(job(a.sha)).toMatchObject({ state: 'done', attempts: 1 });
  });

  it('a trashed copy while another live item has the same file does not stop the job', async () => {
    const a = addPdf(1);
    // a second item with the same bytes
    const asset = db.prepare('SELECT id FROM assets WHERE sha256 = ?').pluck().get(a.sha) as string;
    const rev = db.prepare('SELECT id FROM source_revisions WHERE asset_id = ?').pluck().get(asset) as string;
    const twin = newId();
    new LibraryRepository(db).insertItemsForAsset([{ id: twin, type: 'pdf', title: 'twin', createdAt: T(2), metadataJson: '{}', assetId: asset, revisionId: rev }]);
    const r = rig([reads(100)]);
    r.s.hold(20);
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    await until(() => r.s.held());
    new LibraryRepository(db).trash([a.itemId]);
    r.s.libraryChanged('trash');
    expect(r.x.stops).toBe(0);
    r.s.hold(null);
    await r.s.idle();
    expect(job(a.sha).state).toBe('done');
  });

  it('a purge that took the job away stops the worker; the release changes nothing', async () => {
    const a = addPdf(1);
    const r = rig([reads(100)]);
    r.s.hold(20);
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    await until(() => r.s.held());
    db.prepare('DELETE FROM jobs').run();
    r.s.libraryChanged('purge');
    expect(r.x.stops).toBe(1);
    await r.s.idle();
    expect(repo.jobs()).toEqual([]);
    expect(a.sha).toBeTruthy();
  });

  it('a purge of something else leaves the running job alone', async () => {
    addPdf(1);
    const r = rig([reads(100)]);
    r.s.hold(20);
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    await until(() => r.s.held());
    r.s.libraryChanged('purge');
    expect(r.x.stops).toBe(0);
    r.s.hold(null);
    await r.s.idle();
  });
});

describe('dispose', () => {
  it('kills the worker and starts nothing more; a pending idle() is let go; the running job goes back to the queue with its attempt given back', async () => {
    const a = addPdf(1);
    const r = rig([reads(100), reads(1)]);
    r.s.hold(20);
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    await until(() => r.s.held());
    expect(job(a.sha)).toMatchObject({ state: 'running', attempts: 1 }); // positive control: the attempt was counted at the start
    const settled = vi.fn();
    void r.s.idle().then(settled);
    r.s.dispose();
    expect(r.x.disposed).toBe(true);
    await until(() => settled.mock.calls.length === 1);
    r.s.wake();
    await tick();
    expect(r.x.calls).toHaveLength(1);
    expect(job(a.sha)).toMatchObject({ state: 'queued', attempts: 0 });
  });

  it('touches the database no more once it is disposed and closed', async () => {
    addPdf(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const r = rig([reads(100)]);
      r.s.hold(20);
      r.s.firstIdle();
      r.s.startupChecked();
      r.s.control('now');
      await until(() => r.s.held());
      r.progress.request = 0;
      r.progress.now = 0;
      r.s.dispose();
      db.close();
      for (let i = 0; i < 5; i++) await tick();
      expect(warn).not.toHaveBeenCalled();
      expect(r.progress.request + r.progress.now).toBe(0);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('library broadcasts', () => {
  it('a restore starts the next run after the handler that announced it, not inside it', async () => {
    const a = addPdf(1);
    const r = rig([reads(100), reads(100)]);
    r.s.hold(20);
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    await until(() => r.s.held());
    new LibraryRepository(db).trash([a.itemId]);
    r.s.libraryChanged('trash');
    await until(() => !r.s.held() && job(a.sha).state === 'queued');
    r.s.hold(null);
    new LibraryRepository(db).restore([a.itemId]);
    const calls = r.x.calls.length;
    r.s.libraryChanged('restore');
    expect(r.x.calls).toHaveLength(calls); // nothing ran inside the call
    await until(() => r.x.calls.length === calls + 1);
  });
});

describe('state (E2E textState)', () => {
  const whats = (s: TextScheduler) => s.state().events.map((e) => (e.detail === undefined ? e.what : `${e.what} ${e.detail}`));

  it('says what the first start still waits for, then the trail of a run, with times', async () => {
    const a = addPdf(1);
    const r = rig([reads(2)], { paused: true });
    r.s.firstIdle();
    r.s.control('now');
    expect(r.s.state()).toMatchObject({
      live: false, paused: false, looping: false, sawFirstIdle: true, sawChecked: false, skipDelay: true, current: null, lastError: null,
    });
    expect(whats(r.s)).toEqual(['firstIdle', 'start-waits paused', 'control now', 'start-waits startupChecked']);
    const before = Date.now();
    r.s.startupChecked();
    await r.s.idle();
    const id = (db.prepare('SELECT id FROM jobs').pluck().get() as string).slice(0, 8);
    expect(job(a.sha).state).toBe('done');
    expect(whats(r.s).slice(4)).toEqual([
      'startupChecked', 'begin', 'loop-start', `job-start ${id}`, 'idle-wait', `job-end ${id} done`, 'loop-end empty', 'idle-settled 1',
    ]);
    expect(r.s.state()).toMatchObject({ live: true, looping: false, sawChecked: true, current: null, idleWaiters: 0, unavailable: 0 });
    for (const e of r.s.state().events.slice(4)) expect(e.at).toBeGreaterThanOrEqual(before);
  });

  it('a loop that throws before its job starts: the job stays queued with no attempt, idle() waits, and the state keeps the code', async () => {
    const a = addPdf(1);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const busy = Object.assign(new Error('database is locked: /Users/someone/Library/papers/secret.pdf'), { code: 'SQLITE_BUSY' });
      const r = rig([reads(1)], { paused: true, files: () => { throw busy; } });
      r.s.firstIdle();
      r.s.startupChecked();
      r.s.control('now');
      const settled = vi.fn();
      void r.s.idle().then(settled);
      await tick();
      await tick();
      expect(settled).not.toHaveBeenCalled();
      expect(job(a.sha)).toMatchObject({ state: 'queued', attempts: 0 }); // what the database of a stalled run shows
      expect(r.s.state()).toMatchObject({ live: true, looping: false, lastError: 'INTERNAL/SQLITE_BUSY', idleWaiters: 1 });
      expect(whats(r.s).slice(-4)).toEqual(['loop-start', 'idle-wait', 'loop-error INTERNAL/SQLITE_BUSY', 'loop-end error']);
      expect(warn.mock.calls).toEqual([['[text] the body text loop stopped: INTERNAL/SQLITE_BUSY']]);
      expect(JSON.stringify(r.s.state())).not.toContain('secret');
    } finally {
      warn.mockRestore();
    }
  });

  it('a loop parked on a busy work line says so, and that the line came free', async () => {
    const a = addPdf(1);
    const r = rig([reads(1)]);
    r.busy.value = true;
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    expect(r.s.state()).toMatchObject({ live: true, looping: true, laneBusy: true });
    expect(whats(r.s).at(-1)).toBe('lane-wait');
    r.busy.release();
    await r.s.idle();
    expect(job(a.sha).state).toBe('done');
    expect(whats(r.s)).toContain('lane-free');
    expect(r.s.state()).toMatchObject({ looping: false, laneBusy: false });
  });

  it('a wake before the first start is refused and says why; an unavailable file is counted', async () => {
    const gone = addPdf(1);
    const r = rig([], { paused: true, files: () => null });
    r.s.wake();
    expect(whats(r.s)).toEqual(['wake', 'kick-refused not-live']);
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    await r.s.idle();
    expect(r.s.state().unavailable).toBe(1);
    expect(whats(r.s)).toContain(`job-skip ${(db.prepare('SELECT id FROM jobs').pluck().get() as string).slice(0, 8)} unavailable`);
    expect(job(gone.sha)).toMatchObject({ state: 'queued', attempts: 0 });
  });

  it('a held batch is told apart from a stuck worker: what is held and after how many pages', async () => {
    addPdf(1);
    const r = rig([reads(100)]);
    r.s.hold(20);
    r.s.firstIdle();
    r.s.startupChecked();
    r.s.control('now');
    await until(() => r.s.held());
    expect(r.s.state()).toMatchObject({ looping: true, held: 1, holdAfter: 20 });
    r.s.hold(null);
    await r.s.idle();
    expect(r.s.state()).toMatchObject({ looping: false, held: 0, holdAfter: null });
  });

  it(`keeps the newest ${EVENTS_KEPT} steps`, () => {
    const r = rig([], { paused: true });
    r.s.firstIdle();
    for (let i = 0; i < 100; i++) r.s.libraryChanged('collections');
    const { events } = r.s.state();
    expect(events).toHaveLength(EVENTS_KEPT);
    expect(events.every((e) => e.what === 'libraryChanged' && e.detail === 'collections')).toBe(true); // the oldest went first
  });
});
