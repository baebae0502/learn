import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnConfig } from '@learn/domain';
import { ApiError, api, unwrap } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { parseColumnConfig } from './columns';
import { parseSort, type LibrarySort } from './sort';

/**
 * Optimistic: the table follows at once. A refused write keeps the screen as chosen and logs the code only (the next
 * change writes the whole value again).
 */
function save(key: 'library.columns' | 'library.sort', queryKey: readonly unknown[], value: ColumnConfig | LibrarySort): void {
  queryClient.setQueryData(queryKey, value);
  void unwrap(api().settings.set({ key, value })).catch((e: unknown) => console.warn(`[library] saving ${key} failed: ${e instanceof ApiError ? e.code : 'INTERNAL'}`));
}

/**
 * The table's columns and sort (library settings, ADR-0007 (b)): parsed values, defaults when unset or unreadable.
 * `ready` once both reads have settled, so the table never paints the default columns for a frame before the stored ones.
 */
export function useLibrarySettings(): {
  columns: ColumnConfig;
  sort: LibrarySort;
  setColumns(next: ColumnConfig): void;
  setSort(next: LibrarySort): void;
  ready: boolean;
} {
  const columnsRead = useQuery({ queryKey: keys.columns, queryFn: () => unwrap(api().settings.get({ key: 'library.columns' })) });
  const sortRead = useQuery({ queryKey: keys.sort, queryFn: () => unwrap(api().settings.get({ key: 'library.sort' })) });
  const columns = useMemo(() => parseColumnConfig(columnsRead.data ?? null), [columnsRead.data]);
  const sort = useMemo(() => parseSort(sortRead.data ?? null), [sortRead.data]);
  const setColumns = useCallback((next: ColumnConfig) => save('library.columns', keys.columns, next), []);
  const setSort = useCallback((next: LibrarySort) => save('library.sort', keys.sort, next), []);
  return { columns, sort, setColumns, setSort, ready: !columnsRead.isPending && !sortRead.isPending };
}
