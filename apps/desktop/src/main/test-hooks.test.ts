import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ERROR_COPY, IDLE_BACKUP_PROGRESS, IDLE_IMPORT_STATE, IDLE_RESTORE_PROGRESS, itemMetadataSchema, newId, nowIso, toLearnError, type ImportReport, type LibraryItem } from '@learn/domain';
import { CollectionsRepository, ConversationsRepository, LibraryRepository, TagsRepository, migrate, openDatabase, readOrganizeSnapshot, type Db } from '@learn/db';
import { checkLibrary, ensureLayout, libraryLayout, managedRelativePath, refreshLinkedAvailability, type BackupHooks } from '@learn/library';
import {
  createImportPause, fsyncProbe, installTestHooks, readFakeLog, seedAssets, seedItems, seedOrganize, seedSessions, stageCommitFailures,
  type LearnTestHooks, type OrganizeSeedDeps, type SeedAssetsInput, type SeedAssetsResult, type SeedOrganizeInput, type SeedRepo, type SeedRow, type TutorHooksDeps,
} from './test-hooks';
import type { TextScheduler } from './text/scheduler';

const FROM = { id: 'from-id', type: 'video', storageMode: 'managed', assetId: 'asset-1', revisionId: 'rev-1' } as LibraryItem;
const ROWS: SeedRow[] = [
  { title: '세포 신호 1', creators: ['김민지', 'Alice Kim'], year: 2019, createdAt: '2026-10-01T00:00:00.000Z' },
  { title: 'Kinetics 2', creators: [], year: null, createdAt: '2026-09-30T23:59:00.000Z' },
];
type Inserted = Parameters<SeedRepo['insertItemsForAsset']>[0];
function fakeRepo(from: LibraryItem | undefined): { repo: SeedRepo; inserted: Inserted[] } {
  const inserted: Inserted[] = [];
  const repo: SeedRepo = {
    getItem: (id) => (from && id === from.id ? from : undefined),
    insertItemsForAsset: (rows) => {
      inserted.push(rows);
    },
  };
  return { repo, inserted };
}

describe('E2E seeding hook (P-22)', () => {
  it('builds rows that share the source item\'s asset and revision, with schema-v1 metadata, in one insert', () => {
    const { repo, inserted } = fakeRepo(FROM);
    let n = 0;
    expect(seedItems(repo, { fromItemId: 'from-id', rows: ROWS }, () => `id-${++n}`)).toEqual(['id-1', 'id-2']);
    expect(inserted).toHaveLength(1); // one call: one transaction
    const [a, b] = inserted[0]!;
    expect(a).toMatchObject({ id: 'id-1', type: 'video', title: '세포 신호 1', createdAt: '2026-10-01T00:00:00.000Z', assetId: 'asset-1', revisionId: 'rev-1' });
    expect(itemMetadataSchema.parse(JSON.parse(a!.metadataJson))).toEqual({ creators: [{ name: '김민지', role: 'author' }, { name: 'Alice Kim', role: 'author' }], date: '2019' });
    expect(JSON.parse(b!.metadataJson)).toEqual({ creators: [] });
  });
  it("puts a row's abstract and memo into its metadata, as schema v1", () => {
    const { repo, inserted } = fakeRepo(FROM);
    seedItems(repo, { fromItemId: 'from-id', rows: [{ ...ROWS[0]!, abstract: '긴 초록', extra: '긴 메모' }, ROWS[1]!] }, () => 'x');
    const [a, b] = inserted[0]!;
    expect(itemMetadataSchema.parse(JSON.parse(a!.metadataJson))).toMatchObject({ abstract: '긴 초록', extra: '긴 메모' });
    expect(JSON.parse(b!.metadataJson)).toEqual({ creators: [] });
  });
  it('refuses an unknown source item and a linked one (the seeded items share a managed copy)', () => {
    expect(() => seedItems(fakeRepo(undefined).repo, { fromItemId: 'from-id', rows: ROWS })).toThrow(/unknown/);
    expect(() => seedItems(fakeRepo({ ...FROM, storageMode: 'linked' }).repo, { fromItemId: 'from-id', rows: ROWS })).toThrow(/managed/);
  });
  it('installs globalThis.__learnTest, whose seedItems inserts and then announces the change once', () => {
    const { repo, inserted } = fakeRepo(FROM);
    const broadcast = vi.fn();
    installTestHooks({ importCommits: () => ({}) as never, repo: () => repo, organize: () => { throw new Error('not used'); }, broadcast });
    const hooks = (globalThis as { __learnTest?: { seedItems(input: unknown): number } }).__learnTest!;
    expect(hooks.seedItems({ fromItemId: 'from-id', rows: ROWS })).toBe(2);
    expect(inserted).toHaveLength(1);
    expect(broadcast.mock.calls).toEqual([['libraryChanged', { reason: 'import' }]]);
    delete (globalThis as { __learnTest?: unknown }).__learnTest;
  });
  it("stageState reads the main window's stage as index.ts gives it, and says so when there is none to read", () => {
    const g = globalThis as { __learnTest?: LearnTestHooks };
    const state = { stage: true, fullScreen: true, pending: false };
    installTestHooks({ importCommits: () => ({}) as never, repo: () => ({}) as never, organize: () => { throw new Error('not used'); }, broadcast: vi.fn(), stage: () => state });
    try {
      expect(g.__learnTest!.stageState()).toEqual(state);
      installTestHooks({ importCommits: () => ({}) as never, repo: () => ({}) as never, organize: () => { throw new Error('not used'); }, broadcast: vi.fn() });
      expect(() => g.__learnTest!.stageState()).toThrow('stageState');
    } finally {
      delete g.__learnTest;
    }
  });
  it('also installs the IPC call counter createHandle fills', () => {
    const g = globalThis as { __learnIpcCalls?: Record<string, number> };
    delete g.__learnIpcCalls;
    installTestHooks({ importCommits: () => ({}) as never, repo: () => ({}) as never, organize: () => { throw new Error('not used'); }, broadcast: vi.fn() });
    expect(g.__learnIpcCalls).toEqual({});
    delete g.__learnIpcCalls;
  });
  it('installs the table of held channels createHandle reads, empty; holdReplies fills it and 0 takes a channel out', () => {
    const g = globalThis as { __learnIpcDelays?: Record<string, number>; __learnTest?: { holdReplies(input: { channels: string[]; ms: number }): void } };
    installTestHooks({ importCommits: () => ({}) as never, repo: () => ({}) as never, organize: () => { throw new Error('not used'); }, broadcast: vi.fn() });
    try {
      expect(g.__learnIpcDelays).toEqual({});
      g.__learnTest!.holdReplies({ channels: ['collections:move', 'collections:addItems'], ms: 400 });
      expect(g.__learnIpcDelays).toEqual({ 'collections:move': 400, 'collections:addItems': 400 });
      g.__learnTest!.holdReplies({ channels: ['collections:move'], ms: 0 });
      expect(g.__learnIpcDelays).toEqual({ 'collections:addItems': 400 });
    } finally {
      delete g.__learnIpcDelays;
      delete g.__learnTest;
      delete (globalThis as { __learnIpcCalls?: unknown }).__learnIpcCalls;
    }
  });
});

