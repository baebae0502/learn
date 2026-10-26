import { describe, expect, it } from 'vitest';
import type { Availability, LibraryItem, StorageMode } from '@learn/domain';
import { DEFAULT_SORT } from './sort';
import { inTableOrder, selectionCounts } from './selection';

const item = (id: string, createdAt: string, availability: Availability = 'available', storageMode: StorageMode = 'managed'): LibraryItem => ({
  id, title: id, type: 'pdf', mime: 'application/pdf', size: 1, storageMode, availability, assetId: `a-${id}`, revisionId: `r-${id}`,
  originalName: `${id}.pdf`, createdAt, updatedAt: createdAt, creators: [], year: null, publisher: null, tagIds: [], progress: null, openedAt: null,
});
const LIST = [
  item('b', '2026-10-02T00:00:00.000Z'),
  item('a', '2026-10-01T00:00:00.000Z', 'missing', 'linked'),
  item('c', '2026-10-03T00:00:00.000Z', 'missing', 'managed'),
  item('d', '2026-10-04T00:00:00.000Z', 'available', 'linked'),
];

describe('the table selection as the command context carries it (spec 3.3)', () => {
  it('counts the selected rows still in the list: all, with their file, linked and missing', () => {
    expect(selectionCounts(LIST, new Set())).toEqual({ count: 0, available: 0, relinkable: 0 });
    expect(selectionCounts(LIST, new Set(['a', 'b', 'c', 'gone']))).toEqual({ count: 3, available: 1, relinkable: 1 });
    expect(selectionCounts(LIST, new Set(['d']))).toEqual({ count: 1, available: 1, relinkable: 0 });
  });
  it('gives the selection in table order (the sort in force), without ids the list lost', () => {
    expect(inTableOrder(LIST, new Set(['a', 'c', 'gone', 'd']), DEFAULT_SORT)).toEqual(['d', 'c', 'a']); // added, newest first
    expect(inTableOrder(LIST, new Set(['d', 'b']), { column: 'title', direction: 'asc' })).toEqual(['b', 'd']);
    expect(inTableOrder(LIST, new Set(), DEFAULT_SORT)).toEqual([]);
  });
});
