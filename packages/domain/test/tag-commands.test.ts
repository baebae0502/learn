import { describe, expect, it } from 'vitest';
import {
  COLOR_SLOTS, COMMANDS, NO_LIBRARY_VIEW, SUBMENUS, availableMenuCommands, commandById, inPalette, isCommandAvailable, paletteListed, submenuProblems, tagPositionsMask, tagSlot,
  type CommandContextState, type CommandId, type CommandTargetInfo,
} from '../src/commands';

const LIB: CommandContextState = { view: 'library', blocked: false, textSize: 13, libraryCount: 9, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW };
const VIEWER: CommandContextState = { ...LIB, view: 'viewer' };
const ITEM: CommandTargetInfo = { kind: 'item', storageMode: 'managed', availability: 'available' };
const tagTarget = (hasColor: boolean): CommandTargetInfo => ({ kind: 'tag', id: 't1', hasColor });
const colorKey = (n: number) => `tag.color${n}` as CommandId;
const isColorKey = (id: CommandId) => tagSlot(id) !== null;

describe('the eight colour keys (spec 4.2)', () => {
  it('are 1–8 of the top row, one command each, named by their slot, with no placement of their own and no key while a field has the focus', () => {
    expect(COLOR_SLOTS).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const n of COLOR_SLOTS) {
      const c = commandById(colorKey(n));
      expect(c, `tag.color${n}`).toMatchObject({ label: `색 태그 ${n}`, key: { code: `Digit${n}` }, contexts: ['item'], palette: true });
      expect(c.accelerator).toBeUndefined(); // an accelerator would take the digit from every text field (ADR-0005 §3)
      expect(c.menu).toBeUndefined();
      expect(c.contextMenu).toBeUndefined();
      expect(c.key?.inText).toBeUndefined();
      expect(c.key?.shift).toBeUndefined();
    }
  });
  it('run in the library view on at least one selected item, also on a slot no tag holds (the handler says so); never in the reader, blocked, or on nothing', () => {
    for (const n of COLOR_SLOTS) {
      expect(isCommandAvailable(colorKey(n), LIB, [ITEM]), `${n}`).toBe(true);
      expect(isCommandAvailable(colorKey(n), LIB, [ITEM, ITEM, ITEM]), `${n} several`).toBe(true);
      expect(isCommandAvailable(colorKey(n), LIB, []), `${n} none`).toBe(false);
      expect(isCommandAvailable(colorKey(n), VIEWER, [ITEM]), `${n} reader`).toBe(false);
      expect(isCommandAvailable(colorKey(n), { ...LIB, blocked: true }, [ITEM]), `${n} blocked`).toBe(false);
      expect(isCommandAvailable(colorKey(n), LIB, [tagTarget(true)]), `${n} a tag is no item`).toBe(false);
    }
    // What slots hold never gates the key: the user who presses 2 with no tag at 2 is told so.
    expect(isCommandAvailable('tag.color2', { ...LIB, tagPositions: 0 }, [ITEM])).toBe(true);
  });
  it('are listed in the palette only while a tag holds their slot; every other command always is', () => {
    const ctx = { tagPositions: tagPositionsMask([1, 3]) };
    expect(COLOR_SLOTS.filter((n) => paletteListed(commandById(colorKey(n)), ctx))).toEqual([1, 3]);
    expect(paletteListed(commandById('app.settings'), ctx)).toBe(true);
    expect(paletteListed(commandById('tags.clearFilter'), { tagPositions: 0 })).toBe(true);
    for (const n of COLOR_SLOTS) expect(inPalette(commandById(colorKey(n))), `${n}`).toBe(true);
  });
  it('tagSlot reads the digit a colour key ends with, and nothing else is a colour key', () => {
    expect(COLOR_SLOTS.map((n) => tagSlot(colorKey(n)))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const id of ['tag.rename', 'tag.setColor', 'tags.clearFilter', 'tag.color9', 'tag.color0', 'tag.color'] as CommandId[]) expect(tagSlot(id), id).toBeNull();
  });
});

