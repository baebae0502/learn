import { Channels, bodyMatchesInput, bodySearchInput, emptyInput } from '@learn/domain';
import { searchBody, searchMatches } from '../text/search';
import type { Handle, IpcDeps } from './register';

/** One body search runs per window: a newer request stops the older one of the same window. */
export function registerSearchIpc(
  handle: Handle,
  deps: IpcDeps,
  impl: { searchBody: typeof searchBody; searchMatches: typeof searchMatches } = { searchBody, searchMatches },
): void {
  const running = new Map<number, AbortController>();
  handle(Channels.search.body, bodySearchInput, async ({ query }, event) => {
    const window = event.sender.id;
    running.get(window)?.abort();
    const mine = new AbortController();
    running.set(window, mine);
    try {
      return await impl.searchBody(deps.getContext().db, query, mine.signal);
    } finally {
      // Only its own entry: the newer request has put its controller there already.
      if (running.get(window) === mine) running.delete(window);
    }
  });
  handle(Channels.search.matches, bodyMatchesInput, ({ itemId, query }) => {
    return impl.searchMatches(deps.getContext().db, itemId, query);
  });
  handle(Channels.search.progress, emptyInput, () => deps.getContext().text.progress());
}
