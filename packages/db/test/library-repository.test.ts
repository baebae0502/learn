import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, nowIso, type StorageMode } from '@learn/domain';
import {
  CollectionsRepository, LibraryRepository, ReadingRepository, TagsRepository, migrate, openDatabase,
  type AssetRow, type Db, type NewImportRecord,
} from '../src/index';
import { expectLearnError, seedItem } from './fixtures';

let db: Db;
let repo: LibraryRepository;
beforeEach(() => {
  db = openDatabase(':memory:');
  migrate(db, { dbFile: null });
  repo = new LibraryRepository(db);
});

function asset(sha: string, mode: StorageMode, extra: Partial<AssetRow> = {}): AssetRow {
  const now = nowIso();
  return {
    id: newId(), sha256: sha, storageMode: mode,
    relativePath: mode === 'managed' ? `assets/${sha.slice(0, 2)}/${sha}` : null,
    externalPath: mode === 'linked' ? `/ext/${sha.slice(0, 6)}.pdf` : null,
    originalName: 'lecture.pdf', mime: 'application/pdf', size: 1234, availability: 'available',
    createdAt: now, checkedAt: now, ...extra,
  };
}
function record(a: AssetRow, isNew = true, title = 'lecture'): NewImportRecord {
  const now = nowIso();
  return {
    item: { id: newId(), type: 'pdf', title, createdAt: now },
    asset: a, assetIsNew: isNew,
    revision: isNew ? { id: newId(), createdAt: now } : null,
    job: { id: newId(), kind: 'extract', dedupeKey: `extract:${a.sha256}:text-v0`, payload: { sha256: a.sha256 } },
  };
}
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

