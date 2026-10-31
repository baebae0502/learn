import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IDLE_IMPORT_STATE, LearnError,
  type DuplicateCard, type ErrorCode, type ImportOutcome, type ImportQueueState, type ImportReport, type LibraryItem,
} from '@learn/domain';
import type { ImportOptions } from '@learn/library';
import { createImportQueue, type DuplicateAnswer, type DuplicateQuestion, type ImportBatch, type ImportQueueDeps } from './import-queue';
import { createJobLane, type JobLane } from './lane';

afterEach(() => {
  vi.useRealTimers();
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}
function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const imported = (p: string, collectionId?: string | null): ImportOutcome => ({
  status: 'imported',
  path: p,
  item: { id: `item:${p}` } as LibraryItem,
  ...(collectionId ? { collectionId } : {}),
});
const duplicate = (p: string, existingItemId: string): ImportOutcome => ({ status: 'duplicate', path: p, existingItemId });
const failed = (p: string, code: ErrorCode, message: string): ImportOutcome => ({ status: 'failed', path: p, code, message });
const card = (id: string): DuplicateCard => ({ title: `자료 ${id}`, type: 'pdf', size: 1000, createdAt: '2026-10-31T00:00:00.000Z', storageMode: 'managed' });
const SKIP: DuplicateAnswer = { choice: 'skip', applyToRest: false, askedOn: null };
const until = (signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve) => {
    if (!signal) return;
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });

/**
 * A fake importer: `outcome(path, opts)` answers each call. `hold(path, bytes)` keeps the next import of that path
 * running — after reporting `bytes` read — until released or its signal aborts; a stopped file answers CANCELLED, as
 * the real importer does.
 */
function fakeImporter(outcome: (p: string, opts: ImportOptions) => ImportOutcome = (p, o) => imported(p, o.collectionId)) {
  const calls: Array<{ path: string; opts: ImportOptions }> = [];
  const holds = new Map<string, { bytes: number; started: Deferred<void>; release: Deferred<void> }>();
  let running = 0;
  let mostAtOnce = 0;
  return {
    calls,
    mostAtOnce: () => mostAtOnce,
    hold(p: string, bytes = 0) {
      const h = { bytes, started: deferred(), release: deferred() };
      holds.set(p, h);
      return { started: h.started.promise, release: () => h.release.resolve() };
    },
    importer: {
      async importOne(p: string, opts: ImportOptions): Promise<ImportOutcome> {
        calls.push({ path: p, opts });
        running++;
        mostAtOnce = Math.max(mostAtOnce, running);
        try {
          const h = holds.get(p);
          if (h) {
            holds.delete(p);
            if (h.bytes > 0) opts.onBytes?.(h.bytes);
            h.started.resolve();
            await Promise.race([h.release.promise, until(opts.signal)]);
          } else await Promise.resolve();
          if (opts.signal?.aborted) return failed(p, 'CANCELLED', '가져오기를 취소했습니다.');
          return outcome(p, opts);
        } finally {
          running--;
        }
      },
    },
  };
}

function setup(over: {
  importer?: ReturnType<typeof fakeImporter>;
  answers?: DuplicateAnswer[];
  cards?: Record<string, DuplicateCard | null>;
  sizes?: Record<string, number>;
  lane?: JobLane;
  deps?: Partial<ImportQueueDeps>;
} = {}) {
  const fake = over.importer ?? fakeImporter();
  const lane = over.lane ?? createJobLane();
  const questions: Array<{ owner: number } & DuplicateQuestion> = [];
  const answers = [...(over.answers ?? [])];
  const filed: Array<[string, string[]]> = [];
  const announced: string[][] = [];
  const queue = createImportQueue({
    lane,
    importer: () => fake.importer,
    card: (id) => {
      const known = over.cards?.[id];
      return known === undefined ? card(id) : known;
    },
    ask: async (owner, q) => {
      questions.push({ owner, ...q });
      return answers.shift() ?? { choice: 'skip', applyToRest: false, askedOn: owner };
    },
    fileExisting: (collectionId, itemIds) => {
      filed.push([collectionId, [...itemIds]]);
      return itemIds.length;
    },
    announce: (itemIds) => announced.push(itemIds),
    stat: async (p) => over.sizes?.[p] ?? 10,
    warn: () => {},
    ...over.deps,
  });
  const reports: Array<{ report: ImportReport; openIn: number | null }> = [];
  queue.onFinished((report, openIn) => reports.push({ report, openIn }));
  const states: ImportQueueState[] = [];
  queue.onProgress((s) => states.push(s));
  /** The next run's report (ask before putting files in). */
  const nextReport = () =>
    new Promise<ImportReport>((resolve) => {
      const off = queue.onFinished((r) => {
        off();
        resolve(r);
      });
    });
  return { queue, fake, lane, questions, filed, announced, reports, states, nextReport };
}
const batch = (paths: string[], over: Partial<ImportBatch> = {}): ImportBatch => ({ paths, mode: 'managed', collectionId: null, owner: 1, ...over });
const report = (over: Partial<ImportReport>): ImportReport => ({
  imported: 0, filed: 0, filedExisting: 0, failed: [], openItemId: null, requested: 0, cancelled: false, mode: 'managed', collectionId: null, ...over,
});

