import { BrowserWindow, dialog, type MessageBoxOptions, type WebContents } from 'electron';
import { readOrganizeSnapshot } from '@learn/db';
import { displayFileName } from '@learn/library';
import {
  COMMANDS, Channels, LearnError, SUBMENUS, commandContextInput, confirmDuplicateInput, confirmInput, emptyInput, itemTarget, showColumnMenuInput, showContextMenuInput, themeShownInput, toLearnError,
  type CommandTargetInfo,
} from '@learn/domain';
import { refreshItemAvailability } from '../item-availability';
import { columnMenuEntries, popupColumnMenu } from '../menu/column-menu';
import { contextMenuEntries, kindHasMenu, popupCommandMenu } from '../menu/context-menu';
import { menuNeedsOrganize } from '../menu/submenus';
import { windowStateOf } from '../window-state';
import type { Handle, IpcDeps } from './register';
import { mainStrings } from '../strings';

export function registerUiIpc(handle: Handle, deps: IpcDeps): void {
  // Resolves when the native menu closes: the picked command with its row's value (the renderer runs it with runPicked) or null.
  handle(Channels.ui.showContextMenu, showContextMenuInput, async (input, event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return null;
    // A kind no registry command lists has no menu: answered before anything is read.
    if (!kindHasMenu(input.kind, COMMANDS, SUBMENUS)) return null;
    const ctx = deps.getContext();
    // Collections, tags and who has what: one read, and only when this menu has a submenu built from them or needs its targets.
    const organize = input.kind !== 'item' || menuNeedsOrganize(COMMANDS, SUBMENUS, 'item') ? readOrganizeSnapshot(ctx.db) : null;
    let targets: CommandTargetInfo[];
    let itemIds: string[] = [];
    let tagId: string | undefined;
    if (input.kind === 'item') {
      // One query for the whole selection, in the order asked (the old read per id made ⌘A on 10 000 rows 10 000 reads);
      // the menu needs two facts per item, so the rest of an item (metadata, revision, position) is not read.
      let facts = ctx.repo.targetFacts(input.itemIds);
      if (facts.length === 0) return null;
      if (facts.length === 1) {
        // Same check as library.get, so "다시 연결…" shows for a linked file that went missing this session.
        try {
          const item = await refreshItemAvailability(ctx, facts[0]!.id);
          facts = [{ id: item.id, storageMode: item.storageMode, availability: item.availability }];
        } catch (e) {
          console.warn(`[ui] availability check failed: ${toLearnError(e).code}`); // fall back to the stored state
        }
      }
      targets = facts.map((f) => itemTarget(f));
      itemIds = facts.map((f) => f.id);
    } else if (input.kind === 'collection') {
      const live = new Set(organize!.collections.map((c) => c.id));
      targets = input.collectionIds.filter((id) => live.has(id)).map((id) => ({ kind: 'collection', id }));
    } else {
      const known = new Map(organize!.tags.map((t) => [t.id, t]));
      const asked = input.tagIds.flatMap((id) => known.get(id) ?? []);
      targets = asked.map((t) => ({ kind: 'tag', id: t.id, hasColor: t.color !== null }));
      tagId = asked[0]?.id;
    }
    if (targets.length === 0) return null;
    const entries = contextMenuEntries(input.kind, COMMANDS, deps.uiContext.current(), targets, process.platform, {
      organize,
      itemIds,
      ...(tagId !== undefined ? { tagId } : {}),
    });
    if (entries.length === 0) return null;
    return popupCommandMenu(entries, { window, x: input.x, y: input.y });
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
      fileName: displayFileName(file),
      existing: { title: existing.title, type: existing.type, size: existing.size, createdAt: existing.createdAt, storageMode: existing.storageMode },
      // The renderer asks one file at a time on this path: there is no rest to answer for.
      remaining: 0,
    });
    return { choice: result?.kind === 'duplicate' ? result.choice : ('skip' as const) };
  });

  // A native question in the renderer's words (deleting a collection, merging or deleting a tag): a sheet on the main
  // window, the confirming button first and the default, 취소 after it (esc).
  handle(Channels.ui.confirm, confirmInput, async ({ message, detail, confirm, caution }, event) => {
    const parent = mainWindowOf(event.sender);
    if (!parent) return false;
    const ask: MessageBoxOptions = {
      // The caution symbol is for what cannot be undone and loses data; the other questions show the app icon.
      type: caution ? 'warning' : 'none',
      message,
      ...(detail ? { detail } : {}),
      buttons: [confirm, mainStrings.confirmSheet.cancel],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    };
    const { response } = await deps.windows.asSheet(parent, () => dialog.showMessageBox(parent, ask));
    return response === 0;
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