/** A library of `count` items that share one managed file, as seedItems makes them, in a real in-memory database. */
function libraryOf(count: number): { db: Db; deps: OrganizeSeedDeps; ids: string[] } {
  const db = openDatabase(':memory:');
  migrate(db, { dbFile: null });
  const repo = new LibraryRepository(db);
  const now = nowIso();
  const asset = {
    id: newId(), sha256: 'a'.repeat(64), storageMode: 'managed' as const, relativePath: 'assets/aa/aaaa', externalPath: null,
    originalName: 'lecture.pdf', mime: 'application/pdf', size: 1234, availability: 'available' as const, createdAt: now, checkedAt: now,
  };
  const revisionId = newId();
  const first = newId();
  repo.insertImported({ item: { id: first, type: 'pdf', title: 'source', createdAt: now }, asset, assetIsNew: true, revision: { id: revisionId, createdAt: now }, job: null });
  const rest = Array.from({ length: count - 1 }, (_, i) => ({
    id: newId(), type: 'pdf' as const, title: `item ${i + 2}`, createdAt: now, metadataJson: '{}', assetId: asset.id, revisionId,
  }));
  repo.insertItemsForAsset(rest);
  return { db, deps: { db, collections: new CollectionsRepository(db), tags: new TagsRepository(db) }, ids: [first, ...rest.map((r) => r.id)] };
}

const SMALL: Omit<SeedOrganizeInput, 'items'> = {
  collections: [{ name: '강의', parent: null }, { name: '1주차', parent: 0 }, { name: '논문', parent: null }],
  memberships: [[0, 0], [1, 1], [1, 2], [2, 3]],
  tags: [{ name: '복습', color: 'red', position: 2 }, { name: '읽는 중', color: null, position: null }],
  assignments: [[0, 0], [0, 1], [1, 4]],
  duplicates: [[0, 1], [2, 3, 4]],
};

