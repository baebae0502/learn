import { describe, expect, it, vi } from 'vitest';
import { ERROR_COPY, itemMetadataSchema, newId, nowIso, toLearnError, type LibraryItem } from '@learn/domain';
import { CollectionsRepository, LibraryRepository, TagsRepository, migrate, openDatabase, readOrganizeSnapshot, type Db } from '@learn/db';
import { installTestHooks, seedItems, seedOrganize, stageCommitFailures, type OrganizeSeedDeps, type SeedOrganizeInput, type SeedRepo, type SeedRow } from './test-hooks';

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
    expect(readOrganizeSnapshot(db)).toEqual({ collections: [], tags: [], members: {}, tagged: {}, duplicates: [expect.any(Array)] });
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
