import { describe, expect, it } from 'vitest';
import { factCounts } from './library-facts';

describe('factCounts (AC15: what a restore must bring back)', () => {
  it('counts live and trashed items, live and trashed collection rows, tags, and the memberships and assignments of both', () => {
    expect(
      factCounts({
        items: ['a', 'b', 'c'],
        trashed: [{ id: 'd' }],
        collections: [{ id: 'c1' }, { id: 'c2' }],
        trashedCollections: [{ id: 'c3' }],
        tags: [{ id: 't1' }],
        members: { c1: ['a', 'b'], c2: ['c'] },
        trashMembers: { c2: ['d'] },
        tagged: { t1: ['a'] },
        trashTagged: { t1: ['d'] },
      }),
    ).toEqual({ items: 3, trashed: 1, collections: 2, trashedCollections: 1, tags: 1, memberships: 4, assignments: 2 });
  });
  it('an empty library is all zeros', () => {
    expect(
      factCounts({ items: [], trashed: [], collections: [], trashedCollections: [], tags: [], members: {}, trashMembers: {}, tagged: {}, trashTagged: {} }),
    ).toEqual({ items: 0, trashed: 0, collections: 0, trashedCollections: 0, tags: 0, memberships: 0, assignments: 0 });
  });
});
