import { useQuery } from '@tanstack/react-query';
import type { Prefs } from '@learn/domain';
import { api, unwrap } from '../api';
import { useLearnEvent } from '../events';
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

/** Every change made through main pushes libraryChanged: drop the cached library data. */
export function useLibrarySync(): void {
  useLearnEvent('libraryChanged', () => void queryClient.invalidateQueries({ queryKey: ['library'] }));
}

/** prefsChanged carries the whole new prefs object (any window may have changed them). */
export function usePrefsSync(): void {
  useLearnEvent('prefsChanged', ({ prefs }) => queryClient.setQueryData<Prefs>(keys.prefs, prefs));
}
