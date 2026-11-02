import { exposeSurface } from './surface';

/**
 * The settings window (SettingsApp): app info, the library location and 마지막 백업, the device prefs, its window state and the
 * theme it shows. It hears its window state, menu-bar menus, prefs changes and settingsChanged (backup.last), and subscribes to menuCommand and
 * demoShortcut for the demo overlay (main sends those to the main window only, so they never come here).
 */
exposeSurface({
  requests: { app: ['info', 'showLibraryFolder', 'chooseLibraryFolder', 'backupInfo', 'revealBackup'], prefs: ['get', 'set'], ui: ['windowState', 'themeShown'] },
  events: ['windowState', 'nativeMenu', 'prefsChanged', 'settingsChanged', 'menuCommand', 'demoShortcut'],
});
