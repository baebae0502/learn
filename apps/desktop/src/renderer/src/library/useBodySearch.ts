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

/**
 * The body search for `query` (spec 5.6): off the input path — the deferred query, once it has held for 200 ms, goes to
 * search:body without waiting on anything typed. The answer is cached per query (['search','body', q]); libraryChanged
 * marks it stale (text, import, trash, restore, purge). An answer for a query no longer typed is not used.
 */
export function useBodySearch(query: string, enabled: boolean): BodySearch {
  const deferred = useDeferredValue(query);
  const on = enabled && bodyQueryable(deferred);
  const target = on ? deferred.trim() : '';
  useEffect(() => settle.ask(target), [target]);
  const settled = useSyncExternalStore(settle.subscribe, settle.get);
  const live = target !== '' && settled === target;
  const read = useQuery({
    queryKey: keys.bodySearch(settled),
    queryFn: () => unwrap(api().search.body({ query: settled })),
    enabled: live,
    gcTime: BODY_GC_MS,
    // Stopped by a search this window did not make for this field: asked once more.
    retry: (failures, error) => failures < 1 && cancelled(error),
    retryDelay: 0,
  });
  if (!on) return OFF;
  if (!live) return PENDING;
  // The answer object stays the same until the cache holds another (readers key their memos on it).
  if (read.data !== undefined) return { on: true, answer: read.data, pending: false };
  return read.isError && !cancelled(read.error) ? FAILED : PENDING;
}

/** The library's quick search in the body: the session's query, in the stored scope, never in the trash view. */
export function useQuickBodySearch(): BodySearch {
  const query = useLibrary((s) => s.query);
  const [scope] = useSearchScope();
  const inTrash = useInTrash();
  return useBodySearch(query, scope === 'fulltext' && !inTrash);
}
