import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnConfig, LibraryColumnId } from '@learn/domain';
import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { saveSetting } from '../data/saveSetting';
import { useLibrary } from '../state/library-store';
import { parseColumnConfig } from './columns';
import { DEFAULT_SORT_RECENT, parseSort, type LibrarySort } from './sort';

const NO_COLUMNS: readonly LibraryColumnId[] = [];
/** The recent view always shows when each item was opened (spec 3.2). */
const RECENT_COLUMNS: readonly LibraryColumnId[] = ['openedAt'];

/**
 * The table's columns and sort (library settings, ADR-0007 (b)): parsed values, defaults when unset or unreadable.
 * `sort` and `setSort` are those of the scope shown: the recent view has a sort of its own (`library.sort.recent`), every
 * other view shares `library.sort`. `forced` are the columns the scope shows whatever the stored columns say.
 * `ready` once all three reads have settled, so the table never paints the default columns for a frame before the stored ones.
 */
export function useLibrarySettings(): {
  columns: ColumnConfig;
  sort: LibrarySort;
  forced: readonly LibraryColumnId[];
  setColumns(next: ColumnConfig): void;
  setSort(next: LibrarySort): void;
  ready: boolean;
} {
  const recent = useLibrary((s) => s.scope.kind === 'recent');
  const columnsRead = useQuery({ queryKey: keys.columns, queryFn: () => unwrap(api().settings.get({ key: 'library.columns' })) });
  const sortRead = useQuery({ queryKey: keys.sort, queryFn: () => unwrap(api().settings.get({ key: 'library.sort' })) });
  const recentRead = useQuery({ queryKey: keys.sortRecent, queryFn: () => unwrap(api().settings.get({ key: 'library.sort.recent' })) });
  const columns = useMemo(() => parseColumnConfig(columnsRead.data ?? null), [columnsRead.data]);
  const sortAll = useMemo(() => parseSort(sortRead.data ?? null), [sortRead.data]);
  const sortRecent = useMemo(() => parseSort(recentRead.data ?? null, DEFAULT_SORT_RECENT), [recentRead.data]);
  const setColumns = useCallback((next: ColumnConfig) => saveSetting('library.columns', next), []);
  const setSort = useCallback((next: LibrarySort) => saveSetting(recent ? 'library.sort.recent' : 'library.sort', next), [recent]);
  return {
    columns,
    sort: recent ? sortRecent : sortAll,
    forced: recent ? RECENT_COLUMNS : NO_COLUMNS,
    setColumns,
    setSort,
    ready: !columnsRead.isPending && !sortRead.isPending && !recentRead.isPending,
  };
}