describe('색 태그 ▸ (spec 9.2, P-3)', () => {
  it('is one group of the eight keys in slot order: in 파일 after the item commands and in the item menu after 컬렉션에 추가 ▸', () => {
    expect(SUBMENUS).toEqual([
      {
        id: 'colorTags',
        label: '색 태그',
        commands: COLOR_SLOTS.map(colorKey),
        menu: { menu: 'file', group: 2, order: 6 },
        contextMenu: { kinds: ['item'], group: 3, order: 3 },
      },
    ]);
    expect(submenuProblems(COMMANDS, SUBMENUS)).toEqual([]);
  });
  it('counts its members in the menu bar judgement: on with a selection in the library, off without one and in the reader', () => {
    const one: CommandContextState = { ...LIB, selectionCount: 1, selectionAvailable: 1 };
    expect(availableMenuCommands(one).filter(isColorKey)).toEqual(COLOR_SLOTS.map(colorKey));
    expect(availableMenuCommands(LIB).filter(isColorKey)).toEqual([]);
    expect(availableMenuCommands({ ...one, view: 'viewer' }).filter(isColorKey)).toEqual([]);
    expect(availableMenuCommands({ ...one, blocked: true }).filter(isColorKey)).toEqual([]);
  });
});

describe('the tag chip\'s menu (spec 9.2, 9.3)', () => {
  it('lists 이름 바꾸기 · 색 지정 ▸ · 색 해제 | 태그 삭제… in that order, and is in neither the palette nor the menu bar', () => {
    const menu = COMMANDS.filter((c) => c.contextMenu?.kinds.includes('tag')).sort((a, b) => a.contextMenu!.group - b.contextMenu!.group || a.contextMenu!.order - b.contextMenu!.order);
    expect(menu.map((c) => [c.label, c.contextMenu!.group])).toEqual([['이름 바꾸기', 1], ['색 지정', 1], ['색 해제', 1], ['태그 삭제…', 2]]);
    expect(menu.map((c) => c.id)).toEqual(['tag.rename', 'tag.setColor', 'tag.clearColor', 'tag.delete']);
    for (const c of menu) {
      expect(c.contexts, c.id).toEqual(['tag']);
      expect(c.menu, c.id).toBeUndefined();
      expect(inPalette(c), c.id).toBe(false);
    }
    expect(commandById('tag.setColor')).toMatchObject({ submenu: 'tagColors', palette: false });
  });
  it('act on exactly one tag; 색 해제 needs a colour to clear', () => {
    for (const id of ['tag.rename', 'tag.setColor', 'tag.delete'] as const) {
      expect(isCommandAvailable(id, LIB, [tagTarget(false)]), id).toBe(true);
      expect(isCommandAvailable(id, LIB, []), `${id} none`).toBe(false);
      expect(isCommandAvailable(id, LIB, [tagTarget(false), tagTarget(true)]), `${id} two`).toBe(false);
      expect(isCommandAvailable(id, LIB, [ITEM]), `${id} an item`).toBe(false);
      expect(isCommandAvailable(id, { ...LIB, blocked: true }, [tagTarget(false)]), `${id} blocked`).toBe(false);
    }
    expect(isCommandAvailable('tag.clearColor', LIB, [tagTarget(true)])).toBe(true);
    expect(isCommandAvailable('tag.clearColor', LIB, [tagTarget(false)])).toBe(false);
    expect(isCommandAvailable('tag.rename', VIEWER, [tagTarget(false)])).toBe(true); // the selector is not in the reader, but a tag command does not need the table
  });
});

describe('태그 선택 해제 (spec 4.3)', () => {
  it('is a palette command and the selector\'s menu row; it runs only while a filter is set, in the library view', () => {
    const c = commandById('tags.clearFilter');
    expect(c).toMatchObject({ label: '태그 선택 해제', contexts: ['library'], palette: true });
    expect(c.menu).toBeUndefined();
    expect(c.keywords?.some((k) => /[가-힣]/.test(k))).toBe(true);
    expect(isCommandAvailable('tags.clearFilter', LIB)).toBe(false);
    expect(isCommandAvailable('tags.clearFilter', { ...LIB, tagFilterCount: 2 })).toBe(true);
    expect(isCommandAvailable('tags.clearFilter', { ...LIB, tagFilterCount: 2, view: 'viewer' })).toBe(false);
    expect(isCommandAvailable('tags.clearFilter', { ...LIB, tagFilterCount: 2, blocked: true })).toBe(false);
  });
});