describe('E2E organise seeding hook', () => {
  it('writes collections, memberships, tags and assignments that the organise snapshot then reports', () => {
    const { db, deps, ids } = libraryOf(6);
    const out = seedOrganize(deps, { ...SMALL, items: ids });
    expect(out.collectionIds).toHaveLength(3);
    expect(out.tagIds).toHaveLength(2);
    const snap = readOrganizeSnapshot(db);
    expect(snap.collections.map((c) => [c.name, c.parentId === null ? null : snap.collections.find((p) => p.id === c.parentId)!.name]).sort()).toEqual([['1주차', '강의'], ['강의', null], ['논문', null]]);
    const [lecture, week, paper] = out.collectionIds as [string, string, string];
    expect(snap.members[lecture]).toEqual([ids[0]]);
    expect([...snap.members[week]!].sort()).toEqual([ids[1]!, ids[2]!].sort());
    expect(snap.members[paper]).toEqual([ids[3]]);
    expect(snap.tags.map((t) => [t.name, t.color, t.position])).toEqual([['복습', 'red', 2], ['읽는 중', null, null]]);
    expect([...snap.tagged[out.tagIds[0]!]!].sort()).toEqual([ids[0]!, ids[1]!].sort());
    expect(snap.tagged[out.tagIds[1]!]).toEqual([ids[4]]);
  });
  it('makes the listed groups the only duplicates: one file per group, one file of its own for every other item', () => {
    const { db, deps, ids } = libraryOf(6);
    seedOrganize(deps, { ...SMALL, items: ids });
    const groups = new LibraryRepository(db).duplicateGroups().map((g) => [...g.itemIds].sort());
    expect(groups.sort()).toEqual([[ids[0]!, ids[1]!].sort(), [ids[2]!, ids[3]!, ids[4]!].sort()].sort());
    expect(readOrganizeSnapshot(db).duplicates.map((g) => g.length).sort()).toEqual([2, 3]);
    expect(db.prepare('SELECT COUNT(DISTINCT asset_id) AS n FROM item_assets').get()).toEqual({ n: 3 }); // two groups + item 5 on its own
    expect(db.prepare('SELECT COUNT(*) AS n FROM assets a WHERE NOT EXISTS (SELECT 1 FROM source_revisions r WHERE r.asset_id = a.id)').get()).toEqual({ n: 0 });
  });
  it('leaves the items on the one shared file when no groups are given', () => {
    const { db, deps, ids } = libraryOf(4);
    const { duplicates: _none, ...without } = SMALL;
    seedOrganize(deps, { ...without, memberships: [[0, 0]], assignments: [[0, 0]], items: ids });
    expect(readOrganizeSnapshot(db).duplicates).toHaveLength(1);
    expect(readOrganizeSnapshot(db).duplicates[0]).toHaveLength(4);
  });
  it('writes nothing when any part is wrong (one transaction)', () => {
    const { db, deps, ids } = libraryOf(3);
    expect(() => seedOrganize(deps, { ...SMALL, memberships: [[0, 0], [0, 99]], assignments: [], duplicates: undefined as never, items: ids })).toThrow(/item 99/);
    expect(readOrganizeSnapshot(db)).toEqual({ collections: [], tags: [], members: {}, tagged: {}, duplicates: [expect.any(Array)], trashCount: 0 });
    expect(() => seedOrganize(deps, { ...SMALL, collections: [{ name: 'a', parent: 1 }, { name: 'b', parent: null }], memberships: [], assignments: [], items: ids })).toThrow(/earlier/);
    expect(readOrganizeSnapshot(db).collections).toEqual([]);
  });
  it('announces the change once, as the item hook does, when installed', () => {
    const { deps, ids } = libraryOf(3);
    const broadcast = vi.fn();
    installTestHooks({ importCommits: () => ({}) as never, repo: () => fakeRepo(FROM).repo, organize: () => deps, broadcast });
    const hooks = (globalThis as { __learnTest?: { seedOrganize(input: unknown): { collectionIds: string[] } } }).__learnTest!;
    expect(hooks.seedOrganize({ ...SMALL, memberships: [[0, 0]], assignments: [[0, 0]], duplicates: [[0, 1]], items: ids }).collectionIds).toHaveLength(3);
    expect(broadcast.mock.calls).toEqual([['libraryChanged', { reason: 'import' }]]);
    delete (globalThis as { __learnTest?: unknown }).__learnTest;
  });
});

describe('staged import-commit failures (E2E: a full disk, spec 10)', () => {
  function thrown(fn: () => unknown): unknown {
    try {
      fn();
    } catch (e) {
      return e;
    }
    return null;
  }

  it('throws what SQLite throws while a code is set; null lets commits through again', () => {
    const committed: unknown[] = [];
    const repo = {
      insertImported: (rec: unknown) => {
        committed.push(rec);
        return true;
      },
    } as unknown as Pick<LibraryRepository, 'insertImported'>;
    const stage = stageCommitFailures(repo);
    stage('SQLITE_FULL');
    const full = thrown(() => repo.insertImported({} as never));
    expect(full).toMatchObject({ name: 'SqliteError', code: 'SQLITE_FULL', message: 'database or disk is full' });
    expect(toLearnError(full)).toMatchObject({ code: 'DISK_FULL', message: ERROR_COPY.diskFull });
    stage('SQLITE_READONLY');
    expect(toLearnError(thrown(() => repo.insertImported({} as never)))).toMatchObject({ code: 'PERMISSION_DENIED', message: ERROR_COPY.libraryDenied });
    expect(committed).toEqual([]);
    stage(null);
    expect(repo.insertImported({ n: 1 } as never)).toBe(true);
    expect(committed).toEqual([{ n: 1 }]);
  });

  it('__learnTest.failImportCommits wraps the library repository once, however often it is called', () => {
    const real = vi.fn(() => true);
    const repo = { insertImported: real } as unknown as Pick<LibraryRepository, 'insertImported'>;
    const importCommits = vi.fn(() => repo);
    installTestHooks({ importCommits, repo: () => ({}) as never, organize: () => { throw new Error('not used'); }, broadcast: vi.fn() });
    const hooks = (globalThis as { __learnTest?: { failImportCommits(input: { code: 'SQLITE_FULL' | null }): void } }).__learnTest!;
    try {
      hooks.failImportCommits({ code: 'SQLITE_FULL' });
      hooks.failImportCommits({ code: null });
      hooks.failImportCommits({ code: 'SQLITE_FULL' });
      expect(importCommits).toHaveBeenCalledTimes(1);
      expect(thrown(() => repo.insertImported({} as never))).toMatchObject({ code: 'SQLITE_FULL' });
      hooks.failImportCommits({ code: null });
      expect(repo.insertImported({} as never)).toBe(true);
      expect(real).toHaveBeenCalledTimes(1);
    } finally {
      delete (globalThis as { __learnTest?: unknown }).__learnTest;
      delete (globalThis as { __learnIpcCalls?: unknown }).__learnIpcCalls;
      delete (globalThis as { __learnIpcDelays?: unknown }).__learnIpcDelays;
    }
  });
});

