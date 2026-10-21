import { QueryClient } from '@tanstack/react-query';

/** IPC data is pushed fresh by main (libraryChanged, prefsChanged): never refetch on a timer, focus or reconnect. */
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
});
