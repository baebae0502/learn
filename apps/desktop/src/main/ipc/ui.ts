import path from 'node:path';
import { BrowserWindow, type WebContents } from 'electron';
import { COMMANDS, Channels, LearnError, commandContextInput, confirmDuplicateInput, emptyInput, showContextMenuInput, toLearnError, type LibraryItem } from '@learn/domain';
import { refreshItemAvailability } from '../item-availability';
import { contextMenuEntries, popupCommandMenu } from '../menu/context-menu';
import { windowStateOf } from '../window-state';
import type { Handle, IpcDeps } from './register';

export function registerUiIpc(handle: Handle, deps: IpcDeps): void {
  // Resolves when the native menu closes: the picked command (the renderer runs it with runPicked) or null.
  handle(Channels.ui.showContextMenu, showContextMenuInput, async (input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    if (input.kind !== 'item') return null; // collection/tag/column menus get their commands in M4–M5
    const ctx = deps.getContext();
    let targets: LibraryItem[] = input.itemIds.flatMap((id) => ctx.repo.getItem(id) ?? []);
    if (targets.length === 0) return null;
    if (targets.length === 1) {
      // Same check as library.get, so "다시 연결…" shows for a linked file that went missing this session.
      try {
        targets = [await refreshItemAvailability(ctx, targets[0]!.id)];
      } catch (e) {
        console.warn(`[ui] availability check failed: ${toLearnError(e).code}`); // fall back to the stored state
      }
    }
    const entries = contextMenuEntries('item', COMMANDS, deps.uiContext.current(), targets, process.platform);
    if (entries.length === 0) return null;
    const commandId = await popupCommandMenu(entries, { window, x: input.x, y: input.y });
    return commandId ? { commandId } : null;
  });

  // The main window's command context (ADR-0005 §2): main rebuilds the menu bar from it; other windows are ignored.
  handle(Channels.ui.reportContext, commandContextInput, (ctx, event) => {
    deps.uiContext.report(event.sender, ctx);
  });

  // The current state for a renderer that (re)mounts after the last push; the windowState push stays.
  handle(Channels.ui.windowState, emptyInput, (_input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) throw new LearnError('NOT_FOUND', '창을 찾을 수 없습니다.');
    return windowStateOf(window);
  });

  // Sheets hang over the main window only: a sheet (or the settings window) cannot open one over itself.
  const mainWindowOf = (sender: WebContents): BrowserWindow | null => {
    if (!deps.isMainWindow(sender)) throw new LearnError('PERMISSION_DENIED', '허용되지 않은 호출자입니다.');
    return BrowserWindow.fromWebContents(sender);
  };

  handle(Channels.ui.confirmDuplicate, confirmDuplicateInput, async ({ path: file, existingItemId }, event) => {
    const parent = mainWindowOf(event.sender);
    const existing = deps.getContext().repo.getItem(existingItemId);
    if (!parent || !existing) return { choice: 'skip' as const };
    // Files dropped from Finder leave Finder the active app: the question must not wait unseen on a background window.
    // A window already in front (the open panel's import, the next duplicate) is left to the system.
    if (!parent.isFocused()) parent.focus();
    const result = await deps.sheets.open(parent, {
      kind: 'duplicate',
      fileName: path.basename(file),
      existing: { title: existing.title, type: existing.type, size: existing.size, createdAt: existing.createdAt, storageMode: existing.storageMode },
    });
    return { choice: result?.kind === 'duplicate' ? result.choice : ('skip' as const) };
  });

  handle(Channels.ui.showShortcuts, emptyInput, async (_input, event) => {
    const parent = mainWindowOf(event.sender);
    if (parent) await deps.sheets.open(parent, { kind: 'shortcuts' });
  });

  // The main-owned app.settings (⌘,): also the fatal screen's 설정 열기, so it needs no library. From the main window or
  // the settings window only (a sheet has no reason to).
  handle(Channels.ui.openSettings, emptyInput, (_input, event) => {
    if (!deps.isMainWindow(event.sender) && !deps.isSettingsWindow(event.sender)) throw new LearnError('PERMISSION_DENIED', '허용되지 않은 호출자입니다.');
    deps.windows.openSettings();
  });
}