describe('the import pause and queue hooks (P-6)', () => {
  it('holds the next file to reach the point until resume, says where it waits, then lets the next files run', async () => {
    const pause = createImportPause();
    pause.pause('afterStage');
    await pause.hooks.beforeCommit!(); // another point: not held
    expect(pause.waiting()).toBe(null);
    let through = false;
    const held = Promise.resolve(pause.hooks.afterStage!('/lib/staging/x.part')).then(() => {
      through = true;
    });
    await Promise.resolve();
    expect(pause.waiting()).toBe('afterStage');
    expect(through).toBe(false);
    pause.resume();
    await held;
    expect(through).toBe(true);
    expect(pause.waiting()).toBe(null);
    await pause.hooks.afterStage!('/lib/staging/y.part'); // one file only: the next one runs on
  });

  it('null calls a pause off before any file reaches it', async () => {
    const pause = createImportPause();
    pause.pause('afterPlace');
    pause.pause(null);
    await pause.hooks.afterPlace!('/lib/assets/ab/abc');
    expect(pause.waiting()).toBe(null);
  });

  it('installTestHooks plugs the pause into the importer and puts files in for the main window', () => {
    const setHooks = vi.fn();
    const enqueue = vi.fn((_batch: { paths: string[] }) => 2);
    const finished: Array<(report: ImportReport, openIn: number | null) => void> = [];
    installTestHooks({
      importCommits: () => ({}) as never,
      repo: () => ({}) as never,
      organize: () => {
        throw new Error('not used');
      },
      broadcast: vi.fn(),
      imports: {
        importer: () => ({ setHooks }),
        queue: {
          enqueue,
          state: () => ({ ...IDLE_IMPORT_STATE }),
          onFinished: (cb) => {
            finished.push(cb);
            return () => {};
          },
        },
        mainWindowId: () => 41,
      },
    });
    const hooks = (globalThis as { __learnTest?: LearnTestHooks }).__learnTest!;
    expect(setHooks).toHaveBeenCalledTimes(1);
    expect(hooks.enqueueImport({ paths: ['/in/a.pdf', '/in/b.pdf'] })).toBe(2);
    expect(enqueue).toHaveBeenCalledWith({ paths: ['/in/a.pdf', '/in/b.pdf'], mode: 'managed', collectionId: null, owner: 41 });
    const report: ImportReport = { imported: 2, filed: 0, filedExisting: 0, failed: [], openItemId: null, requested: 2, cancelled: false, mode: 'managed', collectionId: null, untouched: 0 };
    finished[0]!(report, null);
    expect(hooks.importReports()).toEqual([report]);
    expect(hooks.importQueueState()).toEqual(IDLE_IMPORT_STATE);
    expect(hooks.importWaiting()).toBe(null);
    delete (globalThis as { __learnTest?: unknown }).__learnTest;
  });
});

describe('holding the work line (the progress toast that waits for the work before it)', () => {
  it('holdJob runs a job of that kind on the line until releaseJob; a second hold waits for the first to be let go', async () => {
    const runs: Array<{ kind: string; done: Promise<unknown> }> = [];
    const lane = {
      run: vi.fn((kind: string, work: (signal: AbortSignal) => Promise<unknown>) => {
        const done = work(new AbortController().signal);
        runs.push({ kind, done });
        return done;
      }),
    };
    installTestHooks({
      importCommits: () => ({}) as never,
      repo: () => ({}) as never,
      organize: () => {
        throw new Error('not used');
      },
      broadcast: vi.fn(),
      imports: {
        importer: () => ({ setHooks: vi.fn() }),
        queue: { enqueue: vi.fn(() => 0), state: () => ({ ...IDLE_IMPORT_STATE }), onFinished: () => () => {} },
        mainWindowId: () => 41,
        lane: lane as never,
      },
    });
    const hooks = (globalThis as { __learnTest?: LearnTestHooks }).__learnTest!;
    hooks.holdJob({ kind: 'backup' });
    expect(lane.run).toHaveBeenCalledWith('backup', expect.any(Function));
    expect(() => hooks.holdJob({ kind: 'restore' })).toThrow(/held already/);
    let ended = false;
    void runs[0]!.done.then(() => (ended = true));
    await Promise.resolve();
    expect(ended).toBe(false);
    hooks.releaseJob();
    await runs[0]!.done;
    expect(ended).toBe(true);
    hooks.holdJob({ kind: 'restore' }); // let go: free again
    expect(runs.map((r) => r.kind)).toEqual(['backup', 'restore']);
    hooks.releaseJob();
    delete (globalThis as { __learnTest?: unknown }).__learnTest;
  });
});

