import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@learn/domain';
import { TagsRepository, type Db } from '../src/index';
import { expectLearnError, freshDb, seedItem } from './fixtures';

let db: Db;
let repo: TagsRepository;
beforeEach(() => {
  db = freshDb();
  repo = new TagsRepository(db);
});

const itemsOf = (tagId: string) =>
  (db.prepare('SELECT item_id FROM item_tags WHERE tag_id = ? ORDER BY item_id').all(tagId) as { item_id: string }[]).map((r) => r.item_id);
const sorted = (xs: string[]) => [...xs].sort();

describe('TagsRepository: create / list / rename', () => {
  it('creates a tag, and reuses an existing one case-insensitively', () => {
    const math = repo.create('  Math ');
    expect(math).toEqual({ id: math.id, name: 'Math', color: null, position: null, itemCount: 0 });
    expect(repo.create('math')).toEqual(math);
    expect(repo.create('MATH').id).toBe(math.id);
    expect(repo.list()).toEqual([math]);
    expectLearnError(() => repo.create('  '), 'VALIDATION_FAILED', '태그 이름');
    expectLearnError(() => repo.create('x'.repeat(201)), 'VALIDATION_FAILED', '태그 이름');
  });

  it('stores names NFC-normalized, so a decomposed (NFD) Hangul name finds its composed twin', () => {
    const nfc = '수학';
    const nfd = nfc.normalize('NFD');
    const tag = repo.create(nfd);
    expect(tag.name).toBe(nfc);
    expect(repo.findOrCreate(nfc)).toEqual({ created: false, tag });
    expect(repo.findOrCreate(`  ${nfd} `)).toEqual({ created: false, tag });
    expect(repo.list()).toHaveLength(1);
    const other = repo.create('물리');
    expect(repo.rename(other.id, '수학'.normalize('NFD')).id).toBe(tag.id); // merges into the NFC twin
    expect(repo.create('가'.repeat(200).normalize('NFD')).name).toBe('가'.repeat(200)); // bound counts the NFC form
  });

  it('findOrCreate says whether the tag was created', () => {
    const first = repo.findOrCreate(' Math ');
    expect(first).toEqual({ created: true, tag: { id: first.tag.id, name: 'Math', color: null, position: null, itemCount: 0 } });
    expect(repo.findOrCreate('MATH')).toEqual({ created: false, tag: first.tag });
    expect(repo.list()).toHaveLength(1);
  });

  it('counts only non-trashed items and lists colored tags first by position', () => {
    const plain = repo.create('plain');
    const second = repo.create('second');
    const first = repo.create('first');
    repo.setColor(second.id, 'red', 2);
    repo.setColor(first.id, 'yellow', 1);
    const [i1, i2] = [seedItem(db).itemId, seedItem(db).itemId];
    repo.assign(plain.id, [i1, i2]);
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run('2026-10-20T00:00:00.000Z', i2);
    expect(repo.list().map((t) => [t.name, t.position, t.itemCount])).toEqual([['first', 1, 0], ['second', 2, 0], ['plain', null, 1]]);
  });

  it('renames, including a case-only change of the same tag', () => {
    const t = repo.create('math');
    expect(repo.rename(t.id, ' Linear Algebra ')).toMatchObject({ id: t.id, name: 'Linear Algebra' });
    expect(repo.rename(t.id, 'linear algebra')).toMatchObject({ id: t.id, name: 'linear algebra' });
    expect(repo.list()).toHaveLength(1);
    expectLearnError(() => repo.rename(newId(), 'x'), 'NOT_FOUND', '태그를 찾을 수 없습니다.');
    expectLearnError(() => repo.rename(t.id, ''), 'VALIDATION_FAILED', '태그 이름');
  });

  it('merges into the existing tag on a case-insensitive name clash, keeping every item once', () => {
    const [i1, i2, i3] = [seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId];
    const a = repo.create('Calc');
    const b = repo.create('Calculus');
    repo.setColor(b.id, 'blue', 3);
    repo.assign(a.id, [i1, i2]);
    repo.assign(b.id, [i2, i3]);

    const merged = repo.rename(a.id, 'calculus');
    expect(merged).toEqual({ id: b.id, name: 'Calculus', color: 'blue', position: 3, itemCount: 3 });
    expect(itemsOf(b.id)).toEqual(sorted([i1, i2, i3]));
    expect(itemsOf(a.id)).toEqual([]);
    expect(repo.list().map((t) => t.id)).toEqual([b.id]);
  });
});

