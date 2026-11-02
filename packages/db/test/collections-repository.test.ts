import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '@learn/domain';
import { CollectionsRepository, type Db } from '../src/index';
import { expectLearnError, freshDb, seedItem } from './fixtures';

let db: Db;
let repo: CollectionsRepository;
beforeEach(() => {
  db = freshDb();
  repo = new CollectionsRepository(db);
});
afterEach(() => {
  vi.useRealTimers();
});

const CYCLE = '하위 컬렉션 안으로는 옮길 수 없습니다.';
const ids = (list: { id: string }[]) => list.map((c) => c.id);
const deletedAt = (id: string) => (db.prepare('SELECT deleted_at FROM collections WHERE id = ?').get(id) as { deleted_at: string | null }).deleted_at;

/** a > b > c > d (each the parent of the next) */
function chain(n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(repo.create({ name: `c${i}`, parentId: out.at(-1) ?? null }).id);
  return out;
}

describe('CollectionsRepository: create / rename / list', () => {
  it('creates root and nested collections, trims names, lists in creation order', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    const root = repo.create({ name: '  강의  ' });
    expect(root).toEqual({ id: root.id, name: '강의', parentId: null, itemCount: 0, createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z' });
    const child = repo.create({ name: '선형대수', parentId: root.id });
    const other = repo.create({ name: 'Other', parentId: null });
    expect(child.parentId).toBe(root.id);
    expect(ids(repo.list())).toEqual([root.id, child.id, other.id]);
    expect(repo.get(child.id)).toEqual(child);
  });

  it('renames and bumps updatedAt', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    const c = repo.create({ name: 'a' });
    vi.setSystemTime(new Date('2026-10-20T02:00:00.000Z'));
    expect(repo.rename(c.id, ' b ')).toMatchObject({ id: c.id, name: 'b', createdAt: '2026-10-20T01:00:00.000Z', updatedAt: '2026-10-20T02:00:00.000Z' });
  });

  it('stores names NFC-normalized (create and rename)', () => {
    const nfc = '선형대수';
    const c = repo.create({ name: ` ${nfc.normalize('NFD')} ` });
    expect(c.name).toBe(nfc);
    expect(repo.rename(c.id, '해석학'.normalize('NFD')).name).toBe('해석학');
    expect((db.prepare('SELECT name FROM collections WHERE id = ?').get(c.id) as { name: string }).name).toBe('해석학');
    expect(repo.create({ name: '가'.repeat(200).normalize('NFD') }).name).toBe('가'.repeat(200)); // bound counts the NFC form
  });

  it('validates names and requires a live parent', () => {
    expectLearnError(() => repo.create({ name: '   ' }), 'VALIDATION_FAILED', '컬렉션 이름');
    expectLearnError(() => repo.create({ name: 'x'.repeat(201) }), 'VALIDATION_FAILED', '컬렉션 이름');
    const c = repo.create({ name: 'a' });
    expectLearnError(() => repo.rename(c.id, ''), 'VALIDATION_FAILED', '컬렉션 이름');
    expectLearnError(() => repo.create({ name: 'b', parentId: newId() }), 'NOT_FOUND', '상위 컬렉션을 찾을 수 없습니다.');
    repo.softDelete(c.id);
    expectLearnError(() => repo.create({ name: 'b', parentId: c.id }), 'NOT_FOUND', '상위 컬렉션을 찾을 수 없습니다.');
    expect(repo.list()).toEqual([]);
  });
});

