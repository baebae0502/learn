import { exposeSurface } from './surface';

/**
 * The main window, and the gallery board tests load in it: all but the settings window's library location and the
 * sheets' own channels. Channels no page calls yet (collections, tags, trash, the library check) are this window's
 * (M5, M6) — and the fatal screen's 업데이트 전 백업. Equal to CHANNEL_KINDS' main entries (surfaces.test.ts).
 */
exposeSurface({
  requests: {
    app: ['info', 'revealUpdateBackup'],
    library: [
      'pickAndImport', 'import', 'cancelImport', 'list', 'get', 'pickAndRelink', 'detail', 'updateMetadata', 'trash', 'restore', 'trashView',
      'purge', 'emptyTrash', 'keepOneOfDuplicates', 'keepOneOfAllDuplicates', 'undoKeepOne',
      'duplicateGroups', 'showInFolder', 'openExternally', 'searchTexts', 'exportCopy', 'revealExport', 'organize', 'getItems', 'editedCopies', 'importEditedCopy', 'revealEditedCopy', 'check',
    ],
    collections: ['list', 'create', 'rename', 'move', 'remove', 'restore', 'addItems', 'removeItems'],
    tags: ['list', 'create', 'rename', 'setColor', 'remove', 'assign', 'unassign', 'togglePosition'],
    settings: ['get', 'set'],
    prefs: ['get', 'set'],
    reader: ['open', 'getPosition', 'savePosition'],
    search: ['body', 'pages', 'progress'],
    backup: ['create', 'cancel', 'restore'],
    translation: ['translate', 'cancel'],
    ui: ['showContextMenu', 'windowState', 'reportContext', 'confirm', 'confirmPurge', 'showShortcuts', 'openSettings', 'themeShown', 'showColumnMenu', 'reportIdle'],
  },
  events: ['menuCommand', 'libraryChanged', 'windowState', 'settingsChanged', 'prefsChanged', 'nativeMenu', 'demoShortcut', 'import:progress', 'import:finished', 'item:openRequested', 'recovery:show', 'job:progress', 'search:progress'],
  pathForFile: true,
});
