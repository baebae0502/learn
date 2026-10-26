import { Menu, type BaseWindow } from 'electron';
import { SUBMENUS, commandAvailable, commandLabel, type CommandContextState, type CommandSpec, type CommandTargetInfo, type ContextMenuKind, type OrganizeSnapshot, type PickedCommand, type SubmenuSpec } from '@learn/domain';
import { dotIcon } from './dot-icon';
import { entriesToTemplate, type ContextEntry, type MenuEntries } from './entries';
import { colorTagGroup, valueRows } from './submenus';

export type { CommandEntry, ContextEntry, MenuEntries, SubmenuEntry } from './entries';

/** What a menu is built from beside the registry and the reported context. */
export interface MenuExtras {
  /** Collections, tags and who has what; null when it was not read (the rows that need it are left out). */
  organize?: OrganizeSnapshot | null;
  /** The items the menu is for, in table order: what the marks of 컬렉션에 추가 ▸ and 색 태그 ▸ are judged on. */
  itemIds?: readonly string[];
  /** The tag a tag menu is for (색 지정 ▸). */
  tagId?: string;
  /** The grouped submenus; the registry's by default. */
  submenus?: readonly SubmenuSpec[];
}

/** Whether some registry command (or group) lists this kind: a kind nothing lists answers null without a database read. */
export function kindHasMenu(kind: ContextMenuKind, commands: readonly CommandSpec[], submenus: readonly SubmenuSpec[] = SUBMENUS): boolean {
  return commands.some((c) => c.contextMenu?.kinds.includes(kind)) || submenus.some((s) => s.contextMenu?.kinds.includes(kind));
}

interface Placed {
  group: number;
  order: number;
  entry: ContextEntry | null;
}

/**
 * Registry commands (and grouped submenus) for one kind of native context menu, grouped and ordered, enabled by the
 * shared predicate. `onlyWhenAvailable` commands (다시 연결…) are left out instead of shown disabled (design-spec 7.3). A
 * value submenu (컬렉션에 추가 ▸, 색 지정 ▸) and a group (색 태그 ▸) are rows that open a submenu; one with nothing to
 * list is left out together with the separator it would have needed.
 */
export function contextMenuEntries(
  kind: ContextMenuKind,
  commands: readonly CommandSpec[],
  ctx: CommandContextState,
  targets: readonly CommandTargetInfo[],
  platform: string,
  extras: MenuExtras = {},
): MenuEntries {
  const input = {
    organize: extras.organize ?? null,
    itemIds: extras.itemIds ?? [],
    ...(extras.tagId !== undefined ? { tagId: extras.tagId } : {}),
    context: ctx,
    enabledOf: (c: CommandSpec) => commandAvailable(c, ctx, targets),
  };
  const fromCommands = commands.flatMap((c): Placed[] => {
    const at = c.contextMenu;
    if (!at?.kinds.includes(kind)) return [];
    const enabled = commandAvailable(c, ctx, targets);
    if (!enabled && at.onlyWhenAvailable) return [];
    const label = commandLabel(c, platform);
    if (c.submenu === undefined) return [{ group: at.group, order: at.order, entry: { id: c.id, label, enabled } }];
    const rows = valueRows(c, input, enabled);
    return [{ group: at.group, order: at.order, entry: rows.length === 0 ? null : { label, enabled, submenu: rows } }];
  });
  const fromGroups = (extras.submenus ?? SUBMENUS).flatMap((s): Placed[] =>
    s.contextMenu?.kinds.includes(kind) ? [{ group: s.contextMenu.group, order: s.contextMenu.order, entry: colorTagGroup(s, commands, input) }] : [],
  );
  const placed = [...fromCommands, ...fromGroups]
    .filter((p): p is Placed & { entry: ContextEntry } => p.entry !== null)
    .sort((a, b) => a.group - b.group || a.order - b.order);
  const out: Array<ContextEntry | 'separator'> = [];
  let group: number | null = null;
  for (const p of placed) {
    if (group !== null && p.group !== group) out.push('separator');
    group = p.group;
    out.push(p.entry);
  }
  return out;
}

/** Menus stay referenced while open so they can't be collected mid-popup. */
const open = new Set<Menu>();

/**
 * Shows a native menu and resolves the picked command and its row's value, or null when dismissed.
 * Resolution goes through each item's `click` (so a stubbed `Menu.prototype.popup` can drive it);
 * the close callback resolves null one task later, so a click delivered after the close still wins.
 */
export function popupCommandMenu(entries: MenuEntries, at: { window: BaseWindow; x: number; y: number }): Promise<PickedCommand | null> {
  return new Promise((resolve) => {
    let settled = false;
    const menu = Menu.buildFromTemplate(entriesToTemplate(entries, (picked) => settle(picked), { dotIcon, surface: 'popup' }));
    function settle(value: PickedCommand | null): void {
      if (settled) return;
      settled = true;
      open.delete(menu);
      resolve(value);
    }
    open.add(menu);
    menu.popup({ window: at.window, x: Math.round(at.x), y: Math.round(at.y), callback: () => setTimeout(() => settle(null), 0) });
  });
}
