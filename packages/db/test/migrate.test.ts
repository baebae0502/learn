import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LearnError } from '@learn/domain';
import { LATEST_SCHEMA_VERSION, MIGRATIONS, currentVersion, migrate, openDatabase, type Db } from '../src/index';

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
  it('creates schema v1 on an empty database', () => {
    const { db, file } = tempDb();
    expect(migrate(db, { dbFile: file })).toEqual({ from: 0, to: 1, backupFile: null });
    expect(LATEST_SCHEMA_VERSION).toBe(1);
    expect(tables(db)).toEqual(expect.arrayContaining([
      'items', 'assets', 'item_assets', 'source_revisions', 'collections', 'collection_items',
      'tags', 'item_tags', 'anchors', 'annotations', 'jobs', 'settings', 'schema_migrations',
    ]));
  });

  it('is idempotent', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file });
    expect(migrate(db, { dbFile: file })).toEqual({ from: 1, to: 1, backupFile: null });
  });

  it('rolls back a failing migration and keeps a pre-migration snapshot', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file });
    const broken = [...MIGRATIONS, { version: 2, name: 'broken', sql: 'CREATE TABLE half_done (a TEXT); INSERT INTO no_such_table VALUES (1);' }];
    let caught: unknown;
    try { migrate(db, { dbFile: file, migrations: broken }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(LearnError);
    expect((caught as LearnError).code).toBe('MIGRATION_FAILED');
    expect(currentVersion(db)).toBe(1);
    expect(tables(db)).not.toContain('half_done');
    const backup = `${file}.pre-v2.bak`;
    expect(fs.existsSync(backup)).toBe(true);
    const snap = openDatabase(backup);
    dbs.push(snap);
    expect(currentVersion(snap)).toBe(1);
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
