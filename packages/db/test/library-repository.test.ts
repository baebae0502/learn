import { beforeEach, describe, expect, it } from 'vitest';
import { newId, nowIso, type StorageMode } from '@learn/domain';
import { LibraryRepository, migrate, openDatabase, type AssetRow, type Db, type NewImportRecord } from '../src/index';

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
    expect(repo.counts()).toEqual({ items: 1, assets: 1, revisions: 1 });
  });

  it('rolls back everything when part of the insert fails', () => {
    const first = record(asset(SHA_A, 'managed'));
    repo.insertImported(first);
    const clash = { ...record(asset(SHA_B, 'managed')), item: first.item }; // asset row goes in, then the item PK collides
    expect(() => repo.insertImported(clash)).toThrow();
    expect(repo.counts()).toEqual({ items: 1, assets: 1, revisions: 1 });
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
});
