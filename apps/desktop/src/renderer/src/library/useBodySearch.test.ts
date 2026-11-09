import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { ApiError } from '../api';
import { keys } from '../data/queries';
import { bodyQueryOptions, bodySearchState, type BodyAnswer, type BodySearchCall } from './useBodySearch';

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
