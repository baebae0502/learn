import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@learn/domain';
import { CollectionsRepository, LibraryRepository, TagsRepository, readOrganizeSnapshot, trashCount, type Db } from '../src/index';
import { freshDb, seedItem } from './fixtures';

let db: Db;
let repo: LibraryRepository;
let collections: CollectionsRepository;
beforeEach(() => {
  db = freshDb();
  repo = new LibraryRepository(db);
  collections = new CollectionsRepository(db);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-31T01:00:00.000Z'));
});
afterEach(() => {
  vi.useRealTimers();
  db.close();
});

const at = (iso: string) => vi.setSystemTime(new Date(iso));
const count = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { n: number }).n;
const exists = (table: string, id: string) => count(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`, id) === 1;
/** An extract job for the asset's sha, as the importer queues one. */
const queueJob = (sha: string) =>
  db.prepare(`INSERT INTO jobs (id, kind, dedupe_key, state, payload_json, created_at, updated_at) VALUES (?, 'extract', ?, 'queued', '{}', ?, ?)`)
    .run(newId(), `extract:${sha}:text-v0`, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z');
/** A note on the asset's first revision: an anchor and an annotation on it (the tables exist; nothing writes them before M9). */
function annotate(revisionId: string): { anchorId: string; annotationId: string } {
  const anchorId = newId();
  const annotationId = newId();
  db.prepare(`INSERT INTO anchors (id, revision_id, kind, locator_json, schema_version) VALUES (?, ?, 'pdf', '{}', 1)`).run(anchorId, revisionId);
  db.prepare(`INSERT INTO annotations (id, anchor_id, type, body_json, operation_id, created_at, updated_at) VALUES (?, ?, 'note', '{}', ?, ?, ?)`)
    .run(annotationId, anchorId, newId(), '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z');
  return { anchorId, annotationId };
}

describe('the trash view (spec 4.3)', () => {
  it('lists the trashed items with when they went, most recent first, and nothing live', () => {
    const [a, b, c] = [seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId];
    repo.trash([a]);
    at('2026-10-31T02:00:00.000Z');
    repo.trash([b]);
    const view = repo.trashView();
    expect(view.items.map((i) => [i.id, i.deletedAt])).toEqual([[b, '2026-10-31T02:00:00.000Z'], [a, '2026-10-31T01:00:00.000Z']]);
    expect(view.items[0]).toMatchObject({ id: b, type: 'pdf', storageMode: 'managed' });
    expect(view.items.map((i) => i.id)).not.toContain(c);
    expect(repo.getItem(c)).not.toHaveProperty('deletedAt'); // the live row is the LibraryItem it was
  });

  it('shows a trashed collection as one row with the sub-collections trashed with it; one trashed on its own is a row of its own', () => {
    const bio = collections.create({ name: '분자생물학' }).id;
    const ch6 = collections.create({ name: '6장', parentId: bio }).id;
    const lab = collections.create({ name: '실험', parentId: ch6 }).id;
    const notes = collections.create({ name: '노트', parentId: bio }).id;
    const [x, y, z] = [seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId];
    collections.addItems(ch6, [x, y]);
    collections.addItems(lab, [y, z]);
    collections.addItems(notes, [x]);
    repo.trash([z]); // a trashed member is not counted
    collections.softDelete(notes); // on its own, first
    at('2026-10-31T02:00:00.000Z');
    collections.softDelete(bio); // bio, 6장, 실험 together; 노트 keeps its own stamp

    const rows = repo.trashView().collections;
    expect(rows).toEqual([
      { id: bio, name: '분자생물학', parentId: null, deletedAt: '2026-10-31T02:00:00.000Z', childCount: 2, itemCount: 2 },
      { id: notes, name: '노트', parentId: bio, deletedAt: '2026-10-31T01:00:00.001Z', childCount: 0, itemCount: 1 },
    ]);
    expect(trashCount(db)).toBe(3); // the two rows and the item z
    expect(readOrganizeSnapshot(db).trashCount).toBe(3);
  });

  it('a collection under a live parent is a row; the count is zero once nothing is in the trash', () => {
    const bio = collections.create({ name: '분자생물학' }).id;
    const ch6 = collections.create({ name: '6장', parentId: bio }).id;
    expect(trashCount(db)).toBe(0);
    collections.softDelete(ch6);
    expect(repo.trashView().collections.map((c) => [c.id, c.parentId])).toEqual([[ch6, bio]]);
    expect(trashCount(db)).toBe(1);
    collections.restore(ch6);
    expect(repo.trashView()).toEqual({ collections: [], items: [], members: {}, tagged: {} });
    expect(readOrganizeSnapshot(db).trashCount).toBe(0);
  });
});

describe('purge (spec 4.5, ADR-0006)', () => {
  it('removes a trashed item and its memberships, tags and position; the asset goes once no item uses it', () => {
    const first = seedItem(db);
    const coll = collections.create({ name: '강의' }).id;
    const tags = new TagsRepository(db);
    const tag = tags.create('중요').id;
    collections.addItems(coll, [first.itemId]);
    tags.assign(tag, [first.itemId]);
    db.prepare(`INSERT INTO reading_positions (item_id, revision_id, locator_json, progress, opened_at, updated_at) VALUES (?, ?, '{}', 0.5, ?, ?)`)
      .run(first.itemId, first.revisionId, '2026-10-31T00:00:00.000Z', '2026-10-31T00:00:00.000Z');
    queueJob(first.asset.sha256);
    repo.trash([first.itemId]);

    const result = repo.purge({ itemIds: [first.itemId], collectionIds: [] });
    expect(result).toEqual({
      itemIds: [first.itemId],
      collectionIds: [],
      assets: [{ id: first.asset.id, storageMode: 'managed', relativePath: first.asset.relativePath, size: 1234 }],
    });
    expect(exists('items', first.itemId)).toBe(false);
    expect(exists('assets', first.asset.id)).toBe(false);
    expect(exists('source_revisions', first.revisionId)).toBe(false);
    expect(count('SELECT COUNT(*) AS n FROM collection_items')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM item_tags')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM reading_positions')).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM jobs')).toBe(0);
    expect(exists('collections', coll) && exists('tags', tag)).toBe(true); // the collection and the tag stay
  });

  it('keeps a shared asset while another item uses it — a trashed one too — and lets it go with the last', () => {
    const first = seedItem(db);
    const live = seedItem(db, { reuseAsset: first.asset });
    const trashed = seedItem(db, { reuseAsset: first.asset });
    queueJob(first.asset.sha256);
    repo.trash([first.itemId, trashed.itemId]);

    expect(repo.purge({ itemIds: [first.itemId], collectionIds: [] })).toEqual({ itemIds: [first.itemId], collectionIds: [], assets: [] });
    expect(exists('assets', first.asset.id)).toBe(true);
    repo.trash([live.itemId]);
    expect(repo.purge({ itemIds: [live.itemId], collectionIds: [] }).assets).toEqual([]); // the trashed one still uses it
    expect(exists('assets', first.asset.id)).toBe(true);
    expect(count('SELECT COUNT(*) AS n FROM jobs')).toBe(1);

    expect(repo.purge({ itemIds: [trashed.itemId], collectionIds: [] }).assets.map((a) => a.id)).toEqual([first.asset.id]);
    expect(count('SELECT COUNT(*) AS n FROM jobs')).toBe(0);
  });

  it('keeps the jobs of a sha while another asset row of it remains (a linked copy of the same bytes)', () => {
    const managed = seedItem(db, { sha: 'e'.repeat(64) });
    const linked = seedItem(db, { sha: 'e'.repeat(64), mode: 'linked' });
    queueJob('e'.repeat(64));
    repo.trash([managed.itemId]);
    expect(repo.purge({ itemIds: [managed.itemId], collectionIds: [] }).assets.map((a) => a.storageMode)).toEqual(['managed']);
    expect(count('SELECT COUNT(*) AS n FROM jobs')).toBe(1);
    repo.trash([linked.itemId]);
    expect(repo.purge({ itemIds: [linked.itemId], collectionIds: [] }).assets).toEqual([
      { id: linked.asset.id, storageMode: 'linked', relativePath: null, size: 1234 },
    ]);
    expect(count('SELECT COUNT(*) AS n FROM jobs')).toBe(0);
  });

  it('a linked asset never names a file to remove, and a managed path another row still holds is kept', () => {
    const linked = seedItem(db, { mode: 'linked' });
    const managed = seedItem(db);
    // A second row naming the same managed path (a library written by hand or by a broken build): the file stays.
    db.prepare(`INSERT INTO assets (id, sha256, storage_mode, relative_path, original_name, mime, size, availability, created_at)
                VALUES (?, ?, 'managed', ?, 'x.pdf', 'application/pdf', 1, 'available', ?)`).run(newId(), 'f'.repeat(64), managed.asset.relativePath, '2026-10-31T00:00:00.000Z');
    repo.trash([linked.itemId, managed.itemId]);
    const { assets } = repo.purge({ itemIds: [linked.itemId, managed.itemId], collectionIds: [] });
    expect(assets).toEqual([
      { id: linked.asset.id, storageMode: 'linked', relativePath: null, size: 1234 },
      { id: managed.asset.id, storageMode: 'managed', relativePath: null, size: 1234 },
    ]);
  });

  it('removes the notes of a revision before the revision and the asset (anchors and annotations, ADR-0006)', () => {
    const first = seedItem(db);
    const { anchorId, annotationId } = annotate(first.revisionId);
    repo.trash([first.itemId]);
    expect(repo.purge({ itemIds: [first.itemId], collectionIds: [] }).assets).toHaveLength(1);
    expect(exists('anchors', anchorId) || exists('annotations', annotationId)).toBe(false);
  });

  it('is a no-op for live and unknown ids: nothing is removed, nothing is reported', () => {
    const live = seedItem(db);
    const coll = collections.create({ name: '강의' }).id;
    expect(repo.purge({ itemIds: [live.itemId, newId()], collectionIds: [coll, newId()] })).toEqual({ itemIds: [], collectionIds: [], assets: [] });
    expect(repo.getItem(live.itemId)).toMatchObject({ id: live.itemId });
    expect(collections.get(coll)).toMatchObject({ id: coll });
  });

  it('a collection row goes with the sub-collections trashed with it and their memberships; the items stay', () => {
    const bio = collections.create({ name: '분자생물학' }).id;
    const ch6 = collections.create({ name: '6장', parentId: bio }).id;
    const lab = collections.create({ name: '실험', parentId: ch6 }).id;
    const x = seedItem(db).itemId;
    collections.addItems(lab, [x]);
    collections.softDelete(bio);
    expect(repo.purge({ itemIds: [], collectionIds: [ch6] }).collectionIds).toEqual([]); // part of a row, not a row
    expect(repo.purge({ itemIds: [], collectionIds: [bio] })).toEqual({ itemIds: [], collectionIds: [bio, ch6, lab], assets: [] });
    expect([bio, ch6, lab].some((id) => exists('collections', id))).toBe(false);
    expect(count('SELECT COUNT(*) AS n FROM collection_items')).toBe(0);
    expect(repo.getItem(x)).toMatchObject({ id: x });
    expect(trashCount(db)).toBe(0);
  });

  it('a sub-collection trashed on its own is a row of its own: it stays when its parent\'s row goes, at the top level', () => {
    const bio = collections.create({ name: '분자생물학' }).id;
    const notes = collections.create({ name: '노트', parentId: bio }).id;
    const old = collections.create({ name: '옛 자료', parentId: notes }).id;
    collections.softDelete(notes); // 노트 and 옛 자료 together
    at('2026-10-31T02:00:00.000Z');
    collections.softDelete(bio);
    expect(repo.purge({ itemIds: [], collectionIds: [bio] }).collectionIds).toEqual([bio]);
    expect(repo.trashView().collections).toEqual([
      { id: notes, name: '노트', parentId: null, deletedAt: '2026-10-31T01:00:00.000Z', childCount: 1, itemCount: 0 },
    ]);
    expect(collections.restoreChanged(notes).changed).toBe(true);
    expect(collections.list().map((c) => [c.id, c.parentId])).toEqual([[notes, null], [old, notes]]);
  });

  it('removes items and collection rows asked together in one transaction: a failure leaves everything', () => {
    const a = seedItem(db);
    const coll = collections.create({ name: '강의' }).id;
    collections.softDelete(coll);
    repo.trash([a.itemId]);
    // A revision of another asset that names this asset's revision as its parent: the revision cannot go, so nothing does.
    const other = seedItem(db);
    db.prepare('UPDATE source_revisions SET parent_revision_id = ? WHERE id = ?').run(a.revisionId, other.revisionId);
    expect(() => repo.purge({ itemIds: [a.itemId], collectionIds: [coll] })).toThrow(/FOREIGN KEY/);
    expect(exists('items', a.itemId) && exists('assets', a.asset.id) && exists('collections', coll)).toBe(true);
    expect(trashCount(db)).toBe(2);
  });
});

describe('emptyTrash', () => {
  it('removes every trashed item and collection, and nothing live', () => {
    const live = seedItem(db);
    const [a, b] = [seedItem(db), seedItem(db, { reuseAsset: live.asset })];
    const keep = collections.create({ name: '남김' }).id;
    const bio = collections.create({ name: '분자생물학' }).id;
    const notes = collections.create({ name: '노트', parentId: bio }).id;
    collections.softDelete(notes);
    at('2026-10-31T02:00:00.000Z');
    collections.softDelete(bio);
    repo.trash([a.itemId, b.itemId]);

    const result = repo.emptyTrash();
    expect(result.itemIds.sort()).toEqual([a.itemId, b.itemId].sort());
    expect(result.collectionIds.sort()).toEqual([bio, notes].sort());
    expect(result.assets.map((x) => x.id)).toEqual([a.asset.id]); // b shared the live item's asset
    expect(repo.trashView()).toEqual({ collections: [], items: [], members: {}, tagged: {} });
    expect(repo.listItems().map((i) => i.id)).toEqual([live.itemId]);
    expect(collections.list().map((c) => c.id)).toEqual([keep]);
    expect(repo.emptyTrash()).toEqual({ itemIds: [], collectionIds: [], assets: [] });
  });
});
