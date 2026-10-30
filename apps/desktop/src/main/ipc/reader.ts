import { Channels, itemIdInput, savePositionInput } from '@learn/domain';
import { broadcast } from '../events';
import type { Handle, IpcDeps } from './register';

export function registerReaderIpc(handle: Handle, deps: IpcDeps): void {
  // The viewer calls this once per mount, so "opened" is recorded even when the position never changes.
  // Announced so the list can show the new openedAt (the 최근 연 자료 view) when the user comes back from the reader.
  handle(Channels.reader.open, itemIdInput, ({ itemId }) => {
    deps.getContext().reading.markOpened(itemId);
    broadcast('libraryChanged', { reason: 'opened', itemIds: [itemId] });
  });
  handle(Channels.reader.getPosition, itemIdInput, ({ itemId }) => deps.getContext().reading.get(itemId) ?? null);
  handle(Channels.reader.savePosition, savePositionInput, (input) => {
    deps.getContext().reading.save(input);
  });
}