describe('CollectionsRepository: move', () => {
  it('rejects moving into itself, a child, a grandchild or anywhere down a deep chain', () => {
    const [a, b, c] = chain(3) as [string, string, string];
    expectLearnError(() => repo.move(a, a), 'VALIDATION_FAILED', CYCLE);
    expectLearnError(() => repo.move(a, b), 'VALIDATION_FAILED', CYCLE);
    expectLearnError(() => repo.move(a, c), 'VALIDATION_FAILED', CYCLE);
    const deep = chain(40);
    expectLearnError(() => repo.move(deep[0]!, deep[39]!), 'VALIDATION_FAILED', CYCLE);
    expectLearnError(() => repo.move(deep[10]!, deep[25]!), 'VALIDATION_FAILED', CYCLE);
    expect(repo.get(a)!.parentId).toBeNull();
    expect(repo.get(deep[10]!)!.parentId).toBe(deep[9]);
  });

  it('moves under a sibling subtree, up to the root, and to an ancestor', () => {
    const [a, b, c] = chain(3) as [string, string, string];
    const x = repo.create({ name: 'x' }).id;
    expect(repo.move(b, x).parentId).toBe(x); // b (with c) now under x
    expect(repo.get(c)!.parentId).toBe(b);
    expect(repo.move(c, a).parentId).toBe(a); // to a former ancestor
    expect(repo.move(b, null).parentId).toBeNull();
    expect(repo.move(a, x).parentId).toBe(x); // a (with c) under x
    expect(repo.get(c)!.parentId).toBe(a);
  });

  it('requires a live collection and a live target parent', () => {
    const a = repo.create({ name: 'a' }).id;
    const gone = repo.create({ name: 'gone' }).id;
    repo.softDelete(gone);
    expectLearnError(() => repo.move(newId(), null), 'NOT_FOUND', '컬렉션을 찾을 수 없습니다.');
    expectLearnError(() => repo.move(gone, a), 'NOT_FOUND', '컬렉션을 찾을 수 없습니다.');
    expectLearnError(() => repo.move(a, gone), 'NOT_FOUND', '상위 컬렉션을 찾을 수 없습니다.');
    expectLearnError(() => repo.move(a, newId()), 'NOT_FOUND', '상위 컬렉션을 찾을 수 없습니다.');
  });
});

