import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { commonCollections, commonTags } from './common';
import { buildOrganizeModel } from './model';
import { item } from './testing';

const AT = '2026-10-01T00:00:00.000Z';
const SNAPSHOT: OrganizeSnapshot = {
  collections: [
    { id: 'bio', name: '분자생물학', parentId: null, createdAt: AT },
    { id: 'c6', name: '6장', parentId: 'bio', createdAt: AT },
    { id: 'stat', name: '통계', parentId: null, createdAt: AT },
  ],
  tags: [
    { id: 't2', name: '시험', color: null, position: null },
    { id: 't3', name: '가나', color: null, position: null },
    { id: 't1', name: '중요', color: 'yellow', position: 1 },
  ],
  members: { bio: ['a', 'b', 'c'], c6: ['a', 'b'], stat: ['d'] },
  tagged: { t1: ['a', 'b', 'c'], t2: ['a', 'b'], t3: ['a'] },
  duplicates: [],
};
const model = buildOrganizeModel(SNAPSHOT, ['a', 'b', 'c', 'd', 'e'].map((id) => item(id)));

afterEach(() => vi.unstubAllGlobals());

describe('the tags a selection has in common (spec 6.2)', () => {
  it('lists the tags every selected item has, coloured slots first and then by name, as an item\'s own chips are', () => {
    expect(commonTags(model, ['a']).map((t) => t.id)).toEqual(['t1', 't3', 't2']);
    expect(commonTags(model, ['a', 'b']).map((t) => t.id)).toEqual(['t1', 't2']);
    expect(commonTags(model, ['a', 'b', 'c']).map((t) => t.id)).toEqual(['t1']);
  });
  it('is empty when nothing is shared, for no selection, and when one selected id is not in the library', () => {
    expect(commonTags(model, ['a', 'd'])).toEqual([]);
    expect(commonTags(model, [])).toEqual([]);
    expect(commonTags(model, ['a', 'zz'])).toEqual([]);
  });
});

describe('the collections a selection is in together (spec 6.2)', () => {
  it('lists the collections every selected item is directly in, in tree order', () => {
    expect(commonCollections(model, ['a', 'b'])).toEqual(['bio', 'c6']);
    expect(commonCollections(model, ['a', 'b', 'c'])).toEqual(['bio']);
    expect(commonCollections(model, ['a'])).toEqual(['bio', 'c6']);
  });
  it('is empty when no collection holds them all, for none selected, and for an item in no collection', () => {
    expect(commonCollections(model, ['a', 'd'])).toEqual([]);
    expect(commonCollections(model, [])).toEqual([]);
    expect(commonCollections(model, ['e'])).toEqual([]);
  });
  it('a parent does not hold what only its child holds: the membership is the direct one', () => {
    const only: OrganizeSnapshot = { ...SNAPSHOT, members: { c6: ['a', 'b'] }, tagged: {} };
    const m = buildOrganizeModel(only, ['a', 'b'].map((id) => item(id)));
    expect(commonCollections(m, ['a', 'b'])).toEqual(['c6']);
  });
});

describe('10,000 selected items (spec 12: no IPC)', () => {
  it('computes both from the model alone — nothing on `window` is touched — and finds the right answer', () => {
    vi.stubGlobal('window', new Proxy({}, { get: () => { throw new Error('the page API was used'); } }));
    const ids = Array.from({ length: 10_000 }, (_, i) => `i${i}`);
    const big: OrganizeSnapshot = {
      collections: [{ id: 'bio', name: '분자생물학', parentId: null, createdAt: AT }, { id: 'c6', name: '6장', parentId: 'bio', createdAt: AT }],
      tags: [{ id: 't1', name: '중요', color: null, position: null }, { id: 't2', name: '시험', color: null, position: null }],
      members: { bio: ids, c6: ids.slice(0, 5_000) },
      tagged: { t1: ids, t2: ids.slice(0, 9_999) },
      duplicates: [],
    };
    const m = buildOrganizeModel(big, ids.map((id) => item(id)));
    expect(commonTags(m, ids).map((t) => t.id)).toEqual(['t1']);
    expect(commonCollections(m, ids)).toEqual(['bio']);
    expect(commonCollections(m, ids.slice(0, 5_000))).toEqual(['bio', 'c6']);
  });
});
