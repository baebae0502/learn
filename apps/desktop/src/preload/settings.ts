import { exposeSurface } from './surface';

/**
 * The settings window (SettingsApp): app info and the library location, the device prefs, its window state and the
 * theme it shows. It hears its window state, menu-bar menus and prefs changes, and subscribes to menuCommand and
 * demoShortcut for the demo overlay (main sends those to the main window only, so they never come here).
 */
exposeSurface({
  requests: { app: ['info', 'showLibraryFolder', 'chooseLibraryFolder'], prefs: ['get', 'set'], ui: ['windowState', 'themeShown'] },
  events: ['windowState', 'nativeMenu', 'prefsChanged', 'menuCommand', 'demoShortcut'],
});
