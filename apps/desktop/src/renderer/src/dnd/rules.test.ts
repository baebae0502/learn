import { describe, expect, it } from 'vitest';
import type { LibraryScope, OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from '../organize/model';
import { item } from '../organize/testing';
import { collectionOnCollection, filesOnRow, inertRow, itemsOnCollection, tagOnRow } from './rules';

const AT = '2026-10-01T00:00:00.000Z';
const SNAPSHOT: OrganizeSnapshot = {
  collections: [
    { id: 'bio', name: '분자생물학', parentId: null, createdAt: AT },
    { id: 'c6', name: '6장', parentId: 'bio', createdAt: AT },
    { id: 'g6', name: '6장 그림', parentId: 'c6', createdAt: AT },
    { id: 'c7', name: '7장', parentId: 'bio', createdAt: AT },
    { id: 'stat', name: '통계', parentId: null, createdAt: AT },
  ],
  tags: [
    { id: 'exam', name: '시험', color: null, position: null },
    { id: 'must', name: '중요', color: null, position: null },
  ],
  members: { bio: ['a', 'b'], c6: ['a'], stat: ['c'] },
  tagged: { exam: ['a', 'b'] },
  duplicates: [],
};
const model = buildOrganizeModel(SNAPSHOT, ['a', 'b', 'c', 'd'].map((id) => item(id)));
const ALL: LibraryScope = { kind: 'all' };
const IN_BIO: LibraryScope = { kind: 'collection', id: 'bio' };
/** What React Aria allows with no modifier key held (move first), with the move key held, and with Ctrl on Linux. */
const PLAIN = ['move', 'copy'];
const MOVE_KEY = ['move'];

describe('rows onto a collection row (spec 8.2)', () => {
  const ask = (over: Partial<Parameters<typeof itemsOnCollection>[0]> = {}) => itemsOnCollection({ target: 'stat', model, scope: ALL, itemIds: ['d'], allowed: PLAIN, ...over });

  it('adds by default', () => {
    expect(ask()).toBe('copy');
    expect(ask({ allowed: ['copy'] })).toBe('copy'); // Ctrl on Linux
  });

  it('shows nothing on a special view, the row being named, an unknown key, or without a model', () => {
    for (const target of ['scope:all', 'scope:recent', 'scope:unfiled', 'scope:duplicates', 'draft:new', 'nope']) expect(ask({ target }), target).toBe('cancel');
    expect(ask({ model: undefined })).toBe('cancel');
    expect(ask({ allowed: [] })).toBe('cancel');
  });

  it('shows nothing on the collection being viewed, with or without the move key', () => {
    expect(ask({ target: 'bio', scope: IN_BIO })).toBe('cancel');
    expect(ask({ target: 'bio', scope: IN_BIO, allowed: MOVE_KEY })).toBe('cancel');
  });

  it('takes the descendants of the viewed collection, the grandchild too', () => {
    expect(ask({ target: 'c6', scope: IN_BIO, itemIds: ['b'] })).toBe('copy');
    expect(ask({ target: 'g6', scope: IN_BIO, itemIds: ['b'] })).toBe('copy');
  });

  it('shows nothing where every dragged item is already held directly — a held ancestor does not count', () => {
    expect(ask({ target: 'c6', itemIds: ['a'] })).toBe('cancel');
    expect(ask({ target: 'c6', itemIds: ['a', 'b'] })).toBe('copy'); // b is not in 6장
    expect(ask({ target: 'g6', itemIds: ['a'] })).toBe('copy'); // 6장 holds a, 6장 그림 does not
  });

  it('with the move key inside a collection it moves, also to a descendant that holds them already', () => {
    expect(ask({ target: 'c6', scope: IN_BIO, itemIds: ['a'], allowed: MOVE_KEY })).toBe('move');
    expect(ask({ target: 'stat', scope: IN_BIO, allowed: MOVE_KEY })).toBe('move');
  });

  it('with the move key outside a collection the operation stays move — React Aria drops a copy it did not allow — and the drop adds', () => {
    expect(ask({ allowed: MOVE_KEY })).toBe('move');
    expect(ask({ target: 'c6', itemIds: ['a'], allowed: MOVE_KEY })).toBe('cancel'); // holds them all: nothing to add
  });
});

describe('a collection onto a collection row or the 컬렉션 heading (spec 8.3)', () => {
  const ask = (dragged: string | null, target: string | null) => collectionOnCollection({ dragged, target, model });

  it('moves under another collection', () => {
    expect(ask('c7', 'c6')).toBe('move');
    expect(ask('c7', 'stat')).toBe('move');
    expect(ask('stat', 'g6')).toBe('move');
  });

  it('refuses itself, its descendants (a cycle) and its current parent', () => {
    expect(ask('c6', 'c6')).toBe('cancel');
    expect(ask('c6', 'g6')).toBe('cancel');
    expect(ask('bio', 'g6')).toBe('cancel');
    expect(ask('c6', 'bio')).toBe('cancel'); // already there
  });

  it('the heading is the top level: not for a collection that is there already', () => {
    expect(ask('c6', null)).toBe('move');
    expect(ask('g6', null)).toBe('move');
    expect(ask('bio', null)).toBe('cancel');
  });

  it('refuses what it does not know, and an unknown drag', () => {
    expect(ask('nope', 'c6')).toBe('cancel');
    expect(ask('c6', 'nope')).toBe('cancel');
    expect(ask(null, 'c6')).toBe('cancel');
    expect(collectionOnCollection({ dragged: 'c6', target: 'stat', model: undefined })).toBe('cancel');
  });
});

describe('a tag onto a table row (spec 8.3)', () => {
  const ask = (over: Partial<Parameters<typeof tagOnRow>[0]> = {}) => tagOnRow({ tagId: 'must', rowId: 'c', selected: new Set(['a', 'b']), model, ...over });

  it('a row outside the selection takes it alone', () => {
    expect(ask()).toEqual(['c']);
  });

  it('a row inside the selection means the whole selection', () => {
    expect(ask({ rowId: 'b' })).toEqual(['a', 'b']);
  });

  it('shows nothing when everything it would reach has the tag', () => {
    expect(ask({ tagId: 'exam', rowId: 'a' })).toBeNull(); // the selection a, b both have 시험
    expect(ask({ tagId: 'exam', rowId: 'a', selected: new Set(['a', 'c']) })).toEqual(['a', 'c']); // c does not
    expect(ask({ tagId: 'exam', rowId: 'a', selected: new Set() })).toBeNull(); // a alone has it
  });

  it('refuses an unknown tag or no tag in the drag', () => {
    expect(ask({ tagId: 'gone' })).toBeNull();
    expect(ask({ tagId: null })).toBeNull();
    expect(ask({ model: undefined })).toBeNull();
  });
});

describe('Finder files onto a sidebar row (spec 8.4)', () => {
  it('내 라이브러리 imports without a collection, a collection imports into itself', () => {
    expect(filesOnRow('scope:all', model)).toEqual({ kind: 'library' });
    expect(filesOnRow('c6', model)).toEqual({ kind: 'collection', id: 'c6' });
  });

  it('the other special views, the row being named and unknown keys refuse', () => {
    for (const key of ['scope:recent', 'scope:unfiled', 'scope:duplicates', 'draft:new', 'nope']) expect(filesOnRow(key, model), key).toBeNull();
    expect(filesOnRow('c6', undefined)).toBeNull();
  });
});

describe('the draft row and the row being named take no part (neither source nor target)', () => {
  it('names the rows that sit out: the draft row, and the collection whose name is being typed', () => {
    expect(inertRow('draft:new', null)).toBe(true);
    expect(inertRow('c6', 'c6')).toBe(true);
    expect(inertRow('c6', null)).toBe(false);
    expect(inertRow('c7', 'c6')).toBe(false);
    expect(inertRow('scope:all', 'c6')).toBe(false);
  });
});
