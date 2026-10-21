/** Main -> renderer push channels. Names only (no zod) for the sandboxed preload. */
export const EventChannels = {
  menuCommand: 'evt:menu-command',
  libraryChanged: 'evt:library-changed',
  windowState: 'evt:window-state',
  settingsChanged: 'evt:settings-changed',
  prefsChanged: 'evt:prefs-changed',
  nativeMenu: 'evt:native-menu',
} as const;

export type EventChannel = (typeof EventChannels)[keyof typeof EventChannels];
