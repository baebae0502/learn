import { exposeSurface } from './surface';

/**
 * The main window, and the gallery board tests load in it: all but the settings window's library location and the
 * sheets' own channels. Channels no page calls yet (collections, tags, trash, the recovery report) are this window's
 * (M5, M6). Equal to CHANNEL_KINDS' main entries (surfaces.test.ts).
 */
exposeSurface({
  requests: {
    app: ['info'],
    library: [
      'pickAndImport', 'import', 'list', 'get', 'pickAndRelink', 'recoveryReport', 'detail', 'updateMetadata', 'trash', 'restore', 'listTrash',
      'duplicateGroups', 'showInFolder', 'openExternally', 'searchTexts', 'exportCopy', 'revealExport',
    ],
    collections: ['list', 'create', 'rename', 'move', 'remove', 'restore', 'addItems', 'removeItems'],
    tags: ['list', 'create', 'rename', 'setColor', 'remove', 'assign', 'unassign', 'togglePosition'],
    settings: ['get', 'set'],
    prefs: ['get', 'set'],
    reader: ['open', 'getPosition', 'savePosition'],
    ui: ['showContextMenu', 'windowState', 'reportContext', 'confirmDuplicate', 'showShortcuts', 'openSettings', 'themeShown', 'showColumnMenu'],
  },
  events: ['menuCommand', 'libraryChanged', 'windowState', 'settingsChanged', 'prefsChanged', 'nativeMenu', 'demoShortcut'],
  pathForFile: true,
});
