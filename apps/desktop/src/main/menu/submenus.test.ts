import { describe, expect, it } from 'vitest';
import { COMMANDS, NO_LIBRARY_VIEW, SUBMENUS, columnsMask, type CommandContextState, type CommandId, type CommandSpec } from '@learn/domain';
import { isSubmenu, type CommandEntry, type MenuEntries } from './entries';
import { colorTagGroup, collectionRows, menuNeedsOrganize, menuText, sortColumnRows, tagColorRows, valueRows, type SubmenuInput } from './submenus';
import { ADD_TO_COLLECTION, COLOR_GROUP, FUTURE_COMMANDS, FUTURE_SUBMENUS, LIBRARY, SET_TAG_COLOR, organize } from './testing';

const CTX: CommandContextState = { view: 'library', blocked: false, textSize: 13, libraryCount: 9, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW };
const input = (over: Partial<SubmenuInput> = {}): SubmenuInput => ({ organize: LIBRARY, itemIds: [], context: CTX, enabledOf: () => true, ...over });
/** A menu as readable lines: "라벨" (✓ checked, ○ radio on, ✗ disabled), a submenu as { 라벨: [...] }. */
type Line = string | { [label: string]: Line[] };
const lines = (entries: MenuEntries): Line[] =>
  entries.map((e): Line => {
    if (e === 'separator') return '-';
    if (isSubmenu(e)) return { [`${e.label}${e.enabled ? '' : ' ✗'}`]: lines(e.submenu) };
    return `${e.label}${e.hint ? ` [${e.hint}]` : ''}${e.type === 'radio' && e.checked ? ' ○' : ''}${e.type === 'checkbox' && e.checked ? ' ✓' : ''}${e.enabled ? '' : ' ✗'}`;
  });
const rows = (entries: MenuEntries) => entries.filter((e): e is CommandEntry => e !== 'separator' && !isSubmenu(e));
const SORT = COMMANDS.find((c) => c.id === 'library.sortBy')!;
const NEW = '새\u00a0컬렉션';

describe('정렬 기준 ▸ (sortColumns)', () => {
  it('lists the shown columns in catalogue order, then the two directions; the sort in force is the radio that is on', () => {
    expect(lines(sortColumnRows(SORT.id, CTX, true))).toEqual(['제목', '저자', '연도', '종류', '추가일 ○', '-', '오름차순', '내림차순 ○']);
  });
  it('carries the column or the direction as the row\'s value', () => {
    expect(rows(sortColumnRows(SORT.id, CTX, true)).map((r) => r.args)).toEqual([
      { column: 'title' }, { column: 'creators' }, { column: 'year' }, { column: 'type' }, { column: 'createdAt' }, { direction: 'asc' }, { direction: 'desc' },
    ]);
    expect(rows(sortColumnRows(SORT.id, CTX, true)).every((r) => r.id === 'library.sortBy' && r.type === 'radio')).toBe(true);
  });
  it('follows the columns drawn and the reported sort', () => {
    const ctx = { ...CTX, sortColumn: 'size' as const, sortDirection: 'asc' as const, columnsShown: columnsMask(['title', 'size', 'originalName']) };
    expect(lines(sortColumnRows(SORT.id, ctx, true))).toEqual(['제목', '크기 ○', '원래 이름', '-', '오름차순 ○', '내림차순']);
  });
  it('the title is always listed; a sort by a hidden column still shows its row, checked, so the menu never contradicts the table', () => {
    expect(lines(sortColumnRows(SORT.id, { ...CTX, columnsShown: 0, sortColumn: 'title' }, true))).toEqual(['제목 ○', '-', '오름차순', '내림차순 ○']);
    expect(lines(sortColumnRows(SORT.id, { ...CTX, columnsShown: columnsMask(['title']), sortColumn: 'updatedAt' }, true))).toEqual(['제목', '수정일 ○', '-', '오름차순', '내림차순 ○']);
    // progress has no column (M7): nothing is on, and nothing is invented.
    expect(lines(sortColumnRows(SORT.id, { ...CTX, sortColumn: 'progress' }, true))).toEqual(['제목', '저자', '연도', '종류', '추가일', '-', '오름차순', '내림차순 ○']);
  });
  it('is dispatched by the command\'s source, and every row is disabled with its command', () => {
    expect(lines(valueRows(SORT, input(), false))).toEqual(['제목 ✗', '저자 ✗', '연도 ✗', '종류 ✗', '추가일 ○ ✗', '-', '오름차순 ✗', '내림차순 ○ ✗']);
  });
});

