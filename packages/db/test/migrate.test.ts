import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LearnError } from '@learn/domain';
import {
  AnchorsRepository, CollectionsRepository, LATEST_SCHEMA_VERSION, LibraryRepository, MIGRATIONS, TagsRepository, currentVersion, migrate, openDatabase,
  type AssetRow, type Db,
} from '../src/index';
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
    expect(LATEST_SCHEMA_VERSION).toBe(4);
    expect(tables(db)).toContain('page_texts');
    expect(tables(db)).toContain('reading_positions');
    expect(tables(db)).toContain('translation_cache');
    const idx = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all() as { name: string }[]).map((r) => r.name);
    expect(idx).toEqual(expect.arrayContaining([
      'collections_parent', 'collection_items_item', 'tags_position', 'tags_name_nocase', 'item_tags_tag',
      'items_deleted_at', 'anchors_revision', 'annotations_anchor', 'jobs_state', 'reading_positions_revision',
      'source_revisions_parent', 'translation_cache_used',
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
    expect(String((caught as LearnError).message)).toBe(
      `v${LATEST_SCHEMA_VERSION + 1} 업데이트에 실패했습니다. 데이터베이스는 v${LATEST_SCHEMA_VERSION} 상태입니다. ` +
        `업데이트 전 백업(library.sqlite.pre-v${LATEST_SCHEMA_VERSION + 1}.bak)이 라이브러리 폴더에 있습니다. 앱을 다시 시작해 보세요.`,
    );
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

describe('migration failure reporting', () => {
  it('omits the backup sentence when no backup was taken, and still says what to do next', () => {
    const { db } = tempDb();
    const broken = [{ version: 1, name: 'broken', sql: 'INSERT INTO no_such_table VALUES (1);' }];
    expect(() => migrate(db, { dbFile: null, migrations: broken }))
      .toThrow(/^v1 업데이트에 실패했습니다\. 데이터베이스는 v0 상태입니다\. 앱을 다시 시작해 보세요\.$/);
  });

  it('reports how far a multi-step upgrade got', () => {
    const { db, file } = tempDb();
    const v1 = MIGRATIONS.filter((m) => m.version === 1);
    migrate(db, { dbFile: file, migrations: v1 });
    seedItem(new LibraryRepository(db), 1);
    const list = [
      ...v1,
      { version: 2, name: 'ok', sql: 'CREATE TABLE step_two (a TEXT);' },
      { version: 3, name: 'broken', sql: 'CREATE TABLE step_three (a TEXT); INSERT INTO no_such_table VALUES (1);' },
    ];
    let caught: unknown;
    try { migrate(db, { dbFile: file, migrations: list }); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(LearnError);
    expect((caught as LearnError).code).toBe('MIGRATION_FAILED');
    expect((caught as LearnError).message).toBe(
      'v3 업데이트에 실패했습니다. 데이터베이스는 v2 상태입니다. 업데이트 전 백업(library.sqlite.pre-v2.bak)이 라이브러리 폴더에 있습니다. ' +
        '앱을 다시 시작해 보세요.',
    );
    expect(currentVersion(db)).toBe(2);
    expect(tables(db)).toContain('step_two');
    expect(tables(db)).not.toContain('step_three');
    const snap = openDatabase(`${file}.pre-v2.bak`);
    dbs.push(snap);
    expect(currentVersion(snap)).toBe(1);
  });
});

describe('migration v2 (organize)', () => {
  it('upgrades a real v1 database, preserving data and snapshotting v1', () => {
    const { db, file } = tempDb();
    expect(migrate(db, { dbFile: file, migrations: MIGRATIONS.filter((m) => m.version === 1) })).toMatchObject({ to: 1 });
    const repo = new LibraryRepository(db);
    seedItem(repo, 1);
    seedItem(repo, 2);
    db.prepare(`INSERT INTO tags (id, name) VALUES ('t1', 'old')`).run();

    expect(migrate(db, { dbFile: file, migrations: MIGRATIONS.filter((m) => m.version <= 2) })).toEqual({ from: 1, to: 2, backupFile: `${file}.pre-v2.bak` });
    expect(repo.counts()).toMatchObject({ items: 2, assets: 2, revisions: 2, tags: 1, readingPositions: 0 });
    expect(db.prepare('SELECT position, color FROM tags WHERE id = ?').get('t1')).toEqual({ position: null, color: null });
    const snap = openDatabase(`${file}.pre-v2.bak`);
    dbs.push(snap);
    expect(currentVersion(snap)).toBe(1);
    expect((snap.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number }).n).toBe(2);
  });

  it('merges v1 tags whose names differ only by case (oldest wins) and keeps collections and memberships', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file, migrations: MIGRATIONS.filter((m) => m.version === 1) });
    const repo = new LibraryRepository(db);
    const i1 = seedItem(repo, 1).itemId;
    const i2 = seedItem(repo, 2).itemId;
    // v1's UNIQUE(name) is case-sensitive, so all of these could exist side by side.
    const tag = db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)');
    for (const [id, name] of [['t1', 'Math'], ['t2', 'math'], ['t3', 'MATH'], ['t4', 'old']] as const) tag.run(id, name);
    const it = db.prepare('INSERT INTO item_tags (item_id, tag_id) VALUES (?, ?)');
    for (const [item, t] of [[i1, 't1'], [i1, 't2'], [i2, 't2'], [i2, 't3'], [i1, 't4']] as const) it.run(item, t);
    db.prepare(`INSERT INTO collections (id, name, parent_id, created_at) VALUES ('c1', '강의', NULL, '2026-01-01T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO collections (id, name, parent_id, created_at) VALUES ('c2', '선형대수', 'c1', '2026-01-02T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO collection_items (collection_id, item_id) VALUES ('c1', ?), ('c2', ?)`).run(i1, i2);

    expect(migrate(db, { dbFile: file, migrations: MIGRATIONS.filter((m) => m.version <= 2) })).toMatchObject({ from: 1, to: 2 });

    expect(db.prepare('SELECT id, name FROM tags ORDER BY rowid').all()).toEqual([{ id: 't1', name: 'Math' }, { id: 't4', name: 'old' }]);
    const pairs = (db.prepare('SELECT item_id AS item, tag_id AS tag FROM item_tags').all() as { item: string; tag: string }[])
      .map((r) => `${r.item === i1 ? 'i1' : 'i2'}:${r.tag}`).sort();
    expect(pairs).toEqual(['i1:t1', 'i1:t4', 'i2:t1']);
    expect(new TagsRepository(db).list().map((t) => [t.name, t.itemCount])).toEqual([['Math', 2], ['old', 1]]);

    expect(db.prepare('SELECT id, name, parent_id, created_at, updated_at, deleted_at FROM collections ORDER BY rowid').all()).toEqual([
      { id: 'c1', name: '강의', parent_id: null, created_at: '2026-01-01T00:00:00.000Z', updated_at: null, deleted_at: null },
      { id: 'c2', name: '선형대수', parent_id: 'c1', created_at: '2026-01-02T00:00:00.000Z', updated_at: null, deleted_at: null },
    ]);
    expect(db.prepare('SELECT collection_id, item_id, added_at FROM collection_items ORDER BY collection_id').all()).toEqual([
      { collection_id: 'c1', item_id: i1, added_at: null },
      { collection_id: 'c2', item_id: i2, added_at: null },
    ]);
    const collections = new CollectionsRepository(db);
    expect(collections.list().map((c) => [c.id, c.parentId, c.itemCount])).toEqual([['c1', null, 1], ['c2', 'c1', 1]]);
    expect(collections.itemIds('c1', { includeSubcollections: true })).toEqual([i2, i1]);
    expect(repo.counts()).toMatchObject({ tags: 2, itemTags: 3, collections: 2, collectionItems: 2 });

    // The pre-v2 snapshot still has every v1 tag.
    const snap = openDatabase(`${file}.pre-v2.bak`);
    dbs.push(snap);
    expect((snap.prepare('SELECT COUNT(*) AS n FROM tags').get() as { n: number }).n).toBe(4);
    expect((snap.prepare('SELECT COUNT(*) AS n FROM item_tags').get() as { n: number }).n).toBe(5);
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

describe('migration v3 (anchors-translation)', () => {
  it('upgrades a real v2 database: old anchors become span anchors, and a v2 snapshot is kept', () => {
    const { db, file } = tempDb();
    expect(migrate(db, { dbFile: file, migrations: MIGRATIONS.filter((m) => m.version <= 2) })).toMatchObject({ to: 2 });
    const { revisionId } = seedItem(new LibraryRepository(db), 4);
    db.prepare(`INSERT INTO anchors (id, revision_id, kind, locator_json, quote, schema_version) VALUES ('a1', ?, 'pdf', '{}', 'q', 1)`).run(revisionId);
    db.prepare(`INSERT INTO annotations (id, anchor_id, type, body_json, operation_id, created_at, updated_at) VALUES ('n1', 'a1', 'highlight', '{}', 'op', 'now', 'now')`).run();

    expect(migrate(db, { dbFile: file })).toEqual({ from: 2, to: 4, backupFile: `${file}.pre-v3.bak` });
    expect(db.prepare(`SELECT id, precision, text_json, quote FROM anchors`).all()).toEqual([{ id: 'a1', precision: 'span', text_json: null, quote: 'q' }]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(tables(db)).toContain('translation_cache');
    expect(() => db.prepare(`UPDATE anchors SET precision = 'page'`).run()).toThrow(/CHECK/);
    const snap = openDatabase(`${file}.pre-v3.bak`);
    dbs.push(snap);
    expect(currentVersion(snap)).toBe(2);
  });
});

describe('migration v4 (images-text)', () => {
  const v3 = MIGRATIONS.filter((m) => m.version <= 3);
  const rows = (db: Db, table: string) => db.prepare(`SELECT rowid AS _rowid, * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[];
  const SAME = ['items', 'item_assets', 'source_revisions', 'collections', 'collection_items', 'tags', 'item_tags', 'reading_positions', 'annotations'];

  function seedV3(db: Db) {
    const repo = new LibraryRepository(db);
    const pdf = seedItem(repo, 1); // a text-v0 extract job comes with it
    const video = seedItem(repo, 2);
    db.prepare(`UPDATE items SET type = 'video' WHERE id = ?`).run(video.itemId);
    const trashed = seedItem(repo, 3);
    db.prepare(`UPDATE items SET deleted_at = '2026-11-01T00:00:00.000Z' WHERE id = ?`).run(trashed.itemId);
    db.prepare(`INSERT INTO collections (id, name, parent_id, created_at) VALUES ('c1', '강의', NULL, 'now')`).run();
    db.prepare(`INSERT INTO collection_items (collection_id, item_id) VALUES ('c1', ?)`).run(pdf.itemId);
    db.prepare(`INSERT INTO tags (id, name) VALUES ('t1', 'm')`).run();
    db.prepare(`INSERT INTO item_tags (item_id, tag_id) VALUES (?, 't1')`).run(trashed.itemId);
    db.prepare(`INSERT INTO reading_positions (item_id, revision_id, locator_json, progress, updated_at) VALUES (?, ?, '{"kind":"pdf","pageIndex":3}', 0.5, 'now')`).run(pdf.itemId, pdf.revisionId);
    const anchor = db.prepare(`INSERT INTO anchors (id, revision_id, kind, locator_json, quote, schema_version, precision, text_json) VALUES (?, ?, ?, ?, ?, 2, ?, ?)`);
    anchor.run('a-pdf', pdf.revisionId, 'pdf', JSON.stringify({ kind: 'pdf', revisionId: pdf.revisionId, precision: 'span', pageIndex: 0, quads: [[0, 0, 1, 0, 0, 1, 1, 1]], coordinateSpace: 'pdf-user-space' }), 'q', 'span', JSON.stringify({ quote: { exact: 'q', prefix: '', suffix: '' } }));
    anchor.run('a-slide', pdf.revisionId, 'slide', JSON.stringify({ kind: 'slide', revisionId: pdf.revisionId, derivedRevisionId: pdf.revisionId, slideIndex: 0, quads: [] }), null, 'region', null);
    anchor.run('a-bad', pdf.revisionId, 'slide', 'not json', null, 'region', null);
    db.prepare(`INSERT INTO annotations (id, anchor_id, type, body_json, operation_id, created_at, updated_at) VALUES ('n1', 'a-slide', 'highlight', '{}', 'op', 'now', 'now')`).run();
    db.prepare(`INSERT INTO jobs (id, kind, dedupe_key, state, payload_json, created_at, updated_at) VALUES ('j-other', 'backup', 'backup:x', 'done', '{}', 'now', 'now')`).run();
    return { pdf };
  }

  it('upgrades a real v3 library: every row and rowid kept, foreign keys whole and on, slide → slides, text-v0 jobs gone, a v3 snapshot', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file, migrations: v3 });
    const { pdf } = seedV3(db);
    const before = Object.fromEntries([...SAME, 'assets', 'anchors'].map((t) => [t, rows(db, t)]));
    expect(migrate(db, { dbFile: file })).toEqual({ from: 3, to: 4, backupFile: `${file}.pre-v4.bak` });
    for (const t of SAME) expect(rows(db, t), t).toEqual(before[t]);
    expect(rows(db, 'assets')).toEqual(before.assets!.map((r) => ({ ...r, width: null, height: null })));
    expect(rows(db, 'anchors')).toEqual(before.anchors!.map((r) =>
      r.kind !== 'slide' ? r : { ...r, kind: 'slides', locator_json: r.id === 'a-bad' ? r.locator_json : JSON.stringify({ ...JSON.parse(String(r.locator_json)), kind: 'slides' }) }));
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    const parents = (t: string) => (db.pragma(`foreign_key_list(${t})`) as { table: string }[]).map((r) => r.table);
    for (const t of ['item_assets', 'collection_items', 'item_tags', 'reading_positions']) expect(parents(t), t).toContain('items');
    expect(parents('annotations')).toEqual(['anchors']);
    const indexes = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).pluck().all() as string[]);
    expect(indexes).toEqual(expect.arrayContaining(['items_deleted_at', 'anchors_revision']));
    db.prepare(`UPDATE items SET type = 'image' WHERE id = ?`).run(pdf.itemId);
    expect(() => db.prepare(`UPDATE anchors SET kind = 'slide' WHERE id = 'a-slide'`).run()).toThrow(/CHECK/);
    expect(new AnchorsRepository(db).get('a-slide')?.anchor.kind).toBe('slides');
    expect(db.prepare('SELECT id FROM jobs').pluck().all()).toEqual(['j-other']);
    const snap = openDatabase(`${file}.pre-v4.bak`);
    dbs.push(snap);
    expect(currentVersion(snap)).toBe(3);
  });

  it('a foreign-keys-off migration that leaves an orphan is rolled back, and foreign keys are on again', () => {
    const { db, file } = tempDb();
    migrate(db, { dbFile: file, migrations: v3 });
    seedItem(new LibraryRepository(db), 1);
    const orphan = [...v3, { version: 4, name: 'orphan', sql: 'DELETE FROM items;', foreignKeysOff: true as const }];
    expect(() => migrate(db, { dbFile: file, migrations: orphan })).toThrow(/^v4 업데이트에 실패했습니다\. 데이터베이스는 v3 상태입니다\./);
    expect(currentVersion(db)).toBe(3);
    expect(db.prepare('SELECT COUNT(*) FROM items').pluck().get()).toBe(1);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('refuses to run inside a transaction', () => {
    const { db } = tempDb();
    migrate(db, { dbFile: null, migrations: v3 });
    expect(() => db.transaction(() => migrate(db, { dbFile: null }))()).toThrow(/^v4 업데이트에 실패했습니다\. 데이터베이스는 v3 상태입니다\./);
    expect(currentVersion(db)).toBe(3);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('10,000 items rebuild within a second', () => {
    const { db } = tempDb();
    migrate(db, { dbFile: null, migrations: v3 });
    const repo = new LibraryRepository(db);
    const { itemId, revisionId } = seedItem(repo, 1);
    const assetId = db.prepare('SELECT asset_id FROM item_assets WHERE item_id = ?').pluck().get(itemId) as string;
    const now = nowIso();
    repo.insertItemsForAsset(Array.from({ length: 10_000 }, (_, i) => ({
      id: newId(), type: 'pdf' as const, title: `n${i}`, createdAt: now, metadataJson: '{}', assetId, revisionId,
    })));
    const t0 = performance.now();
    migrate(db, { dbFile: null });
    const ms = performance.now() - t0;
    console.log('[measure] migrate-004', ms);
    expect(ms).toBeLessThan(1000);
    expect(db.prepare('SELECT COUNT(*) FROM items').pluck().get()).toBe(10_001);
  });

  it('the FTS triggers index, update and delete', () => {
    const { db } = tempDb();
    migrate(db, { dbFile: null });
    const hits = (q: string) => db.prepare('SELECT rowid FROM page_texts_fts WHERE page_texts_fts MATCH ?').all(`"${q}"`);
    db.prepare(`INSERT INTO page_texts (sha256, page_index, text) VALUES (?, 0, '현미경 관찰 기록')`).run('a'.repeat(64));
    expect(hits('현미경')).toHaveLength(1);
    db.prepare('UPDATE page_texts SET text = ?').run('망원경 관찰 기록');
    expect(hits('현미경')).toHaveLength(0);
    expect(hits('망원경')).toHaveLength(1);
    db.prepare('DELETE FROM page_texts').run();
    expect(hits('망원경')).toHaveLength(0);
  });
});
