import type { CommandId } from './commands';
import type { Prefs } from './settings';

export interface LearnEventMap {
  menuCommand: { commandId: CommandId };
  /** `availability`: a file was found missing (or back) when an item was opened or right-clicked. */
  libraryChanged: { reason: 'import' | 'relink' | 'metadata' | 'trash' | 'restore' | 'organize' | 'availability'; itemIds?: string[] };
  windowState: { fullscreen: boolean; focused: boolean };
  settingsChanged: { keys: string[] };
  prefsChanged: { prefs: Prefs };
}
