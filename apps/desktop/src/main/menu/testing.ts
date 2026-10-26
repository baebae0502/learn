import { COMMANDS, SUBMENUS, commandById, type CommandId, type CommandSpec, type OrganizeSnapshot, type SubmenuSpec } from '@learn/domain';

/** The registry's own 색 태그 group and 색 지정 command, under the names the menu builders' tests use. */
export const COLOR_GROUP: SubmenuSpec = SUBMENUS.find((s) => s.id === 'colorTags')!;
export const SET_TAG_COLOR: CommandSpec = commandById('tag.setColor');
/** A stand-in for the command a later task adds (its handler does not exist yet, so the real registry has none). */
export const ADD_TO_COLLECTION: CommandSpec = {
  id: 'collection.addItems' as CommandId, label: '컬렉션에 추가', contexts: ['item'], submenu: 'collections', palette: false,
  menu: { menu: 'file', group: 2, order: 4 }, contextMenu: { kinds: ['item'], group: 3, order: 1 },
};
/** The real registry plus the one stand-in left. */
export const FUTURE_COMMANDS: CommandSpec[] = [...COMMANDS, ADD_TO_COLLECTION];
export const FUTURE_SUBMENUS: SubmenuSpec[] = [...SUBMENUS];

export function organize(over: Partial<OrganizeSnapshot> = {}): OrganizeSnapshot {
  return { collections: [], tags: [], members: {}, tagged: {}, duplicates: [], ...over };
}
/** 분자생물학 ▸ (2장, 10장, 유전학) and 시험, with 태그 중요 (slot 3) and 시험 범위 (slot 1). */
export const LIBRARY = organize({
  collections: [
    { id: 'c-mb', name: '분자생물학', parentId: null, createdAt: '2026-10-01T00:00:00.000Z' },
    { id: 'c-gen', name: '유전학', parentId: 'c-mb', createdAt: '2026-10-02T00:00:00.000Z' },
    { id: 'c-ex', name: '시험', parentId: null, createdAt: '2026-10-03T00:00:00.000Z' },
    { id: 'c-2', name: '2장', parentId: 'c-mb', createdAt: '2026-10-04T00:00:00.000Z' },
    { id: 'c-10', name: '10장', parentId: 'c-mb', createdAt: '2026-10-05T00:00:00.000Z' },
  ],
  tags: [
    { id: 't-range', name: '시험 범위', color: 'yellow', position: 1 },
    { id: 't-key', name: '중요', color: 'green', position: 3 },
    { id: 't-plain', name: '복습', color: null, position: null },
  ],
  members: { 'c-mb': ['i1', 'i2', 'i3'], 'c-ex': ['i1'] },
  tagged: { 't-key': ['i1', 'i2', 'i9'], 't-range': ['i1'] },
});
