import { useQuery } from '@tanstack/react-query';
import type { Prefs } from '@learn/domain';
import { api, unwrap } from '../api';
import { useLearnEvent } from '../events';
import { queryClient } from './query-client';

export const keys = {
  info: ['app', 'info'] as const,
  prefs: ['prefs'] as const,
  items: ['library', 'items'] as const,
  item: (itemId: string) => ['library', 'item', itemId] as const,
  detail: (itemId: string) => ['library', 'detail', itemId] as const,
  panes: ['settings', 'layout.panes'] as const,
};

export const useAppInfo = () => useQuery({ queryKey: keys.info, queryFn: () => unwrap(api().app.info()) });
export const usePrefs = () => useQuery({ queryKey: keys.prefs, queryFn: () => unwrap(api().prefs.get()) });
export const useItems = () => useQuery({ queryKey: keys.items, queryFn: () => unwrap(api().library.list()) });
/** `library.get` re-checks the file on disk; main broadcasts libraryChanged when that changed availability. */
export const useItem = (itemId: string) => useQuery({ queryKey: keys.item(itemId), queryFn: () => unwrap(api().library.get({ itemId })) });
export const usePanes = () => useQuery({ queryKey: keys.panes, queryFn: () => unwrap(api().settings.get({ key: 'layout.panes' })) });

/** Every change made through main pushes libraryChanged: drop the cached library data. */
export function useLibrarySync(): void {
  useLearnEvent('libraryChanged', () => void queryClient.invalidateQueries({ queryKey: ['library'] }));
}

/** prefsChanged carries the whole new prefs object (any window may have changed them). */
export function usePrefsSync(): void {
  useLearnEvent('prefsChanged', ({ prefs }) => queryClient.setQueryData<Prefs>(keys.prefs, prefs));
}