describe('컬렉션에 추가 ▸ (collections)', () => {
  const rowsOf = (itemIds: readonly string[] = [], enabled = true) => collectionRows(ADD_TO_COLLECTION.id, LIBRARY, itemIds, enabled);
  it('is 새 컬렉션, a separator, then the tree by name (numbers by value); a collection with children is a submenu whose first row is itself', () => {
    expect(lines(rowsOf())).toEqual([
      NEW, '-',
      { 분자생물학: ['분자생물학', '-', '2장', '10장', '유전학'] },
      '시험',
    ]);
  });
  it('gives each row the collection (the first row, a new one for the selection)', () => {
    const [first, , tree] = rowsOf();
    expect((first as CommandEntry).args).toEqual({ addSelection: true });
    const parent = (tree as { submenu: MenuEntries }).submenu;
    expect(rows(parent).map((r) => r.args)).toEqual([{ collectionId: 'c-mb' }, { collectionId: 'c-2' }, { collectionId: 'c-10' }, { collectionId: 'c-gen' }]);
  });
  it('a collection that holds every selected item is checked and cannot be picked again; a partial one can', () => {
    expect(lines(rowsOf(['i1', 'i2']))).toEqual([
      NEW, '-',
      { 분자생물학: ['분자생물학 ✓ ✗', '-', '2장', '10장', '유전학'] },
      '시험',
    ]);
    expect(lines(rowsOf(['i1']))).toEqual([NEW, '-', { 분자생물학: ['분자생물학 ✓ ✗', '-', '2장', '10장', '유전학'] }, '시험 ✓ ✗']);
    expect(lines(rowsOf(['i1', 'i9']))[2]).toEqual({ 분자생물학: ['분자생물학', '-', '2장', '10장', '유전학'] }); // i9 is in none of them
  });
  it('is just 새 컬렉션 when there is none yet, and disabled with its command', () => {
    expect(lines(collectionRows(ADD_TO_COLLECTION.id, organize(), [], true))).toEqual([NEW]);
    expect(lines(rowsOf([], false))).toEqual([`${NEW} ✗`, '-', { '분자생물학 ✗': ['분자생물학 ✗', '-', '2장 ✗', '10장 ✗', '유전학 ✗'] }, '시험 ✗']);
  });
  it('doubles an ampersand in a name (Windows and Linux read it as a mnemonic)', () => {
    expect(menuText('R&D')).toBe('R&&D');
    const snap = organize({ collections: [{ id: 'c', name: 'R&D', parentId: null, createdAt: '2026-10-01T00:00:00.000Z' }] });
    expect(lines(collectionRows(ADD_TO_COLLECTION.id, snap, [], true))).toEqual([NEW, '-', 'R&&D']);
  });
  it('lifts a collection whose parent is gone to the top, and sorts the roots by name', () => {
    const snap = organize({ collections: [
      { id: 'b', name: '나', parentId: 'gone', createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 'a', name: '가', parentId: null, createdAt: '2026-10-02T00:00:00.000Z' },
    ] });
    expect(lines(collectionRows(ADD_TO_COLLECTION.id, snap, [], true))).toEqual([NEW, '-', '가', '나']);
  });
  it('without the library read there is nothing to list', () => {
    expect(valueRows(ADD_TO_COLLECTION, input({ organize: null }), true)).toEqual([]);
  });
});

describe('색 지정 ▸ (tagColors)', () => {
  it('lists the eight colours "N 이름" with a dot; the tag\'s own slot is on, and a slot another tag holds names that tag', () => {
    expect(lines(tagColorRows(SET_TAG_COLOR.id, LIBRARY, 't-key', true))).toEqual([
      '1 노랑 — 시험 범위', '2 빨강', '3 초록 ○', '4 파랑', '5 보라', '6 자홍', '7 주황', '8 회색',
    ]);
    expect(rows(tagColorRows(SET_TAG_COLOR.id, LIBRARY, 't-key', true)).map((r) => [r.args, r.dot])).toEqual([
      [{ position: 1 }, '#ffd400'], [{ position: 2 }, '#ff6666'], [{ position: 3 }, '#5fb236'], [{ position: 4 }, '#2ea8e5'],
      [{ position: 5 }, '#a28ae5'], [{ position: 6 }, '#e56eee'], [{ position: 7 }, '#f19837'], [{ position: 8 }, '#aaaaaa'],
    ]);
  });
  it('a tag without a colour has none on; a name keeps its ampersand doubled', () => {
    expect(lines(tagColorRows(SET_TAG_COLOR.id, LIBRARY, 't-plain', true))[2]).toBe('3 초록 — 중요');
    expect(lines(tagColorRows(SET_TAG_COLOR.id, LIBRARY, 't-plain', true)).some((l) => typeof l === 'string' && l.includes('○'))).toBe(false);
    const snap = organize({ tags: [{ id: 't', name: 'Q&A', color: 'red', position: 2 }, { id: 'u', name: '다른', color: null, position: null }] });
    expect(lines(tagColorRows(SET_TAG_COLOR.id, snap, 'u', true))[1]).toBe('2 빨강 — Q&&A');
  });
  it('needs the library and the tag', () => {
    expect(valueRows(SET_TAG_COLOR, input({ organize: null, tagId: 't-key' }), true)).toEqual([]);
    expect(valueRows(SET_TAG_COLOR, input(), true)).toEqual([]);
    expect(valueRows(SET_TAG_COLOR, input({ tagId: 't-key' }), true)).toHaveLength(8);
  });
});

