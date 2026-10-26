import type { CommandArgs, CommandId } from './commands';
import type { Prefs } from './settings';

/** The window's state as its renderer draws it: pushed on change (windowState event) and answered by `ui.windowState()`. */
export interface WindowState {
  fullscreen: boolean;
  /** The key window (macOS): rings, keyboard cursor and the accent selection only here. */
  focused: boolean;
  /**
   * One of our sheets (a sheet window or a native dialog) hangs on this window, from just before it shows until the
   * window is key again after it closed: the window is held (the main window's `blocked`).
   */
  sheetOpen: boolean;
  /**
   * AppKit's main window: key, or carrying one of our sheets while no other window of ours has the key. Only a window
   * that is not main dims its chrome (design-spec 2.1).
   */
  main: boolean;
}

/** Why `libraryChanged` was sent; the renderer decides from it what to read again. */
export type LibraryChangeReason =
  | 'import' | 'relink' | 'metadata' | 'trash' | 'restore' | 'collections' | 'tags' | 'availability' | 'opened';

export interface LearnEventMap {
  /** A menu-bar click or accelerator; `args` is the value of a submenu row (정렬 기준 › 연도). */
  menuCommand: { commandId: CommandId; args?: CommandArgs };
  /**
   * Sent only when something changed. `itemIds`: the items that actually changed (absent when the change is not
   * per item, e.g. a collection or tag was created, renamed or removed).
   * `collections` / `tags`: the collection tree or memberships / the tag list or assignments changed.
   * `availability`: a file was found missing (or back) when an item was opened or right-clicked.
   * `opened`: the reader opened the item, so its `openedAt` changed.
   */
  libraryChanged: {
    reason: LibraryChangeReason;
    itemIds?: string[];
  };
  windowState: WindowState;
  settingsChanged: { keys: string[] };
  prefsChanged: { prefs: Prefs };
  /** A menu-bar menu opened or closed (the window stays key on macOS): tooltips close while one is open. */
  nativeMenu: { open: boolean };
  /**
   * Demo recordings only (LEARN_DEMO_OVERLAY=1, unpackaged): a menu item that main runs itself — 설정… and the macOS
   * 전체 화면, which send no menuCommand — ran, so the demo overlay can show its shortcut. Never sent otherwise.
   */
  demoShortcut: { accelerator: string; label: string };
}
