import { useDeferredValue, useEffect, useMemo } from 'react';
import type { LibraryItem, SearchText } from '@learn/domain';
import { useSearchTexts } from '../data/queries';
import type { OrganizeModel } from '../organize/model';
import { useOrganize } from '../organize/useOrganize';
import { useLibrary } from '../state/library-store';
import { useViewModel } from '../trash/useTrashSource';
import { whenIdle } from '../ui/whenIdle';
import { searchCached, searchIndexFor, type SearchResult, type TagNames } from './search';
import { tagNamesFor } from './tagField';

export interface SearchSources {
  /** The abstracts and memos, read once a query is typed. */
  texts: readonly SearchText[] | undefined;
  /** Each tagged item's tag names (spec 7.1). */
  tags: TagNames;
  /** The organize snapshot has answered, success or not: the index is final (a failed read means no tags). */
  settled: boolean;
}

/** What the search index is built from besides the list; `model` names the tags (the view's: the trash's in the trash view). */
export function useSearchSources(queryTyped: boolean, model?: OrganizeModel): SearchSources {
  const texts = useSearchTexts(queryTyped).data;
  const organize = useOrganize();
  const used = model ?? organize.model;
  const tags = useMemo(() => tagNamesFor(used), [used]);
  return { texts, tags, settled: organize.settled };
}

/**
 * The quick search result for this list, or null with an empty query (no filtering). The query comes deferred
 * (spec 4.2), so typing never waits for the table. The toolbar's count, the field and the table call it in the same
 * frame: they share the index of this list array and the last answer (search.ts caches). It reads the WHOLE list: the
 * view and the tag filter intersect its answer (useLibraryRows), so a view change builds no index.
 */
export function useSearch(items: readonly LibraryItem[]): SearchResult | null {
  const query = useLibrary((s) => s.query);
  const { texts, tags, settled } = useSearchSources(query.trim() !== '', useViewModel());
  const deferred = useDeferredValue(query);
  // The index of a new list is built while the window is idle, so the first keystroke does not pay for it. It waits for
  // the tag names, or the first build would be thrown away as they arrive.
  useEffect(() => {
    if (items.length === 0 || !settled) return;
    return whenIdle(() => void searchIndexFor(items, texts, tags), 1000);
  }, [items, texts, tags, settled]);
  return useMemo(() => (deferred.trim() === '' ? null : searchCached(searchIndexFor(items, texts, tags), deferred)), [items, texts, tags, deferred]);
}
