import { describe, expect, it } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from '../organize/model';
import { item } from '../organize/testing';
import { DRAFT_KEY, SCOPE_KEYS, ancestorIds, descendantIds, keyOfScope, scopeOfKey, visibleCollectionKeys, visibleSpecials } from './rows';

const AT = '2026-10-01T00:00:00.000Z';
const ITEMS = ['a', 'b', 'c', 'd1', 'd2'].map((id) => item(id));
const SNAPSHOT: OrganizeSnapshot = {
  collections: [
    { id: 'bio', name: '분자생물학', parentId: null, createdAt: AT },
    { id: 'c10', name: '10장', parentId: 'bio', createdAt: AT },
    { id: 'c6', name: '6장', parentId: 'bio', createdAt: AT },
    { id: 'c7', name: '7장', parentId: 'bio', createdAt: AT },
    { id: 'lab', name: '실험', parentId: 'c6', createdAt: AT },
    { id: 'stats', name: '통계', parentId: null, createdAt: AT },
  ],
  tags: [],
  members: { c6: ['a'], stats: ['b'] },
  tagged: {},
  duplicates: [['d1', 'd2']],
};
const model = buildOrganizeModel(SNAPSHOT, ITEMS);

describe('the tree\'s keys', () => {
  it('a collection is its id; a special view has a key no id can have', () => {
    expect(keyOfScope({ kind: 'all' })).toBe('scope:all');
    expect(keyOfScope({ kind: 'collection', id: 'bio' })).toBe('bio');
    for (const kind of ['all', 'recent', 'unfiled', 'duplicates'] as const) expect(scopeOfKey(SCOPE_KEYS[kind])).toEqual({ kind });
    expect(scopeOfKey('bio')).toEqual({ kind: 'collection', id: 'bio' });
  });
});

describe('which special views are drawn (spec 3.2)', () => {
  const rows = (over: Partial<Parameters<typeof visibleSpecials>[0]> = {}) =>
    visibleSpecials({ itemCount: 5, hasRecent: false, model, current: 'all', ...over }).map((r) => [r.kind, r.count]);

  it('내 라이브러리 always, with its count (none when empty); the others only with content, 최근 연 자료 without a count', () => {
    expect(rows()).toEqual([['all', 5], ['unfiled', 3], ['duplicates', 2]]);
    expect(rows({ hasRecent: true })).toEqual([['all', 5], ['recent', null], ['unfiled', 3], ['duplicates', 2]]);
    expect(visibleSpecials({ itemCount: 0, hasRecent: false, model: undefined, current: 'all' })).toEqual([{ kind: 'all', count: null }]);
  });
  it('미분류 needs a collection to exist: with none, every item is in none', () => {
    const none = buildOrganizeModel({ ...SNAPSHOT, collections: [], members: {}, duplicates: [] }, ITEMS);
    expect(rows({ model: none }).map(([kind]) => kind)).toEqual(['all']);
  });
  it('the one being looked at stays when it has no content any more, with no number', () => {
    const filed = buildOrganizeModel({ ...SNAPSHOT, members: { c6: ['a', 'b', 'c', 'd1', 'd2'] }, duplicates: [] }, ITEMS);
    expect(rows({ model: filed })).toEqual([['all', 5]]);
    expect(rows({ model: filed, current: 'unfiled' })).toEqual([['all', 5], ['unfiled', null]]);
    expect(rows({ model: filed, current: 'recent' })).toEqual([['all', 5], ['recent', null]]);
    expect(rows({ model: filed, current: 'duplicates' })).toEqual([['all', 5], ['duplicates', null]]);
  });
});

describe('walking the tree', () => {
  it('ancestors root first, descendants all the way down', () => {
    expect(ancestorIds(model, 'lab')).toEqual(['bio', 'c6']);
    expect(ancestorIds(model, 'bio')).toEqual([]);
    expect(descendantIds(model, 'bio').sort()).toEqual(['c10', 'c6', 'c7', 'lab']);
    expect(descendantIds(model, 'stats')).toEqual([]);
    expect(descendantIds(model, 'nope')).toEqual([]);
  });
  it('the visible rows are in the tree\'s order (6장 < 7장 < 10장) and only under open parents', () => {
    expect(visibleCollectionKeys(model, new Set())).toEqual(['bio', 'stats']);
    expect(visibleCollectionKeys(model, new Set(['bio']))).toEqual(['bio', 'c6', 'c7', 'c10', 'stats']);
    expect(visibleCollectionKeys(model, new Set(['bio', 'c6']))).toEqual(['bio', 'c6', 'lab', 'c7', 'c10', 'stats']);
  });
  it('a row being created goes first among its siblings; a closed parent hides it, a leaf parent shows it', () => {
    const open = new Set(['bio']);
    expect(visibleCollectionKeys(model, open, null)).toEqual([DRAFT_KEY, 'bio', 'c6', 'c7', 'c10', 'stats']);
    expect(visibleCollectionKeys(model, open, 'bio')).toEqual(['bio', DRAFT_KEY, 'c6', 'c7', 'c10', 'stats']);
    expect(visibleCollectionKeys(model, new Set(), 'bio')).toEqual(['bio', 'stats']);
    expect(visibleCollectionKeys(model, new Set(['stats']), 'stats')).toEqual(['bio', 'stats', DRAFT_KEY]);
  });
});
