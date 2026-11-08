import { useEffect } from 'react';
import type { ItemType } from '@learn/domain';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, unwrap } from '../api';
import { keys, useItems } from '../data/queries';
import { useShell } from '../state/shell-store';

/** What a tab shows of its item. */
export interface TabItem {
  title: string;
  type: ItemType;
}

/**
 * The name and kind of a reader tab's item, for the strip, the window title and the panel's label. The library list row names it
 * first (no read of its own per tab); an id the list lacks (a trashed item restored with the session, or one purged meanwhile)
 * is asked of `library.detail`, which returns trashed items, under the item panel's own key. Gone for good there too, the tab goes.
 * Until either answers, the title and kind the saved session carried stand in (`known`).
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
  const live = row ? { title: row.title, type: row.type } : undefined;
  // What the last session saw of the item stands in until the item is read (R38): the strip, the window title and the panel's
  // label are whole in the first frame. The live value wins as soon as there is one, and is what the next save carries.
  const known = useShell((s) => s.known[itemId]);
  const noteTabItem = useShell((s) => s.noteTabItem);
  useEffect(() => {
    if (live) noteTabItem(itemId, live);
  }, [itemId, live?.title, live?.type, noteTabItem]);
  const item = live ?? (gone ? undefined : known);
  return { item, failed: !item && (list.isError || detail.isError) };
}

/**
 * The kind of the shown reader tab's item, as far as it is known without reading anything: the library list's row, else the kind the
 * saved session carried. The shell sizes the reader's item panel from it before the item has been read (R39).
 */
export function useTabKind(itemId: string | null): TabItem['type'] | undefined {
  const listed = useItems().data?.find((i) => i.id === itemId);
  const known = useShell((s) => (itemId === null ? undefined : s.known[itemId]));
  return (listed ?? known)?.type;
}
