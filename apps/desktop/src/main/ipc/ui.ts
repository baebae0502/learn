import { BrowserWindow } from 'electron';
import { COMMANDS, Channels, showContextMenuInput } from '@learn/domain';
import { itemContextEntries, popupCommandMenu } from '../menu/context-menu';
import type { Handle, IpcDeps } from './register';

export function registerUiIpc(handle: Handle, deps: IpcDeps): void {
  // Resolves when the native menu closes: the picked command (run by the renderer's registry) or null.
  handle(Channels.ui.showContextMenu, showContextMenuInput, async ({ itemIds, x, y }, event) => {
    const { repo } = deps.getContext();
    const targets = itemIds.flatMap((id) => repo.getItem(id) ?? []);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || targets.length === 0) return null;
    const commandId = await popupCommandMenu(itemContextEntries(COMMANDS, targets), { window, x, y });
    return commandId ? { commandId } : null;
  });
}
