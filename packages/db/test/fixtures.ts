import { LearnError, newId, nowIso, type StorageMode } from '@learn/domain';
import { expect } from 'vitest';
import { LibraryRepository, migrate, openDatabase, type AssetRow, type Db } from '../src/index';

export function freshDb(): Db {
  const db = openDatabase(':memory:');
  migrate(db, { dbFile: null });
  return db;
}

let seq = 0;
/** Imports one item through the real repository path; pass `reuseAsset` to share an existing asset (duplicate content). */
export function seedItem(
  db: Db,
  opts: { title?: string; sha?: string; mode?: StorageMode; reuseAsset?: AssetRow; type?: 'pdf' | 'video' } = {},
): { itemId: string; revisionId: string; asset: AssetRow } {
  const repo = new LibraryRepository(db);
  const now = nowIso();
  seq += 1;
  const sha = opts.sha ?? seq.toString(16).padStart(64, '0');
  const mode = opts.mode ?? 'managed';
  const asset: AssetRow = opts.reuseAsset ?? {
    id: newId(), sha256: sha, storageMode: mode,
    relativePath: mode === 'managed' ? `assets/${sha.slice(0, 2)}/${sha}` : null,
    externalPath: mode === 'linked' ? `/ext/${sha.slice(0, 8)}.pdf` : null,
    originalName: 'lecture.pdf', mime: opts.type === 'video' ? 'video/mp4' : 'application/pdf', size: 1234, availability: 'available',
    createdAt: now, checkedAt: now,
  };
  const itemId = newId();
  const isNew = !opts.reuseAsset;
  const revisionId = isNew ? newId() : (db.prepare('SELECT id FROM source_revisions WHERE asset_id = ?').get(asset.id) as { id: string }).id;
  repo.insertImported({
    item: { id: itemId, type: opts.type ?? 'pdf', title: opts.title ?? `item ${seq}`, createdAt: now },
    asset, assetIsNew: isNew,
    revision: isNew ? { id: revisionId, createdAt: now } : null,
    job: null,
  });
  return { itemId, revisionId, asset };
}

/** Asserts that `fn` throws a LearnError with `code` (and optionally a message matcher). */
export function expectLearnError(fn: () => unknown, code: LearnError['code'], message?: string | RegExp): LearnError {
  let caught: unknown;
  try { fn(); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(LearnError);
  const err = caught as LearnError;
  expect(err.code).toBe(code);
  if (message !== undefined) expect(err.message).toMatch(message);
  return err;
}