describe('order and batches (spec 3.1)', () => {
  it('imports one file at a time, batch after batch, each with its own mode, collection and titles', async () => {
    const h = setup();
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/a1.pdf', '/in/a2.pdf']));
    h.queue.enqueue(batch(['/in/b1.mp4'], { mode: 'linked', collectionId: 'c-1', titles: { '/in/b1.mp4': '강의 4' } }));
    expect(await done).toEqual(report({ imported: 3, filed: 1, requested: 3, mode: null, collectionId: null }));
    expect(h.fake.calls.map((c) => [c.path, c.opts.mode, c.opts.collectionId, c.opts.title])).toEqual([
      ['/in/a1.pdf', 'managed', null, undefined],
      ['/in/a2.pdf', 'managed', null, undefined],
      ['/in/b1.mp4', 'linked', 'c-1', '강의 4'],
    ]);
    expect(h.fake.mostAtOnce()).toBe(1);
    expect(h.reports).toHaveLength(1); // one run, one report
    expect(h.queue.state()).toEqual(IDLE_IMPORT_STATE);
  });

  it('names the one mode and collection every batch of a run shared', async () => {
    const h = setup();
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/a.pdf'], { mode: 'linked', collectionId: 'c-1' }));
    h.queue.enqueue(batch(['/in/b.pdf'], { mode: 'linked', collectionId: 'c-1' }));
    expect(await done).toEqual(report({ imported: 2, filed: 2, requested: 2, mode: 'linked', collectionId: 'c-1' }));
  });

  it('files put in while it runs join the run: the total grows, and one report covers them all', async () => {
    const h = setup();
    const held = h.fake.hold('/in/a.pdf');
    const done = h.nextReport();
    expect(h.queue.enqueue(batch(['/in/a.pdf', '/in/b.pdf']))).toBe(2);
    await held.started;
    expect(h.queue.enqueue(batch(['/in/c.pdf', '/in/d.pdf', '/in/e.pdf']))).toBe(5);
    expect(h.queue.state()).toMatchObject({ state: 'running', done: 0, total: 5, current: 'a.pdf' });
    held.release();
    expect(await done).toEqual(report({ imported: 5, requested: 5 }));
    expect(h.fake.calls.map((c) => c.path)).toEqual(['/in/a.pdf', '/in/b.pdf', '/in/c.pdf', '/in/d.pdf', '/in/e.pdf']);
  });

  it('starts a new run once idle: a report of its own, counted from zero', async () => {
    const h = setup();
    const first = h.nextReport();
    h.queue.enqueue(batch(['/in/a.pdf']));
    await first;
    const second = h.nextReport();
    expect(h.queue.enqueue(batch(['/in/b.pdf']))).toBe(1);
    expect(await second).toEqual(report({ imported: 1, requested: 1 }));
    expect(h.reports).toHaveLength(2);
  });

  it('refuses a batch with a relative path and changes nothing; an empty batch is nothing', () => {
    const h = setup();
    expect(() => h.queue.enqueue(batch(['/in/a.pdf', 'b.pdf']))).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(h.queue.enqueue(batch([]))).toBe(0);
    expect(h.queue.state()).toEqual(IDLE_IMPORT_STATE);
    expect(h.fake.calls).toEqual([]);
  });
});

