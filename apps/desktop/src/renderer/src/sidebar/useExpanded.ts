import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SIDEBAR_EXPANDED_MAX } from '@learn/domain';
import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { saveSetting } from '../data/saveSetting';
import type { OrganizeModel } from '../organize/model';
import { parseExpanded } from '../organize/viewSettings';

/** The stored list of open collections (`sidebar.expanded`), read once; writes go through the same cache entry (saveSetting). */
export function useExpandedRead() {
  return useQuery({ queryKey: keys.expanded, queryFn: () => unwrap(api().settings.get({ key: 'sidebar.expanded' })), staleTime: Infinity });
}

/**
 * The open collections the tree draws, and whether they are known: the read has answered (a failed read is "none open") and
 * the snapshot is there to tell which stored ids still exist. Derived from the cache entry, so a change saved at once shows.
 */
export function useExpanded(model: OrganizeModel | undefined): { expanded: ReadonlySet<string>; settled: boolean } {
  const read = useExpandedRead();
  const expanded = useMemo(() => new Set(parseExpanded(read.data, (id) => model?.node(id) !== undefined)), [read.data, model]);
  return { expanded, settled: model !== undefined && (read.isSuccess || read.isError) };
}

/** Writes the open collections (at most as many as the setting takes). */
export function saveExpanded(ids: ReadonlySet<string>): void {
  saveSetting('sidebar.expanded', [...ids].slice(0, SIDEBAR_EXPANDED_MAX));
}
