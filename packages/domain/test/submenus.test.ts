import { describe, expect, it } from 'vitest';
import {
  COMMANDS, NO_LIBRARY_VIEW, SUBMENUS, argsKey, availableMenuCommands, commandAvailable, commandById, hasTagPosition, inPalette, isCommandAvailable, itemTarget, menuItemId,
  submenuProblems, tagPositionsMask, type CommandContextState, type CommandId, type CommandSpec, type CommandTargetInfo, type SubmenuSpec,
} from '../src/commands';
import { DEFAULT_COLUMN_CONFIG, columnsOfMask } from '../src/library-columns';

const LIB: CommandContextState = { view: 'library', blocked: false, textSize: 13, libraryCount: 9, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW };
const FILE: CommandTargetInfo = { kind: 'item', storageMode: 'managed', availability: 'available' };
const COLLECTION: CommandTargetInfo = { kind: 'collection', id: 'c1' };
const TAG: CommandTargetInfo = { kind: 'tag', id: 't1', hasColor: false };
const cmd = (id: string, over: Partial<CommandSpec> = {}): CommandSpec => ({ id: id as CommandId, label: '시험', contexts: ['library'], ...over });

/** Stand-ins for the colour-tag commands (their handlers come later): the real registry gains no command without one. */
const members: CommandSpec[] = [1, 2].map((n) => cmd(`tag.color${n}`, { key: { code: `Digit${n}` }, contexts: ['item'] }));
const group = (over: Partial<SubmenuSpec> = {}): SubmenuSpec => ({
  id: 'colorTags', label: '색 태그', commands: members.map((m) => m.id), menu: { menu: 'file', group: 2, order: 3 }, contextMenu: { kinds: ['item'], group: 3, order: 1 }, ...over,
});

describe('library.sortBy (spec 5.2: sorting from the keyboard)', () => {
  it('is 정렬 기준 ▸ in 보기, a value submenu of the shown columns, with no key and no palette entry', () => {
    const c = commandById('library.sortBy');
    expect(c).toMatchObject({ label: '정렬 기준', menu: { menu: 'view', group: 2, order: 3 }, contexts: ['library'], submenu: 'sortColumns', palette: false });
    expect(c.accelerator).toBeUndefined();
    expect(c.key).toBeUndefined();
    expect(inPalette(c)).toBe(false); // a palette run would carry no column: a fake control
  });
  it('runs in the library view while the library has items, never in the reader, an empty library or a blocked window', () => {
    expect(isCommandAvailable('library.sortBy', LIB)).toBe(true);
    expect(isCommandAvailable('library.sortBy', { ...LIB, libraryCount: 0 })).toBe(false);
    expect(isCommandAvailable('library.sortBy', { ...LIB, view: 'viewer' })).toBe(false);
    expect(isCommandAvailable('library.sortBy', { ...LIB, blocked: true })).toBe(false);
    expect(availableMenuCommands(LIB)).toContain('library.sortBy');
    expect(availableMenuCommands({ ...LIB, libraryCount: 0 })).not.toContain('library.sortBy');
  });
});

describe('a value names a menu row (Q-24)', () => {
  it('sorts the keys, leaves out undefined values and gives a command without a value its own id', () => {
    expect(argsKey({ direction: 'asc', column: 'year' })).toBe('column=year&direction=asc');
    expect(argsKey({ collectionId: 'c1', column: undefined })).toBe('collectionId=c1');
    expect(argsKey({ addSelection: true })).toBe('addSelection=true');
    expect(menuItemId('library.sortBy', { direction: 'asc', column: 'year' })).toBe('library.sortBy?column=year&direction=asc');
    expect(menuItemId('library.sortBy')).toBe('library.sortBy');
    expect(menuItemId('library.sortBy', {})).toBe('library.sortBy');
  });
});

