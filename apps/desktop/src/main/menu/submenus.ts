import {
  LIBRARY_COLUMNS, TAG_COLORS, columnsOfMask,
  type CommandArgs, type CommandContextState, type CommandId, type CommandSpec, type ContextMenuKind, type OrganizeSnapshot, type SubmenuSource, type SubmenuSpec,
} from '@learn/domain';
import { mainStrings } from '../strings';
import type { CommandEntry, ContextEntry, MenuEntries, SubmenuEntry } from './entries';

/** A user's name as a menu label: Windows and Linux read "&" as a mnemonic marker, so it is doubled (macOS drops the doubling). */
export const menuText = (name: string): string => name.replaceAll('&', '&&');

/** What the rows of a submenu are built from. */
export interface SubmenuInput {
  /** Collections, tags and who has what; null when the caller did not read them (the rows that need them are left out). */
  organize: OrganizeSnapshot | null;
  /** The items the menu acts on, for marks (empty in the menu bar: it marks nothing, spec 9.3). */
  itemIds: readonly string[];
  /** The tag a tag menu is for. */
  tagId?: string;
  /** The reported context: the sort and the columns drawn. */
  context: CommandContextState;
  /** Whether a command can run now: each member of a group is judged on its own. */
  enabledOf(command: CommandSpec): boolean;
}

/** 보기 › 정렬 기준 ▸: the columns drawn (and the one in force, whatever it is), then the two directions, as radios. */
export function sortColumnRows(id: CommandId, state: Pick<CommandContextState, 'sortColumn' | 'sortDirection' | 'columnsShown'>, enabled: boolean): MenuEntries {
  const shown = new Set(columnsOfMask(state.columnsShown));
  const columns = LIBRARY_COLUMNS.filter((c) => c.required === true || shown.has(c.id) || c.id === state.sortColumn);
  const radio = (label: string, args: CommandArgs, checked: boolean): CommandEntry => ({ id, label, enabled, args, type: 'radio', checked });
  return [
    ...columns.map((c) => radio(c.label, { column: c.id }, c.id === state.sortColumn)),
    'separator',
    radio(mainStrings.menu.sort.asc, { direction: 'asc' }, state.sortDirection === 'asc'),
    radio(mainStrings.menu.sort.desc, { direction: 'desc' }, state.sortDirection === 'desc'),
  ];
}

interface CollectionNode {
  id: string;
  name: string;
  children: CollectionNode[];
}
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

/** The live collections as a tree, siblings by name (numbers by value). A parent that is not live lifts the child to the top. */
function collectionTree(collections: OrganizeSnapshot['collections']): CollectionNode[] {
  const nodes = new Map(collections.map((c) => [c.id, { id: c.id, name: c.name, children: [] as CollectionNode[] }]));
  const roots: CollectionNode[] = [];
  for (const c of collections) {
    const node = nodes.get(c.id)!;
    const parent = c.parentId === null ? undefined : nodes.get(c.parentId);
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: CollectionNode[]): void => {
    list.sort((a, b) => collator.compare(a.name, b.name));
    for (const n of list) sort(n.children);
  };
  sort(roots);
  return roots;
}

/**
 * 컬렉션에 추가 ▸ (spec 9.2): 새 컬렉션, a separator, then the tree. A collection with children is a submenu whose first
 * row is itself (Zotero), a separator, then the children. One that already holds every item of the selection is checked
 * and cannot be picked again.
 */
export function collectionRows(id: CommandId, organize: OrganizeSnapshot, itemIds: readonly string[], enabled: boolean): MenuEntries {
  const selected = new Set(itemIds);
  const holdsAll = (collectionId: string): boolean => {
    if (selected.size === 0) return false;
    let inside = 0;
    for (const member of organize.members[collectionId] ?? []) if (selected.has(member)) inside++;
    return inside === selected.size;
  };
  const row = (node: CollectionNode): CommandEntry => {
    const all = holdsAll(node.id);
    return { id, label: menuText(node.name), enabled: enabled && !all, args: { collectionId: node.id }, ...(all ? { type: 'checkbox' as const, checked: true } : {}) };
  };
  const walk = (node: CollectionNode): ContextEntry =>
    node.children.length === 0 ? row(node) : { label: menuText(node.name), enabled, submenu: [row(node), 'separator', ...node.children.map(walk)] };
  const tree = collectionTree(organize.collections);
  const out: Array<ContextEntry | 'separator'> = [{ id, label: mainStrings.menu.newCollection, enabled, args: { addSelection: true } }];
  if (tree.length > 0) out.push('separator', ...tree.map(walk));
  return out;
}

