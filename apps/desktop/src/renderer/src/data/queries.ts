import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { LibraryItem, Prefs, SessionsChanged } from '@learn/domain';
import { api, unwrap } from '../api';
import { useLearnEvent } from '../events';
import { carrySearchIndex } from '../library/search';
import { whenIdle } from '../ui/whenIdle';
import { createChangeHandler } from './libraryChange';
import { queryClient } from './query-client';

export const keys = {
  info: ['app', 'info'] as const,
  prefs: ['prefs'] as const,
  /** 마지막 백업 (spec 8.2), the settings window's: read again when main says backup.last changed. */
  backupInfo: ['app', 'backupInfo'] as const,
  items: ['library', 'items'] as const,
  searchTexts: ['library', 'searchTexts'] as const,
  item: (itemId: string) => ['library', 'item', itemId] as const,
  detail: (itemId: string) => ['library', 'detail', itemId] as const,
  /** An item's edited copies (M6 spec 6): under its detail, so whatever reads the detail again reads these too. */
  editedCopies: (itemId: string) => ['library', 'detail', itemId, 'editedCopies'] as const,
  /** The 읽기 section's position of one item; main's position and opened notices invalidate it (libraryChange.ts). */
  reading: (itemId: string) => ['reading', itemId] as const,
  panes: ['settings', 'layout.panes'] as const,
  tabs: ['settings', 'ui.tabs'] as const,
  /** The table's library settings (spec §3.1, §3.2): read once, then written optimistically (useLibrarySettings). */
  columns: ['settings', 'library.columns'] as const,
  sort: ['settings', 'library.sort'] as const,
  /** The open collections of the sidebar (sidebar.expanded): read once, written whole (sidebar/useExpanded.ts). */
  expanded: ['settings', 'sidebar.expanded'] as const,
  /** The tag selector's 표시·정렬 (tags.selector): read once, written optimistically (tags/useTagsSelector.ts). */
  tagsSelector: ['settings', 'tags.selector'] as const,
  sortRecent: ['settings', 'library.sort.recent'] as const,
  sortTrash: ['settings', 'library.sort.trash'] as const,
  /** The stored view (read once at start, then written by the store: useRestoreView, library-store). */
  view: ['settings', 'library.view'] as const,
  /** The organize snapshot (spec 10.1): collections, tags, memberships, assignments, duplicate groups. */
  organize: ['library', 'organize'] as const,
  /** The trash view's rows (spec 4.3): read while the trash view shows; under ['library'], so trash, restore and purge notices mark it stale. */
  trash: ['library', 'trash'] as const,
  /** search:body's answer for one query (spec 5.6): under ['search'], which the body's notices mark stale (libraryChange.ts). */
  bodySearch: (query: string) => ['search', 'body', query] as const,
  /** search:matches for one item and query (the item panel's 본문 일치): under ['search'] with the body's other answers. */
  bodyPages: (itemId: string, query: string) => ['search', 'pages', itemId, query] as const,
  /** How far the body index is: main's search:progress notices put each new count here. */
  bodyProgress: ['search', 'progress'] as const,
  /** The tutor's agents report of this run (tutor:agents): kept for the run, read again by the chooser's buttons and after a failed login or lockdown. */
  tutorAgents: ['tutor', 'agents'] as const,
  /** The tutor's sessions (spec 12): an item's list, the recent ones, one session's thread. sessions:changed and an item's trash, restore and purge mark all of them stale. */
  sessionsList: (itemId: string) => ['sessions', 'list', itemId] as const,
  sessionsRecent: ['sessions', 'recent'] as const,
  sessionThread: (conversationId: string) => ['sessions', 'get', conversationId] as const,
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
/** The tabs open at the last quit, read once before the window's first paint (Boot). */
export const useSavedTabs = () => useQuery({ queryKey: keys.tabs, queryFn: () => unwrap(api().settings.get({ key: 'ui.tabs' })), staleTime: Infinity });

export const usePanes = () => useQuery({ queryKey: keys.panes, queryFn: () => unwrap(api().settings.get({ key: 'layout.panes' })) });

/** The item panel's facts (metadata, file, SHA-256): the same cache entry as the reader's missing notice (ViewerHost). */
export const useItemDetail = (itemId: string) => useQuery({ queryKey: keys.detail(itemId), queryFn: () => unwrap(api().library.detail({ itemId })) });

/** The trash view (spec 4.3): its collection rows and items. `enabled` while the trash view is what the library shows. */
export const useTrashView = (enabled = true) => useQuery({ queryKey: keys.trash, queryFn: () => unwrap(api().library.trashView()), enabled });

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

/** The window's reading of what main announces; the tag actions say which changes they made themselves (expectEcho). */
export const libraryChanges = createChangeHandler({
  cached: () => queryClient.getQueryData<LibraryItem[]>(keys.items),
  refetching: () => queryClient.isFetching({ queryKey: keys.items }) > 0,
  put: (prev, next) => putItems(queryClient, prev, next),
  getItems: (ids) => unwrap(api().library.getItems({ ids })),
  invalidateAll: () => void queryClient.invalidateQueries({ queryKey: ['library'] }),
  invalidateOrganize: () => void queryClient.invalidateQueries({ queryKey: keys.organize }),
  invalidateTrash: () => void queryClient.invalidateQueries({ queryKey: keys.trash }),
  invalidateItem: (itemId) => {
    void queryClient.invalidateQueries({ queryKey: keys.item(itemId) });
    void queryClient.invalidateQueries({ queryKey: keys.detail(itemId) });
  },
  invalidateTexts: () => void queryClient.invalidateQueries({ queryKey: keys.searchTexts }),
  invalidateDetail: (itemId) => void queryClient.invalidateQueries({ queryKey: keys.detail(itemId) }),
  invalidateReading: (ids) => {
    if (ids === null) void queryClient.invalidateQueries({ queryKey: ['reading'] });
    else for (const id of ids) void queryClient.invalidateQueries({ queryKey: keys.reading(id) });
  },
  invalidateBody: () => void queryClient.invalidateQueries({ queryKey: ['search'] }),
  invalidateSessions: () => void queryClient.invalidateQueries({ queryKey: ['sessions'] }),
  whenIdle,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
});
export function useLibrarySync(): void {
  useLearnEvent('libraryChanged', libraryChanges.onChange);
}

/**
 * sessions:changed: main created, ended, renamed, deleted or restored a session (spec 12). The lists and the recent sessions are read
 * again where they are shown, and of the threads only the named sessions'.
 *
 * A list read already on its way may have started before this write: once the list has data it is cancelled and read again (a kept
 * one would end the query's staleness with the older list, and nothing would read it again). Lists are cheap. TanStack Query v5
 * cancels an in-flight fetch only when the query already has data (query-core's `cancelRefetch` branch in `Query.fetch`): a list's
 * first read, just mounted, is reused. Accepted: a notice for a write that this first read may predate is then missed until the
 * next notice or a remount.
 *
 * A thread read already on its way is kept: the one there is at a notice is the window's own read at a turn's end, which starts
 * once main has committed that end, and main's notice of the same end must not cancel it for a second whole read. Accepted: a
 * notice of another write to that session that lands during an unrelated read of its thread is missed until the next one.
 */
export function invalidateSessions(client: QueryClient, e: SessionsChanged): void {
  void client.invalidateQueries({ queryKey: ['sessions', 'list'] });
  void client.invalidateQueries({ queryKey: keys.sessionsRecent });
  for (const id of e.conversationIds) void client.invalidateQueries({ queryKey: keys.sessionThread(id) }, { cancelRefetch: false });
}
export function useSessionsSync(): void {
  useLearnEvent('sessions:changed', (e) => invalidateSessions(queryClient, e));
}

/** prefsChanged carries the whole new prefs object (any window may have changed them). */
export function usePrefsSync(): void {
  useLearnEvent('prefsChanged', ({ prefs }) => queryClient.setQueryData<Prefs>(keys.prefs, prefs));
}
