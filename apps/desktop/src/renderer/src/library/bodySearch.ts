import { SEARCH_SCOPES, bodyQueryWords, bodySearchInput, hasBodyWords, type SearchScope } from '@learn/domain';
import { t } from '../strings';
import type { SearchResult } from './search';

/** How far the body index is: PDFs outside the trash whose body text is read, of all of them (search:progress). */
export interface BodyProgress {
  done: number;
  total: number;
}

/**
 * How long a query must stay as it is before the body is searched for it: no scan per keystroke, and the matches still
 * come right after typing stops.
 */
export const BODY_SETTLE_MS = 200;

/** The body is searched for this query: it has a word of two letters or more, and search:body takes it (200 after NFC). */
export function bodyQueryable(query: string): boolean {
  return hasBodyWords(bodyQueryWords(query)) && bodySearchInput.safeParse({ query }).success;
}

/** The stored scope; nothing stored, or a value this build does not know, reads as the metadata search. */
export function parseSearchScope(value: unknown): SearchScope {
  return (SEARCH_SCOPES as readonly unknown[]).includes(value) ? (value as SearchScope) : 'metadata';
}

/** Some PDFs are not indexed yet. */
export const indexing = (p: BodyProgress | undefined): p is BodyProgress => p !== undefined && p.done < p.total;

/**
 * The quick search's answer with the body matches added: the metadata matches and the body matches together. Only the
 * metadata matches mark a title (a body-only row has no sign of its own). No query (meta null) filters nothing. When the
 * body adds nothing, the metadata answer itself comes back, so nothing that reads it draws again.
 */
export function mergeBodyResult(meta: SearchResult | null, body: readonly string[] | undefined): SearchResult | null {
  if (meta === null || body === undefined) return meta;
  let ids: Set<string> | null = null;
  for (const id of body) {
    if (meta.ids.has(id)) continue;
    ids ??= new Set(meta.ids);
    ids.add(id);
  }
  return ids === null ? meta : { ids, titleMatches: meta.titleMatches };
}

/**
 * What a no-results state adds about the body (in 정보와 본문 only), so that it does not read as a false negative: a query of
 * one-letter words was not searched in the body; a body search made while PDFs are still being indexed may find more once
 * they are. The first says more than the second (a finished index would not search one letter either).
 */
export function emptyNote(o: { scope: SearchScope; query: string; searched: boolean; progress: BodyProgress | undefined }): string[] {
  if (o.scope !== 'fulltext') return [];
  if (!hasBodyWords(bodyQueryWords(o.query))) return [t.library.searchEmptyOneLetter];
  if (o.searched && indexing(o.progress)) return [t.library.searchEmptyIndexing(o.progress.done, o.progress.total)];
  return [];
}

export interface SettleTimers {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
}

/** The query the body is searched for, as an external store: every reader of the search asks, one timer answers. */
export interface Settle {
  get(): string;
  subscribe(listener: () => void): () => void;
  /** The query the field holds now ('' for none): taken once it has held for BODY_SETTLE_MS, '' at once. */
  ask(query: string): void;
}

/**
 * The toolbar, the field and the table each read the search; they ask with the same query in the same frame. One timer for
 * all of them gives them the new query in one update (one render, one search:body), not three a few milliseconds apart.
 */
export function createSettle(timers: SettleTimers): Settle {
  let value = '';
  let waiting: string | null = null;
  let timer: unknown = null;
  const listeners = new Set<() => void>();
  const take = (next: string): void => {
    if (next === value) return;
    value = next;
    for (const listener of [...listeners]) listener();
  };
  const drop = (): void => {
    if (timer !== null) timers.clearTimer(timer);
    timer = null;
    waiting = null;
  };
  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    ask(query) {
      if (query === waiting) return;
      drop();
      if (query === '') take('');
      if (query === value) return;
      waiting = query;
      timer = timers.setTimer(() => {
        timer = null;
        waiting = null;
        take(query);
      }, BODY_SETTLE_MS);
    },
  };
}
