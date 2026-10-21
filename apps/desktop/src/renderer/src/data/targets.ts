import type { QueryClient } from '@tanstack/react-query';
import type { LibraryItem } from '@learn/domain';
import { keys } from './queries';

/**
 * Command targets for `itemIds` from the freshest fact: the item's own read (library.get re-checks the file on disk)
 * while it is current, otherwise the list row. An invalidated read is a change announced since (libraryChanged) that
 * the inactive item query has not re-read: the list, read again, knows better.
 */
export function freshTargets(client: QueryClient, list: readonly LibraryItem[], itemIds: readonly string[]): LibraryItem[] {
  return itemIds.flatMap((id) => {
    const read = client.getQueryState<LibraryItem>(keys.item(id));
    const current = read && !read.isInvalidated ? read.data : undefined;
    return current ?? list.find((i) => i.id === id) ?? [];
  });
}