describe('progress (spec 3.3)', () => {
  it('bytes: the total is the sizes when put in; a file counts its hashed bytes, then all of its size; only the file name shows', async () => {
    const h = setup({ sizes: { '/in/folder/a.pdf': 100, '/in/folder/b.pdf': 300 } });
    const a = h.fake.hold('/in/folder/a.pdf', 40);
    const b = h.fake.hold('/in/folder/b.pdf', 120);
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/folder/a.pdf', '/in/folder/b.pdf']));
    await a.started;
    await vi.waitFor(() => expect(h.queue.state()).toEqual({ state: 'running', done: 0, total: 2, bytesDone: 40, bytesTotal: 400, current: 'a.pdf' }));
    a.release();
    await b.started;
    expect(h.queue.state()).toEqual({ state: 'running', done: 1, total: 2, bytesDone: 220, bytesTotal: 400, current: 'b.pdf' });
    b.release();
    await done;
    await vi.waitFor(() => expect(h.states.at(-1)).toEqual(IDLE_IMPORT_STATE));
  });

  it('sends at most ten progress notices a second, however fast the bytes come', async () => {
    vi.useFakeTimers();
    const importer = {
      async importOne(p: string, opts: ImportOptions): Promise<ImportOutcome> {
        for (let i = 0; i < 1000; i++) {
          opts.onBytes?.(1000);
          await new Promise((r) => setTimeout(r, 1));
        }
        return imported(p);
      },
    };
    const h = setup({ sizes: { '/in/big.mp4': 1_000_000 }, deps: { importer: () => importer } });
    const stamps: number[] = [];
    h.queue.onProgress(() => stamps.push(Date.now()));
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/big.mp4']));
    await vi.advanceTimersByTimeAsync(1500);
    await done;
    const busiest = Math.max(...stamps.map((s) => stamps.filter((x) => x >= s && x < s + 1000).length));
    expect(busiest).toBeLessThanOrEqual(10);
    expect(stamps.length).toBeGreaterThanOrEqual(10);
  });
});

