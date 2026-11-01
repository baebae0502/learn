import { describe, expect, it } from 'vitest';
import {
  CONTEXT_MENU_KINDS, LIBRARY_COLUMNS, LIBRARY_COLUMN_IDS, NO_LIBRARY_VIEW, SETTINGS, TRASH_COLUMNS, TRASH_TARGET,
  availableMenuCommands, commandById, commandContextInput, commandLabel, confirmPurgeInput, isCommandAvailable, libraryScopeSchema,
  paletteLabel, parseSetting, selectionTargets, sheetResultInput, showContextMenuInput,
  type CommandContextState, type CommandTargetInfo,
} from '../src/index';

const ID = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
const COL = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const base: CommandContextState = { view: 'library', blocked: false, textSize: 13, libraryCount: 9, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW };
const LIVE: CommandTargetInfo = { kind: 'item', storageMode: 'managed', availability: 'available' };
const inTrash = (over: Partial<CommandContextState> = {}): CommandContextState => ({ ...base, scope: 'trash', trashCount: 3, ...over });

describe('the trash commands (spec 11.1, P-10, P-11)', () => {
  it('item.trash: ⌘⌫, 파일\'s last group after 휴지통 비우기…, last in the item and trash menus, in the palette', () => {
    expect(commandById('item.trash')).toMatchObject({
      label: '휴지통으로 이동', accelerator: 'CmdOrCtrl+Backspace', contexts: ['item', 'trash'], palette: true,
      menu: { menu: 'file', group: 4, order: 2 }, contextMenu: { kinds: ['item', 'trash'], group: 4, order: 1 },
      stateLabels: { scope: { trash: '영구 삭제…' } },
    });
    expect(commandById('trash.empty')).toMatchObject({ label: '휴지통 비우기…', accelerator: 'Shift+CmdOrCtrl+Backspace', contexts: ['library'], menu: { menu: 'file', group: 4, order: 1 } });
    expect(commandById('item.restore')).toMatchObject({ label: '복원', contexts: ['trash'], palette: true, contextMenu: { kinds: ['trash'], group: 1, order: 1 } });
    expect(commandById('item.restore').accelerator).toBeUndefined();
    expect(commandById('item.restore').menu).toBeUndefined();
    expect(CONTEXT_MENU_KINDS).toContain('trash');
  });

  it('collection.delete is 휴지통으로 이동 now (spec 4.2), told apart from the items\' in the palette', () => {
    const c = commandById('collection.delete');
    expect(c.label).toBe('휴지통으로 이동');
    expect(paletteLabel(c, 'darwin')).toBe('컬렉션을 휴지통으로 이동');
  });

  it('⌘⌫ is one line named by the view: 영구 삭제… in the trash, 휴지통으로 이동 elsewhere and where no view is known (P-11)', () => {
    const c = commandById('item.trash');
    for (const platform of ['darwin', 'linux']) {
      expect(commandLabel(c, platform, { scope: 'trash' })).toBe('영구 삭제…');
      for (const scope of ['all', 'recent', 'unfiled', 'duplicates', 'collection'] as const) expect(commandLabel(c, platform, { scope })).toBe('휴지통으로 이동');
      expect(commandLabel(c, platform)).toBe('휴지통으로 이동');
    }
    // No other command's name follows the view.
    expect(commandLabel(commandById('item.open'), 'darwin', { scope: 'trash' })).toBe('열기');
    expect(commandLabel(commandById('view.toggleSidebar'), 'darwin', { scope: 'trash', sidebar: 'shown' })).toBe('사이드바 가리기');
  });

  it('outside the trash ⌘⌫ needs live items in the library view; in the trash it takes trash rows and nothing else', () => {
    expect(isCommandAvailable('item.trash', base, [LIVE])).toBe(true);
    expect(isCommandAvailable('item.trash', base, [])).toBe(false);
    expect(isCommandAvailable('item.trash', { ...base, view: 'viewer' }, [LIVE])).toBe(false);
    expect(isCommandAvailable('item.trash', base, [TRASH_TARGET])).toBe(false);
    expect(isCommandAvailable('item.trash', inTrash(), [TRASH_TARGET])).toBe(true);
    expect(isCommandAvailable('item.trash', inTrash(), [LIVE])).toBe(false);
    expect(isCommandAvailable('item.trash', inTrash({ blocked: true }), [TRASH_TARGET])).toBe(false);
  });

  it('복원 needs trash rows in the trash view; the item commands get no target there (opening is off, spec 4.3)', () => {
    expect(isCommandAvailable('item.restore', inTrash(), [TRASH_TARGET, TRASH_TARGET])).toBe(true);
    expect(isCommandAvailable('item.restore', inTrash(), [])).toBe(false);
    expect(isCommandAvailable('item.restore', base, [TRASH_TARGET])).toBe(false);
    for (const id of ['item.open', 'item.showInFolder', 'item.exportCopy', 'item.editInfo', 'collection.addItems', 'tag.color1'] as const) {
      expect(isCommandAvailable(id, inTrash(), [TRASH_TARGET]), id).toBe(false);
    }
    // The sidebar's collection commands still work while the trash view shows.
    expect(isCommandAvailable('collection.rename', inTrash(), [{ kind: 'collection', id: COL }])).toBe(true);
  });

  it('휴지통 비우기… while the trash has something, in the library view (trashCount, P-10)', () => {
    expect(isCommandAvailable('trash.empty', { ...base, trashCount: 1 })).toBe(true);
    expect(isCommandAvailable('trash.empty', { ...base, trashCount: 0 })).toBe(false);
    expect(isCommandAvailable('trash.empty', { ...base, trashCount: 4, view: 'viewer' })).toBe(false);
    expect(NO_LIBRARY_VIEW.trashCount).toBe(0);
  });

  it('the menu bar judges the reported selection in the trash as trash rows (selectionTargets)', () => {
    const ctx = inTrash({ selectionCount: 2 });
    expect(selectionTargets(ctx)).toEqual([TRASH_TARGET, TRASH_TARGET]);
    const menu = availableMenuCommands(ctx);
    expect(menu).toContain('item.trash');
    expect(menu).toContain('trash.empty');
    expect(menu).not.toContain('item.showInFolder');
    expect(availableMenuCommands(inTrash({ selectionCount: 0 }))).not.toContain('item.trash');
    expect(availableMenuCommands({ ...base, selectionCount: 1, selectionAvailable: 1 })).toContain('item.trash');
  });
});

