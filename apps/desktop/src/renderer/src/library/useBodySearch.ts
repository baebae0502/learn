import { useDeferredValue, useEffect, useSyncExternalStore } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { SearchScope } from '@learn/domain';
import { ApiError, api, unwrap } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { saveSetting, settingKey } from '../data/saveSetting';
import { useLearnEvent } from '../events';
import { useLibrary } from '../state/library-store';
import { useInTrash } from '../trash/useTrashSource';
import { bodyQueryable, createSettle, parseSearchScope, type BodyProgress } from './bodySearch';

/** What search:body answered for a query: the items whose body has every word on one page, and whether it searched at all. */
export interface BodyAnswer {
  itemIds: readonly string[];
  searched: boolean;
}

export interface BodySearch {
  /** The body is searched for this query here: 정보와 본문, not the trash, a word of two letters or more. */
  on: boolean;
  /** The answer for this query, once it came. */
  answer: BodyAnswer | undefined;
  /** On, and not answered yet. A search that failed has answered: nothing was found in the body. */
  pending: boolean;
}

const OFF: BodySearch = { on: false, answer: undefined, pending: false };
const PENDING: BodySearch = { on: true, answer: undefined, pending: true };
const FAILED: BodySearch = { on: true, answer: undefined, pending: false };
/** The answers of queries typed on the way are let go a while after nothing reads them. */
const BODY_GC_MS = 5 * 60_000;

/** One wait for the whole window: the toolbar, the field and the table take the new query in the same update. */
const settle = createSettle({ setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>) });

/** A newer search:body from this window stopped this one: the newer one answers instead. */
const cancelled = (e: unknown): boolean => e instanceof ApiError && e.code === 'CANCELLED';

/** Read before the window's first paint (Boot), so the field's placeholder is the stored scope's from the start. */
export const useSearchScopeSetting = (): UseQueryResult<unknown> =>
  useQuery({ queryKey: settingKey('library.searchScope'), queryFn: () => unwrap(api().settings.get({ key: 'library.searchScope' })) });

const setSearchScope = (scope: SearchScope): void => saveSetting('library.searchScope', scope);

/** The quick search's scope, remembered by the library (metadata until one is chosen), and its setter. */
export function useSearchScope(): [SearchScope, (scope: SearchScope) => void] {
  return [parseSearchScope(useSearchScopeSetting().data), setSearchScope];
}

/** How far the body index is (PDFs outside the trash); main's progress notices keep it current (useBodyProgressSync). */
export function useBodyProgress(): BodyProgress | undefined {
  return useQuery({ queryKey: keys.bodyProgress, queryFn: () => unwrap(api().search.progress()) }).data;
}

/** Main's progress notices go into the cache whether or not anything shows them now. */
export function useBodyProgressSync(): void {
  useLearnEvent('search:progress', (progress) => queryClient.setQueryData(keys.bodyProgress, progress));
}

/** search:body for one query: the app's IPC, or a stub in a test. */
export type BodySearchCall = (query: string) => Promise<BodyAnswer>;
const searchBody: BodySearchCall = (query) => unwrap(api().search.body({ query }));

/**
 * The cache entry the readers of `target` (the query typed now) observe, and its fetch, which waits until the settled
 * query (BODY_SETTLE_MS without a key) has caught up with it. Keyed by the typed query, so one typed again shows its
 * cached answer at once rather than a blank table for the settle time.
 */
export function bodyQueryOptions(target: string, settled: string, search: BodySearchCall = searchBody) {
  return {
    queryKey: keys.bodySearch(target),
    queryFn: () => search(target),
    enabled: target !== '' && settled === target,
    gcTime: BODY_GC_MS,
    // Stopped by a search this window did not make for this field: asked once more.
    retry: (failures: number, error: unknown) => failures < 1 && cancelled(error),
    retryDelay: 0,
  };
}

