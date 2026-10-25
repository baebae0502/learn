import { useMemo } from 'react';
import type { LibraryItem } from '@learn/domain';
import type { Match } from '../palette/hangul';
import { sortItems } from './sort';
import { useSearch } from './useSearch';
import { useLibrarySettings } from './useLibrarySettings';

/**
 * The rows the table shows: the whole list in the stored sort. `titleMatches` is the search's matched range per title, null until a search exists.
 */
export function useLibraryRows(items: readonly LibraryItem[]): { rows: readonly LibraryItem[]; titleMatches: ReadonlyMap<string, Match> | null } {
  const { sort } = useLibrarySettings();
  const sorted = useMemo(() => sortItems(items, sort), [items, sort]);
  // Quick search filters the sorted rows: the order stays the table's (spec 4.2); relevance ranks only the palette.
  // The index is built once per list (buildSearchIndex) and each query searched once (search), shared with the toolbar.
  const found = useSearch(items);
  const rows = useMemo(() => (found ? sorted.filter((i) => found.ids.has(i.id)) : sorted), [sorted, found]);
  return { rows, titleMatches: found?.titleMatches ?? null };
}