describe('TagsRepository: color and position', () => {
  it('assigns color and position, moving a taken position off the other tag in one step', () => {
    const a = repo.create('a');
    const b = repo.create('b');
    expect(repo.setColor(a.id, 'yellow', 1)).toMatchObject({ color: 'yellow', position: 1 });
    expect(repo.setColor(b.id, 'red', 1)).toMatchObject({ id: b.id, color: 'red', position: 1 });
    expect(repo.list().find((t) => t.id === a.id)).toMatchObject({ color: null, position: null });
    expect(repo.setColor(b.id, 'red', 1)).toMatchObject({ position: 1 }); // re-assigning its own position is fine
    expect(repo.setColor(b.id, null, null)).toMatchObject({ color: null, position: null });
  });

  it('clears the color of the tag whose position is taken, in the same step, and touches no other tag', () => {
    const a = repo.create('a');
    const b = repo.create('b');
    const c = repo.create('c');
    const colorOnly = repo.create('color only');
    repo.setColor(a.id, 'yellow', 1);
    repo.setColor(b.id, 'red', 2);
    repo.setColor(colorOnly.id, 'green', null); // a color without a position holds nothing to take
    expect(repo.setColor(c.id, 'blue', 1)).toMatchObject({ id: c.id, color: 'blue', position: 1 });
    const byId = new Map(repo.list().map((t) => [t.id, t]));
    expect(byId.get(a.id)).toMatchObject({ color: null, position: null });
    expect(byId.get(b.id)).toMatchObject({ color: 'red', position: 2 });
    expect(byId.get(colorOnly.id)).toMatchObject({ color: 'green', position: null });
    expect(repo.list().map((t) => t.name)).toEqual(['c', 'b', 'a', 'color only']); // positioned tags first, then creation order
  });

  it('keeps the other tag as it was when the new position is null or the tag takes its own position again', () => {
    const a = repo.create('a');
    const b = repo.create('b');
    repo.setColor(a.id, 'yellow', 1);
    repo.setColor(b.id, 'red', null);
    expect(repo.list().find((t) => t.id === a.id)).toMatchObject({ color: 'yellow', position: 1 });
    repo.setColor(a.id, 'yellow', 1);
    expect(repo.list().find((t) => t.id === a.id)).toMatchObject({ color: 'yellow', position: 1 });
  });

  it('rejects unknown colors, out-of-range positions and unknown tags', () => {
    const a = repo.create('a');
    expectLearnError(() => repo.setColor(a.id, 'pink' as never, null), 'VALIDATION_FAILED', '태그 색');
    expectLearnError(() => repo.setColor(a.id, '#ff0000' as never, 1), 'VALIDATION_FAILED', '태그 색');
    for (const p of [0, 9, 1.5]) expectLearnError(() => repo.setColor(a.id, 'red', p), 'VALIDATION_FAILED', '위치');
    expectLearnError(() => repo.setColor(newId(), 'red', 1), 'NOT_FOUND', '태그를 찾을 수 없습니다.');
    expect(repo.list()[0]).toMatchObject({ color: null, position: null });
  });
});

