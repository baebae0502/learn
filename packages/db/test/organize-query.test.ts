import { beforeEach, describe, expect, it } from 'vitest';
import { CollectionsRepository, LibraryRepository, TagsRepository, readOrganizeSnapshot, type Db } from '../src/index';
import { freshDb, seedItem } from './fixtures';

let db: Db;
let collections: CollectionsRepository;
let tags: TagsRepository;
let library: LibraryRepository;
beforeEach(() => {
  db = freshDb();
  collections = new CollectionsRepository(db);
  tags = new TagsRepository(db);
  library = new LibraryRepository(db);
});

describe('readOrganizeSnapshot', () => {
  it('is empty for an empty library', () => {
    expect(readOrganizeSnapshot(db)).toEqual({ collections: [], tags: [], members: {}, tagged: {}, duplicates: [] });
  });

  it('lists live collections in creation order with the fields the tree needs, and none of the deleted subtree', () => {
    const a = collections.create({ name: '강의' });
    const b = collections.create({ name: '선형대수', parentId: a.id });
    const c = collections.create({ name: '해석학', parentId: b.id });
    const d = collections.create({ name: '읽기 자료' });
    collections.softDelete(b.id); // b and c
    expect(readOrganizeSnapshot(db).collections).toEqual([
      { id: a.id, name: '강의', parentId: null, createdAt: a.createdAt },
      { id: d.id, name: '읽기 자료', parentId: null, createdAt: d.createdAt },
    ]);
    collections.restore(c.id); // brings back c and its deleted ancestor b
    expect(readOrganizeSnapshot(db).collections.map((x) => [x.id, x.parentId])).toEqual([[a.id, null], [b.id, a.id], [c.id, b.id], [d.id, null]]);
  });

  it('lists tags the way TAG_ORDER does: colored ones by position first, then the rest in creation order', () => {
    const plain = tags.create('plain');
    const second = tags.create('second');
    const first = tags.create('first');
    const later = tags.create('later');
    tags.setColor(second.id, 'red', 2);
    tags.setColor(first.id, 'yellow', 1);
    expect(readOrganizeSnapshot(db).tags).toEqual([
      { id: first.id, name: 'first', color: 'yellow', position: 1 },
      { id: second.id, name: 'second', color: 'red', position: 2 },
      { id: plain.id, name: 'plain', color: null, position: null },
      { id: later.id, name: 'later', color: null, position: null },
    ]);
    expect(readOrganizeSnapshot(db).tags.map((t) => t.id)).toEqual(tags.list().map((t) => t.id));
  });

  it('reads an unknown stored color as none, like the Tag type does', () => {
    const t = tags.create('odd');
    db.prepare('UPDATE tags SET color = ? WHERE id = ?').run('chartreuse', t.id);
    expect(readOrganizeSnapshot(db).tags).toEqual([{ id: t.id, name: 'odd', color: null, position: null }]);
  });

  it('lists the direct, non-trashed members of live collections; empty collections and deleted ones have no key', () => {
    const a = collections.create({ name: 'a' });
    const child = collections.create({ name: 'child', parentId: a.id });
    const empty = collections.create({ name: 'empty' });
    const deleted = collections.create({ name: 'deleted' });
    const [i1, i2, i3, trashed] = [seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId];
    collections.addItems(a.id, [i1, i2, trashed]);
    collections.addItems(child.id, [i2, i3]); // i2 is in two collections
    collections.addItems(deleted.id, [i1]);
    collections.softDelete(deleted.id);
    library.trash([trashed]);
    const { members } = readOrganizeSnapshot(db);
    expect(members).toEqual({ [a.id]: [i1, i2], [child.id]: [i2, i3] }); // direct only: a does not list i3
    expect(members[empty.id]).toBeUndefined();
    expect(members[deleted.id]).toBeUndefined();
  });

  it('lists the non-trashed items each tag is on; a tag nothing has no key', () => {
    const [t1, t2, unused] = [tags.create('t1'), tags.create('t2'), tags.create('unused')];
    const [i1, i2, trashed] = [seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId];
    tags.assign(t1.id, [i1, i2, trashed]);
    tags.assign(t2.id, [i2]);
    library.trash([trashed]);
    const { tagged } = readOrganizeSnapshot(db);
    expect(tagged).toEqual({ [t1.id]: [i1, i2], [t2.id]: [i2] });
    expect(tagged[unused.id]).toBeUndefined();
  });

  it('groups the non-trashed items that share content, as duplicateGroups does, and drops a group trash leaves with one', () => {
    const first = seedItem(db, { sha: 'a'.repeat(64) });
    const second = seedItem(db, { reuseAsset: first.asset }); // same asset
    const linked = seedItem(db, { sha: 'a'.repeat(64), mode: 'linked' }); // same content, separate asset
    seedItem(db, { sha: 'b'.repeat(64) }); // unique
    const d1 = seedItem(db, { sha: 'd'.repeat(64) });
    const d2 = seedItem(db, { reuseAsset: d1.asset });
    expect(readOrganizeSnapshot(db).duplicates).toEqual([[first.itemId, second.itemId, linked.itemId], [d1.itemId, d2.itemId]]);
    expect(readOrganizeSnapshot(db).duplicates).toEqual(library.duplicateGroups().map((g) => g.itemIds));
    library.trash([d2.itemId]);
    expect(readOrganizeSnapshot(db).duplicates).toEqual([[first.itemId, second.itemId, linked.itemId]]);
  });

  it('reads a trashed item back into every list when it is restored', () => {
    const c = collections.create({ name: 'c' });
    const t = tags.create('t');
    const { itemId } = seedItem(db);
    collections.addItems(c.id, [itemId]);
    tags.assign(t.id, [itemId]);
    library.trash([itemId]);
    expect(readOrganizeSnapshot(db)).toMatchObject({ members: {}, tagged: {} });
    library.restore([itemId]);
    expect(readOrganizeSnapshot(db)).toMatchObject({ members: { [c.id]: [itemId] }, tagged: { [t.id]: [itemId] } });
  });
});