describe('the trash view in the domain (P-7, spec 4.3)', () => {
  it('a stored view may be the trash', () => {
    expect(libraryScopeSchema.parse({ kind: 'trash' })).toEqual({ kind: 'trash' });
    expect(libraryScopeSchema.safeParse({ kind: 'trash', id: ID }).success).toBe(false);
  });
  it('삭제한 날짜: the last catalogue column, sortable, drawn only by the trash view, with a sort of its own', () => {
    expect(LIBRARY_COLUMN_IDS.at(-1)).toBe('deletedAt');
    expect(LIBRARY_COLUMNS.find((c) => c.id === 'deletedAt')).toEqual({ id: 'deletedAt', label: '삭제한 날짜', defaultVisible: false, defaultWidth: 132, minWidth: 112, align: 'start', trashOnly: true });
    expect(LIBRARY_COLUMNS.filter((c) => c.trashOnly).map((c) => c.id)).toEqual(['deletedAt']);
    expect(TRASH_COLUMNS).toEqual(['deletedAt']);
    expect(Object.hasOwn(SETTINGS, 'library.sort.trash')).toBe(true);
    expect(parseSetting('library.sort.trash', { column: 'deletedAt', direction: 'desc' })).toEqual({ column: 'deletedAt', direction: 'desc' });
  });
});

describe('the trash over IPC (P-10, P-25)', () => {
  it('the reported context takes the trash scope and its count; the count is required', () => {
    const ctx = inTrash({ selectionCount: 1 });
    expect(commandContextInput.parse(ctx)).toEqual(ctx);
    for (const bad of [-1, 1.5, '3']) expect(commandContextInput.safeParse({ ...ctx, trashCount: bad }).success, String(bad)).toBe(false);
    const { trashCount: _dropped, ...without } = ctx;
    expect(commandContextInput.safeParse(without).success).toBe(false);
  });
  it('the trash rows\' menu: items and collections, either list may be empty', () => {
    expect(showContextMenuInput.parse({ kind: 'trash', itemIds: [ID], collectionIds: [], x: 1, y: 2 })).toEqual({ kind: 'trash', itemIds: [ID], collectionIds: [], x: 1, y: 2 });
    expect(showContextMenuInput.safeParse({ kind: 'trash', itemIds: [], collectionIds: [COL], x: 1, y: 2 }).success).toBe(true);
    expect(showContextMenuInput.safeParse({ kind: 'trash', itemIds: ['x'], collectionIds: [], x: 1, y: 2 }).success).toBe(false);
    expect(showContextMenuInput.safeParse({ kind: 'trash', itemIds: [ID], x: 1, y: 2 }).success).toBe(false);
  });
  it('the purge sheet\'s question and its answer (P-25)', () => {
    expect(confirmPurgeInput.parse({ variant: 'mixed', items: 3, collections: 1 })).toEqual({ variant: 'mixed', items: 3, collections: 1 });
    for (const bad of [{ variant: 'all', items: 1, collections: 0 }, { variant: 'items', items: -1, collections: 0 }, { variant: 'items', items: 1, collections: 0, extra: true }, { variant: 'items', items: 1 }]) {
      expect(confirmPurgeInput.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(sheetResultInput.parse({ kind: 'purge', confirmed: true })).toEqual({ kind: 'purge', confirmed: true });
    expect(sheetResultInput.safeParse({ kind: 'purge' }).success).toBe(false);
  });
});
