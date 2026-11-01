/** Main -> renderer push channels. Names only (no zod) for the sandboxed preload. */
export const EventChannels = {
  menuCommand: 'evt:menu-command',
  libraryChanged: 'evt:library-changed',
  windowState: 'evt:window-state',
  settingsChanged: 'evt:settings-changed',
  prefsChanged: 'evt:prefs-changed',
  nativeMenu: 'evt:native-menu',
  demoShortcut: 'evt:demo-shortcut',
  'import:progress': 'evt:import-progress',
  'import:finished': 'evt:import-finished',
  'item:openRequested': 'evt:item-open-requested',
  'recovery:show': 'evt:recovery-show',
} as const;

export type EventChannel = (typeof EventChannels)[keyof typeof EventChannels];
