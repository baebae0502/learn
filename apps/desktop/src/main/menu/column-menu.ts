import { Menu, type BaseWindow, type MenuItemConstructorOptions } from 'electron';
import { LIBRARY_COLUMNS, type LibraryColumnId } from '@learn/domain';

/** What the column header menu answers: a column to show or hide, a reset of the whole column set, or nothing. */
export type ColumnMenuPick = { toggle: LibraryColumnId } | { reset: true } | null;
export type ColumnMenuEntry =
  | { kind: 'column'; id: LibraryColumnId; label: string; checked: boolean; enabled: boolean }
  | { kind: 'reset'; label: string }
  | 'separator';

/**
 * The table header's native menu (design-spec 7.3 열 머리): every column of the catalogue, checked while shown (제목
 * checked and disabled: it cannot be hidden), then 열 구성 되돌리기. Its items come from the catalogue only, so none
 * can lack a handler. A column a view forces on (`locked`) is checked and fixed like the title.
 */
export function columnMenuEntries(visible: readonly LibraryColumnId[], resetLabel: string, locked: readonly LibraryColumnId[] = []): ColumnMenuEntry[] {
  return [
    ...LIBRARY_COLUMNS.map((c) => {
      const fixed = c.required === true || locked.includes(c.id);
      return { kind: 'column' as const, id: c.id, label: c.label, checked: fixed || visible.includes(c.id), enabled: !fixed };
    }),
    'separator' as const,
    { kind: 'reset' as const, label: resetLabel },
  ];
}

/** Menus stay referenced while open so they can't be collected mid-popup. */
const open = new Set<Menu>();

/**
 * Shows the column menu and resolves the pick, or null when dismissed. As popupCommandMenu (context-menu.ts): items
 * resolve through their own `click` (a stubbed `Menu.prototype.popup` can drive it), and the close callback resolves
 * null one task later so a click delivered after the close still wins.
 */
export function popupColumnMenu(entries: readonly ColumnMenuEntry[], at: { window: BaseWindow; x: number; y: number }): Promise<ColumnMenuPick> {
  return new Promise((resolve) => {
    let settled = false;
    const template: MenuItemConstructorOptions[] = entries.map((e) =>
      e === 'separator'
        ? { type: 'separator' }
        : e.kind === 'column'
          ? { id: `column.${e.id}`, type: 'checkbox', label: e.label, checked: e.checked, enabled: e.enabled, click: () => settle({ toggle: e.id }) }
          : { id: 'column.reset', label: e.label, click: () => settle({ reset: true }) },
    );
    const menu = Menu.buildFromTemplate(template);
    function settle(value: ColumnMenuPick): void {
      if (settled) return;
      settled = true;
      open.delete(menu);
      resolve(value);
    }
    open.add(menu);
    menu.popup({ window: at.window, x: Math.round(at.x), y: Math.round(at.y), callback: () => setTimeout(() => settle(null), 0) });
  });
}
