import { describe, expect, it } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from '../organize/model';
import { item } from '../organize/testing';
import { pathRows } from './collectionRows';

const AT = '2026-10-01T00:00:00.000Z';
const SNAPSHOT: OrganizeSnapshot = {
  collections: [
    { id: 'stat', name: '통계', parentId: null, createdAt: AT },
    { id: 'bio', name: '분자생물학', parentId: null, createdAt: AT },
    { id: 'c6', name: '6장 · 신호 전달', parentId: 'bio', createdAt: AT },
  ],
  tags: [],
  members: { bio: ['a', 'b'], c6: ['a'], stat: ['a', 'c'] },
  tagged: {},
  duplicates: [],
};
const model = buildOrganizeModel(SNAPSHOT, ['a', 'b', 'c', 'd'].map((id) => item(id)));

describe('the collection section\'s rows (spec 6.1, 6.2)', () => {
  it('one item: a row per collection it is directly in, root to leaf, in tree order (names, not creation order)', () => {
    expect(pathRows(model, ['a'])).toEqual([
      { id: 'bio', names: ['분자생물학'] },
      { id: 'c6', names: ['분자생물학', '6장 · 신호 전달'] },
      { id: 'stat', names: ['통계'] },
    ]);
  });
  it('one item in no collection: no rows', () => {
    expect(pathRows(model, ['d'])).toEqual([]);
  });
  it('several items: only the collections all of them are in directly', () => {
    expect(pathRows(model, ['a', 'b'])).toEqual([{ id: 'bio', names: ['분자생물학'] }]);
    expect(pathRows(model, ['a', 'c'])).toEqual([{ id: 'stat', names: ['통계'] }]);
    expect(pathRows(model, ['b', 'c'])).toEqual([]);
  });
});
