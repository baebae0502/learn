import { useMemo } from 'react';
import type { LibraryItem } from '@learn/domain';
import type { Match } from '../palette/hangul';
import { sortItems } from './sort';
import { useLibrarySettings } from './useLibrarySettings';

/**
 * The rows the table shows: the whole list in the stored sort. `total` is the list's size (for the "N개 / M개" count
 * once a search narrows the list); `titleMatches` is the search's matched range per title, null until a search exists.
 */
export function useLibraryRows(items: readonly LibraryItem[]): { rows: readonly LibraryItem[]; total: number; titleMatches: ReadonlyMap<string, Match> | null } {
  const { sort } = useLibrarySettings();
  const rows = useMemo(() => sortItems(items, sort), [items, sort]);
  return { rows, total: items.length, titleMatches: null };
}
