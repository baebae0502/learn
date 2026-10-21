import { Menu, type BaseWindow, type MenuItemConstructorOptions } from 'electron';
import type { CommandId, CommandSpec, LibraryItem } from '@learn/domain';

export interface ContextEntry {
  id: CommandId;
  label: string;
  enabled: boolean;
}

type Target = Pick<LibraryItem, 'id' | 'storageMode' | 'availability'>;

/** Enablement per item command; a command without a rule needs at least one target. */
const RULES: Partial<Record<CommandId, (targets: readonly Target[]) => boolean>> = {
  'item.open': (t) => t.length === 1,
  'item.relink': (t) => t.length === 1 && t[0]!.storageMode === 'linked' && t[0]!.availability === 'missing',
};

/** Registry commands for the item context menu, in registry order, with their enabled state for `targets`. */
export function itemContextEntries(commands: readonly CommandSpec[], targets: readonly Target[]): ContextEntry[] {
  return commands
    .filter((c) => c.contextMenu === true && c.contexts.includes('item'))
    .map((c) => ({ id: c.id, label: c.label, enabled: (RULES[c.id] ?? ((t) => t.length > 0))(targets) }));
}

/** Menus stay referenced while open so they can't be collected mid-popup. */
const open = new Set<Menu>();

/**
 * Shows a native menu and resolves the picked command id, or null when dismissed.
 * Resolution goes through each item's `click` (so a stubbed `Menu.prototype.popup` can drive it);
 * the close callback resolves null one task later, so a click delivered after the close still wins.
 */
export function popupCommandMenu(entries: readonly ContextEntry[], at: { window: BaseWindow; x: number; y: number }): Promise<CommandId | null> {
  return new Promise((resolve) => {
    let settled = false;
    const template: MenuItemConstructorOptions[] = entries.map((e) => ({
      id: e.id,
      label: e.label,
      enabled: e.enabled,
      click: (item) => settle(item.enabled ? e.id : null),
    }));
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
