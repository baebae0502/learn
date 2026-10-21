import type { CommandId } from './commands';
import type { Prefs } from './settings';

/** The window's fullscreen/focus state: pushed on change (windowState event) and answered by `ui.windowState()`. */
export interface WindowState {
  fullscreen: boolean;
  focused: boolean;
}

export interface LearnEventMap {
  menuCommand: { commandId: CommandId };
  /**
   * Sent only when something changed. `itemIds`: the items that actually changed (absent when the change is not
   * per item, e.g. a collection or tag was created, renamed or removed).
   * `collections` / `tags`: the collection tree or memberships / the tag list or assignments changed.
   * `availability`: a file was found missing (or back) when an item was opened or right-clicked.
   */
  libraryChanged: {
    reason: 'import' | 'relink' | 'metadata' | 'trash' | 'restore' | 'collections' | 'tags' | 'availability';
    itemIds?: string[];
  };
  windowState: WindowState;
  settingsChanged: { keys: string[] };
  prefsChanged: { prefs: Prefs };
  /** A menu-bar menu opened or closed (the window stays key on macOS): tooltips close while one is open. */
  nativeMenu: { open: boolean };
}
