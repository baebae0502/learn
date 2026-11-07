import { Channels, POSITION_NOTICE_MS, itemIdInput, savePositionInput } from '@learn/domain';
import { broadcast } from '../events';
import type { Handle, IpcDeps } from './register';

/** Per item with a window running: whether a save came in during it (announced when the window closes). */
const windows = new Map<string, { pending: boolean; timer: NodeJS.Timeout | null }>();

/** The first save of an item is announced at once; the saves of the next window make one notice at its end. */
function announcePosition(itemId: string): void {
  const open = windows.get(itemId);
  if (open) {
    open.pending = true;
    return;
  }
  const w: { pending: boolean; timer: NodeJS.Timeout | null } = { pending: false, timer: null };
  windows.set(itemId, w);
  broadcast('libraryChanged', { reason: 'position', itemIds: [itemId] });
  const close = () => {
    if (w.pending) {
      w.pending = false;
      broadcast('libraryChanged', { reason: 'position', itemIds: [itemId] });
      w.timer = setTimeout(close, POSITION_NOTICE_MS).unref();
    } else windows.delete(itemId);
  };
  w.timer = setTimeout(close, POSITION_NOTICE_MS).unref();
}

/** The window it belonged to is gone: no notice is owed to anyone, and no timer is left running. */
export function endPositionNotices(): void {
  for (const w of windows.values()) if (w.timer) clearTimeout(w.timer);
  windows.clear();
}

export function registerReaderIpc(handle: Handle, deps: IpcDeps): void {
  // The viewer calls this once per mount, so "opened" is recorded even when the position never changes.
  // Announced so the list can show the new openedAt (the 최근 연 자료 view) when the user comes back from the reader.
  handle(Channels.reader.open, itemIdInput, ({ itemId }) => {
    deps.getContext().reading.markOpened(itemId);
    broadcast('libraryChanged', { reason: 'opened', itemIds: [itemId] });
  });
  handle(Channels.reader.getPosition, itemIdInput, ({ itemId }) => deps.getContext().reading.get(itemId) ?? null);
  // Announced so the 진행 column follows the reading while the library is behind the reader.
  handle(Channels.reader.savePosition, savePositionInput, (input) => {
    deps.getContext().reading.save(input);
    announcePosition(input.itemId);
  });
}
