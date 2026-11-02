import { inPalette, type CommandId, type CommandSpec, type ContextMenuKind, type MenuName } from './commands';
import { COLOR_SLOTS } from './tag-colors';

// The registry's submenus (spec 9.1), kept apart so commands.ts stays the list of commands; commands.ts re-exports all of
// this. From commands.ts this file takes types and `inPalette`, which it only calls and never reads while loading, and the
// colour slots come from tag-colors.ts: so either file can load first (submenus-module.test.ts).

/** Where a value submenu's rows come from: main builds them from the library (collections, colours) or the reported context (columns). */
export type SubmenuSource = 'collections' | 'tagColors' | 'sortColumns';
/** Which menus each source can fill: `submenuProblems` checks a command's placement against it. */
export const SUBMENU_SOURCES: Readonly<Record<SubmenuSource, { menuBar: boolean; contextKinds: readonly ContextMenuKind[] }>> = {
  collections: { menuBar: true, contextKinds: ['item', 'collection'] },
  tagColors: { menuBar: false, contextKinds: ['tag'] },
  sortColumns: { menuBar: true, contextKinds: [] },
};

/**
 * Commands grouped into one submenu (spec 9.1): "색 태그 ▸" lists `tag.color1`–`tag.color8`. The members stay commands
 * of their own (the key map, the ⌘/ sheet and the palette need each one), so they carry no placement; the group does.
 * A group exists only with its members' handlers (a row without a handler cannot exist): the colour keys' are in R/commands/registry.ts.
 */
export interface SubmenuSpec {
  id: 'colorTags';
  /** Korean, as the menu shows it. */
  label: string;
  /** The members, in menu order. */
  commands: readonly CommandId[];
  menu?: { menu: MenuName; group: number; order: number };
  contextMenu?: { kinds: readonly ContextMenuKind[]; group: number; order: number };
}
export const SUBMENUS: readonly SubmenuSpec[] = [
  {
    id: 'colorTags',
    label: '색 태그',
    commands: COLOR_SLOTS.map((n): CommandId => `tag.color${n}`),
    // 파일 group 2 after 컬렉션에 추가 ▸ (4) and 이 컬렉션에서 빼기 (5); the item menu's group 3 after the same two (1, 2).
    menu: { menu: 'file', group: 2, order: 6 },
    contextMenu: { kinds: ['item'], group: 3, order: 3 },
  },
];

/** What is wrong with the submenus of a registry (empty: nothing). The real registry must give []. */
export function submenuProblems(commands: readonly CommandSpec[], submenus: readonly SubmenuSpec[]): string[] {
  const problems: string[] = [];
  const byId = new Map(commands.map((c) => [c.id, c]));
  for (const c of commands) {
    if (c.submenu === undefined) continue;
    const source = SUBMENU_SOURCES[c.submenu];
    if (!c.menu && !c.contextMenu) problems.push(`${c.id}: a value submenu with no placement`);
    if (inPalette(c)) problems.push(`${c.id}: a value submenu listed in the palette (a palette run carries no value)`);
    if (c.menu && !source.menuBar) problems.push(`${c.id}: ${c.submenu} has no menu-bar form`);
    for (const kind of c.contextMenu?.kinds ?? []) if (!source.contextKinds.includes(kind)) problems.push(`${c.id}: ${c.submenu} does not build a${kind === 'item' ? 'n' : ''} ${kind} menu`);
  }
  const seen = new Set<string>();
  const members = new Set<CommandId>();
  for (const s of submenus) {
    if (seen.has(s.id)) problems.push(`${s.id}: listed twice`);
    seen.add(s.id);
    if (!s.menu && !s.contextMenu) problems.push(`${s.id}: no placement`);
    if (!/[가-힣]/.test(s.label)) problems.push(`${s.id}: the label is not Korean`);
    if (s.commands.length === 0) problems.push(`${s.id}: no members`);
    for (const id of s.commands) {
      const c = byId.get(id);
      if (!c) {
        problems.push(`${s.id}: ${id} is not a command`);
        continue;
      }
      if (members.has(id)) problems.push(`${id}: in two submenus`);
      members.add(id);
      if (c.menu || c.contextMenu) problems.push(`${id}: a member of ${s.id} with a placement of its own`);
    }
  }
  return problems;
}
