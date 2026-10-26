import type { QueryClient } from '@tanstack/react-query';
import type { LibraryItem } from '@learn/domain';
import { keys } from './queries';

/** One id index per list array: a refetched list is a new array, so its index is built once and dropped with it. */
const indexes = new WeakMap<readonly LibraryItem[], ReadonlyMap<string, LibraryItem>>();
function byId(list: readonly LibraryItem[]): ReadonlyMap<string, LibraryItem> {
  let index = indexes.get(list);
  if (!index) {
    index = new Map(list.map((i) => [i.id, i]));
    indexes.set(list, index);
  }
  return index;
}

/**
 * Command targets for `itemIds` from the freshest fact: the item's own read (library.get re-checks the file on disk)
 * while it is current, otherwise the list row. An invalidated read is a change announced since (libraryChanged) that
 * the inactive item query has not re-read: the list, read again, knows better.
 */
export function freshTargets(client: QueryClient, list: readonly LibraryItem[], itemIds: readonly string[]): LibraryItem[] {
  const rows = byId(list);
  return itemIds.flatMap((id) => {
    const read = client.getQueryState<LibraryItem>(keys.item(id));
    const current = read && !read.isInvalidated ? read.data : undefined;
    return current ?? rows.get(id) ?? [];
  });
}
