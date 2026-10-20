import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LearnError } from '@learn/domain';
import { LATEST_SCHEMA_VERSION, LibraryRepository, MIGRATIONS, currentVersion, migrate, openDatabase, type AssetRow, type Db } from '../src/index';
import { newId, nowIso } from '@learn/domain';

const dirs: string[] = [];
const dbs: Db[] = [];
function tempDb(): { db: Db; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-db-'));
  dirs.push(dir);
  const file = path.join(dir, 'library.sqlite');
  const db = openDatabase(file);
  dbs.push(db);
  return { db, file };
}
afterEach(() => {
  for (const db of dbs.splice(0)) if (db.open) db.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const tables = (db: Db) =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as { name: string }[]).map((r) => r.name);

describe('openDatabase', () => {
  it('enables WAL and foreign keys', () => {
    const { db } = tempDb();
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('migrate', () => {
  it('creates the latest schema on an empty database', () => {
    const { db, file } = tempDb();
    expect(migrate(db, { dbFile: file })).toEqual({ from: 0, to: LATEST_SCHEMA_VERSION, backupFile: null });
    expect(LATEST_SCHEMA_VERSION).toBe(2);
    expect(tables(db)).toContain('reading_positions');
    const idx = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]).map((r) => r.name);
    expect(idx).toEqual(expect.arrayContaining([
      'collections_parent', 'collection_items_item', 'tags_position', 'tags_name_nocase', 'item_tags_tag',
      'items_deleted_at', 'anchors_revision', 'annotations_anchor', 'jobs_state', 'reading_positions_revision',
    ]));
    expect(tables(db)).toEqual(expect.arrayContaining([
      'items', 'assets', 'item_assets', 'source_revisions', 'collections', 'collection_items',
      'tags', 'item_tags', 'anchors', 'annotations', 'jobs', 'settings', 'schema_migrations',
    ]));
  });

  it('is idempotent', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file });
    expect(migrate(db, { dbFile: file })).toEqual({ from: LATEST_SCHEMA_VERSION, to: LATEST_SCHEMA_VERSION, backupFile: null });
  });

  it('rolls back a failing migration and keeps a pre-migration snapshot', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file });
    const broken = [...MIGRATIONS, { version: LATEST_SCHEMA_VERSION + 1, name: 'broken', sql: 'CREATE TABLE half_done (a TEXT); INSERT INTO no_such_table VALUES (1);' }];
    let caught: unknown;
    try { migrate(db, { dbFile: file, migrations: broken }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(LearnError);
    expect((caught as LearnError).code).toBe('MIGRATION_FAILED');
    expect(currentVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    expect(tables(db)).not.toContain('half_done');
    const backup = `${file}.pre-v${LATEST_SCHEMA_VERSION + 1}.bak`;
    expect(fs.existsSync(backup)).toBe(true);
    const snap = openDatabase(backup);
    dbs.push(snap);
    expect(currentVersion(snap)).toBe(LATEST_SCHEMA_VERSION);
    expect(String((caught as LearnError).message)).toContain(`v${LATEST_SCHEMA_VERSION} 상태`);
  });

  it('refuses a database created by a newer app', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file });
    db.prepare(`INSERT INTO schema_migrations (version, name, applied_at) VALUES (99, 'future', 'x')`).run();
    expect(() => migrate(db, { dbFile: file })).toThrow(/더 새로운 버전/);
  });

  it('enforces storage-mode path consistency on assets', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file });
    const insert = db.prepare(`INSERT INTO assets (id, sha256, storage_mode, relative_path, external_path, original_name, mime, size, created_at)
      VALUES (?, ?, ?, ?, ?, 'a.pdf', 'application/pdf', 1, 'now')`);
    const sha = 'a'.repeat(64);
    expect(() => insert.run('1', sha, 'managed', null, '/x/a.pdf')).toThrow(/CHECK/);
    expect(() => insert.run('2', sha, 'linked', 'assets/aa/x', null)).toThrow(/CHECK/);
    insert.run('3', sha, 'managed', `assets/aa/${sha}`, null);
    expect(() => insert.run('4', sha, 'managed', `assets/aa/${sha}`, null)).toThrow(/UNIQUE/);
    insert.run('5', sha, 'linked', null, '/x/a.pdf');
  });
});

function seedItem(repo: LibraryRepository, n: number): { itemId: string; revisionId: string } {
  const now = nowIso();
  const sha = String(n).repeat(64);
  const a: AssetRow = {
    id: newId(), sha256: sha, storageMode: 'managed', relativePath: `assets/${sha.slice(0, 2)}/${sha}`, externalPath: null,
    originalName: `f${n}.pdf`, mime: 'application/pdf', size: 10, availability: 'available', createdAt: now, checkedAt: now,
  };
  const itemId = newId();
  const revisionId = newId();
  repo.insertImported({
    item: { id: itemId, type: 'pdf', title: `t${n}`, createdAt: now }, asset: a, assetIsNew: true,
    revision: { id: revisionId, createdAt: now },
    job: { id: newId(), kind: 'extract', dedupeKey: `extract:${sha}:text-v0`, payload: { sha256: sha } },
  });
  return { itemId, revisionId };
}

describe('migration v2 (organize)', () => {
  it('upgrades a real v1 database, preserving data and snapshotting v1', () => {
    const { db, file } = tempDb();
    expect(migrate(db, { dbFile: file, migrations: MIGRATIONS.filter((m) => m.version === 1) })).toMatchObject({ to: 1 });
    const repo = new LibraryRepository(db);
    seedItem(repo, 1);
    seedItem(repo, 2);
    db.prepare(`INSERT INTO tags (id, name) VALUES ('t1', 'old')`).run();

    expect(migrate(db, { dbFile: file })).toEqual({ from: 1, to: 2, backupFile: `${file}.pre-v2.bak` });
    expect(repo.counts()).toMatchObject({ items: 2, assets: 2, revisions: 2, tags: 1, readingPositions: 0 });
    expect(db.prepare('SELECT position, color FROM tags WHERE id = ?').get('t1')).toEqual({ position: null, color: null });
    const snap = openDatabase(`${file}.pre-v2.bak`);
    dbs.push(snap);
    expect(currentVersion(snap)).toBe(1);
    expect((snap.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n).toBe(2);
  });

  it('constrains tag position and name', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file });
    const ins = db.prepare('INSERT INTO tags (id, name, position) VALUES (?, ?, ?)');
    expect(() => ins.run('a', 'x', 9)).toThrow(/CHECK/);
    expect(() => ins.run('a', 'x', 0)).toThrow(/CHECK/);
    ins.run('a', 'Math', 1);
    expect(() => ins.run('b', 'Other', 1)).toThrow(/UNIQUE/);
    expect(() => ins.run('c', 'math', 2)).toThrow(/UNIQUE/);
    ins.run('d', 'n1', null);
    ins.run('e', 'n2', null);
  });

  it('cascades reading_positions when the item is deleted', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file });
    const repo = new LibraryRepository(db);
    const { itemId, revisionId } = seedItem(repo, 3);
    db.prepare(`INSERT INTO reading_positions (item_id, revision_id, locator_json, progress, updated_at) VALUES (?, ?, '{}', 0.5, 'now')`).run(itemId, revisionId);
    expect(() => db.prepare(`UPDATE reading_positions SET progress = 1.5`).run()).toThrow(/CHECK/);
    expect(repo.counts().readingPositions).toBe(1);
    db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
    expect(repo.counts().readingPositions).toBe(0);
  });
});
