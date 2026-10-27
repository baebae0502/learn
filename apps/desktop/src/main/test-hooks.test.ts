import { describe, expect, it, vi } from 'vitest';
import { itemMetadataSchema, type LibraryItem } from '@learn/domain';
import { installTestHooks, seedItems, type SeedRepo, type SeedRow } from './test-hooks';

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
    installTestHooks({ repo: () => repo, broadcast });
    const hooks = (globalThis as { __learnTest?: { seedItems(input: unknown): number } }).__learnTest!;
    expect(hooks.seedItems({ fromItemId: 'from-id', rows: ROWS })).toBe(2);
    expect(inserted).toHaveLength(1);
    expect(broadcast.mock.calls).toEqual([['libraryChanged', { reason: 'import' }]]);
    delete (globalThis as { __learnTest?: unknown }).__learnTest;
  });
  it('also installs the IPC call counter createHandle fills', () => {
    const g = globalThis as { __learnIpcCalls?: Record<string, number> };
    delete g.__learnIpcCalls;
    installTestHooks({ repo: () => ({}) as never, broadcast: vi.fn() });
    expect(g.__learnIpcCalls).toEqual({});
    delete g.__learnIpcCalls;
  });
});