describe('LibraryRepository', () => {
  it('inserts an imported item atomically and reads it back', () => {
    const a = asset(SHA_A, 'managed');
    const rec = record(a);
    repo.insertImported(rec);
    const item = repo.getItem(rec.item.id)!;
    expect(item).toMatchObject({
      id: rec.item.id, title: 'lecture', type: 'pdf', mime: 'application/pdf', size: 1234,
      storageMode: 'managed', availability: 'available', assetId: a.id, revisionId: rec.revision!.id, originalName: 'lecture.pdf',
    });
    expect(repo.listItems().map((i) => i.id)).toEqual([rec.item.id]);
    expect(repo.counts()).toMatchObject({ items: 1, assets: 1, revisions: 1 });
  });

  it('rolls back everything when part of the insert fails', () => {
    const first = record(asset(SHA_A, 'managed'));
    repo.insertImported(first);
    const clash = { ...record(asset(SHA_B, 'managed')), item: first.item }; // asset row goes in, then the item PK collides
    expect(() => repo.insertImported(clash)).toThrow();
    expect(repo.counts()).toMatchObject({ items: 1, assets: 1, revisions: 1 });
    expect(repo.findAssetsBySha(SHA_B)).toEqual([]);
  });

  it('rejects a second managed asset with the same content', () => {
    repo.insertImported(record(asset(SHA_A, 'managed')));
    expect(() => repo.insertImported(record(asset(SHA_A, 'managed')))).toThrow(/UNIQUE/);
  });

  it('requires an initial revision for a new asset', () => {
    const rec = { ...record(asset(SHA_A, 'managed')), revision: null };
    expect(() => repo.insertImported(rec)).toThrow(/initial revision/);
  });

  it('shares asset and revision when an item reuses an existing asset', () => {
    const a = asset(SHA_A, 'managed');
    const first = record(a);
    repo.insertImported(first);
    const second = record(a, false, 'copy');
    repo.insertImported(second);
    expect(repo.getItem(second.item.id)!.revisionId).toBe(first.revision!.id);
    expect(repo.itemIdsForAsset(a.id)).toEqual([first.item.id, second.item.id]);
    expect((db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n).toBe(1); // dedupe_key
  });

  it('finds assets by sha with managed first', () => {
    const linked = asset(SHA_A, 'linked');
    repo.insertImported(record(linked));
    const managed = asset(SHA_A, 'managed');
    repo.insertImported(record(managed));
    expect(repo.findAssetsBySha(SHA_A).map((x) => x.id)).toEqual([managed.id, linked.id]);
    expect(repo.findAssetsBySha(SHA_B)).toEqual([]);
    expect(repo.assetsByMode('linked').map((x) => x.id)).toEqual([linked.id]);
    expect(repo.allAssets()).toHaveLength(2);
  });

  it('updates availability and relinks linked assets', () => {
    const a = asset(SHA_B, 'linked');
    const rec = record(a);
    repo.insertImported(rec);
    repo.setAvailability(a.id, 'missing', nowIso());
    expect(repo.getItem(rec.item.id)!.availability).toBe('missing');
    repo.setExternalPath(a.id, '/new/place.pdf', nowIso());
    expect(repo.getAsset(a.id)).toMatchObject({ externalPath: '/new/place.pdf', availability: 'available' });
  });

  it('marks running jobs as interrupted', () => {
    repo.insertImported(record(asset(SHA_A, 'managed')));
    db.prepare(`UPDATE jobs SET state = 'running'`).run();
    expect(repo.markRunningJobsInterrupted(nowIso())).toBe(1);
    expect((db.prepare('SELECT state FROM jobs').get() as { state: string }).state).toBe('interrupted');
  });

  it('rejects non-dedupe job constraint violations (e.g. id collision)', () => {
    const jobId = newId();
    const a1 = asset(SHA_A, 'managed');
    const rec1 = { ...record(a1), job: { id: jobId, kind: 'extract', dedupeKey: `extract:${SHA_A}:text-v0`, payload: { sha256: SHA_A } } };
    repo.insertImported(rec1);

    const a2 = asset(SHA_B, 'managed');
    const rec2 = { ...record(a2), job: { id: jobId, kind: 'extract', dedupeKey: `extract:${SHA_B}:text-v0`, payload: { sha256: SHA_B } } };
    expect(() => repo.insertImported(rec2)).toThrow(); // id collision, different dedupeKey
    expect(repo.counts()).toMatchObject({ items: 1, assets: 1, revisions: 1 }); // rec2 rolled back
    expect(repo.findAssetsBySha(SHA_B)).toEqual([]);
  });

  it('setAvailability throws on unknown asset', () => {
    expect(() => repo.setAvailability('unknown-id', 'missing', nowIso())).toThrow(/setAvailability: no asset/);
  });

  it('setExternalPath throws when asset is not linked', () => {
    const a = asset(SHA_A, 'managed');
    repo.insertImported(record(a));
    expect(() => repo.setExternalPath(a.id, '/path.pdf', nowIso())).toThrow(/setExternalPath: no linked asset/);
    // verify row unchanged
    expect(repo.getAsset(a.id)).toMatchObject({ externalPath: null, storageMode: 'managed' });
  });
});

describe('LibraryRepository: organize fields, metadata, trash, duplicates', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('round-trips metadata and exposes creators and year on the item', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    const { itemId } = seedItem(db, { title: 'old' });
    expect(repo.getItem(itemId)).toMatchObject({ creators: [], year: null, updatedAt: '2026-10-20T01:00:00.000Z' });

    vi.setSystemTime(new Date('2026-10-20T02:00:00.000Z'));
    const metadata = {
      creators: [{ name: '김교수', role: 'lecturer' as const }, { name: 'Lee', role: 'author' as const }],
      date: '2021-03', publisher: 'MIT', url: 'https://example.org/x', language: 'ko', abstract: '요약', extra: 'n',
    };
    const updated = repo.updateMetadata(itemId, { title: '  선형대수 1강 ', metadata });
    expect(updated).toMatchObject({
      id: itemId, title: '선형대수 1강', creators: ['김교수', 'Lee'], year: 2021,
      createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T02:00:00.000Z',
    });
    expect(repo.getItemDetail(itemId).metadata).toEqual(metadata);
    expect(repo.listItems()[0]).toEqual(updated);

    // title only keeps the metadata, metadata only keeps the title
    expect(repo.updateMetadata(itemId, { title: 'T' })).toMatchObject({ title: 'T', creators: ['김교수', 'Lee'] });
    expect(repo.updateMetadata(itemId, { metadata: { creators: [] } })).toMatchObject({ title: 'T', creators: [], year: null });
    expect(repo.updateMetadata(itemId, { title: 'x'.repeat(500) }).title).toHaveLength(500);
  });

  it('an update with no fields writes nothing (updated_at stays) but still requires a live item', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    const { itemId } = seedItem(db, { title: 'keep' });
    vi.setSystemTime(new Date('2026-10-20T02:00:00.000Z'));
    expect(repo.updateMetadata(itemId, {})).toMatchObject({ title: 'keep', updatedAt: '2026-10-20T01:00:00.000Z' });
    expect(repo.updateMetadata(itemId, { title: undefined, metadata: undefined }).updatedAt).toBe('2026-10-20T01:00:00.000Z');
    expectLearnError(() => repo.updateMetadata(newId(), {}), 'NOT_FOUND', '항목을 찾을 수 없습니다.');
    repo.trash([itemId]);
    expectLearnError(() => repo.updateMetadata(itemId, {}), 'NOT_FOUND', '항목을 찾을 수 없습니다.');
  });

  it('rejects invalid metadata or titles, and unknown or trashed items, leaving the row unchanged', () => {
    const { itemId } = seedItem(db, { title: 'keep' });
    const bad = [
      { url: 'ftp://example.org' }, { date: '2021-13' }, { creators: [{ name: '', role: 'author' }] },
      { creators: [{ name: 'x', role: 'singer' }] }, { abstract: 'x'.repeat(10_001) },
    ];
    for (const metadata of bad) {
      expectLearnError(() => repo.updateMetadata(itemId, { metadata: metadata as never }), 'VALIDATION_FAILED', '메타데이터');
    }
    for (const title of ['   ', '', 'x'.repeat(501)]) {
      expectLearnError(() => repo.updateMetadata(itemId, { title }), 'VALIDATION_FAILED', '제목');
    }
    expect(repo.getItem(itemId)).toMatchObject({ title: 'keep', creators: [] });
    expect((db.prepare('SELECT metadata_json FROM items WHERE id = ?').get(itemId) as { metadata_json: string }).metadata_json).toBe('{}');

    expectLearnError(() => repo.updateMetadata(newId(), { title: 'x' }), 'NOT_FOUND', '항목을 찾을 수 없습니다.');
    repo.trash([itemId]);
    expectLearnError(() => repo.updateMetadata(itemId, { title: 'x' }), 'NOT_FOUND', '항목을 찾을 수 없습니다.');
  });

  it('degrades corrupt stored metadata to empty without failing the list', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { itemId } = seedItem(db);
    db.prepare(`UPDATE items SET metadata_json = '{"creators":' WHERE id = ?`).run(itemId);
    expect(repo.listItems()[0]).toMatchObject({ id: itemId, creators: [], year: null });
    expect(warn).toHaveBeenCalledWith('METADATA_CORRUPT_JSON');
  });

  it('reflects tags and reading position in listItems and getItem', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    const a = seedItem(db);
    const b = seedItem(db);
    const tags = new TagsRepository(db);
    const t1 = tags.create('t1');
    const t2 = tags.create('t2');
    tags.assign(t1.id, [a.itemId, b.itemId]);
    tags.assign(t2.id, [a.itemId]);
    vi.setSystemTime(new Date('2026-10-20T03:00:00.000Z'));
    new ReadingRepository(db).save({ itemId: a.itemId, revisionId: a.revisionId, locator: { kind: 'pdf', pageIndex: 4 }, progress: 0.25 });

    const byId = new Map(repo.listItems().map((i) => [i.id, i]));
    expect(byId.get(a.itemId)).toMatchObject({ tagIds: [t1.id, t2.id], progress: 0.25, openedAt: '2026-10-20T03:00:00.000Z' });
    expect(byId.get(b.itemId)).toMatchObject({ tagIds: [t1.id], progress: null, openedAt: null });
    expect(repo.getItem(a.itemId)).toEqual(byId.get(a.itemId));
    expect(repo.getItem(b.itemId)).toEqual(byId.get(b.itemId));
  });

  it('returns item detail with file info, metadata, tags and live collections', () => {
    const { itemId, asset } = seedItem(db, { mode: 'linked', sha: 'c'.repeat(64) });
    const tag = new TagsRepository(db).create('중요');
    new TagsRepository(db).assign(tag.id, [itemId]);
    const cols = new CollectionsRepository(db);
    const live = cols.create({ name: '강의' });
    const gone = cols.create({ name: '옛것' });
    cols.addItems(live.id, [itemId]);
    cols.addItems(gone.id, [itemId]);
    cols.softDelete(gone.id);
    repo.updateMetadata(itemId, { metadata: { creators: [{ name: 'Kim', role: 'author' }], date: '2019' } });

    const detail = repo.getItemDetail(itemId);
    expect(detail.item).toEqual(repo.getItem(itemId));
    expect(detail.metadata).toEqual({ creators: [{ name: 'Kim', role: 'author' }], date: '2019' });
    expect(detail.file).toEqual({
      originalName: 'lecture.pdf', mime: 'application/pdf', size: 1234, storageMode: 'linked',
      externalPath: asset.externalPath, sha256: 'c'.repeat(64), availability: 'available',
    });
    expect(detail.tags).toEqual([{ id: tag.id, name: '중요', color: null, position: null, itemCount: 1 }]);
    expect(detail.collections.map((c) => [c.id, c.itemCount])).toEqual([[live.id, 1]]);

    expectLearnError(() => repo.getItemDetail(newId()), 'NOT_FOUND', '항목을 찾을 수 없습니다.');
    repo.trash([itemId]);
    expectLearnError(() => repo.getItemDetail(itemId), 'NOT_FOUND', '항목을 찾을 수 없습니다.');
  });

  it('trashes and restores items, listing the trash most recently deleted first', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    const [a, b, c] = [seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId];
    const tag = new TagsRepository(db).create('t');
    new TagsRepository(db).assign(tag.id, [a]);

    vi.setSystemTime(new Date('2026-10-20T02:00:00.000Z'));
    expect(repo.trash([a])).toBe(1);
    vi.setSystemTime(new Date('2026-10-20T03:00:00.000Z'));
    expect(repo.trash([b, a, newId()])).toBe(1); // a is already trashed, the unknown id is ignored

    expect(repo.listItems().map((i) => i.id)).toEqual([c]);
    expect(repo.getItem(a)).toBeUndefined();
    const trash = repo.listTrash();
    expect(trash.map((i) => i.id)).toEqual([b, a]);
    expect(trash[1]).toMatchObject({ id: a, tagIds: [tag.id] });
    expect((db.prepare('SELECT deleted_at FROM items WHERE id = ?').get(a) as { deleted_at: string }).deleted_at).toBe('2026-10-20T02:00:00.000Z');
    expect(repo.counts().items).toBe(1);

    expect(repo.restore([a, c, newId()])).toBe(1); // only a was in the trash
    expect(repo.listTrash().map((i) => i.id)).toEqual([b]);
    expect(repo.getItem(a)).toMatchObject({ id: a, tagIds: [tag.id] });
    expect(repo.listItems().map((i) => i.id).sort()).toEqual([a, c].sort());
  });

  it('trashChanged / restoreChanged report exactly the items that moved, each once', () => {
    const [a, b] = [seedItem(db).itemId, seedItem(db).itemId];
    expect(repo.trashChanged([a, a, newId()])).toEqual([a]);
    expect(repo.trashChanged([b, a])).toEqual([b]);
    expect(repo.trashChanged([a, b])).toEqual([]);
    expect(repo.restoreChanged([b, b, newId()])).toEqual([b]);
    expect(repo.restoreChanged([a, b])).toEqual([a]);
    expect(repo.restoreChanged([a, b])).toEqual([]);
  });

  it('groups non-trashed items that share content (same sha256) across assets', () => {
    const SHA_D = 'd'.repeat(64);
    const first = seedItem(db, { sha: SHA_A });
    const second = seedItem(db, { reuseAsset: first.asset }); // same managed asset
    const linked = seedItem(db, { sha: SHA_A, mode: 'linked' }); // same content, separate linked asset
    seedItem(db, { sha: SHA_B }); // unique
    const d1 = seedItem(db, { sha: SHA_D });
    const d2 = seedItem(db, { reuseAsset: d1.asset });
    expect(repo.duplicateGroups()).toEqual([
      { sha256: SHA_A, itemIds: [first.itemId, second.itemId, linked.itemId] },
      { sha256: SHA_D, itemIds: [d1.itemId, d2.itemId] },
    ]);
    repo.trash([d2.itemId]);
    expect(repo.duplicateGroups()).toEqual([{ sha256: SHA_A, itemIds: [first.itemId, second.itemId, linked.itemId] }]);
  });

  it('counts every backed-up table', () => {
    const { itemId, revisionId } = seedItem(db);
    const tags = new TagsRepository(db);
    tags.assign(tags.create('t').id, [itemId]);
    const cols = new CollectionsRepository(db);
    cols.addItems(cols.create({ name: 'c' }).id, [itemId]);
    new ReadingRepository(db).save({ itemId, revisionId, locator: { kind: 'pdf', pageIndex: 0 }, progress: null });
    expect(repo.counts()).toEqual({
      items: 1, assets: 1, revisions: 1, collections: 1, collectionItems: 1, tags: 1, itemTags: 1, readingPositions: 1,
    });
  });
});

