import { useMemo } from 'react';
import type { LibraryItem } from '@learn/domain';
import type { Match } from '../palette/hangul';
import type { SearchResult } from './search';
import { sortItems } from './sort';
import { useLibrarySettings } from './useLibrarySettings';
import { useScopeView, type ScopeView } from './useScopeView';
import { useSearch } from './useSearch';

/** The rows the quick search keeps, in the order given. No search keeps them all. */
export function keepFound(rows: readonly LibraryItem[], found: SearchResult | null): readonly LibraryItem[] {
  return found ? rows.filter((i) => found.ids.has(i.id)) : rows;
}

/**
 * The rows the table shows (spec 3.1): the scope, then the tag filter, then the quick search, in the stored sort — the
 * recent view's own sort in the recent view. `titleMatches` is the search's matched range per title, null until a search exists.
 * The search index is built once for the whole list (never per scope, which would rebuild it at every view change); its
 * answer is intersected with the scope's rows.
 */
export function useLibraryRows(items: readonly LibraryItem[]): { rows: readonly LibraryItem[]; titleMatches: ReadonlyMap<string, Match> | null; view: ScopeView } {
  const { sort } = useLibrarySettings();
  const view = useScopeView(items);
  const sorted = useMemo(() => sortItems(view.filtered, sort), [view.filtered, sort]);
  // Quick search filters the sorted rows: the order stays the table's (spec 4.2); relevance ranks only the palette.
  // The index is built once per list (buildSearchIndex) and each query searched once (search), shared with the toolbar.
  const found = useSearch(items);
  const rows = useMemo(() => keepFound(sorted, found), [sorted, found]);
  return { rows, titleMatches: found?.titleMatches ?? null, view };
}