describe('CollectionsRepository: soft delete / restore', () => {
  it('deletes the whole subtree without touching items, and restore brings back the subtree and deleted ancestors', () => {
    const [a, b, c, d] = chain(4) as [string, string, string, string];
    const sibling = repo.create({ name: 'sibling', parentId: a }).id;
    const { itemId } = seedItem(db);
    repo.addItems(c, [itemId]);

    repo.softDelete(b);
    expect(ids(repo.list())).toEqual([a, sibling]);
    expect([b, c, d].every((id) => deletedAt(id) !== null)).toBe(true);
    expect(repo.get(c)).toBeUndefined();
    expect((db.prepare('SELECT deleted_at FROM items WHERE id = ?').get(itemId) as { deleted_at: string | null }).deleted_at).toBeNull();
    expect((db.prepare('SELECT COUNT(*) AS n FROM collection_items').get() as { n: number }).n).toBe(1);

    repo.softDelete(a); // now everything is deleted
    expect(repo.list()).toEqual([]);

    // Restoring c brings back c's subtree (d) and its deleted ancestors (b, a), but not a's other child.
    expect(repo.restore(c)).toMatchObject({ id: c, parentId: b, itemCount: 1 });
    expect(ids(repo.list())).toEqual([a, b, c, d]);
    expect(deletedAt(sibling)).not.toBeNull();
  });

  it('keeps the original deletion time of an already-deleted descendant', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const [a, b] = chain(2) as [string, string];
    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    repo.softDelete(b);
    vi.setSystemTime(new Date('2026-10-20T02:00:00.000Z'));
    repo.softDelete(a);
    expect(deletedAt(b)).toBe('2026-10-20T01:00:00.000Z');
    expect(deletedAt(a)).toBe('2026-10-20T02:00:00.000Z');
  });

  it('restores only the descendants deleted with the target: a child deleted earlier stays deleted', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const [a, b, c] = chain(3) as [string, string, string];
    const sibling = repo.create({ name: 'sibling', parentId: a }).id;
    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    repo.softDelete(b); // b and c
    vi.setSystemTime(new Date('2026-10-20T02:00:00.000Z'));
    repo.softDelete(a); // a and sibling; b and c keep their own time
    expect(repo.restoreChanged(a)).toMatchObject({ changed: true, collection: { id: a } });
    expect(ids(repo.list())).toEqual([a, sibling]);
    expect([deletedAt(b), deletedAt(c)]).toEqual(['2026-10-20T01:00:00.000Z', '2026-10-20T01:00:00.000Z']);
    // Restoring the child that went first brings back its own subtree.
    expect(repo.restore(b)).toMatchObject({ id: b, parentId: a });
    expect(ids(repo.list())).toEqual([a, b, c, sibling]);
  });

  it('brings back every descendant deleted in the same batch, however deep, with their items', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    const [a, b, c, d] = chain(4) as [string, string, string, string];
    const side = repo.create({ name: 'side', parentId: b }).id;
    const { itemId } = seedItem(db);
    repo.addItems(d, [itemId]);
    vi.setSystemTime(new Date('2026-10-20T02:00:00.000Z'));
    repo.softDelete(b); // b, c, d, side
    expect(ids(repo.list())).toEqual([a]);
    vi.setSystemTime(new Date('2026-10-20T03:00:00.000Z'));
    expect(repo.restore(b)).toMatchObject({ id: b, parentId: a });
    expect(ids(repo.list())).toEqual([a, b, c, d, side]);
    expect(repo.get(d)).toMatchObject({ itemCount: 1 });
  });

  it('still restores every deleted ancestor, whatever its batch, and only the target\'s own batch below it', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const [a, b, c, d] = chain(4) as [string, string, string, string];
    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    repo.softDelete(d); // d alone
    vi.setSystemTime(new Date('2026-10-20T02:00:00.000Z'));
    repo.softDelete(b); // b, c (d keeps its time)
    vi.setSystemTime(new Date('2026-10-20T03:00:00.000Z'));
    repo.softDelete(a); // a
    expect(repo.restoreChanged(c)).toMatchObject({ changed: true, collection: { id: c, parentId: b } });
    expect(ids(repo.list())).toEqual([a, b, c]); // a (03:00) and b (02:00) come back with c; d (01:00) does not
    expect(deletedAt(d)).toBe('2026-10-20T01:00:00.000Z');
  });

  it('m-4: a child deleted on its own in the same millisecond as its parent stays in the trash when the parent is restored', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T01:00:00.000Z'));
    const [a, b] = chain(2) as [string, string];
    repo.softDelete(b); // b alone
    repo.softDelete(a); // a, the same millisecond
    expect([deletedAt(b), deletedAt(a)]).toEqual(['2026-10-20T01:00:00.000Z', '2026-10-20T01:00:00.001Z']);
    expect(repo.restoreChanged(a)).toMatchObject({ changed: true, collection: { id: a } });
    expect(ids(repo.list())).toEqual([a]);
    expect(deletedAt(b)).toBe('2026-10-20T01:00:00.000Z');
  });

  it('throws NOT_FOUND for unknown or already-deleted targets', () => {
    const a = repo.create({ name: 'a' }).id;
    repo.softDelete(a);
    expectLearnError(() => repo.softDelete(a), 'NOT_FOUND', '컬렉션을 찾을 수 없습니다.');
    expectLearnError(() => repo.softDelete(newId()), 'NOT_FOUND');
    expectLearnError(() => repo.restore(newId()), 'NOT_FOUND', '컬렉션을 찾을 수 없습니다.');
    expectLearnError(() => repo.rename(a, 'x'), 'NOT_FOUND');
    expect(repo.restore(a).id).toBe(a);
    const child = repo.create({ name: 'child', parentId: a }).id;
    repo.softDelete(child);
    expect(repo.restore(a).id).toBe(a); // restoring a live collection is a no-op
    expect(deletedAt(child)).not.toBeNull();
  });

  it('restoreChanged says whether anything was restored', () => {
    const a = repo.create({ name: 'a' }).id;
    expect(repo.restoreChanged(a)).toMatchObject({ changed: false, collection: { id: a } });
    repo.softDelete(a);
    expect(repo.restoreChanged(a)).toMatchObject({ changed: true, collection: { id: a } });
    expect(deletedAt(a)).toBeNull();
    expect(repo.restoreChanged(a).changed).toBe(false);
    expectLearnError(() => repo.restoreChanged(newId()), 'NOT_FOUND', '컬렉션을 찾을 수 없습니다.');
  });
});

