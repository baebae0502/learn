import { describe, expect, it, vi } from 'vitest';
import { COMMANDS, NO_LIBRARY_VIEW, type CommandId, type CommandTargetInfo } from '@learn/domain';
import { COMMAND_HANDLERS, contextOf, isCommandEnabled, menuTarget, reportedContext, runCommand, runPicked, type CommandEnv, type CommandTarget } from './registry';

const ID = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
const OTHER = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
/** An empty library with nothing selected, as every report starts: the counts and the default library view. */
const COUNTS = { libraryCount: 0, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW } as const;
const missingLinked: CommandTargetInfo = { kind: 'item', storageMode: 'linked', availability: 'missing' };
/** The items of a target, all with a file there. */
const available = (target: CommandTarget): CommandTargetInfo[] => (target.itemIds ?? []).map(() => ({ kind: 'item', storageMode: 'managed', availability: 'available' }));
const env = (over: Partial<CommandEnv> = {}): CommandEnv => ({
  view: 'library',
  blocked: false,
  textSize: 13,
  ...COUNTS,
  selection: () => [],
  targetsOf: (target) => (target.itemIds ?? []).map(() => missingLinked),
  importFiles: vi.fn(),
  newCollection: vi.fn(),
  renameCollection: vi.fn(),
  deleteCollection: vi.fn(),
  toggleTagPosition: vi.fn(),
  renameTag: vi.fn(),
  setTagColor: vi.fn(),
  clearTagColor: vi.fn(),
  deleteTag: vi.fn(),
  clearTagFilter: vi.fn(),
  back: vi.fn(),
  open: vi.fn(),
  relink: vi.fn(),
  toggleSidebar: vi.fn(),
  toggleInspector: vi.fn(),
  showShortcuts: vi.fn(),
  openPalette: vi.fn(),
  showInFolder: vi.fn(),
  openExternally: vi.fn(),
  exportCopy: vi.fn(),
  editInfo: vi.fn(),
  addToCollection: vi.fn(),
  removeFromCollection: vi.fn(),
  focusSearch: vi.fn(),
  findEverywhere: vi.fn(),
  sortBy: vi.fn(),
  openSettings: vi.fn(),
  setTextSize: vi.fn(),
  focusPane: vi.fn(),
  modal: false,
  ...over,
});

