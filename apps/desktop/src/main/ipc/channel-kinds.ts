import type { WindowKind } from '../window-kinds';
import type { Channel } from './register';

const MAIN: readonly WindowKind[] = ['main'];
const SETTINGS: readonly WindowKind[] = ['settings'];
const MAIN_AND_SETTINGS: readonly WindowKind[] = ['main', 'settings'];
const SHEET: readonly WindowKind[] = ['sheet'];

/**
 * The window kinds that may call each channel. createHandle refuses any other sender — by the kind main gave its
 * webContents when it created the window (window-kinds.ts) — the way it refuses a foreign page. Each window's preload
 * exposes exactly its kind's channels (preload/surfaces.test.ts holds the two together).
 *
 * - main: the library window — all but the settings window's library location and the sheets' own channels. Channels
 *   no page calls yet (collections, tags, trash, the recovery report) are the main window's (M5, M6).
 * - settings: what SettingsApp calls. Not ui.openSettings: its ⌘, is the menu's, which main runs itself.
 * - sheet: its payload and its answer.
 */
export const CHANNEL_KINDS: Readonly<Record<Channel, readonly WindowKind[]>> = {
  'app:info': MAIN_AND_SETTINGS,
  'app:showLibraryFolder': SETTINGS,
  'app:chooseLibraryFolder': SETTINGS,

  'library:pickAndImport': MAIN,
  'library:import': MAIN,
  'library:list': MAIN,
  'library:get': MAIN,
  'library:pickAndRelink': MAIN,
  'library:recoveryReport': MAIN,
  'library:detail': MAIN,
  'library:updateMetadata': MAIN,
  'library:trash': MAIN,
  'library:restore': MAIN,
  'library:listTrash': MAIN,
  'library:duplicateGroups': MAIN,
  'library:showInFolder': MAIN,
  'library:openExternally': MAIN,
  'library:searchTexts': MAIN,
  'library:organize': MAIN,
  'library:getItems': MAIN,
  'library:exportCopy': MAIN,
  'library:revealExport': MAIN,

  'collections:list': MAIN,
  'collections:create': MAIN,
  'collections:rename': MAIN,
  'collections:move': MAIN,
  'collections:remove': MAIN,
  'collections:restore': MAIN,
  'collections:addItems': MAIN,
  'collections:removeItems': MAIN,

  'tags:list': MAIN,
  'tags:create': MAIN,
  'tags:rename': MAIN,
  'tags:setColor': MAIN,
  'tags:remove': MAIN,
  'tags:assign': MAIN,
  'tags:unassign': MAIN,
  'tags:togglePosition': MAIN,

  'settings:get': MAIN,
  'settings:set': MAIN,

  'prefs:get': MAIN_AND_SETTINGS,
  'prefs:set': MAIN_AND_SETTINGS,

  'reader:open': MAIN,
  'reader:getPosition': MAIN,
  'reader:savePosition': MAIN,

  'ui:showContextMenu': MAIN,
  'ui:windowState': MAIN_AND_SETTINGS,
  'ui:reportContext': MAIN,
  'ui:confirmDuplicate': MAIN,
  'ui:confirm': MAIN,
  'ui:showShortcuts': MAIN,
  'ui:openSettings': MAIN,
  'ui:themeShown': MAIN_AND_SETTINGS,
  'ui:showColumnMenu': MAIN,
  'ui:reportIdle': MAIN,

  'sheet:payload': SHEET,
  'sheet:resolve': SHEET,
};
