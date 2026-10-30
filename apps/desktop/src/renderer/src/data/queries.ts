import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { LibraryItem, Prefs } from '@learn/domain';
import { api, unwrap } from '../api';
import { useLearnEvent } from '../events';
import { carrySearchIndex } from '../library/search';
import { createChangeHandler } from './libraryChange';
import { queryClient } from './query-client';

export const keys = {
  info: ['app', 'info'] as const,
  prefs: ['prefs'] as const,
  items: ['library', 'items'] as const,
  searchTexts: ['library', 'searchTexts'] as const,
  item: (itemId: string) => ['library', 'item', itemId] as const,
  detail: (itemId: string) => ['library', 'detail', itemId] as const,
  panes: ['settings', 'layout.panes'] as const,
  /** The table's library settings (spec §3.1, §3.2): read once, then written optimistically (useLibrarySettings). */
  columns: ['settings', 'library.columns'] as const,
  sort: ['settings', 'library.sort'] as const,
  /** The open collections of the sidebar (sidebar.expanded): read once, written whole (sidebar/useExpanded.ts). */
  expanded: ['settings', 'sidebar.expanded'] as const,
  /** The tag selector's 표시·정렬 (tags.selector): read once, written optimistically (tags/useTagsSelector.ts). */
  tagsSelector: ['settings', 'tags.selector'] as const,
  sortRecent: ['settings', 'library.sort.recent'] as const,
  /** The stored view (read once at start, then written by the store: useRestoreView, library-store). */
  view: ['settings', 'library.view'] as const,
  /** The organize snapshot (spec 10.1): collections, tags, memberships, assignments, duplicate groups. */
  organize: ['library', 'organize'] as const,
};

export const useAppInfo = () => useQuery({ queryKey: keys.info, queryFn: () => unwrap(api().app.info()) });
/**
 * After a failed read `data` stays undefined (Boot still opens the window): read it as `usePrefs().data ?? DEFAULT_PREFS`.
 * Read once per window, then kept current by prefsChanged. A failed read is not retried when another reader mounts
 * (the main window, useApplyPrefs): that retry put the query back to pending, Boot unmounted the shell and it mounted
 * again — a loop (shell.spec "a failed prefs read still opens the shell").
 */
export const usePrefs = () => useQuery({ queryKey: keys.prefs, queryFn: () => unwrap(api().prefs.get()), retryOnMount: false });
export const useItems = () => useQuery({ queryKey: keys.items, queryFn: () => unwrap(api().library.list()) });
/**
 * Quick search's long fields, read the first time a query is typed, not with the list. libraryChanged marks
 * them stale like the rest of ['library']; they are read again only while a query is typed.
 */
export const useSearchTexts = (enabled: boolean) =>
  useQuery({ queryKey: keys.searchTexts, queryFn: () => unwrap(api().library.searchTexts()), enabled });
/**
 * `library.get` re-checks the file on disk; main broadcasts libraryChanged when that changed availability.
 * `fresh`: read again on every mount even when cached (the reader: a file can vanish without any announcement).
 */
export const useItem = (itemId: string, fresh = false) =>
  useQuery({ queryKey: keys.item(itemId), queryFn: () => unwrap(api().library.get({ itemId })), refetchOnMount: fresh ? 'always' : true });
export const usePanes = () => useQuery({ queryKey: keys.panes, queryFn: () => unwrap(api().settings.get({ key: 'layout.panes' })) });

/** The item panel's facts (metadata, file, SHA-256): the same cache entry as the reader's missing notice (ViewerHost). */
export const useItemDetail = (itemId: string) => useQuery({ queryKey: keys.detail(itemId), queryFn: () => unwrap(api().library.detail({ itemId })) });

/**
 * Every change made through main pushes libraryChanged. Collections and tags read the snapshot only; a change to some
 * items' own rows reads those items and patches the list; the rest drops all cached library data (libraryChange.ts).
 */
/**
 * Stores a patched list and hands the search index to the array the cache then holds: structural sharing keeps a new array
 * that reuses the unchanged rows, so `next` itself is never what readers get.
 */
export function putItems(client: QueryClient, prev: readonly LibraryItem[], next: readonly LibraryItem[]): void {
  client.setQueryData(keys.items, next);
  const held = client.getQueryData<LibraryItem[]>(keys.items);
  if (held) carrySearchIndex(prev, held);
}

const onLibraryChanged = createChangeHandler({
  cached: () => queryClient.getQueryData<LibraryItem[]>(keys.items),
  refetching: () => queryClient.isFetching({ queryKey: keys.items }) > 0,
  put: (prev, next) => putItems(queryClient, prev, next),
  getItems: (ids) => unwrap(api().library.getItems({ ids })),
  invalidateAll: () => void queryClient.invalidateQueries({ queryKey: ['library'] }),
  invalidateOrganize: () => void queryClient.invalidateQueries({ queryKey: keys.organize }),
  invalidateItem: (itemId) => {
    void queryClient.invalidateQueries({ queryKey: keys.item(itemId) });
    void queryClient.invalidateQueries({ queryKey: keys.detail(itemId) });
  },
  invalidateTexts: () => void queryClient.invalidateQueries({ queryKey: keys.searchTexts }),
});
export function useLibrarySync(): void {
  useLearnEvent('libraryChanged', onLibraryChanged);
}

/** prefsChanged carries the whole new prefs object (any window may have changed them). */
export function usePrefsSync(): void {
  useLearnEvent('prefsChanged', ({ prefs }) => queryClient.setQueryData<Prefs>(keys.prefs, prefs));
}