describe('TagsRepository: items', () => {
  it('assigns and unassigns, ignoring duplicates, unknown and trashed items', () => {
    const t = repo.create('t');
    const [i1, i2, trashed] = [seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId];
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run('2026-10-20T00:00:00.000Z', trashed);
    expect(repo.assign(t.id, [i1])).toBe(1);
    expect(repo.assign(t.id, [i1, i2, trashed, newId()])).toBe(1);
    expect(repo.tagsOf(i1).map((x) => x.id)).toEqual([t.id]);
    expect(repo.unassign(t.id, [i1, newId()])).toBe(1);
    expect(itemsOf(t.id)).toEqual([i2]);
    expectLearnError(() => repo.assign(newId(), [i1]), 'NOT_FOUND', '태그를 찾을 수 없습니다.');
    expectLearnError(() => repo.unassign(newId(), [i1]), 'NOT_FOUND', '태그를 찾을 수 없습니다.');
  });

  it('assignChanged / unassignChanged report exactly the items whose tags changed, each once', () => {
    const t = repo.create('t');
    const [i1, i2, trashed] = [seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId];
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run('2026-10-20T00:00:00.000Z', trashed);
    expect(repo.assignChanged(t.id, [i1, i1, trashed, newId()])).toEqual([i1]);
    expect(repo.assignChanged(t.id, [i1, i2])).toEqual([i2]);
    expect(repo.assignChanged(t.id, [i2])).toEqual([]);
    expect(repo.unassignChanged(t.id, [i1, i1, newId()])).toEqual([i1]);
    expect(repo.unassignChanged(t.id, [i1])).toEqual([]);
    expect(itemsOf(t.id)).toEqual([i2]);
  });

  it('togglePositionChanged also reports the items that changed (only the ones that lacked the tag when adding)', () => {
    const t = repo.create('starred');
    repo.setColor(t.id, 'orange', 4);
    const [i1, i2, i3] = [seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId];
    repo.assign(t.id, [i1]);
    expect(repo.togglePositionChanged(4, [i1, i2, i2, i3])).toEqual({ tagId: t.id, assigned: true, itemIds: [i2, i3] });
    expect(repo.togglePositionChanged(4, [i3, i1])).toEqual({ tagId: t.id, assigned: false, itemIds: [i3, i1] });
    expect(repo.togglePositionChanged(5, [i1])).toBeNull();
  });

  it('removes a tag and its assignments', () => {
    const t = repo.create('t');
    const { itemId } = seedItem(db);
    repo.assign(t.id, [itemId]);
    repo.remove(t.id);
    expect(repo.list()).toEqual([]);
    expect(itemsOf(t.id)).toEqual([]);
    expectLearnError(() => repo.remove(t.id), 'NOT_FOUND', '태그를 찾을 수 없습니다.');
  });

  it('toggles the tag at a position: some -> all get it, all -> all lose it, empty position -> null', () => {
    const t = repo.create('starred');
    repo.setColor(t.id, 'orange', 4);
    const [i1, i2, i3] = [seedItem(db).itemId, seedItem(db).itemId, seedItem(db).itemId];
    repo.assign(t.id, [i1]);

    expect(repo.togglePosition(4, [i1, i2, i3])).toEqual({ tagId: t.id, assigned: true });
    expect(itemsOf(t.id)).toEqual(sorted([i1, i2, i3]));
    expect(repo.togglePosition(4, [i1, i2])).toEqual({ tagId: t.id, assigned: false });
    expect(itemsOf(t.id)).toEqual([i3]);
    expect(repo.togglePosition(5, [i1])).toBeNull();
    expectLearnError(() => repo.togglePosition(9, [i1]), 'VALIDATION_FAILED', '위치');
  });

  it('returns null and changes nothing when no target is a live item', () => {
    const t = repo.create('starred');
    repo.setColor(t.id, 'orange', 4);
    const [kept, trashed] = [seedItem(db).itemId, seedItem(db).itemId];
    repo.assign(t.id, [kept, trashed]);
    db.prepare('UPDATE items SET deleted_at = ? WHERE id = ?').run('2026-10-20T00:00:00.000Z', trashed);
    const before = itemsOf(t.id);
    expect(repo.togglePosition(4, [trashed, newId(), trashed])).toBeNull();
    expect(itemsOf(t.id)).toEqual(before);
  });

  it('handles duplicate ids in the input once', () => {
    const t = repo.create('starred');
    repo.setColor(t.id, 'orange', 4);
    const [i1, i2] = [seedItem(db).itemId, seedItem(db).itemId];
    repo.assign(t.id, [i1]);
    // i1 listed twice and already tagged, i2 untagged: not all have it -> add to all, each once
    expect(repo.togglePosition(4, [i1, i1, i2, i2])).toEqual({ tagId: t.id, assigned: true });
    expect(itemsOf(t.id)).toEqual(sorted([i1, i2]));
    // now every distinct target has it -> remove from all
    expect(repo.togglePosition(4, [i2, i1, i2])).toEqual({ tagId: t.id, assigned: false });
    expect(itemsOf(t.id)).toEqual([]);
  });
});
