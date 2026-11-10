import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { ApiError } from '../api';
import { keys } from '../data/queries';
import { bodyPagesOptions, bodyQueryOptions, bodySearchState, type BodyAnswer, type BodyPages, type BodyPagesCall, type BodySearchCall } from './useBodySearch';

// The hook's own query options and state mapping, driven through React Query as the hook drives them (the same client
// defaults as the app's query-client.ts), with search:body replaced by a stub.
const client = () => new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } } });
const cancelledError = () => new ApiError('CANCELLED', 'superseded', false);
const answer = (ids: string[]): BodyAnswer => ({ itemIds: ids, searched: true });

/** One reader of `target` while the settled query is `settled`: the state it ends at once nothing is fetched any more. */
async function read(c: QueryClient, target: string, settled: string, search: BodySearchCall) {
  const observer = new QueryObserver(c, bodyQueryOptions(target, settled, search));
  const stop = observer.subscribe(() => {});
  await vi.waitFor(() => expect(observer.getCurrentResult().fetchStatus).toBe('idle'));
  const result = observer.getCurrentResult();
  stop();
  return bodySearchState(true, target !== '' && settled === target, result);
}

describe('the body answer as the readers see it', () => {
  it('a query stopped twice (the one retry spent) ends as failed, so no-results shows without the body claim', async () => {
    const search = vi.fn<BodySearchCall>(() => Promise.reject(cancelledError()));
    const state = await read(client(), '형광', '형광', search);
    expect(search).toHaveBeenCalledTimes(2);
    expect(state).toEqual({ on: true, answer: undefined, pending: false });
  });
  it('a query stopped once is asked again, and its answer is used', async () => {
    const found = answer(['a']);
    const search = vi.fn<BodySearchCall>().mockRejectedValueOnce(cancelledError()).mockResolvedValueOnce(found);
    const state = await read(client(), '형광', '형광', search);
    expect(search).toHaveBeenCalledTimes(2);
    expect(state).toEqual({ on: true, answer: found, pending: false });
  });
  it('an IPC error is not asked again and ends as failed', async () => {
    const search = vi.fn<BodySearchCall>(() => Promise.reject(new ApiError('INTERNAL', 'broken', false)));
    const state = await read(client(), '형광', '형광', search);
    expect(search).toHaveBeenCalledTimes(1);
    expect(state).toEqual({ on: true, answer: undefined, pending: false });
  });
  it('while the settle is pending, a query typed again shows its cached answer at once, with no new search', async () => {
    const c = client();
    const cached = answer(['a', 'b']);
    c.setQueryData(keys.bodySearch('형광'), cached);
    const search = vi.fn<BodySearchCall>(() => Promise.resolve(answer([])));
    const state = await read(c, '형광', '형광 현', search);
    expect(search).not.toHaveBeenCalled();
    expect(state).toEqual({ on: true, answer: cached, pending: false });
  });
  it('while the settle is pending, a query with nothing cached waits, with no search yet', async () => {
    const search = vi.fn<BodySearchCall>(() => Promise.resolve(answer([])));
    const state = await read(client(), '형광', '', search);
    expect(search).not.toHaveBeenCalled();
    expect(state).toEqual({ on: true, answer: undefined, pending: true });
  });
  it('a settled query with an answer is that answer; off is off', async () => {
    const found = answer(['x']);
    const search = vi.fn<BodySearchCall>(() => Promise.resolve(found));
    expect(await read(client(), '형광', '형광', search)).toEqual({ on: true, answer: found, pending: false });
    expect(bodySearchState(false, true, { data: found, isError: false, error: null, isFetching: false })).toEqual({ on: false, answer: undefined, pending: false });
  });
});

describe("본문 일치's pages as the item panel reads them (keyed as the table's body answer)", () => {
  const ITEM = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
  const pages = (n: number): BodyPages => ({ pages: Array.from({ length: n }, (_, i) => ({ pageIndex: i, snippet: `\ue000형광\ue001 ${i}` })), total: n });
  /** One reader of the pages of `target` while the settled query is `settled`: what it holds once nothing is fetched any more. */
  async function readPages(c: QueryClient, target: string, settled: string, read: boolean, search: BodyPagesCall) {
    const observer = new QueryObserver(c, bodyPagesOptions(ITEM, target, settled, read, search));
    const stop = observer.subscribe(() => {});
    await vi.waitFor(() => expect(observer.getCurrentResult().fetchStatus).toBe('idle'));
    const result = observer.getCurrentResult();
    stop();
    return result;
  }

  it('is keyed by the query typed now, not the settled one', () => {
    expect(bodyPagesOptions(ITEM, '형광', '형', true).queryKey).toEqual(keys.bodyPages(ITEM, '형광'));
    expect(keys.bodyPages(ITEM, '형광')).toEqual(['search', 'pages', ITEM, '형광']);
  });
  it('asks nothing before the typed query has settled: the list waits with no answer', async () => {
    const search = vi.fn<BodyPagesCall>(() => Promise.resolve(pages(3)));
    const result = await readPages(client(), '형광 현', '형광', true, search);
    expect(search).not.toHaveBeenCalled();
    expect(result.data).toBeUndefined();
    expect(result.isPending).toBe(true);
  });
  it('a query typed again shows its cached pages at once, before it settles, with no new ask', async () => {
    const c = client();
    const cached = pages(2);
    c.setQueryData(keys.bodyPages(ITEM, '형광'), cached);
    const search = vi.fn<BodyPagesCall>(() => Promise.resolve(pages(9)));
    const result = await readPages(c, '형광', '형광 현', true, search);
    expect(search).not.toHaveBeenCalled();
    expect(result.data).toBe(cached);
  });
  it('once settled it asks search:pages for that item and query, once', async () => {
    const found = pages(3);
    const search = vi.fn<BodyPagesCall>(() => Promise.resolve(found));
    const result = await readPages(client(), '형광', '형광', true, search);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith(ITEM, '형광');
    expect(result.data).toBe(found);
  });
  it('asks nothing for a body that is not read, nor for no query', async () => {
    const search = vi.fn<BodyPagesCall>(() => Promise.resolve(pages(1)));
    await readPages(client(), '형광', '형광', false, search);
    await readPages(client(), '', '', true, search);
    expect(search).not.toHaveBeenCalled();
  });
});
