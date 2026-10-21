import { BrowserWindow } from 'electron';
import { COMMANDS, Channels, LearnError, emptyInput, showContextMenuInput, toLearnError, type LibraryItem } from '@learn/domain';
import { refreshItemAvailability } from '../item-availability';
import { itemContextEntries, popupCommandMenu } from '../menu/context-menu';
import { windowStateOf } from '../window';
import type { Handle, IpcDeps } from './register';

export function registerUiIpc(handle: Handle, deps: IpcDeps): void {
  // Resolves when the native menu closes: the picked command (run by the renderer's registry) or null.
  handle(Channels.ui.showContextMenu, showContextMenuInput, async ({ itemIds, x, y }, event) => {
    const ctx = deps.getContext();
    let targets: LibraryItem[] = itemIds.flatMap((id) => ctx.repo.getItem(id) ?? []);
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || targets.length === 0) return null;
    if (targets.length === 1) {
      // Same check as library.get, so "다시 연결…" is enabled for a linked file that went missing this session.
      try {
        targets = [await refreshItemAvailability(ctx, targets[0]!.id)];
      } catch (e) {
        console.warn(`[ui] availability check failed: ${toLearnError(e).code}`); // fall back to the stored state
      }
    }
    const commandId = await popupCommandMenu(itemContextEntries(COMMANDS, targets), { window, x, y });
    return commandId ? { commandId } : null;
  });

  // The current state for a renderer that (re)mounts after the last push; the windowState push stays.
  handle(Channels.ui.windowState, emptyInput, (_input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) throw new LearnError('NOT_FOUND', '창을 찾을 수 없습니다.');
    return windowStateOf(window);
  });
}