describe('색 태그 ▸ (a group of commands)', () => {
  const group = (over: Partial<SubmenuInput> = {}) => colorTagGroup(COLOR_GROUP, FUTURE_COMMANDS, input(over));
  it('lists the colour tags in slot order by name, with the slot shown at the right and never registered; the rest of the slots are left out', () => {
    expect(lines([group()!])).toEqual([{ '색 태그': ['시험 범위 [1]', '중요 [3]'] }]);
    expect(rows(group()!.submenu).map((r) => r.id)).toEqual(['tag.color1', 'tag.color3']);
    expect(group()!.id).toBe('submenu.colorTags');
  });
  it('marks a tag that every selected item has', () => {
    expect(lines([group({ itemIds: ['i1', 'i2'] })!])).toEqual([{ '색 태그': ['시험 범위 [1]', '중요 [3] ✓'] }]);
    expect(lines([group({ itemIds: ['i1'] })!])).toEqual([{ '색 태그': ['시험 범위 [1] ✓', '중요 [3] ✓'] }]);
    expect(lines([group({ itemIds: ['i2', 'i9', 'i-new'] })!])).toEqual([{ '색 태그': ['시험 범위 [1]', '중요 [3]'] }]); // i-new has no tag
  });
  it('each member is judged on its own, and the group is off when none can run', () => {
    const only3 = (c: CommandSpec) => c.id === ('tag.color3' as CommandId);
    expect(lines([group({ enabledOf: only3 })!])).toEqual([{ '색 태그': ['시험 범위 [1] ✗', '중요 [3]'] }]);
    expect(group({ enabledOf: () => false })!.enabled).toBe(false);
    expect(group({ enabledOf: only3 })!.enabled).toBe(true);
  });
  it('is left out when no tag has a slot, when the library was not read, or when a member is not a command', () => {
    expect(group({ organize: organize({ tags: [{ id: 't', name: '복습', color: null, position: null }] }) })).toBeNull();
    expect(group({ organize: null })).toBeNull();
    // The real registry has the members now: the group is built from it as from the stand-ins.
    expect(rows(colorTagGroup(COLOR_GROUP, COMMANDS, input())!.submenu).map((r) => r.id)).toEqual(['tag.color1', 'tag.color3']);
  });
});

describe('which menus read the library', () => {
  it('the real registry\'s colour commands make the menus that hold them read the library, and no other does', () => {
    expect(menuNeedsOrganize(COMMANDS, [], 'tag')).toBe(true); // 색 지정 ▸ is built from the tags
    for (const where of ['menu', 'item', 'collection', 'column'] as const) expect(menuNeedsOrganize(COMMANDS, [], where), where).toBe(false);
    // The group's own placements count once the groups are handed in.
    expect(menuNeedsOrganize(COMMANDS, SUBMENUS, 'menu')).toBe(true); // 색 태그 ▸ in 파일
    expect(menuNeedsOrganize(COMMANDS, SUBMENUS, 'item')).toBe(true); // and in the item menu
    expect(menuNeedsOrganize(COMMANDS, SUBMENUS, 'collection')).toBe(false);
  });
  it('a collections or colour source, or a group, makes the menu that holds it read the library', () => {
    expect(menuNeedsOrganize(FUTURE_COMMANDS, FUTURE_SUBMENUS, 'menu')).toBe(true);
    expect(menuNeedsOrganize(FUTURE_COMMANDS, FUTURE_SUBMENUS, 'item')).toBe(true);
    expect(menuNeedsOrganize(FUTURE_COMMANDS, FUTURE_SUBMENUS, 'tag')).toBe(true);
    expect(menuNeedsOrganize(FUTURE_COMMANDS, FUTURE_SUBMENUS, 'collection')).toBe(false);
    expect(menuNeedsOrganize(FUTURE_COMMANDS, [], 'menu')).toBe(true); // 컬렉션에 추가 ▸ is in 파일
    expect(menuNeedsOrganize([...COMMANDS, SET_TAG_COLOR], [], 'menu')).toBe(false); // the colours are the tag menu's only
  });
});
