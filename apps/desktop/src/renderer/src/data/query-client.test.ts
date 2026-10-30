import { QueryObserver, notifyManager } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { cacheDrawn, queryClient } from './query-client';

describe('cacheDrawn', () => {
  it('resolves after the cache has told its readers of every change made before it, as a component reading it is told', async () => {
    const key = ['cache-drawn-test'];
    const heard: unknown[] = [];
    const observer = new QueryObserver(queryClient, { queryKey: key, enabled: false });
    // A component's subscription (react-query's useBaseQuery): told in the cache's own task, after the change.
    const stop = observer.subscribe(notifyManager.batchCalls((r: { data: unknown }) => void heard.push(r.data)));
    try {
      queryClient.setQueryData(key, 'moved');
      queryClient.setQueryData(key, 'revealed');
      const drawn = cacheDrawn().then(() => heard.push('drawn'));
      expect(heard, 'not told yet: the cache tells its readers in a task of its own').toEqual([]);
      await drawn;
      expect(heard).toEqual(['moved', 'revealed', 'drawn']);
    } finally {
      stop();
      queryClient.removeQueries({ queryKey: key });
    }
  });
});
