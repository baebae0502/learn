import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '@learn/domain';
import { item } from '../organize/testing';
import { keepFound } from './useLibraryRows';

describe('the rows the quick search keeps', () => {
  const rows: LibraryItem[] = [item('a'), item('b'), item('c')];
  it('keeps the matching rows in the given order, and every row for no search', () => {
    expect(keepFound(rows, null)).toBe(rows);
    expect(keepFound(rows, { ids: new Set(['c', 'a']), titleMatches: new Map() }).map((i) => i.id)).toEqual(['a', 'c']);
    expect(keepFound(rows, { ids: new Set(), titleMatches: new Map() })).toEqual([]);
  });
});
