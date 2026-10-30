import { QueryClient, notifyManager } from '@tanstack/react-query';

/** IPC data is pushed fresh by main (libraryChanged, prefsChanged): never refetch on a timer, focus or reconnect. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
});

/**
 * Resolves once every change the cache was given so far has been drawn: the cache tells the components that read it in a task of
 * its own (notifyManager, in the order the changes came), and React draws what they read in that same task.
 */
export const cacheDrawn = (): Promise<void> => new Promise((resolve) => notifyManager.schedule(resolve));