/** 색 지정 ▸ (spec 9.2): "N 이름" with a colour dot; this tag's slot is on, and a slot another tag holds names that tag. */
export function tagColorRows(id: CommandId, organize: OrganizeSnapshot, tagId: string, enabled: boolean): MenuEntries {
  return TAG_COLORS.map((color, i): CommandEntry => {
    const position = i + 1;
    const holder = organize.tags.find((t) => t.position === position);
    const own = holder?.id === tagId;
    return {
      id,
      label: `${position} ${color.label}${holder && !own ? ` — ${menuText(holder.name)}` : ''}`,
      enabled,
      args: { position },
      type: 'radio',
      checked: own,
      dot: color.hex,
    };
  });
}

/** The slot a colour command stands for: the digit its id ends with (tag.color3). */
const slotOf = (id: string): number | null => {
  const m = /(\d)$/.exec(id);
  return m ? Number(m[1]) : null;
};

/**
 * 색 태그 ▸ (spec 9.2): a group of commands, one per slot that has a tag, named by the tag with the slot at the right
 * edge. A tag that every selected item has is checked. Left out when no tag has a slot (or the library was not read).
 */
export function colorTagGroup(spec: SubmenuSpec, commands: readonly CommandSpec[], input: SubmenuInput): SubmenuEntry | null {
  const { organize } = input;
  if (!organize) return null;
  const selected = new Set(input.itemIds);
  const rows: CommandEntry[] = [];
  for (const id of spec.commands) {
    const command = commands.find((c) => c.id === id);
    const slot = slotOf(id);
    const tag = slot === null ? undefined : organize.tags.find((t) => t.position === slot);
    if (!command || !tag) continue;
    let has = 0;
    for (const item of organize.tagged[tag.id] ?? []) if (selected.has(item)) has++;
    const all = selected.size > 0 && has === selected.size;
    rows.push({ id, label: menuText(tag.name), enabled: input.enabledOf(command), hint: String(slot), dot: TAG_COLORS[slot! - 1]!.hex, ...(all ? { type: 'checkbox' as const, checked: true } : {}) });
  }
  if (rows.length === 0) return null;
  return { id: `submenu.${spec.id}`, label: spec.label, enabled: rows.some((r) => r.enabled), submenu: rows };
}

/**
 * The rows of a value-submenu command. `rowsEnabled`: the context menu greys the rows with their command; the menu bar
 * leaves them on and greys the head (the head is switched in place, the rows are not).
 */
export function valueRows(command: CommandSpec, input: SubmenuInput, rowsEnabled: boolean): MenuEntries {
  const source: SubmenuSource | undefined = command.submenu;
  switch (source) {
    case 'sortColumns':
      return sortColumnRows(command.id, input.context, rowsEnabled);
    case 'collections':
      return input.organize ? collectionRows(command.id, input.organize, input.itemIds, rowsEnabled) : [];
    case 'tagColors':
      return input.organize && input.tagId !== undefined ? tagColorRows(command.id, input.organize, input.tagId, rowsEnabled) : [];
    default:
      return [];
  }
}

/** Whether the menu bar (`where` = 'menu') or the context menu of a kind lists a submenu that is read from the library. */
export function menuNeedsOrganize(commands: readonly CommandSpec[], submenus: readonly SubmenuSpec[], where: ContextMenuKind | 'menu'): boolean {
  const placedHere = (at: { kinds: readonly ContextMenuKind[] } | undefined): boolean => where !== 'menu' && at?.kinds.includes(where) === true;
  const fromSource = commands.some(
    (c) => (c.submenu === 'collections' || c.submenu === 'tagColors') && (where === 'menu' ? c.menu !== undefined : placedHere(c.contextMenu)),
  );
  return fromSource || submenus.some((s) => (where === 'menu' ? s.menu !== undefined : placedHere(s.contextMenu)));
}
