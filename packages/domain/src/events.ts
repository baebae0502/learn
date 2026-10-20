import type { CommandId } from './commands';
import type { Prefs } from './settings';

export interface LearnEventMap {
  menuCommand: { commandId: CommandId };
  libraryChanged: { reason: 'import' | 'relink' | 'metadata' | 'trash' | 'restore' | 'organize'; itemIds?: string[] };
  windowState: { fullscreen: boolean; focused: boolean };
  settingsChanged: { keys: string[] };
  prefsChanged: { prefs: Prefs };
}
