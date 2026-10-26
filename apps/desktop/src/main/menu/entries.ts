import type { MenuItemConstructorOptions, NativeImage } from 'electron';
import { menuItemId, type CommandArgs, type CommandId, type PickedCommand } from '@learn/domain';

/** A row that runs a registry command, with a value when it is one row of a value submenu (spec 9.1). */
export interface CommandEntry {
  id: CommandId;
  label: string;
  enabled: boolean;
  args?: CommandArgs;
  /** 'radio': one of a set (정렬 기준); 'checkbox': a mark that may stand alone (색 태그 ✓, a collection that has the items). */
  type?: 'radio' | 'checkbox';
  checked?: boolean;
  /** A shortcut shown at the right edge and never registered ("1"…"8": the renderer's key map owns the key). */
  hint?: string;
  /** A colour dot (#rrggbb) before the label. */
  dot?: string;
}
/** A row that opens a submenu. It has no command of its own: the first row inside may be the thing itself. */
export interface SubmenuEntry {
  /** The menu item's id when something must find it (a group's head, to switch it in place). */
  id?: string;
  label: string;
  enabled: boolean;
  submenu: MenuEntries;
  dot?: string;
}
export type ContextEntry = CommandEntry | SubmenuEntry;
export type MenuEntries = ReadonlyArray<ContextEntry | 'separator'>;

export const isSubmenu = (entry: ContextEntry): entry is SubmenuEntry => 'submenu' in entry;
/** The menu item id of a command row (menuItemId: the command's, with its value). */
export const entryItemId = (entry: CommandEntry): string => menuItemId(entry.id, entry.args);

export interface TemplateOptions {
  /** The native image of a colour dot; injected so this module stays free of the Electron runtime. */
  dotIcon?: (hex: string) => NativeImage;
}

/**
 * The native menu template of some rows. A click answers the row's command and value through `pick`; a disabled row
 * answers null (a stubbed popup clicks without asking Electron whether the row is on).
 */
export function entriesToTemplate(entries: MenuEntries, pick: (picked: PickedCommand | null) => void, opts: TemplateOptions = {}): MenuItemConstructorOptions[] {
  return entries.map((entry): MenuItemConstructorOptions => {
    if (entry === 'separator') return { type: 'separator' };
    const icon = entry.dot !== undefined && opts.dotIcon ? { icon: opts.dotIcon(entry.dot) } : {};
    if (isSubmenu(entry)) {
      return { ...(entry.id ? { id: entry.id } : {}), label: entry.label, enabled: entry.enabled, submenu: entriesToTemplate(entry.submenu, pick, opts), ...icon };
    }
    const picked: PickedCommand = { commandId: entry.id, ...(entry.args ? { args: entry.args } : {}) };
    return {
      id: entryItemId(entry),
      label: entry.label,
      enabled: entry.enabled,
      ...(entry.type ? { type: entry.type, checked: entry.checked === true } : {}),
      ...(entry.hint ? { accelerator: entry.hint, registerAccelerator: false } : {}),
      ...icon,
      // A row that only shows a key must not run twice: macOS can still treat the hint as the menu bar's key equivalent, and the
      // renderer's key map already owns the digit (and ignores it in a text field, which a menu key would not).
      click: (item, _window, event) => pick(item.enabled && !(entry.hint && event?.triggeredByAccelerator === true) ? picked : null),
    };
  });
}