describe('renderer command registry', () => {
  it('has a handler for every registry command and nothing else (no fake controls)', () => {
    expect(Object.keys(COMMAND_HANDLERS).sort()).toEqual(COMMANDS.map((c) => c.id).sort());
  });
  it('reports only the context fields, never the handlers', () => {
    expect(contextOf(env({ view: 'viewer' }))).toEqual({ view: 'viewer', blocked: false, textSize: 13, ...COUNTS });
    expect(contextOf(env({ textSize: 15, sidebar: 'hidden' }))).toEqual({ view: 'library', blocked: false, textSize: 15, sidebar: 'hidden', ...COUNTS });
  });
  it('reports the library and selection counts and the item panel state, never the selected ids (P-2)', () => {
    const e = env({ inspector: 'shown', libraryCount: 48, selectionCount: 3, selectionAvailable: 2, selectionRelinkable: 1, selection: () => [ID, OTHER] });
    expect(contextOf(e)).toEqual({ view: 'library', blocked: false, textSize: 13, inspector: 'shown', libraryCount: 48, selectionCount: 3, selectionAvailable: 2, selectionRelinkable: 1, ...NO_LIBRARY_VIEW });
    expect(contextOf(e)).not.toHaveProperty('selection');
  });
  it('runs a menu-bar item command on the table selection, in table order, in the library view only (P-2, spec 6)', () => {
    const one = env({ selection: () => [ID], targetsOf: available });
    expect(menuTarget('item.showInFolder', one)).toEqual({ itemIds: [ID] });
    expect(menuTarget('file.importManaged', one)).toEqual({});
    expect(menuTarget('file.nope' as CommandId, one)).toEqual({});
    expect(runCommand('item.showInFolder', one, menuTarget('item.showInFolder', one))).toBe(true);
    expect(one.showInFolder).toHaveBeenCalledWith(ID);
    // Two selected: a one-item command is refused (main has its menu item disabled too).
    const two = env({ selection: () => [ID, OTHER], targetsOf: available });
    expect(menuTarget('item.openExternally', two)).toEqual({ itemIds: [ID, OTHER] });
    expect(runCommand('item.openExternally', two, menuTarget('item.openExternally', two))).toBe(false);
    // Nothing selected (the table reports none yet), or the reader, which shows no table: nothing to act on.
    const none = env({ targetsOf: available });
    expect(runCommand('item.showInFolder', none, menuTarget('item.showInFolder', none))).toBe(false);
    const reader = env({ view: 'viewer', selection: () => [ID], targetsOf: available });
    expect(menuTarget('item.showInFolder', reader)).toEqual({ itemIds: [] });
    expect(runCommand('item.showInFolder', reader, menuTarget('item.showInFolder', reader))).toBe(false);
    expect(two.openExternally).not.toHaveBeenCalled();
    expect(none.showInFolder).not.toHaveBeenCalled();
    expect(reader.showInFolder).not.toHaveBeenCalled();
  });
  it('runs the collection commands on the one collection handed over; the library menu command on none; the import needs the library view', () => {
    const targetsOf = (t: { collectionIds?: readonly string[] }): CommandTargetInfo[] => (t.collectionIds ?? []).map((id) => ({ kind: 'collection', id }));
    const e = env({ targetsOf });
    expect(runCommand('collection.new', e)).toBe(true);
    expect(e.newCollection).toHaveBeenLastCalledWith();
    expect(runCommand('collection.newChild', e, { collectionIds: ['c1'] })).toBe(true);
    expect(e.newCollection).toHaveBeenLastCalledWith({ parentId: 'c1' });
    expect(runCommand('collection.rename', e, { collectionIds: ['c1'] })).toBe(true);
    expect(e.renameCollection).toHaveBeenCalledWith('c1');
    expect(runCommand('collection.importInto', e, { collectionIds: ['c1'] })).toBe(true);
    expect(e.importFiles).toHaveBeenLastCalledWith('managed', 'c1');
    expect(runCommand('collection.delete', e, { collectionIds: ['c1'] })).toBe(true);
    expect(e.deleteCollection).toHaveBeenCalledWith('c1');
    // none or two collections: refused
    expect(runCommand('collection.rename', e)).toBe(false);
    expect(runCommand('collection.delete', e, { collectionIds: ['a', 'b'] })).toBe(false);
    // the reader: the sidebar beside it renames and deletes, but nothing is imported into a collection and no library menu command runs
    const viewer = env({ view: 'viewer', targetsOf });
    expect(runCommand('collection.new', viewer)).toBe(false);
    expect(runCommand('collection.importInto', viewer, { collectionIds: ['c1'] })).toBe(false);
    expect(runCommand('collection.rename', viewer, { collectionIds: ['c1'] })).toBe(true);
    // a context-menu pick runs with the target the menu was opened for
    expect(runPicked({ commandId: 'collection.delete' }, e, { collectionIds: ['c2'] })).toBe(true);
    expect(e.deleteCollection).toHaveBeenLastCalledWith('c2');
  });
  it('runs a colour key on the items handed over — any slot, in the library view with a selection — and the chip commands on the tag handed over', () => {
    const targetsOf = (t: { itemIds?: readonly string[]; tagIds?: readonly string[] }): CommandTargetInfo[] => [
      ...(t.itemIds ?? []).map((): CommandTargetInfo => ({ kind: 'item', storageMode: 'managed', availability: 'available' })),
      ...(t.tagIds ?? []).map((id): CommandTargetInfo => ({ kind: 'tag', id, hasColor: id === 'coloured' })),
    ];
    const e = env({ targetsOf, selection: () => [ID, OTHER] });
    expect(runCommand('tag.color3', e, menuTarget('tag.color3', e))).toBe(true);
    expect(e.toggleTagPosition).toHaveBeenCalledExactlyOnceWith(3, [ID, OTHER]);
    // Nothing selected, or the reader (no table): refused — the key map then leaves the key alone.
    const none = env({ targetsOf });
    expect(runCommand('tag.color1', none, menuTarget('tag.color1', none))).toBe(false);
    const reader = env({ view: 'viewer', targetsOf, selection: () => [ID] });
    expect(runCommand('tag.color1', reader, menuTarget('tag.color1', reader))).toBe(false);
    // The chip's commands act on the one tag handed over; 색 해제 needs a colour.
    expect(runCommand('tag.rename', e, { tagIds: ['t1'] })).toBe(true);
    expect(e.renameTag).toHaveBeenCalledExactlyOnceWith('t1');
    expect(runCommand('tag.delete', e, { tagIds: ['t1'] })).toBe(true);
    expect(e.deleteTag).toHaveBeenCalledExactlyOnceWith('t1');
    expect(runCommand('tag.clearColor', e, { tagIds: ['plain'] })).toBe(false);
    expect(runCommand('tag.clearColor', e, { tagIds: ['coloured'] })).toBe(true);
    expect(e.clearTagColor).toHaveBeenCalledExactlyOnceWith('coloured');
    // A picked row of 색 지정 ▸ carries its slot; the head without a row does nothing.
    expect(runPicked({ commandId: 'tag.setColor', args: { position: 3 } }, e, { tagIds: ['t1'] })).toBe(true);
    expect(e.setTagColor).toHaveBeenCalledExactlyOnceWith('t1', 3);
    runPicked({ commandId: 'tag.setColor' }, e, { tagIds: ['t1'] });
    expect(e.setTagColor).toHaveBeenCalledTimes(1);
    // 태그 선택 해제 runs only while a filter is set.
    expect(runCommand('tags.clearFilter', e)).toBe(false);
    const filtered = env({ tagFilterCount: 2 });
    expect(runCommand('tags.clearFilter', filtered)).toBe(true);
    expect(filtered.clearTagFilter).toHaveBeenCalledOnce();
  });
  it('runs through the shared availability predicate', () => {
    const lib = env();
    expect(runCommand('file.importManaged', lib)).toBe(true);
    expect(runCommand('file.importLinked', lib)).toBe(true);
    expect(lib.importFiles).toHaveBeenNthCalledWith(1, 'managed');
    expect(lib.importFiles).toHaveBeenNthCalledWith(2, 'linked');
    expect(runCommand('nav.back', lib)).toBe(false);
    const viewer = env({ view: 'viewer' });
    expect(runCommand('nav.back', viewer)).toBe(true);
    expect(viewer.back).toHaveBeenCalledTimes(1);
  });
  it('⌃⌘S toggles the sidebar in every view, but not while the window is blocked', () => {
    for (const view of ['library', 'viewer'] as const) {
      const e = env({ view });
      expect(runCommand('view.toggleSidebar', e)).toBe(true);
      expect(e.toggleSidebar).toHaveBeenCalledTimes(1);
    }
    const blocked = env({ blocked: true });
    expect(runCommand('view.toggleSidebar', blocked)).toBe(false);
    expect(blocked.toggleSidebar).not.toHaveBeenCalled();
  });
  it('⌘/ opens the shortcut sheet in every view, but not while the window is blocked (a sheet is already up)', () => {
    for (const view of ['library', 'viewer'] as const) {
      const e = env({ view });
      expect(runCommand('app.shortcuts', e)).toBe(true);
      expect(e.showShortcuts).toHaveBeenCalledTimes(1);
    }
    const blocked = env({ blocked: true });
    expect(runCommand('app.shortcuts', blocked)).toBe(false);
    expect(blocked.showShortcuts).not.toHaveBeenCalled();
  });
  it('⌘K opens the palette in every view, but not while the window is blocked (an import or a sheet holds it)', () => {
    for (const view of ['library', 'viewer'] as const) {
      const e = env({ view });
      expect(runCommand('app.palette', e)).toBe(true);
      expect(e.openPalette).toHaveBeenCalledTimes(1);
    }
    const blocked = env({ blocked: true });
    expect(runCommand('app.palette', blocked)).toBe(false);
    expect(blocked.openPalette).not.toHaveBeenCalled();
  });
  it('F6 / ⇧F6 move to the next / previous pane in every view and during an import, never under a modal surface', () => {
    for (const view of ['library', 'viewer'] as const) {
      const e = env({ view });
      expect(runCommand('view.nextPane', e)).toBe(true);
      expect(runCommand('view.previousPane', e)).toBe(true);
      expect(vi.mocked(e.focusPane).mock.calls).toEqual([[1], [-1]]);
    }
    // An import holds the window (blocked, nothing modal): F6 still moves the focus (Task 12 polish ruling).
    const importing = env({ blocked: true });
    expect(runCommand('view.nextPane', importing)).toBe(true);
    expect(importing.focusPane).toHaveBeenCalledWith(1);
    // A sheet, the palette or the drop overlay owns the keyboard: nothing moves.
    for (const e of [env({ blocked: true, modal: true }), env({ modal: true })]) {
      expect(runCommand('view.nextPane', e)).toBe(false);
      expect(runCommand('view.previousPane', e)).toBe(false);
      expect(e.focusPane).not.toHaveBeenCalled();
    }
    expect(contextOf(env({ modal: true }))).not.toHaveProperty('modal'); // never reported: main's blocked is unchanged
  });
  it('⌘, opens the settings window in every view, even while the window is blocked (main-owned)', () => {
    for (const e of [env(), env({ view: 'viewer' }), env({ blocked: true })]) {
      expect(runCommand('app.settings', e)).toBe(true);
      expect(e.openSettings).toHaveBeenCalledTimes(1);
    }
  });
  it('steps the text size: ⌘+ / ⌘− one point within 12–15 from the latest size (a functional update), ⌘0 back to 13, in the library only', () => {
    const at = (textSize: 12 | 13 | 14 | 15, view: 'library' | 'viewer' = 'library') => env({ textSize, view });
    /** The update a command passed, applied to `current` (the newest size, which may be ahead of env.textSize). */
    const applied = (e: CommandEnv, current: 12 | 13 | 14 | 15) => vi.mocked(e.setTextSize).mock.calls.at(-1)![0](current);
    let e = at(13);
    expect(runCommand('view.textBigger', e)).toBe(true);
    expect(applied(e, 13)).toBe(14);
    expect(applied(e, 14)).toBe(15); // a second ⌘+ before prefsChanged came back steps on from 14
    expect(applied(e, 15)).toBe(15);
    e = at(13);
    expect(runCommand('view.textSmaller', e)).toBe(true);
    expect(applied(e, 13)).toBe(12);
    expect(applied(e, 12)).toBe(12);
    e = at(15);
    expect(runCommand('view.textBigger', e)).toBe(false);
    expect(runCommand('view.textReset', e)).toBe(true);
    expect(applied(e, 15)).toBe(13);
    expect(e.setTextSize).toHaveBeenCalledTimes(1);
    e = at(12);
    expect(runCommand('view.textSmaller', e)).toBe(false);
    expect(runCommand('view.textReset', at(13))).toBe(false);
    e = at(14, 'viewer');
    expect(runCommand('view.textBigger', e)).toBe(false); // the reader zooms its own content (M7)
    expect(runCommand('view.textReset', e)).toBe(false);
    expect(e.setTextSize).not.toHaveBeenCalled();
  });
  it('item commands use the targets of the given items', () => {
    const e = env();
    expect(isCommandEnabled('item.relink', e, { itemIds: [ID] })).toBe(true);
    expect(isCommandEnabled('item.relink', env({ targetsOf: available }), { itemIds: [ID] })).toBe(false);
    expect(runCommand('item.open', e, { itemIds: [ID] })).toBe(true);
    expect(e.open).toHaveBeenCalledWith(ID);
  });
  it('Finder에서 보기 / 기본 앱으로 열기 run for one item whose file exists, in any view, never while blocked', () => {
    for (const view of ['library', 'viewer'] as const) {
      const e = env({ view, targetsOf: available });
      expect(runCommand('item.showInFolder', e, { itemIds: [ID] })).toBe(true);
      expect(runCommand('item.openExternally', e, { itemIds: [ID] })).toBe(true);
      expect(e.showInFolder).toHaveBeenCalledWith(ID);
      expect(e.openExternally).toHaveBeenCalledWith(ID);
    }
    const missing = env();
    expect(runCommand('item.showInFolder', missing, { itemIds: [ID] })).toBe(false);
    expect(runCommand('item.openExternally', missing, { itemIds: [ID] })).toBe(false);
    const blocked = env({ blocked: true, targetsOf: available });
    expect(runCommand('item.openExternally', blocked, { itemIds: [ID] })).toBe(false);
    expect(blocked.openExternally).not.toHaveBeenCalled();
    expect(missing.showInFolder).not.toHaveBeenCalled();
  });
  it('runs a context-menu pick (main already judged it) unless the window is blocked', () => {
    const e = env({ targetsOf: () => [] });
    expect(runPicked({ commandId: 'item.relink' }, e, { itemIds: [ID] })).toBe(true);
    expect(e.relink).toHaveBeenCalledWith(ID);
    expect(runPicked({ commandId: 'item.open' }, env({ blocked: true }), { itemIds: [ID] })).toBe(false);
  });
  it('a held window (a sheet asked for, not up yet) refuses what the sheet will refuse, but draws nothing disabled', () => {
    const held = env({ held: true });
    // Drawn as before: the toolbar and the list do not grey ahead of the sheet (T13M-n4).
    expect(isCommandEnabled('file.importManaged', held)).toBe(true);
    expect(isCommandEnabled('app.palette', held)).toBe(true);
    // Judged as the blocked, modal window it is about to be.
    for (const id of ['file.importManaged', 'app.palette', 'app.shortcuts', 'view.toggleSidebar', 'view.nextPane'] as const) {
      expect(runCommand(id, held), id).toBe(false);
    }
    expect(held.importFiles).not.toHaveBeenCalled();
    expect(held.showShortcuts).not.toHaveBeenCalled();
    expect(held.focusPane).not.toHaveBeenCalled();
    expect(runCommand('app.settings', held)).toBe(true); // main-owned: allowed under a sheet as well
    expect(runPicked({ commandId: 'item.relink' }, held, { itemIds: [ID] })).toBe(false);
    // Main's menu bar refuses them too.
    expect(reportedContext(held)).toEqual({ view: 'library', blocked: true, textSize: 13, ...COUNTS });
    expect(reportedContext(env())).toEqual(contextOf(env()));
  });
  it('⌘F focuses the quick search in the library while it has items, not in the reader', () => {
    const lib = env({ libraryCount: 2 });
    expect(runCommand('library.find', lib)).toBe(true);
    expect(lib.focusSearch).toHaveBeenCalledTimes(1);
    expect(runCommand('library.find', env({ libraryCount: 0 }))).toBe(false);
    expect(runCommand('library.find', env({ view: 'viewer', libraryCount: 2 }))).toBe(false);
  });
  it("내 라이브러리 전체에서 찾기 runs the env's switch only while a search is active outside 내 라이브러리", () => {
    const outside = env({ libraryCount: 3, scope: 'collection', searchActive: true });
    expect(runCommand('library.findEverywhere', outside)).toBe(true);
    expect(outside.findEverywhere).toHaveBeenCalledTimes(1);
    const everywhere = env({ libraryCount: 3, scope: 'all', searchActive: true });
    expect(runCommand('library.findEverywhere', everywhere)).toBe(false);
    expect(everywhere.findEverywhere).not.toHaveBeenCalled();
    const noQuery = env({ libraryCount: 3, scope: 'unfiled', searchActive: false });
    expect(runCommand('library.findEverywhere', noQuery)).toBe(false);
  });
  it('ignores unknown ids', () => {
    expect(runCommand('file.nope' as CommandId, env())).toBe(false);
    expect(runPicked({ commandId: 'file.nope' as CommandId }, env(), { itemIds: [ID] })).toBe(false);
    expect(runPicked({ commandId: 'toString' as CommandId }, env(), { itemIds: [ID] })).toBe(false); // not fooled by Object.prototype
  });
  it('⌥⌘I toggles the item panel in the library with items, never in the reader, the empty library or while blocked', () => {
    const e = env({ libraryCount: 2 });
    expect(runCommand('view.toggleInspector', e)).toBe(true);
    expect(e.toggleInspector).toHaveBeenCalledTimes(1);
    for (const over of [{ libraryCount: 0 }, { view: 'viewer' as const, libraryCount: 2 }, { libraryCount: 2, blocked: true }]) {
      const off = env(over);
      expect(runCommand('view.toggleInspector', off), JSON.stringify(over)).toBe(false);
      expect(off.toggleInspector).not.toHaveBeenCalled();
    }
  });
  it('reports the item panel state only while the view has one (the menu relabels from it)', () => {
    expect(contextOf(env({ inspector: 'hidden' }))).toMatchObject({ inspector: 'hidden' });
    expect(Object.hasOwn(contextOf(env()), 'inspector')).toBe(false);
  });
  it('사본 내보내기… runs for one item whose file is there, with that item', () => {
    const e = env({ targetsOf: available });
    expect(runCommand('item.exportCopy', e, { itemIds: [ID] })).toBe(true);
    expect(e.exportCopy).toHaveBeenCalledWith(ID);
    expect(runCommand('item.exportCopy', env(), { itemIds: [ID] })).toBe(false); // the factory's target has no file
  });
  it('정보 편집 edits the one target in the library; never in the reader or for several', () => {
    const e = env();
    expect(runCommand('item.editInfo', e, { itemIds: [ID] })).toBe(true);
    expect(e.editInfo).toHaveBeenCalledWith(ID);
    expect(runCommand('item.editInfo', env(), { itemIds: [ID, ID] })).toBe(false);
    expect(runCommand('item.editInfo', env({ view: 'viewer' }), { itemIds: [ID] })).toBe(false);
  });
});

