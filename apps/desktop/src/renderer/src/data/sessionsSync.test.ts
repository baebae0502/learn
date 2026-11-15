import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateSessions, keys } from './queries';

/** A promise the test settles by hand. */
function gate<T>() {
  let resolve!: (v: T) => void;
  const p = new Promise<T>((r) => {
    resolve = r;
  });
  return { p, resolve };
}

describe('sessions:changed (spec 12)', () => {
  it('reads the lists and the recent sessions again, and only the named sessions\' threads', () => {
    const client = new QueryClient();
    const all = [keys.sessionsList('item-a'), keys.sessionsList('item-b'), keys.sessionsRecent, keys.sessionThread('c1'), keys.sessionThread('c2')];
    for (const k of all) client.setQueryData(k, 'read');
    invalidateSessions(client, { reason: 'updated', itemIds: ['item-a'], conversationIds: ['c1'] });
    const stale = (k: readonly unknown[]) => client.getQueryState(k)?.isInvalidated;
    expect(all.map(stale)).toEqual([true, true, true, true, false]);
  });

  it('never cancels a thread read already on its way for a second one (the turn\'s end reads it first)', async () => {
    const client = new QueryClient();
    client.setQueryData(keys.sessionThread('c1'), 'stored');
    let reads = 0;
    const first = gate<string>();
    const observer = new QueryObserver(client, {
      queryKey: keys.sessionThread('c1'),
      staleTime: Infinity,
      queryFn: () => {
        reads += 1;
        return reads === 1 ? first.p : Promise.resolve('second');
      },
    });
    const stop = observer.subscribe(() => {});
    try {
      expect(reads).toBe(0);
      // The window's own read when it hears the turn end (useTurnEvents), then main's notice of the same end.
      void client.invalidateQueries({ queryKey: keys.sessionThread('c1') });
      expect(reads).toBe(1);
      invalidateSessions(client, { reason: 'updated', itemIds: ['item-a'], conversationIds: ['c1'] });
      await Promise.resolve();
      expect(reads, 'the read on its way is kept').toBe(1);
      first.resolve('first');
      await expect.poll(() => client.getQueryData(keys.sessionThread('c1'))).toBe('first');
      expect(reads).toBe(1);
    } finally {
      stop();
    }
  });

  it('reads a list and the recent sessions again when a write\'s notice lands while their read is on its way: that read may predate the write', async () => {
    for (const key of [keys.sessionsList('item-a'), keys.sessionsRecent]) {
      const client = new QueryClient();
      client.setQueryData(key, 'stored');
      let reads = 0;
      const first = gate<string>();
      const observer = new QueryObserver(client, {
        queryKey: key,
        staleTime: Infinity,
        queryFn: () => {
          reads += 1;
          return reads === 1 ? first.p : Promise.resolve('after the third seed');
        },
      });
      const stop = observer.subscribe(() => {});
      try {
        // The second seed's notice starts a read; the third seed's notice comes while it is on its way.
        invalidateSessions(client, { reason: 'created', itemIds: ['item-a'], conversationIds: ['c2'] });
        expect(reads).toBe(1);
        invalidateSessions(client, { reason: 'created', itemIds: ['item-a'], conversationIds: ['c3'] });
        first.resolve('after the second seed');
        await expect.poll(() => client.getQueryData(key), { message: JSON.stringify(key) }).toBe('after the third seed');
        expect(reads).toBe(2);
      } finally {
        stop();
      }
    }
  });
});
