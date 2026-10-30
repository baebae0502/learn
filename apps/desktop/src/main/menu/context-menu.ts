import { Menu, type BaseWindow } from 'electron';
import type { PickedCommand } from '@learn/domain';
import { dotIcon } from './dot-icon';
import { entriesToTemplate, type MenuEntries } from './entries';

export type { CommandEntry, ContextEntry, MenuEntries, SubmenuEntry } from './entries';

export { contextMenuEntries, kindHasMenu, type MenuExtras } from './context-entries';

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