describe('the library check\'s hooks (Task 8)', () => {
  it('libraryCheck reads the newest check and what the startup did about the automatic sheet; requestLibraryCheck asks again', async () => {
    const request = vi.fn(async () => {});
    installTestHooks({
      importCommits: () => ({}) as never,
      repo: () => ({}) as never,
      organize: () => {
        throw new Error('not used');
      },
      broadcast: vi.fn(),
      check: { state: () => ({ check: null, auto: 'not-due' }), request },
    });
    const hooks = (globalThis as { __learnTest?: LearnTestHooks }).__learnTest!;
    expect(hooks.libraryCheck()).toEqual({ check: null, auto: 'not-due' });
    await hooks.requestLibraryCheck();
    expect(request).toHaveBeenCalledTimes(1);
    delete (globalThis as { __learnTest?: unknown }).__learnTest;
  });
});

describe('the body-text scheduler\'s state hook', () => {
  it('textState reads the scheduler\'s state and main\'s steps its first start waits on; main is null when index.ts gives none', () => {
    const state = { live: false, sawChecked: false, events: [{ at: 1, what: 'firstIdle' }] };
    const main = { firstIdle: null, checkStart: 5, checkEnd: 0, auto: 'pending', lane: null, imports: 'idle' } as const;
    const scheduler = { state: vi.fn(() => state) } as unknown as TextScheduler;
    const install = (withMain: boolean) =>
      installTestHooks({
        importCommits: () => ({}) as never,
        repo: () => ({}) as never,
        organize: () => {
          throw new Error('not used');
        },
        broadcast: vi.fn(),
        text: { extractor: {} as never, assetsDir: '/assets', scheduler: () => scheduler, ...(withMain ? { main: () => main } : {}) },
      });
    install(true);
    const hooks = (globalThis as { __learnTest?: LearnTestHooks }).__learnTest!;
    expect(hooks.textState()).toEqual({ scheduler: state, main });
    install(false);
    expect((globalThis as { __learnTest?: LearnTestHooks }).__learnTest!.textState()).toEqual({ scheduler: state, main: null });
    delete (globalThis as { __learnTest?: unknown }).__learnTest;
  });
});

describe('holding a backup copy (Task 9: the backup\'s toast, its 취소, a copy that reads back different)', () => {
  it('backupPause holds the first copy written until backupResume, says which file, and lets the copies after it pass', async () => {
    let hooks: BackupHooks | undefined;
    installTestHooks({
      importCommits: () => ({}) as never,
      repo: () => ({}) as never,
      organize: () => {
        throw new Error('not used');
      },
      broadcast: vi.fn(),
      backup: { setHooks: (h) => (hooks = h), state: () => ({ ...IDLE_BACKUP_PROGRESS }) },
    });
    const t = (globalThis as { __learnTest?: LearnTestHooks }).__learnTest!;
    t.backupPause({ at: 'afterCopy' });
    let first = false;
    void Promise.resolve(hooks!.afterCopy!('/b/assets/aa/1')).then(() => (first = true));
    await Promise.resolve();
    expect(t.backupWaiting()).toBe('/b/assets/aa/1');
    expect(first).toBe(false);
    expect(hooks!.afterCopy!('/b/assets/bb/2')).toBeUndefined(); // once: the copies after it pass
    t.backupResume();
    await vi.waitFor(() => expect(first).toBe(true));
    expect(t.backupWaiting()).toBeNull();
    t.backupPause({ at: null });
    expect(hooks).toBeUndefined();
    expect(t.backupState()).toEqual(IDLE_BACKUP_PROGRESS);
    delete (globalThis as { __learnTest?: unknown }).__learnTest;
  });
});

describe('holding a restored copy (Task 10: the restore\'s toast, its 취소, quitting while it runs)', () => {
  it('restorePause holds the first copy written until restoreResume, says which file, and lets the copies after it pass', async () => {
    let hooks: BackupHooks | undefined;
    installTestHooks({
      importCommits: () => ({}) as never,
      repo: () => ({}) as never,
      organize: () => {
        throw new Error('not used');
      },
      broadcast: vi.fn(),
      restore: { setHooks: (h) => (hooks = h), state: () => ({ ...IDLE_RESTORE_PROGRESS }) },
    });
    const t = (globalThis as { __learnTest?: LearnTestHooks }).__learnTest!;
    t.restorePause({ at: 'afterCopy' });
    let first = false;
    void Promise.resolve(hooks!.afterCopy!('/r/assets/aa/1')).then(() => (first = true));
    await Promise.resolve();
    expect(t.restoreWaiting()).toBe('/r/assets/aa/1');
    expect(first).toBe(false);
    expect(hooks!.afterCopy!('/r/assets/bb/2')).toBeUndefined();
    t.restoreResume();
    await vi.waitFor(() => expect(first).toBe(true));
    expect(t.restoreWaiting()).toBeNull();
    t.restorePause({ at: null });
    expect(hooks).toBeUndefined();
    expect(t.restoreState()).toEqual(IDLE_RESTORE_PROGRESS);
    delete (globalThis as { __learnTest?: unknown }).__learnTest;
  });
});

