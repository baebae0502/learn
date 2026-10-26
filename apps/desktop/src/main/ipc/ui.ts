import path from 'node:path';
import { BrowserWindow, type WebContents } from 'electron';
import { COMMANDS, Channels, LearnError, commandContextInput, confirmDuplicateInput, emptyInput, showColumnMenuInput, showContextMenuInput, themeShownInput, toLearnError, type LibraryItem } from '@learn/domain';
import { refreshItemAvailability } from '../item-availability';
import { columnMenuEntries, popupColumnMenu } from '../menu/column-menu';
import { contextMenuEntries, popupCommandMenu } from '../menu/context-menu';
import { windowStateOf } from '../window-state';
import type { Handle, IpcDeps } from './register';
import { mainStrings } from '../strings';

export function registerUiIpc(handle: Handle, deps: IpcDeps): void {
  // Resolves when the native menu closes: the picked command (the renderer runs it with runPicked) or null.
  handle(Channels.ui.showContextMenu, showContextMenuInput, async (input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    if (input.kind !== 'item') return null; // collection and tag menus get their commands in M5
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

  // The table header's native menu: resolves the column to show or hide, a reset, or null when dismissed. Its items
  // are the column catalogue's; the renderer sends only which columns show and where the pointer is.
  handle(Channels.ui.showColumnMenu, showColumnMenuInput, async ({ visible, locked, x, y }, event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    return popupColumnMenu(columnMenuEntries(visible, mainStrings.columnMenu.reset, locked), { window, x, y });
  });

  // The main window's command context (ADR-0005 §2): main rebuilds the menu bar from it; other windows are ignored.
  handle(Channels.ui.reportContext, commandContextInput, (ctx, event) => {
    deps.uiContext.report(event.sender, ctx);
  });

  // The current state for a renderer that (re)mounts after the last push; the windowState push stays.
  handle(Channels.ui.windowState, emptyInput, (_input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || window.isDestroyed()) throw new LearnError('NOT_FOUND', mainStrings.windowGone);
    return windowStateOf(window);
  });

  // Sheets hang over the main window only: a sheet (or the settings window) cannot open one over itself.
  const mainWindowOf = (sender: WebContents): BrowserWindow | null => {
    if (!deps.isMainWindow(sender)) throw new LearnError('PERMISSION_DENIED', mainStrings.callerRefused);
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

  // The main-owned app.settings (⌘,) behind the fatal screen's 설정 열기: it needs no library. The main window only
  // (CHANNEL_KINDS): the settings window's own ⌘, is the menu's, which main runs itself.
  handle(Channels.ui.openSettings, emptyInput, (_input, event) => {
    if (!deps.isMainWindow(event.sender)) throw new LearnError('PERMISSION_DENIED', mainStrings.callerRefused);
    deps.windows.openSettings();
  });

  // The pages that draw the theme themselves (the main and the settings window) say when they show a change; the native
  // theme follows them (T13R4-m1). Sheets follow the native theme and report nothing.
  handle(Channels.ui.themeShown, themeShownInput, ({ shade }, event) => {
    if (!deps.isMainWindow(event.sender) && !deps.isSettingsWindow(event.sender)) throw new LearnError('PERMISSION_DENIED', mainStrings.callerRefused);
    deps.theme.shown(event.sender, shade);
  });

  // The settings window is prepared once the main window's page has drawn its first list and gone idle, never while
  // the app is still starting (spec 8). Only the main window's report counts.
  handle(Channels.ui.reportIdle, emptyInput, (_input, event) => {
    if (!deps.isMainWindow(event.sender)) throw new LearnError('PERMISSION_DENIED', mainStrings.callerRefused);
    deps.prepareSettings();
  });
}
