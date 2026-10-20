/** Channel names only — kept free of zod so the sandboxed preload bundle stays tiny. */
/** @deprecated removed in M2 Task 4 */
export const IpcChannels = {
  appInfo: 'app:info',
  pickAndImport: 'library:pickAndImport',
  importPaths: 'library:import',
  listItems: 'library:list',
  getItem: 'library:get',
  pickAndRelink: 'library:pickAndRelink',
  recoveryReport: 'library:recoveryReport',
} as const;

/** @deprecated removed in M2 Task 4 */
export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];

/** Namespaced request channels: every value is `ns:verb`. */
export const Channels = {
  app: { info: 'app:info' },
  library: {
    pickAndImport: 'library:pickAndImport', import: 'library:import', list: 'library:list', get: 'library:get',
    pickAndRelink: 'library:pickAndRelink', recoveryReport: 'library:recoveryReport', detail: 'library:detail',
    updateMetadata: 'library:updateMetadata', trash: 'library:trash', restore: 'library:restore', listTrash: 'library:listTrash',
    duplicateGroups: 'library:duplicateGroups',
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
  reader: { getPosition: 'reader:getPosition', savePosition: 'reader:savePosition' },
  ui: { showContextMenu: 'ui:showContextMenu' },
} as const;
