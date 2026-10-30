import { describe, expect, it } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from './model';
import { item } from './testing';
import { filterByTags } from './tagFilter';

const ITEMS = ['a', 'b', 'c', 'd'].map((id) => item(id));
const SNAPSHOT: OrganizeSnapshot = {
  collections: [],
  tags: [
    { id: 'imp', name: '중요', color: 'yellow', position: 1 },
    { id: 'exam', name: '시험', color: 'red', position: 2 },
    { id: 'unused', name: '안 씀', color: null, position: null },
  ],
  members: {},
  tagged: { imp: ['a', 'b', 'c'], exam: ['b', 'c', 'd'] },
  duplicates: [],
};
const model = buildOrganizeModel(SNAPSHOT, ITEMS);
const ids = (xs: readonly { id: string }[]) => xs.map((i) => i.id);

describe('the tag filter (spec 4.3: all the chosen tags)', () => {
  it('no tags chosen is no filtering: the same list back', () => {
    expect(filterByTags(model, ITEMS, new Set())).toBe(ITEMS);
  });
  it('one tag keeps its items, in list order', () => {
    expect(ids(filterByTags(model, ITEMS, new Set(['imp'])))).toEqual(['a', 'b', 'c']);
  });
  it('several tags keep only the items that have every one of them (AND)', () => {
    expect(ids(filterByTags(model, ITEMS, new Set(['imp', 'exam'])))).toEqual(['b', 'c']);
  });
  it('a tag nobody has, or one that does not exist, leaves nothing', () => {
    expect(filterByTags(model, ITEMS, new Set(['imp', 'unused']))).toEqual([]);
    expect(filterByTags(model, ITEMS, new Set(['nope']))).toEqual([]);
  });
  it('filters the list it is given: the items outside it never come back', () => {
    expect(ids(filterByTags(model, ITEMS.slice(2), new Set(['imp'])))).toEqual(['c']);
  });
});
