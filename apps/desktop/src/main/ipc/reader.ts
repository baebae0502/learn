import { Channels, itemIdInput, savePositionInput } from '@learn/domain';
import type { Handle, IpcDeps } from './register';

export function registerReaderIpc(handle: Handle, deps: IpcDeps): void {
  // The renderer asks for the position when it opens an item, so this is also where "opened" is recorded.
  handle(Channels.reader.getPosition, itemIdInput, ({ itemId }) => {
    const { reading } = deps.getContext();
    reading.markOpened(itemId);
    return reading.get(itemId) ?? null;
  });
  handle(Channels.reader.savePosition, savePositionInput, (input) => {
    deps.getContext().reading.save(input);
  });
}
