import { Channels, bodyPagesInput, bodySearchInput, emptyInput } from '@learn/domain';
import { searchBody, searchPages } from '../text/search';
import type { Handle, IpcDeps } from './register';

/** One body search runs per window: a newer request stops the older one of the same window. */
export function registerSearchIpc(
  handle: Handle,
  deps: IpcDeps,
  impl: { searchBody: typeof searchBody; searchPages: typeof searchPages } = { searchBody, searchPages },
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
  handle(Channels.search.pages, bodyPagesInput, ({ itemId, query }) => {
    const ctx = deps.getContext();
    return impl.searchPages(ctx.db, ctx.repo, itemId, query);
  });
  handle(Channels.search.progress, emptyInput, () => deps.getContext().text.progress());
}
