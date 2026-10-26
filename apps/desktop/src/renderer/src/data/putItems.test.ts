import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { LibraryItem } from '@learn/domain';
import { item } from '../organize/testing';
import { searchIndexFor } from '../library/search';
import { keys, putItems } from './queries';

describe('storing a patched list keeps the search index for the list the cache holds', () => {
  it('an opened patch (no searched field changed) is still served the old index, though the cache re-shares rows', () => {
    const client = new QueryClient();
    const prev: LibraryItem[] = ['a', 'b', 'c'].map((id) => item(id));
    client.setQueryData(keys.items, prev);
    const held = client.getQueryData<LibraryItem[]>(keys.items)!;
    const before = searchIndexFor(held, undefined);
    const next = held.map((i) => (i.id === 'b' ? { ...i, openedAt: '2026-10-25T00:00:00.000Z' } : i));
    putItems(client, held, next);
    const cached = client.getQueryData<LibraryItem[]>(keys.items)!;
    expect(cached[1]!.openedAt).toBe('2026-10-25T00:00:00.000Z');
    expect(searchIndexFor(cached, undefined)).toBe(before);
  });
  it('a changed title builds a new index', () => {
    const client = new QueryClient();
    const prev: LibraryItem[] = ['a', 'b'].map((id) => item(id));
    client.setQueryData(keys.items, prev);
    const held = client.getQueryData<LibraryItem[]>(keys.items)!;
    const before = searchIndexFor(held, undefined);
    putItems(client, held, held.map((i) => (i.id === 'b' ? { ...i, title: '새 제목' } : i)));
    expect(searchIndexFor(client.getQueryData<LibraryItem[]>(keys.items)!, undefined)).not.toBe(before);
  });
});
