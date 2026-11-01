import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TRASH_COLUMNS, type ColumnConfig, type LibraryColumnId } from '@learn/domain';
import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { saveSetting } from '../data/saveSetting';
import { useLibrary } from '../state/library-store';
import { useInTrash } from '../trash/useTrashSource';
import { parseColumnConfig } from './columns';
import { DEFAULT_SORT, DEFAULT_SORT_RECENT, DEFAULT_SORT_TRASH, parseSort, type LibrarySort } from './sort';

const NO_COLUMNS: readonly LibraryColumnId[] = [];
/** The recent view always shows when each item was opened (spec 3.2). */
const RECENT_COLUMNS: readonly LibraryColumnId[] = ['openedAt'];
/** 삭제한 날짜 is the trash view's only (M6 spec 4.3): a sort by it stored for another view reads as that view's default. */
const outsideTrash = (sort: LibrarySort, fallback: LibrarySort): LibrarySort => (sort.column === 'deletedAt' ? fallback : sort);

/**
 * The table's columns and sort (library settings, ADR-0007 (b)): parsed values, defaults when unset or unreadable.
 * `sort` and `setSort` are those of the scope shown: the recent view has a sort of its own (`library.sort.recent`), the trash
 * view too (`library.sort.trash`, read the first time it shows), every other view shares `library.sort`. `forced` are the
 * columns the scope shows whatever the stored columns say. `ready` once the reads it needs have settled, so the table never
 * paints the default columns for a frame before the stored ones.
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
  const trash = useInTrash();
  const columnsRead = useQuery({ queryKey: keys.columns, queryFn: () => unwrap(api().settings.get({ key: 'library.columns' })) });
  const sortRead = useQuery({ queryKey: keys.sort, queryFn: () => unwrap(api().settings.get({ key: 'library.sort' })) });
  const recentRead = useQuery({ queryKey: keys.sortRecent, queryFn: () => unwrap(api().settings.get({ key: 'library.sort.recent' })) });
  const trashRead = useQuery({ queryKey: keys.sortTrash, queryFn: () => unwrap(api().settings.get({ key: 'library.sort.trash' })), enabled: trash });
  const columns = useMemo(() => parseColumnConfig(columnsRead.data ?? null), [columnsRead.data]);
  const sortAll = useMemo(() => outsideTrash(parseSort(sortRead.data ?? null), DEFAULT_SORT), [sortRead.data]);
  const sortRecent = useMemo(() => outsideTrash(parseSort(recentRead.data ?? null, DEFAULT_SORT_RECENT), DEFAULT_SORT_RECENT), [recentRead.data]);
  const sortTrash = useMemo(() => parseSort(trashRead.data ?? null, DEFAULT_SORT_TRASH), [trashRead.data]);
  const setColumns = useCallback((next: ColumnConfig) => saveSetting('library.columns', next), []);
  const setSort = useCallback((next: LibrarySort) => saveSetting(trash ? 'library.sort.trash' : recent ? 'library.sort.recent' : 'library.sort', next), [recent, trash]);
  return {
    columns,
    sort: trash ? sortTrash : recent ? sortRecent : sortAll,
    forced: trash ? TRASH_COLUMNS : recent ? RECENT_COLUMNS : NO_COLUMNS,
    setColumns,
    setSort,
    ready: !columnsRead.isPending && !sortRead.isPending && !recentRead.isPending && (!trash || !trashRead.isPending),
  };
}