describe('CollectionsRepository: items', () => {
  it('adds items ignoring duplicates and unknown ids, removes them, and counts only non-trashed items', () => {
    const c = repo.create({ name: 'c' }).id;
    const i1 = seedItem(db).itemId;
    const i2 = seedItem(db).itemId;
    const i3 = seedItem(db).itemId;
    expect(repo.addItems(c, [i1, i2])).toBe(2);
    expect(repo.addItems(c, [i1, i2, i3, newId()])).toBe(1);
    expect(repo.get(c)!.itemCount).toBe(3);
    const addedAt = db.prepare('SELECT added_at FROM collection_items WHERE item_id = ?').get(i1) as { added_at: string | null };
    expect(addedAt.added_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run('2026-10-20T00:00:00.000Z', i3);
    expect(repo.list()[0]!.itemCount).toBe(2);
    expect(repo.itemIds(c, { includeSubcollections: false }).sort()).toEqual([i1, i2].sort());

    expect(repo.removeItems(c, [i1, newId()])).toBe(1);
    expect(repo.removeItems(c, [i1])).toBe(0);
    expect(repo.itemIds(c, { includeSubcollections: false })).toEqual([i2]);
  });

  it('addItemsChanged / removeItemsChanged report exactly the items whose membership changed, each once', () => {
    const c = repo.create({ name: 'c' }).id;
    const [i1, i2, trashed] = [seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId];
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run('2026-10-20T00:00:00.000Z', trashed);
    expect(repo.addItemsChanged(c, [i1, i1, trashed, newId()])).toEqual([i1]);
    expect(repo.addItemsChanged(c, [i1, i2])).toEqual([i2]);
    expect(repo.addItemsChanged(c, [i1, i2])).toEqual([]);
    expect(repo.removeItemsChanged(c, [i2, i2, newId()])).toEqual([i2]);
    expect(repo.removeItemsChanged(c, [i2])).toEqual([]);
    expect(repo.itemIds(c, { includeSubcollections: false })).toEqual([i1]);
  });

  it('collects item ids from live subcollections when asked, without duplicates', () => {
    const [a, b, c] = chain(3) as [string, string, string];
    const gone = repo.create({ name: 'gone', parentId: a }).id;
    const [i1, i2, i3, i4] = [seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId];
    repo.addItems(a, [i1]);
    repo.addItems(b, [i2, i1]);
    repo.addItems(c, [i3]);
    repo.addItems(gone, [i4]);
    repo.softDelete(gone);
    expect(repo.itemIds(a, { includeSubcollections: false })).toEqual([i1]);
    expect(repo.itemIds(a, { includeSubcollections: true }).sort()).toEqual([i1, i2, i3].sort());
    expect(repo.itemIds(b, { includeSubcollections: true }).sort()).toEqual([i1, i2, i3].sort());
  });

  it('lists the live collections an item belongs to', () => {
    const [a, b] = chain(2) as [string, string];
    const gone = repo.create({ name: 'gone' }).id;
    const { itemId } = seedItem(db);
    for (const id of [a, b, gone]) repo.addItems(id, [itemId]);
    repo.softDelete(gone);
    expect(ids(repo.membershipsOf(itemId))).toEqual([a, b]);
    expect(repo.membershipsOf(newId())).toEqual([]);
  });

  it('throws NOT_FOUND for unknown or deleted collections', () => {
    const { itemId } = seedItem(db);
    const gone = repo.create({ name: 'gone' }).id;
    repo.softDelete(gone);
    for (const id of [newId(), gone]) {
      expectLearnError(() => repo.addItems(id, [itemId]), 'NOT_FOUND', '컬렉션을 찾을 수 없습니다.');
      expectLearnError(() => repo.removeItems(id, [itemId]), 'NOT_FOUND', '컬렉션을 찾을 수 없습니다.');
      expectLearnError(() => repo.itemIds(id, { includeSubcollections: true }), 'NOT_FOUND', '컬렉션을 찾을 수 없습니다.');
    }
  });
});