describe('the handler target and the value of a menu row (P-2, spec 9.1)', () => {
  it('hands a handler the whole target, including the row\'s value, from every way in', () => {
    const lib = env({ libraryCount: 3 });
    expect(runCommand('library.sortBy', lib, { args: { column: 'year' } })).toBe(true);
    expect(lib.sortBy).toHaveBeenCalledWith({ column: 'year' });
    expect(runPicked({ commandId: 'library.sortBy', args: { direction: 'asc' } }, lib, {})).toBe(true);
    expect(lib.sortBy).toHaveBeenLastCalledWith({ direction: 'asc' });
    // The head of the submenu is not a row: with no value there is nothing to sort by.
    expect(runCommand('library.sortBy', lib)).toBe(true);
    expect(lib.sortBy).toHaveBeenCalledTimes(2);
  });
  it('a value picked from a menu is added to the target it was opened for, and replaces none of it', () => {
    const e = env({ libraryCount: 3, targetsOf: () => [] });
    expect(runPicked({ commandId: 'item.open', args: { column: 'year' } }, e, { itemIds: [ID], collectionIds: ['c1'] })).toBe(true);
    expect(e.open).toHaveBeenCalledWith(ID);
  });
  it('judges a command on every kind of the target it is given', () => {
    const targetsOf = vi.fn(() => [] as CommandTargetInfo[]);
    const e = env({ targetsOf });
    isCommandEnabled('item.open', e, { itemIds: [ID], collectionIds: ['c1'], tagIds: ['t1'], args: { column: 'year' } });
    expect(targetsOf).toHaveBeenCalledWith({ itemIds: [ID], collectionIds: ['c1'], tagIds: ['t1'], args: { column: 'year' } });
  });
  it('sorts in the library view while it has items: not in the reader, not in the empty library, not under a sheet', () => {
    for (const over of [{ view: 'viewer', libraryCount: 3 }, { libraryCount: 0 }, { libraryCount: 3, blocked: true }] as const) {
      const e = env(over);
      expect(runCommand('library.sortBy', e, { args: { column: 'year' } }), JSON.stringify(over)).toBe(false);
      expect(e.sortBy).not.toHaveBeenCalled();
    }
  });
  it('reports the library view for the menu bar: the scope, the counts, the sort, the columns drawn — no handlers, no ids', () => {
    const e = env({ scope: 'collection', collectionCount: 2, tagPositions: 0b101, tagFilterCount: 1, searchActive: true, sortColumn: 'year', sortDirection: 'asc', columnsShown: 0b111 });
    expect(contextOf(e)).toMatchObject({ scope: 'collection', collectionCount: 2, tagPositions: 5, tagFilterCount: 1, searchActive: true, sortColumn: 'year', sortDirection: 'asc', columnsShown: 7 });
    expect(Object.keys(contextOf(e)).sort()).toEqual(
      ['blocked', 'collectionCount', 'columnsShown', 'libraryCount', 'scope', 'searchActive', 'selectionAvailable', 'selectionCount', 'selectionRelinkable', 'selectionTagPositions', 'sortColumn', 'sortDirection', 'tagFilterCount', 'tagPositions', 'textSize', 'view'].sort(),
    );
  });
  it('컬렉션에 추가 passes the target items and the row\'s value to the env, in the library, for any file state', () => {
    const e = env({ libraryCount: 3 });
    expect(runCommand('collection.addItems', e, { itemIds: [ID, OTHER], args: { collectionId: 'c1' } })).toBe(true);
    expect(e.addToCollection).toHaveBeenLastCalledWith([ID, OTHER], { collectionId: 'c1' });
    expect(runCommand('collection.addItems', e, { itemIds: [ID], args: { addSelection: true } })).toBe(true);
    expect(e.addToCollection).toHaveBeenLastCalledWith([ID], { addSelection: true });
    expect(runCommand('collection.addItems', e, { itemIds: [ID] })).toBe(true); // a bare run (no row): the env decides there is nothing to file into
    expect(e.addToCollection).toHaveBeenLastCalledWith([ID], {});
  });
  it('컬렉션에 추가 is refused in the reader, while blocked and with no target', () => {
    expect(runCommand('collection.addItems', env({ view: 'viewer' }), { itemIds: [ID], args: { collectionId: 'c1' } })).toBe(false);
    expect(runCommand('collection.addItems', env({ blocked: true }), { itemIds: [ID], args: { collectionId: 'c1' } })).toBe(false);
    expect(runCommand('collection.addItems', env(), { args: { collectionId: 'c1' } })).toBe(false);
  });
  it('이 컬렉션에서 빼기 runs only while a collection is viewed', () => {
    const inside = env({ scope: 'collection' });
    expect(runCommand('collection.removeItems', inside, { itemIds: [ID, OTHER] })).toBe(true);
    expect(inside.removeFromCollection).toHaveBeenCalledWith([ID, OTHER]);
    for (const scope of ['all', 'recent', 'unfiled', 'duplicates'] as const) expect(runCommand('collection.removeItems', env({ scope }), { itemIds: [ID] }), scope).toBe(false);
  });
  it('a pick from the item menu reaches the env with its value (main judged it)', () => {
    const e = env();
    expect(runPicked({ commandId: 'collection.addItems', args: { collectionId: 'c1' } }, e, { itemIds: [ID] })).toBe(true);
    expect(e.addToCollection).toHaveBeenCalledWith([ID], { collectionId: 'c1' });
  });
});
