import { useDeferredValue, useEffect, useMemo } from 'react';
import type { LibraryItem } from '@learn/domain';
import { useSearchTexts } from '../data/queries';
import { useLibrary } from '../state/library-store';
import { searchCached, searchIndexFor, type SearchResult } from './search';

/**
 * The quick search result for this list, or null with an empty query (no filtering). The query comes deferred
 * (spec 4.2), so typing never waits for the table. The toolbar's count and the table call it in the same frame: they
 * share the index of this list array and the last answer (search.ts caches).
 */
export function useSearch(items: readonly LibraryItem[]): SearchResult | null {
  const query = useLibrary((s) => s.query);
  const texts = useSearchTexts(query.trim() !== '').data;
  const deferred = useDeferredValue(query);
  // The index of a new list is built while the window is idle, so the first keystroke does not pay for it.
  useEffect(() => {
    if (items.length === 0) return;
    const id = requestIdleCallback(() => void searchIndexFor(items, texts));
    return () => cancelIdleCallback(id);
  }, [items, texts]);
  return useMemo(() => (deferred.trim() === '' ? null : searchCached(searchIndexFor(items, texts), deferred)), [items, texts, deferred]);
}