describe('duplicates at the end (spec 3.4)', () => {
  const dupOf: Record<string, string> = { '/in/d1.pdf': 'e-1', '/in/d2.pdf': 'e-2', '/in/d3.pdf': 'e-3' };
  const withDuplicates = () =>
    fakeImporter((p, o) => {
      const existing = dupOf[p];
      return existing !== undefined && !o.allowDuplicate ? duplicate(p, existing) : imported(p, o.collectionId);
    });

  it('imports every other file first, then asks each duplicate in order, saying how many are left', async () => {
    const h = setup({ importer: withDuplicates() });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/d1.pdf', '/in/n1.pdf', '/in/d2.pdf'], { owner: 7 }));
    expect(await done).toEqual(report({ imported: 1, requested: 3 }));
    expect(h.fake.calls.map((c) => c.path)).toEqual(['/in/d1.pdf', '/in/n1.pdf', '/in/d2.pdf']);
    expect(h.questions).toEqual([
      { owner: 7, fileName: 'd1.pdf', existing: card('e-1'), remaining: 1 },
      { owner: 7, fileName: 'd2.pdf', existing: card('e-2'), remaining: 0 },
    ]);
  });

  it('waits for the answer as waiting-choice, naming the file', async () => {
    const answer = deferred<DuplicateAnswer>();
    const h = setup({ importer: withDuplicates(), deps: { ask: () => answer.promise } });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/d1.pdf', '/in/n1.pdf']));
    await vi.waitFor(() => expect(h.queue.state()).toMatchObject({ state: 'waiting-choice', done: 1, total: 2, current: 'd1.pdf' }));
    answer.resolve({ choice: 'skip', applyToRest: false, askedOn: 1 });
    expect(await done).toEqual(report({ imported: 1, requested: 2 }));
  });

  it('새 자료로 추가 with the box ticked adds every remaining duplicate without asking again', async () => {
    const h = setup({ importer: withDuplicates(), answers: [{ choice: 'add', applyToRest: true, askedOn: 1 }] });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/d1.pdf', '/in/d2.pdf', '/in/d3.pdf'], { collectionId: 'c-1' }));
    expect(await done).toEqual(report({ imported: 3, filed: 3, requested: 3, collectionId: 'c-1' }));
    expect(h.questions).toHaveLength(1);
    expect(h.fake.calls.filter((c) => c.opts.allowDuplicate).map((c) => [c.path, c.opts.collectionId])).toEqual([
      ['/in/d1.pdf', 'c-1'],
      ['/in/d2.pdf', 'c-1'],
      ['/in/d3.pdf', 'c-1'],
    ]);
  });

  it('건너뛰기 with the box ticked skips the rest', async () => {
    const h = setup({ importer: withDuplicates(), answers: [{ choice: 'skip', applyToRest: true, askedOn: 1 }] });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/d1.pdf', '/in/d2.pdf', '/in/d3.pdf']));
    expect(await done).toEqual(report({ requested: 3 }));
    expect(h.questions).toHaveLength(1);
    expect(h.fake.calls.some((c) => c.opts.allowDuplicate)).toBe(false);
  });

  it('기존 자료 열기 with the box ticked opens that item and skips the rest, on the window it was answered on', async () => {
    const h = setup({ importer: withDuplicates(), answers: [{ choice: 'open', applyToRest: true, askedOn: 9 }] });
    h.queue.enqueue(batch(['/in/d1.pdf', '/in/d2.pdf', '/in/d3.pdf'], { owner: 7 }));
    await vi.waitFor(() => expect(h.reports).toHaveLength(1));
    expect(h.reports[0]).toEqual({ report: report({ openItemId: 'e-1', requested: 3 }), openIn: 9 });
    expect(h.questions).toHaveLength(1);
  });

  it('without the box each duplicate is asked; the last 기존 자료 열기 wins', async () => {
    const h = setup({
      importer: withDuplicates(),
      answers: [
        { choice: 'open', applyToRest: false, askedOn: 7 },
        { choice: 'add', applyToRest: false, askedOn: 7 },
        { choice: 'open', applyToRest: false, askedOn: 7 },
      ],
    });
    h.queue.enqueue(batch(['/in/d1.pdf', '/in/d2.pdf', '/in/d3.pdf'], { owner: 7 }));
    await vi.waitFor(() => expect(h.reports).toHaveLength(1));
    expect(h.reports[0]).toEqual({ report: report({ imported: 1, openItemId: 'e-3', requested: 3 }), openIn: 7 });
    expect(h.questions.map((q) => q.remaining)).toEqual([2, 1, 0]);
  });

  it('건너뛰기 in an import into a collection files the existing items there, in one call after the questions', async () => {
    const h = setup({ importer: withDuplicates() });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/d1.pdf', '/in/d2.pdf'], { collectionId: 'c-1' }));
    h.queue.enqueue(batch(['/in/d3.pdf']));
    expect(await done).toEqual(report({ filedExisting: 2, requested: 3, collectionId: null }));
    expect(h.filed).toEqual([['c-1', ['e-1', 'e-2']]]);
  });

  it('a duplicate whose item left the library meanwhile (the trash) comes in as a new item, unasked', async () => {
    let first = true;
    const fake = fakeImporter((p) => {
      if (first) {
        first = false;
        return duplicate(p, 'e-1');
      }
      return imported(p);
    });
    const h = setup({ importer: fake, cards: { 'e-1': null } });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/d1.pdf']));
    expect(await done).toEqual(report({ imported: 1, requested: 1 }));
    expect(h.questions).toEqual([]);
    expect(fake.calls.map((c) => c.opts.allowDuplicate)).toEqual([undefined, undefined]);
  });

  it('a question that fails to show is 건너뛰기 for that file', async () => {
    const h = setup({ importer: withDuplicates(), deps: { ask: async () => { throw new LearnError('INTERNAL', '창을 찾을 수 없습니다.'); } } });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/d1.pdf', '/in/d2.pdf']));
    expect(await done).toEqual(report({ requested: 2 }));
  });
});