describe('LibraryRepository.insertItemsForAsset (E2E seeding only, P-22)', () => {
  const rowsFor = (a: AssetRow, revisionId: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: newId(),
      type: 'pdf' as const,
      title: `seeded ${i}`,
      createdAt: `2026-10-01T00:00:0${i}.000Z`,
      metadataJson: JSON.stringify({ creators: [{ name: `저자 ${i}`, role: 'author' }], date: String(2000 + i) }),
      assetId: a.id,
      revisionId,
    }));

  it('adds items that share the source asset and its revision, with their creators and year, in one go', () => {
    const src = seedItem(db, { title: 'source' });
    repo.insertItemsForAsset(rowsFor(src.asset, src.revisionId, 3));
    const seeded = repo.listItems().filter((i) => i.title.startsWith('seeded'));
    expect(seeded.map((i) => i.title)).toEqual(['seeded 2', 'seeded 1', 'seeded 0']); // created_at DESC
    for (const i of seeded) expect([i.assetId, i.revisionId, i.availability]).toEqual([src.asset.id, src.revisionId, 'available']);
    expect(seeded.at(-1)).toMatchObject({ creators: ['저자 0'], year: 2000, updatedAt: '2026-10-01T00:00:00.000Z' });
    expect(repo.counts()).toMatchObject({ items: 4, assets: 1, revisions: 1 });
  });

  it('writes nothing when a row names another asset\'s revision or carries metadata outside schema v1', () => {
    const src = seedItem(db, { title: 'source' });
    const other = seedItem(db, { title: 'other' });
    const foreign = rowsFor(src.asset, src.revisionId, 2);
    foreign[1] = { ...foreign[1]!, revisionId: other.revisionId };
    expect(() => repo.insertItemsForAsset(foreign)).toThrow(/revision/);
    const invalid = rowsFor(src.asset, src.revisionId, 2);
    invalid[1] = { ...invalid[1]!, metadataJson: JSON.stringify({ date: 'soon' }) };
    expect(() => repo.insertItemsForAsset(invalid)).toThrow(/metadata/);
    expect(repo.counts().items).toBe(2);
  });
});