describe('E2E file seeding hook (M6 spec 14: items that each have a file)', () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });
  function library() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-seed-assets-'));
    made.push(dir);
    const layout = libraryLayout(path.join(dir, 'Library'));
    ensureLayout(layout);
    const db = openDatabase(layout.dbFile);
    migrate(db, { dbFile: layout.dbFile });
    return { dir, layout, db, repo: new LibraryRepository(db) };
  }
  const THREE: SeedRow[] = [ROWS[0]!, ROWS[1]!, { title: 'Linked 3', creators: [], year: 2020, createdAt: '2026-09-30T23:58:00.000Z' }];
  const fileSha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

  it('gives every row a file of its own where an import would put it — copies in assets/, the rows from linkedFrom outside — and the check finds nothing', async () => {
    const lib = library();
    try {
      const outside = path.join(lib.dir, 'outside');
      const out = seedAssets({ db: lib.db, repo: lib.repo, layout: lib.layout }, { rows: THREE, linkedFrom: 2, linkedDir: outside });
      expect(out.itemIds).toHaveLength(3);
      expect(new Set(out.sha256).size).toBe(3);
      const byHash = new Map(lib.repo.allAssets().map((a) => [a.sha256, a]));
      out.sha256.forEach((sha, i) => {
        const managed = i < 2;
        const file = managed ? path.join(lib.layout.root, ...managedRelativePath(sha).split('/')) : path.join(outside, 'seed-3.pdf');
        expect(byHash.get(sha)).toMatchObject(
          managed ? { storageMode: 'managed', relativePath: managedRelativePath(sha), externalPath: null, size: fs.statSync(file).size } : { storageMode: 'linked', relativePath: null, externalPath: file },
        );
        expect(fileSha(file)).toBe(sha);
      });
      const items = lib.repo.listItems();
      expect(items.map((x) => x.id)).toEqual(out.itemIds); // newest first: the rows' order
      expect(items[0]).toMatchObject({ title: '세포 신호 1', type: 'pdf', creators: ['김민지', 'Alice Kim'], year: 2019, availability: 'available' });
      expect(lib.repo.counts()).toMatchObject({ items: 3, assets: 3, revisions: 3 });
      await expect(refreshLinkedAvailability(lib.layout, lib.repo)).resolves.toEqual([]);
      await expect(checkLibrary(lib.layout, lib.repo)).resolves.toMatchObject({
        items: 3, actionable: false, staging: { count: 0 }, unreferenced: { keys: [] }, missingManaged: { itemIds: [] }, missingLinked: { itemIds: [] },
      });
    } finally {
      lib.db.close();
    }
  });
  it('another call writes other files: every call has bytes of its own', () => {
    const lib = library();
    try {
      const deps = { db: lib.db, repo: lib.repo, layout: lib.layout };
      const first = seedAssets(deps, { rows: [ROWS[0]!] });
      const second = seedAssets(deps, { rows: [ROWS[0]!] });
      expect(first.sha256[0]).not.toBe(second.sha256[0]);
      expect(lib.repo.counts()).toMatchObject({ items: 2, assets: 2 });
    } finally {
      lib.db.close();
    }
  });
  it('refuses linked rows without an absolute linkedDir, before it writes anything', () => {
    const lib = library();
    try {
      const deps = { db: lib.db, repo: lib.repo, layout: lib.layout };
      expect(() => seedAssets(deps, { rows: THREE, linkedFrom: 1 })).toThrow(/linkedDir/);
      expect(() => seedAssets(deps, { rows: THREE, linkedFrom: 1, linkedDir: 'relative/outside' })).toThrow(/linkedDir/);
      expect(() => seedAssets(deps, { rows: THREE, linkedFrom: -1 })).toThrow(/linkedFrom/);
      expect(lib.repo.counts()).toMatchObject({ items: 0, assets: 0 });
      expect(fs.readdirSync(lib.layout.assetsDir)).toEqual([]);
    } finally {
      lib.db.close();
    }
  });
  it('installed: __learnTest.seedAssets writes and announces the change once; __learnTest.fsyncProbe runs the probe', async () => {
    const lib = library();
    const broadcast = vi.fn();
    const g = globalThis as { __learnTest?: { seedAssets(input: SeedAssetsInput): SeedAssetsResult; fsyncProbe(input: unknown): Promise<{ fileMs: number[] }> } };
    try {
      installTestHooks({
        importCommits: () => ({}) as never,
        repo: () => ({}) as never,
        organize: () => {
          throw new Error('not used');
        },
        broadcast,
        seedFiles: () => ({ db: lib.db, repo: lib.repo, layout: lib.layout }),
      });
      expect(g.__learnTest!.seedAssets({ rows: [ROWS[0]!] }).itemIds).toHaveLength(1);
      expect(broadcast.mock.calls).toEqual([['libraryChanged', { reason: 'import' }]]);
      expect((await g.__learnTest!.fsyncProbe({ dir: path.join(lib.dir, 'probe'), files: 1, bytes: 16 })).fileMs).toHaveLength(1);
    } finally {
      lib.db.close();
      delete g.__learnTest;
      delete (globalThis as { __learnIpcCalls?: unknown }).__learnIpcCalls;
      delete (globalThis as { __learnIpcDelays?: unknown }).__learnIpcDelays;
    }
  });
});