/** What that entry means to the readers. `live`: the settled query is the one typed now, so the entry may be fetched. */
export function bodySearchState(on: boolean, live: boolean, read: { data: BodyAnswer | undefined; isError: boolean; error: unknown; isFetching: boolean }): BodySearch {
  if (!on) return OFF;
  // The answer object stays the same until the cache holds another (readers key their memos on it). Before the settle a
  // cached answer is the one for this very query; a stale one is fetched again once the query settles.
  if (read.data !== undefined) return { on: true, answer: read.data, pending: false };
  if (!live) return PENDING;
  // An error is final once nothing is fetched any more: a second stop after the one retry, or any other failure. The
  // readers then show no-results without the body claim instead of waiting for an answer that will not come. A stopped
  // query that is fetched again (typed again later) waits for that fetch.
  return read.isError && !read.isFetching ? FAILED : PENDING;
}

/** A search field's body query: the one typed now (`target`, '' when the body is not searched for it) and the one that has settled. */
export interface BodyTarget {
  on: boolean;
  target: string;
  settled: string;
}

/** The deferred query as a body query, asked of the one settle store; whoever reads it gets the same settled value. */
function useBodyTargetOf(query: string, enabled: boolean): BodyTarget {
  const deferred = useDeferredValue(query);
  const on = enabled && bodyQueryable(deferred);
  const target = on ? deferred.trim() : '';
  useEffect(() => settle.ask(target), [target]);
  const settled = useSyncExternalStore(settle.subscribe, settle.get);
  return { on, target, settled };
}

function useBodyAnswer({ on, target, settled }: BodyTarget): BodySearch {
  const read = useQuery(bodyQueryOptions(target, settled));
  return bodySearchState(on, target !== '' && settled === target, read);
}

/**
 * The body search for `query` (spec 5.6): off the input path — the deferred query, once it has held for 200 ms, goes to
 * search:body without waiting on anything typed. The answer is cached per query (['search','body', q]); libraryChanged
 * marks it stale (text, import, trash, restore, purge). An answer for a query no longer typed is not used.
 */
export function useBodySearch(query: string, enabled: boolean): BodySearch {
  return useBodyAnswer(useBodyTargetOf(query, enabled));
}

/**
 * The library quick search's body query: the session's query, in the stored scope, never in the trash view. The table's body
 * answer and the item panel's 본문 일치 both key on its target, so they empty and fill in the same update.
 */
export function useBodyTarget(): BodyTarget {
  const query = useLibrary((s) => s.query);
  const [scope] = useSearchScope();
  const inTrash = useInTrash();
  return useBodyTargetOf(query, scope === 'fulltext' && !inTrash);
}

/** The library's quick search in the body: the session's query, in the stored scope, never in the trash view. */
export function useQuickBodySearch(): BodySearch {
  return useBodyAnswer(useBodyTarget());
}

/** What search:pages answers for one item: its first pages that match (twenty at most), a snippet each, and how many match. */
export interface BodyPages {
  pages: Array<{ pageIndex: number; snippet: string }>;
  total: number;
}

/** search:pages for one item and query: the app's IPC, or a stub in a test. */
export type BodyPagesCall = (itemId: string, query: string) => Promise<BodyPages>;
const searchPages: BodyPagesCall = (itemId, query) => unwrap(api().search.pages({ itemId, query }));

/**
 * 본문 일치's pages for one item, read as the table reads its body answer (bodyQueryOptions): the entry of `target`, the query
 * typed now, fetched once the settled query has caught up with it. The list then empties and fills with the table's body rows,
 * never once more when the query settles, and a query typed again shows from the cache at once. `read`: the item's body is indexed.
 */
export function bodyPagesOptions(itemId: string, target: string, settled: string, read: boolean, search: BodyPagesCall = searchPages) {
  return {
    queryKey: keys.bodyPages(itemId, target),
    queryFn: () => search(itemId, target),
    enabled: read && target !== '' && settled === target,
    gcTime: BODY_GC_MS,
  };
}