describe('취소 (spec 3.5)', () => {
  it('stops the file under way, drops the files not started and does not ask the gathered duplicates', async () => {
    const fake = fakeImporter((p) => (p === '/in/d1.pdf' ? duplicate(p, 'e-1') : imported(p)));
    const h = setup({ importer: fake });
    const held = fake.hold('/in/b.pdf');
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/d1.pdf', '/in/a.pdf', '/in/b.pdf', '/in/c.pdf']));
    await held.started;
    h.queue.cancel();
    expect(await done).toEqual(report({ imported: 1, requested: 4, cancelled: true }));
    expect(fake.calls.map((c) => c.path)).toEqual(['/in/d1.pdf', '/in/a.pdf', '/in/b.pdf']);
    expect(fake.calls[2]!.opts.signal?.aborted).toBe(true);
    expect(h.questions).toEqual([]);
    expect(h.queue.state()).toEqual(IDLE_IMPORT_STATE);
  });

  it('a file that committed before it saw the stop still counts', async () => {
    const started = deferred();
    const release = deferred();
    const importer = {
      async importOne(p: string): Promise<ImportOutcome> {
        if (p === '/in/b.pdf') {
          started.resolve();
          await release.promise;
        }
        return imported(p);
      },
    };
    const h = setup({ deps: { importer: () => importer } });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/a.pdf', '/in/b.pdf', '/in/c.pdf']));
    await started.promise;
    h.queue.cancel();
    expect(h.queue.state()).toMatchObject({ state: 'running', current: 'b.pdf' }); // still stopping
    release.resolve();
    expect(await done).toEqual(report({ imported: 2, requested: 3, cancelled: true }));
  });

  it('files put in after 취소 make a new run, while the stopped file is still stopping', async () => {
    const h = setup();
    const held = h.fake.hold('/in/a.pdf');
    h.queue.enqueue(batch(['/in/a.pdf']));
    await held.started;
    h.queue.cancel();
    expect(h.queue.enqueue(batch(['/in/b.pdf']))).toBe(1);
    await vi.waitFor(() => expect(h.reports).toHaveLength(2));
    expect(h.reports.map((r) => r.report)).toEqual([report({ requested: 1, cancelled: true }), report({ imported: 1, requested: 1 })]);
  });

  it('취소 during a question: the answer is not acted on and the rest are not asked', async () => {
    const answer = deferred<DuplicateAnswer>();
    const fake = fakeImporter((p, o) => (o.allowDuplicate ? imported(p) : duplicate(p, 'e-1')));
    const h = setup({
      importer: fake,
      deps: { ask: (_owner, _q, signal) => Promise.race([answer.promise, until(signal).then(() => SKIP)]) },
    });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/d1.pdf', '/in/d2.pdf']));
    await vi.waitFor(() => expect(h.queue.state().state).toBe('waiting-choice'));
    h.queue.cancel();
    expect(await done).toEqual(report({ requested: 2, cancelled: true }));
    answer.resolve({ choice: 'add', applyToRest: true, askedOn: 1 });
    await Promise.resolve();
    expect(fake.calls.some((c) => c.opts.allowDuplicate)).toBe(false);
  });

  it('취소 with nothing running does nothing', () => {
    const h = setup();
    h.queue.cancel();
    expect(h.reports).toEqual([]);
  });
});