describe("E2E fsync probe (Q-2c: what one import's flush costs)", () => {
  it('flushes as Importer.place does on a new shard — its parent, the staging file, then the shard after the rename — timing each', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-fsync-probe-'));
    try {
      const calls: string[] = [];
      const io = {
        fsyncFile: async (f: string) => void calls.push(`file ${path.relative(dir, f)}`),
        fsyncDir: async (d: string) => void calls.push(`dir ${path.relative(dir, d)}`),
      };
      const out = await fsyncProbe({ dir, files: 2, bytes: 1024 }, io);
      expect(calls).toEqual(['dir assets', 'file staging/00.part', 'dir assets/00', 'dir assets', 'file staging/01.part', 'dir assets/01']);
      for (const list of [out.parentMs, out.fileMs, out.shardMs]) {
        expect(list).toHaveLength(2);
        for (const ms of list) expect(ms).toBeGreaterThanOrEqual(0);
      }
      expect(out.uv).toBe(process.versions.uv);
      expect(fs.readdirSync(path.join(dir, 'staging'))).toEqual([]);
      expect(fs.statSync(path.join(dir, 'assets', '01', '01')).size).toBe(1024);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("uses the importer's own fsyncFile and fsyncDir by default", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-fsync-probe-'));
    try {
      const out = await fsyncProbe({ dir, files: 3, bytes: 4096 });
      expect([out.parentMs.length, out.fileMs.length, out.shardMs.length]).toEqual([3, 3, 3]);
      expect(fs.readdirSync(path.join(dir, 'assets')).sort()).toEqual(['00', '01', '02']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it('refuses a relative folder, a count outside 1–256 and an empty file, before it touches the disk', async () => {
    await expect(fsyncProbe({ dir: 'relative', files: 1, bytes: 1 })).rejects.toThrow(/absolute/);
    await expect(fsyncProbe({ dir: os.tmpdir(), files: 0, bytes: 1 })).rejects.toThrow(/256/);
    await expect(fsyncProbe({ dir: os.tmpdir(), files: 257, bytes: 1 })).rejects.toThrow(/256/);
    await expect(fsyncProbe({ dir: os.tmpdir(), files: 1, bytes: 0 })).rejects.toThrow(/bytes/);
  });
});

describe('the translation hooks (Task 4)', () => {
  it('translationFake sets the fake engine\'s mode; translationCalls counts its requests', () => {
    const setMode = vi.fn();
    installTestHooks({
      importCommits: () => ({}) as never,
      repo: () => ({}) as never,
      organize: () => {
        throw new Error('not used');
      },
      broadcast: vi.fn(),
      translation: { setMode, calls: () => 3 },
    });
    const hooks = (globalThis as { __learnTest?: LearnTestHooks }).__learnTest!;
    hooks.translationFake('offline');
    expect(setMode).toHaveBeenCalledWith('offline');
    expect(hooks.translationCalls()).toBe(3);
    delete (globalThis as { __learnTest?: unknown }).__learnTest;
  });
});

describe('the tutor hooks (spec 12)', () => {
  const g = globalThis as { __learnTest?: LearnTestHooks; __learnIpcCalls?: unknown; __learnIpcDelays?: unknown };
  const install = (tutor?: TutorHooksDeps) =>
    installTestHooks({
      importCommits: () => ({}) as never,
      repo: () => ({}) as never,
      organize: () => {
        throw new Error('not used');
      },
      broadcast: vi.fn(),
      ...(tutor ? { tutor } : {}),
    });
  afterEach(() => {
    delete g.__learnTest;
    delete g.__learnIpcCalls;
    delete g.__learnIpcDelays;
  });

  it('each says there is no tutor when the app has none (no library)', async () => {
    install();
    const h = g.__learnTest!;
    const calls: Array<[string, () => unknown]> = [
      ['tutorFakeScript', () => h.tutorFakeScript('inject')],
      ['tutorFakeLog', () => h.tutorFakeLog()],
      ['tutorNetwork', () => h.tutorNetwork('offline')],
      ['tutorTimeouts', () => h.tutorTimeouts({ firstUpdateMs: 1 })],
      ['tutorProcesses', () => h.tutorProcesses()],
      ['tutorKillAgent', () => h.tutorKillAgent()],
      ['seedSessions', () => h.seedSessions({ itemId: 'x', sessions: 1, messagesPerSession: 2, citationsPerAnswer: 1 })],
      ['toolReads', () => h.toolReads('x')],
    ];
    for (const [name, run] of calls) expect(run, name).toThrow(`${name}: no tutor (the library is not open)`);
  });

  it('hands each call to the tutor as it is', () => {
    const processes = { count: 1, max: 1, conversationIds: ['c'] };
    const log = [{ t: 'cancel' as const }];
    const reads = [{ seq: 0, tool: 'get_context' as const, outcome: 'ok' as const, revisionId: null, pageFrom: null, pageTo: null, duplicatePages: 0, chars: 0, errorCode: null, ms: 1 }];
    const order: string[] = [];
    const tutor = {
      service: {
        setTimeouts: vi.fn(),
        processes: vi.fn(() => {
          order.push('processes');
          return processes;
        }),
        resetProcessMax: vi.fn(() => void order.push('resetMax')),
        killAgent: vi.fn(),
        failNextAgents: vi.fn(),
      },
      setFakeScript: vi.fn(),
      fakeLog: vi.fn(() => log),
      setNetwork: vi.fn(),
      sessions: vi.fn(() => ({ toolReads: vi.fn(() => reads) }) as never),
      seed: vi.fn(() => ({ conversationIds: ['a', 'b'] })),
    } satisfies TutorHooksDeps;
    install(tutor);
    const h = g.__learnTest!;
    h.tutorFakeScript('lockdown-read');
    expect(tutor.setFakeScript).toHaveBeenCalledWith('lockdown-read');
    expect(h.tutorFakeLog()).toBe(log);
    h.tutorNetwork('offline');
    h.tutorNetwork(null);
    expect(tutor.setNetwork.mock.calls).toEqual([['offline'], [null]]);
    h.tutorTimeouts({ firstUpdateMs: 50, idleMs: 200 });
    expect(tutor.service.setTimeouts).toHaveBeenCalledWith({ firstUpdateMs: 50, idleMs: 200 });
    expect(h.tutorProcesses()).toBe(processes);
    expect(order).toEqual(['processes']);
    expect(h.tutorProcesses({ resetMax: true })).toBe(processes);
    expect(order).toEqual(['processes', 'resetMax', 'processes']);
    h.tutorKillAgent();
    expect(tutor.service.killAgent).toHaveBeenCalledTimes(1);
    h.tutorFailAgents(2);
    expect(tutor.service.failNextAgents).toHaveBeenCalledWith(2);
    const input = { itemId: 'i', sessions: 2, messagesPerSession: 4, citationsPerAnswer: 3 };
    expect(h.seedSessions(input)).toEqual({ conversationIds: ['a', 'b'] });
    expect(tutor.seed).toHaveBeenCalledWith(input);
    expect(h.toolReads('m')).toBe(reads);
  });

  it('readFakeLog: one entry per line of the fake agent\'s log, none before it wrote one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-fake-log-'));
    try {
      const file = path.join(dir, 'fake-agent.log');
      expect(readFakeLog(file)).toEqual([]);
      fs.writeFileSync(file, `${JSON.stringify({ t: 'cancel' })}\n${JSON.stringify({ t: 'client-call', method: 'fs/read_text_file', error: { code: -32601 } })}\n`);
      expect(readFakeLog(file)).toEqual([{ t: 'cancel' }, { t: 'client-call', method: 'fs/read_text_file', error: { code: -32601 } }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('seedSessions (spec 15: the sessions fixture)', () => {
  function library() {
    const { db, ids } = libraryOf(2);
    return { db, deps: { db, repo: new LibraryRepository(db), conversations: new ConversationsRepository(db) }, itemId: ids[0]! };
  }

  it('sessions × messages, question and answer in turn, each answer with its verified citations', () => {
    const { deps, itemId } = library();
    const { conversationIds } = seedSessions(deps, { itemId, sessions: 2, messagesPerSession: 4, citationsPerAnswer: 3 });
    expect(conversationIds).toHaveLength(2);
    expect(deps.conversations.list(itemId).map((s) => s.id).sort()).toEqual([...conversationIds].sort());
    for (const id of conversationIds) {
      const { messages } = deps.conversations.thread(id);
      expect(messages.map((m) => [m.role, m.status])).toEqual([['user', 'complete'], ['tutor', 'complete'], ['user', 'complete'], ['tutor', 'complete']]);
      for (const m of messages.filter((x) => x.role === 'tutor')) {
        expect(m.sources.map((c) => [c.pageIndex, c.label])).toEqual([[0, '1쪽'], [1, '2쪽'], [2, '3쪽']]);
        expect(m.sources.every((c) => c.anchorId !== null)).toBe(true);
        expect(m.text).toContain('[[p3]]');
      }
    }
  });

  it('sessions of another day and with questions of their own, for the session list (its day groups and names)', () => {
    const { deps, itemId } = library();
    const startedAt = '2026-10-12T03:00:00.000Z';
    const { conversationIds } = seedSessions(deps, { itemId, sessions: 2, messagesPerSession: 2, citationsPerAnswer: 0, startedAt, questions: ['그림 6-2는 어떻게 읽나요?'] });
    const [first, second] = conversationIds.map((id) => deps.conversations.thread(id));
    expect(first!.session).toMatchObject({ title: '그림 6-2는 어떻게 읽나요?', createdAt: startedAt });
    expect(second!.session.title).toBe('Seeded question 1 of session 2'); // a session past the list keeps the seeded words
    expect(Date.parse(second!.session.updatedAt) - Date.parse(startedAt)).toBeLessThan(10);
    expect(() => seedSessions(deps, { itemId, sessions: 1, messagesPerSession: 2, citationsPerAnswer: 0, startedAt: 'x' })).toThrow(/startedAt/);
    // A real agent's sessions too (the list draws them otherwise than the fake's).
    const [claude] = seedSessions(deps, { itemId, sessions: 1, messagesPerSession: 2, citationsPerAnswer: 0, agent: 'claude' }).conversationIds;
    expect(deps.conversations.thread(claude!).session.agent).toBe('claude');
  });

  it('writes nothing when the input does not fit (one transaction)', () => {
    const { db, deps, itemId } = library();
    expect(() => seedSessions(deps, { itemId, sessions: 2, messagesPerSession: 2, citationsPerAnswer: 41 })).toThrow();
    expect(() => seedSessions(deps, { itemId, sessions: 1, messagesPerSession: 3, citationsPerAnswer: 1 })).toThrow(/even/);
    expect(() => seedSessions(deps, { itemId: newId(), sessions: 1, messagesPerSession: 2, citationsPerAnswer: 1 })).toThrow(/PDF/);
    expect(db.prepare('SELECT COUNT(*) FROM conversations').pluck().get()).toBe(0);
    expect(db.prepare('SELECT COUNT(*) FROM messages').pluck().get()).toBe(0);
  });
});