describe('submenu invariants (P-3, Q-25)', () => {
  it('the real registry has none to check: no grouped submenu before its commands exist, and its value submenus are placed and kept out of the palette', () => {
    expect(SUBMENUS).toEqual([]);
    expect(submenuProblems(COMMANDS, SUBMENUS)).toEqual([]);
    for (const c of COMMANDS.filter((x) => x.submenu !== undefined)) expect(inPalette(c), c.id).toBe(false);
  });
  it('accepts a group whose members are commands of their own with no placement', () => {
    expect(submenuProblems(members, [group()])).toEqual([]);
  });
  it('names each way a group goes wrong', () => {
    expect(submenuProblems(members, [group({ commands: ['tag.color1' as CommandId, 'tag.color9' as CommandId] })])).toEqual(['colorTags: tag.color9 is not a command']);
    expect(submenuProblems([{ ...members[0]!, menu: { menu: 'file', group: 2, order: 1 } }, members[1]!], [group()])).toEqual(['tag.color1: a member of colorTags with a placement of its own']);
    expect(submenuProblems([{ ...members[0]!, contextMenu: { kinds: ['item'], group: 1, order: 1 } }, members[1]!], [group()])).toEqual(['tag.color1: a member of colorTags with a placement of its own']);
    expect(submenuProblems(members, [group(), group()])).toEqual(['colorTags: listed twice', 'tag.color1: in two submenus', 'tag.color2: in two submenus']);
    const bare: SubmenuSpec = { id: 'colorTags', label: '색 태그', commands: members.map((m) => m.id) };
    expect(submenuProblems(members, [bare])).toEqual(['colorTags: no placement']);
    expect(submenuProblems(members, [group({ label: 'colors' })])).toEqual(['colorTags: the label is not Korean']);
    expect(submenuProblems(members, [group({ commands: [] })])).toEqual(['colorTags: no members']);
    expect(submenuProblems([...members, cmd('x.sort', { submenu: 'sortColumns', menu: { menu: 'view', group: 2, order: 9 } })], [group()])).toEqual([
      'x.sort: a value submenu listed in the palette (a palette run carries no value)',
    ]);
  });
  it('names each way a value submenu goes wrong: no placement, a menu its rows cannot fill', () => {
    const quiet = { palette: false } as const;
    expect(submenuProblems([cmd('x.sort', { submenu: 'sortColumns', ...quiet })], [])).toEqual(['x.sort: a value submenu with no placement']);
    expect(submenuProblems([cmd('x.sort', { submenu: 'sortColumns', ...quiet, contextMenu: { kinds: ['item'], group: 1, order: 1 } })], [])).toEqual(['x.sort: sortColumns does not build an item menu']);
    expect(submenuProblems([cmd('x.colors', { submenu: 'tagColors', ...quiet, menu: { menu: 'file', group: 1, order: 1 } })], [])).toEqual(['x.colors: tagColors has no menu-bar form']);
    expect(submenuProblems([cmd('x.add', { submenu: 'collections', ...quiet, menu: { menu: 'file', group: 1, order: 1 }, contextMenu: { kinds: ['item', 'collection'], group: 1, order: 1 } })], [])).toEqual([]);
  });
  it('a menu-bar group counts its members in the menu bar judgement (they carry no placement of their own)', () => {
    const one: CommandContextState = { ...LIB, selectionCount: 1, selectionAvailable: 1 };
    expect(availableMenuCommands(one, members, [])).toEqual([]); // no group on the menu bar: members are no menu items
    expect(availableMenuCommands(one, members, [group()])).toEqual(['tag.color1', 'tag.color2']);
    expect(availableMenuCommands(LIB, members, [group()])).toEqual([]); // nothing selected: item commands are off
    expect(availableMenuCommands(one, members, [group({ menu: undefined })])).toEqual([]); // a context-menu-only group
  });
});

describe('target kinds (P-4)', () => {
  it('the item rules read the item targets and no others', () => {
    expect(isCommandAvailable('item.open', LIB, [COLLECTION])).toBe(false);
    expect(isCommandAvailable('item.open', LIB, [FILE, COLLECTION, TAG])).toBe(true); // one item among the targets
    expect(isCommandAvailable('item.open', LIB, [FILE, FILE, TAG])).toBe(false);
    expect(isCommandAvailable('item.exportCopy', LIB, [TAG, FILE])).toBe(true);
    expect(isCommandAvailable('item.relink', LIB, [{ kind: 'item', storageMode: 'linked', availability: 'missing' }, COLLECTION])).toBe(true);
  });
  it('a collection or tag command needs a target of its kind, and is not in the palette by default', () => {
    const rename = cmd('collection.rename', { contexts: ['collection'] });
    const recolor = cmd('tag.clearColor', { contexts: ['tag'] });
    expect(commandAvailable(rename, LIB, [COLLECTION])).toBe(true);
    expect(commandAvailable(rename, LIB, [])).toBe(false);
    expect(commandAvailable(rename, LIB, [TAG, FILE])).toBe(false);
    expect(commandAvailable(recolor, LIB, [TAG])).toBe(true);
    expect(commandAvailable(recolor, LIB, [COLLECTION])).toBe(false);
    expect(commandAvailable(rename, { ...LIB, blocked: true }, [COLLECTION])).toBe(false);
    expect(inPalette(rename)).toBe(false);
    expect(inPalette({ ...rename, palette: true })).toBe(true);
  });
  it('copies only the availability facts of an item', () => {
    expect(itemTarget({ storageMode: 'linked', availability: 'missing', title: '제목' } as never)).toEqual({ kind: 'item', storageMode: 'linked', availability: 'missing' });
  });
});

describe('the view fields of a context (spec 9.4)', () => {
  it('starts as the default library view: all, no collections or tags, the default sort and the five default columns (frozen)', () => {
    expect(NO_LIBRARY_VIEW).toMatchObject({ scope: 'all', collectionCount: 0, tagPositions: 0, tagFilterCount: 0, searchActive: false, sortColumn: 'createdAt', sortDirection: 'desc' });
    expect(columnsOfMask(NO_LIBRARY_VIEW.columnsShown)).toEqual(DEFAULT_COLUMN_CONFIG.visible);
    expect(Object.isFrozen(NO_LIBRARY_VIEW)).toBe(true);
  });
  it('keeps the colour slots in use as a bitmask: bit n−1 for slot n; null and slots outside 1–8 count for nothing', () => {
    expect(tagPositionsMask([])).toBe(0);
    expect(tagPositionsMask([1, 3, null, 9, 0])).toBe(0b101);
    expect(tagPositionsMask([8])).toBe(0b10000000);
    expect(hasTagPosition(0b101, 1)).toBe(true);
    expect(hasTagPosition(0b101, 2)).toBe(false);
    expect(hasTagPosition(0b101, 3)).toBe(true);
    expect(hasTagPosition(0b101, 9)).toBe(false);
  });
});
