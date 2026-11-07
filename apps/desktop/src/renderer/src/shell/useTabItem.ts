import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '../api';
import { keys, useItems } from '../data/queries';
import { useShell } from '../state/shell-store';

/** What a tab shows of its item. */
export interface TabItem {
  title: string;
  type: 'pdf' | 'video';
}

/**
 * The name and kind of a reader tab's item, for the strip, the window title and the panel's label. The library list row names it
 * first (no read of its own per tab); an id the list lacks (a trashed item restored with the session, or one purged meanwhile)
 * is asked of `library.detail`, which returns trashed items, under the item panel's own key. Gone for good there too, the tab goes.
 * `failed`: neither could name it (the window title is then the app's).
 */
export function useTabItem(itemId: string): { item: TabItem | undefined; failed: boolean } {
  const list = useItems();
  const listed = list.data?.find((i) => i.id === itemId);
  const detail = useQuery({
    queryKey: keys.detail(itemId),
    queryFn: () => unwrap(api().library.detail({ itemId })),
    enabled: list.isSuccess && !listed,
  });
  const gone = detail.error instanceof ApiError && detail.error.code === 'NOT_FOUND';
  const removeTab = useShell((s) => s.removeTab);
  useEffect(() => {
    if (gone && !listed) removeTab(itemId);
  }, [gone, listed, itemId, removeTab]);
  const row = listed ?? detail.data?.item;
  return { item: row ? { title: row.title, type: row.type } : undefined, failed: !row && (list.isError || detail.isError) };
}
