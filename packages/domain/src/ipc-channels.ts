/**
 * Namespaced request channels: every value is `ns:verb`.
 * Names only — kept free of zod so the sandboxed preload bundle stays tiny.
 */
export const Channels = {
  app: { info: 'app:info', showLibraryFolder: 'app:showLibraryFolder', chooseLibraryFolder: 'app:chooseLibraryFolder' },
  library: {
    pickAndImport: 'library:pickAndImport', import: 'library:import', list: 'library:list', get: 'library:get',
    pickAndRelink: 'library:pickAndRelink', recoveryReport: 'library:recoveryReport', detail: 'library:detail',
    updateMetadata: 'library:updateMetadata', trash: 'library:trash', restore: 'library:restore', listTrash: 'library:listTrash',
    duplicateGroups: 'library:duplicateGroups', showInFolder: 'library:showInFolder', openExternally: 'library:openExternally',
    exportCopy: 'library:exportCopy', revealExport: 'library:revealExport',
    searchTexts: 'library:searchTexts', organize: 'library:organize', getItems: 'library:getItems',
  },
  collections: {
    list: 'collections:list', create: 'collections:create', rename: 'collections:rename', move: 'collections:move',
    remove: 'collections:remove', restore: 'collections:restore', addItems: 'collections:addItems', removeItems: 'collections:removeItems',
  },
  tags: {
    list: 'tags:list', create: 'tags:create', rename: 'tags:rename', setColor: 'tags:setColor', remove: 'tags:remove',
    assign: 'tags:assign', unassign: 'tags:unassign', togglePosition: 'tags:togglePosition',
  },
  settings: { get: 'settings:get', set: 'settings:set' },
  prefs: { get: 'prefs:get', set: 'prefs:set' },
  reader: { open: 'reader:open', getPosition: 'reader:getPosition', savePosition: 'reader:savePosition' },
  ui: {
    showContextMenu: 'ui:showContextMenu', windowState: 'ui:windowState', reportContext: 'ui:reportContext', confirmDuplicate: 'ui:confirmDuplicate',
    showShortcuts: 'ui:showShortcuts', openSettings: 'ui:openSettings', themeShown: 'ui:themeShown', reportIdle: 'ui:reportIdle', showColumnMenu: 'ui:showColumnMenu',
  },
  sheet: { payload: 'sheet:payload', resolve: 'sheet:resolve' },
} as const;
