import { COMMANDS, type CommandId, type CommandSpec, type OrganizeSnapshot, type SubmenuSpec } from '@learn/domain';

const colorId = (n: number) => `tag.color${n}` as CommandId;

/** Stand-ins for the commands later tasks add; their handlers do not exist yet, so the real registry has none of them. */
export const COLOR_COMMANDS: CommandSpec[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: colorId(n), label: `색 태그 ${n}`, key: { code: `Digit${n}` }, contexts: ['item'] }));
export const COLOR_GROUP: SubmenuSpec = {
  id: 'colorTags',
  label: '색 태그',
  commands: COLOR_COMMANDS.map((c) => c.id),
  menu: { menu: 'file', group: 2, order: 4 },
  contextMenu: { kinds: ['item'], group: 3, order: 1 },
};
export const ADD_TO_COLLECTION: CommandSpec = {
  id: 'collection.addItems' as CommandId, label: '컬렉션에 추가', contexts: ['item'], submenu: 'collections', palette: false,
  menu: { menu: 'file', group: 2, order: 5 }, contextMenu: { kinds: ['item'], group: 3, order: 0 },
};
export const SET_TAG_COLOR: CommandSpec = {
  id: 'tag.setColor' as CommandId, label: '색 지정', contexts: ['tag'], submenu: 'tagColors', palette: false, contextMenu: { kinds: ['tag'], group: 1, order: 2 },
};
/** The real registry plus the stand-ins: what Tasks 5–7 will have. */
export const FUTURE_COMMANDS: CommandSpec[] = [...COMMANDS, ADD_TO_COLLECTION, SET_TAG_COLOR, ...COLOR_COMMANDS];
export const FUTURE_SUBMENUS: SubmenuSpec[] = [COLOR_GROUP];

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