describe('the work line (spec 3.1)', () => {
  it('waits behind a running backup as waiting-job, then runs', async () => {
    const lane = createJobLane();
    const backup = deferred();
    const backupDone = lane.run('backup', () => backup.promise);
    const h = setup({ lane });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/a.pdf']));
    expect(h.queue.state()).toMatchObject({ state: 'waiting-job', done: 0, total: 1 });
    await Promise.resolve();
    expect(h.fake.calls).toEqual([]);
    backup.resolve();
    await backupDone;
    expect(await done).toEqual(report({ imported: 1, requested: 1 }));
  });

  it('a backup asked for while it imports runs once the queue is empty, files put in meanwhile included', async () => {
    const h = setup();
    const held = h.fake.hold('/in/a.pdf');
    h.queue.enqueue(batch(['/in/a.pdf']));
    await held.started;
    const order: string[] = [];
    const backup = h.lane.run('backup', async () => {
      order.push(`backup after ${h.fake.calls.length} imports`);
    });
    h.queue.enqueue(batch(['/in/b.pdf']));
    held.release();
    await backup;
    expect(order).toEqual(['backup after 2 imports']);
    expect(h.lane.busy()).toBe(null);
  });

  it('취소 while waiting behind another job: nothing runs, the report says none of N', async () => {
    const lane = createJobLane();
    const backup = deferred();
    void lane.run('backup', () => backup.promise);
    const h = setup({ lane });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/a.pdf', '/in/b.pdf']));
    h.queue.cancel();
    expect(await done).toEqual(report({ requested: 2, cancelled: true }));
    backup.resolve();
    await lane.idle();
    expect(h.fake.calls).toEqual([]);
  });

  it("the line's stop (quitting) stops the queue as 취소 does", async () => {
    const h = setup();
    const held = h.fake.hold('/in/a.pdf');
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/a.pdf', '/in/b.pdf']));
    await held.started;
    h.lane.cancelAll();
    expect(await done).toEqual(report({ requested: 2, cancelled: true }));
    await h.lane.idle();
    expect(h.fake.calls.map((c) => c.path)).toEqual(['/in/a.pdf']);
  });

  it('quitting while it waits behind a job drops it: the report says none of N', async () => {
    const lane = createJobLane();
    const backup = deferred();
    void lane.run('backup', () => backup.promise).catch(() => {});
    const h = setup({ lane });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/a.pdf']));
    lane.cancelAll();
    expect(await done).toEqual(report({ requested: 1, cancelled: true }));
    backup.resolve();
    await lane.idle();
    expect(h.fake.calls).toEqual([]);
  });
});

describe('results', () => {
  it('lists failures by file name with main\'s message; the run goes on past them', async () => {
    const message = '지원하지 않는 형식입니다. 지금은 PDF와\u00a0동영상(MP4\u00a0·\u00a0MOV\u00a0·\u00a0WebM)을 가져올\u00a0수 있습니다.';
    const h = setup({ importer: fakeImporter((p) => (p.endsWith('.txt') ? failed(p, 'UNSUPPORTED_TYPE', message) : imported(p))) });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/folder/notes.txt', '/in/a.pdf']));
    expect(await done).toEqual(report({ imported: 1, requested: 2, failed: [{ name: 'notes.txt', message }] }));
  });

  it('with no library open each file fails with the reason, and the run still ends', async () => {
    const h = setup({ deps: { importer: () => { throw new LearnError('LIBRARY_UNAVAILABLE', '라이브러리를 열 수 없습니다.'); } } });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/a.pdf', '/in/b.pdf']));
    expect(await done).toEqual(report({
      requested: 2,
      failed: [{ name: 'a.pdf', message: '라이브러리를 열 수 없습니다.' }, { name: 'b.pdf', message: '라이브러리를 열 수 없습니다.' }],
    }));
  });

  it("runs a batch's after-commit step for each file it imported; that step failing fails nothing", async () => {
    const seen: string[] = [];
    const h = setup();
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/a.pdf', '/in/b.pdf'], {
      afterCommit: async (o) => {
        seen.push(o.item.id);
        if (o.path === '/in/a.pdf') throw new Error('gone');
      },
    }));
    h.queue.enqueue(batch(['/in/c.pdf']));
    expect(await done).toEqual(report({ imported: 3, requested: 3 }));
    expect(seen).toEqual(['item:/in/a.pdf', 'item:/in/b.pdf']);
  });

  it('announces the items it added at most once a second, and the rest as the run ends', async () => {
    vi.useFakeTimers();
    const importer = {
      async importOne(p: string): Promise<ImportOutcome> {
        await new Promise((r) => setTimeout(r, 300));
        return imported(p);
      },
    };
    const h = setup({ deps: { importer: () => importer } });
    const done = h.nextReport();
    h.queue.enqueue(batch(['/in/1.pdf', '/in/2.pdf', '/in/3.pdf', '/in/4.pdf', '/in/5.pdf']));
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(h.announced).toEqual([['item:/in/1.pdf'], ['item:/in/2.pdf', 'item:/in/3.pdf', 'item:/in/4.pdf'], ['item:/in/5.pdf']]);
  });
});
