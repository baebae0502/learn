import { Menu, type BaseWindow, type MenuItemConstructorOptions } from 'electron';
import { commandLabel, isCommandAvailable, type CommandContextState, type CommandId, type CommandSpec, type CommandTargetInfo, type ContextMenuKind } from '@learn/domain';

export interface ContextEntry {
  id: CommandId;
  label: string;
  enabled: boolean;
}

/**
 * Registry commands for one kind of native context menu, grouped and ordered, enabled by the shared predicate.
 * `onlyWhenAvailable` commands (다시 연결…) are left out instead of shown disabled (design-spec 7.3).
 */
export function contextMenuEntries(
  kind: ContextMenuKind,
  commands: readonly CommandSpec[],
  ctx: CommandContextState,
  targets: readonly CommandTargetInfo[],
  platform: string,
): Array<ContextEntry | 'separator'> {
  const placed = commands
    .filter((c) => c.contextMenu?.kinds.includes(kind))
    .map((c) => ({ c, at: c.contextMenu!, enabled: isCommandAvailable(c.id, ctx, targets) }))
    .filter((e) => e.enabled || !e.at.onlyWhenAvailable)
    .sort((a, b) => a.at.group - b.at.group || a.at.order - b.at.order);
  const out: Array<ContextEntry | 'separator'> = [];
  let group: number | null = null;
  for (const { c, at, enabled } of placed) {
    if (group !== null && at.group !== group) out.push('separator');
    group = at.group;
    out.push({ id: c.id, label: commandLabel(c, platform), enabled });
  }
  return out;
}

/** Menus stay referenced while open so they can't be collected mid-popup. */
const open = new Set<Menu>();

/**
 * Shows a native menu and resolves the picked command id, or null when dismissed.
 * Resolution goes through each item's `click` (so a stubbed `Menu.prototype.popup` can drive it);
 * the close callback resolves null one task later, so a click delivered after the close still wins.
 */
export function popupCommandMenu(
  entries: ReadonlyArray<ContextEntry | 'separator'>,
  at: { window: BaseWindow; x: number; y: number },
): Promise<CommandId | null> {
  return new Promise((resolve) => {
    let settled = false;
    const template: MenuItemConstructorOptions[] = entries.map((e) =>
      e === 'separator' ? { type: 'separator' } : { id: e.id, label: e.label, enabled: e.enabled, click: (item) => settle(item.enabled ? e.id : null) },
    );
    const menu = Menu.buildFromTemplate(template);
    function settle(value: CommandId | null): void {
      if (settled) return;
      settled = true;
      open.delete(menu);
      resolve(value);
    }
    open.add(menu);
    menu.popup({ window: at.window, x: Math.round(at.x), y: Math.round(at.y), callback: () => setTimeout(() => settle(null), 0) });
  });
}
