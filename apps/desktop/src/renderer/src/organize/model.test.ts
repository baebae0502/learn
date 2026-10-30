import { describe, expect, it } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel, organizeModelFor } from './model';
import { item } from './testing';

const at = '2026-10-01T00:00:00.000Z';
const ITEMS = ['i1', 'i2', 'i3', 'i4', 'i5', 'i6'].map((id) => item(id));
const SNAPSHOT: OrganizeSnapshot = {
  collections: [
    { id: 'bio', name: '분자생물학', parentId: null, createdAt: at },
    { id: 'c10', name: '10장', parentId: 'bio', createdAt: at },
    { id: 'c6', name: '6장 · 신호 전달', parentId: 'bio', createdAt: at },
    { id: 'stat', name: '통계', parentId: null, createdAt: at },
    { id: 'conf', name: '학회 준비', parentId: null, createdAt: at },
  ],
  tags: [
    { id: 't-imp', name: '중요', color: 'yellow', position: 1 },
    { id: 't-exam', name: '시험', color: 'red', position: 2 },
    { id: 't-b', name: '나', color: null, position: null },
    { id: 't-a', name: '가', color: null, position: null },
  ],
  // i2 is in both bio and c6; ghost is no longer in the list; i6 is in no collection.
  members: { bio: ['i1', 'i2'], c6: ['i2', 'i3', 'ghost'], c10: ['i4'], stat: ['i5'] },
  tagged: { 't-imp': ['i1', 'i3', 'ghost'], 't-exam': ['i3'], 't-a': ['i3'], 't-b': ['i1'] },
  duplicates: [['i1', 'i5'], ['i3', 'ghost']],
};
const model = buildOrganizeModel(SNAPSHOT, ITEMS);
const ids = (s: ReadonlySet<string>) => [...s].sort();

describe('the tree', () => {
  it('has the roots in name order and the children under them, 6장 before 10장', () => {
    expect(model.roots.map((n) => n.name)).toEqual(['분자생물학', '통계', '학회 준비']);
    expect(model.node('bio')!.children.map((n) => n.name)).toEqual(['6장 · 신호 전달', '10장']);
    expect(model.node('nope')).toBeUndefined();
    expect(model.collectionCount).toBe(5);
    expect(model.flat.map((n) => n.id)).toEqual(['bio', 'c6', 'c10', 'stat', 'conf']);
  });
  it('gives the path from the top-level collection down, and nothing for an unknown one', () => {
    expect(model.path('c6').map((n) => n.name)).toEqual(['분자생물학', '6장 · 신호 전달']);
    expect(model.path('bio').map((n) => n.id)).toEqual(['bio']);
    expect(model.path('nope')).toEqual([]);
  });
});

describe('collection items and counts', () => {
  it('a collection holds its own items and those of its live descendants, each item once', () => {
    expect(ids(model.subtreeItems('bio'))).toEqual(['i1', 'i2', 'i3', 'i4']);
    expect(ids(model.subtreeItems('c6'))).toEqual(['i2', 'i3']);
    expect(ids(model.subtreeItems('stat'))).toEqual(['i5']);
  });
  it('counts the distinct items that are in the list, so an item the list no longer has is not counted', () => {
    expect(model.count('bio')).toBe(4);
    expect(model.count('c6')).toBe(2); // 'ghost' is in members but not in the list
    expect(model.count('conf')).toBe(0);
    expect(model.count('nope')).toBe(0);
    expect(ids(model.subtreeItems('nope'))).toEqual([]);
  });
  it('lists the collections an item is directly in, in tree order', () => {
    expect(model.directCollectionsOf('i2')).toEqual(['bio', 'c6']);
    expect(model.directCollectionsOf('i3')).toEqual(['c6']);
    expect(model.directCollectionsOf('i6')).toEqual([]);
    expect(model.directCollectionsOf('ghost')).toEqual([]);
  });
});

describe('unfiled and duplicates', () => {
  it('unfiled is the items in no live collection', () => {
    expect(ids(model.unfiled)).toEqual(['i6']);
    expect(ids(buildOrganizeModel({ ...SNAPSHOT, collections: [], members: {} }, ITEMS).unfiled)).toEqual(['i1', 'i2', 'i3', 'i4', 'i5', 'i6']);
  });
  it('duplicates are the items of the groups that still have two or more items in the list', () => {
    expect(ids(model.duplicates)).toEqual(['i1', 'i5']); // the second group has only i3 left in the list
    const without5 = buildOrganizeModel(SNAPSHOT, ITEMS.filter((i) => i.id !== 'i5'));
    expect(ids(without5.duplicates)).toEqual([]);
    expect(without5.count('stat')).toBe(0);
  });
});

describe('tags', () => {
  it('lists an item\'s tags: the coloured ones by position, then the rest by name', () => {
    expect(model.tagsOfItem('i3').map((t) => t.name)).toEqual(['중요', '시험', '가']);
    expect(model.tagsOfItem('i1').map((t) => t.name)).toEqual(['중요', '나']);
    expect(model.tagsOfItem('i6')).toEqual([]);
    expect(model.tagsOfItem('ghost')).toEqual([]);
  });
  it('knows the items of a tag (only those in the list) and the tag at a position', () => {
    expect(ids(model.tagItems('t-imp'))).toEqual(['i1', 'i3']);
    expect(ids(model.tagItems('nope'))).toEqual([]);
    expect(model.tagByPosition(2)?.name).toBe('시험');
    expect(model.tagByPosition(3)).toBeUndefined();
    expect(model.tags.map((t) => t.id)).toEqual(['t-imp', 't-exam', 't-b', 't-a']);
  });
});

describe('organizeModelFor (one model for the three callers)', () => {
  it('returns the same model while the snapshot and the ids stay, even when other fields of the items change', () => {
    const first = organizeModelFor(SNAPSHOT, ITEMS);
    const opened = ITEMS.map((i) => (i.id === 'i2' ? { ...i, openedAt: '2026-10-25T00:00:00.000Z' } : i));
    expect(organizeModelFor(SNAPSHOT, opened)).toBe(first);
  });
  it('builds a new one when an id leaves the list, or the snapshot is a new object', () => {
    const first = organizeModelFor(SNAPSHOT, ITEMS);
    const fewer = organizeModelFor(SNAPSHOT, ITEMS.slice(0, 5));
    expect(fewer).not.toBe(first);
    expect(ids(fewer.unfiled)).toEqual([]);
    expect(organizeModelFor({ ...SNAPSHOT }, ITEMS.slice(0, 5))).not.toBe(fewer);
  });
});
