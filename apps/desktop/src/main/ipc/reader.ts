import { Channels, itemIdInput, savePositionInput } from '@learn/domain';
import type { Handle, IpcDeps } from './register';

export function registerReaderIpc(handle: Handle, deps: IpcDeps): void {
  // The viewer calls this once per mount, so "opened" is recorded even when the position never changes.
  // Not broadcast: the M2 list does not show openedAt.
  handle(Channels.reader.open, itemIdInput, ({ itemId }) => {
    deps.getContext().reading.markOpened(itemId);
  });
  handle(Channels.reader.getPosition, itemIdInput, ({ itemId }) => deps.getContext().reading.get(itemId) ?? null);
  handle(Channels.reader.savePosition, savePositionInput, (input) => {
    deps.getContext().reading.save(input);
  });
}
