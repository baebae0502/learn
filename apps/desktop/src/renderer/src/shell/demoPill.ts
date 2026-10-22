import { acceleratorKeys, commandById, commandLabel, type CommandId, type LearnEventMap, type SidebarState } from '@learn/domain';

/** What the demo overlay shows for one shortcut: keycaps in the platform's glyphs, and the menu's label (or none). */
export interface DemoPill {
  keys: string[];
  label: string;
}

/**
 * A registry command that ran from the menu (its accelerator or a click): its shortcut as the menus and tooltips draw
 * it (acceleratorKeys, which acceleratorLabel joins) and its menu label. A toggle is named by the state it found
 * (`sidebar` before the command ran: 사이드바 가리기 while shown). Null for a command without a shortcut.
 */
export function commandPill(id: CommandId, platform: string, sidebar?: SidebarState): DemoPill | null {
  const c = commandById(id);
  if (!c.accelerator) return null;
  return { keys: acceleratorKeys(c.accelerator, platform), label: commandLabel(c, platform, sidebar ? { sidebar } : {}) };
}

/** A menu item main runs itself (설정…, the macOS 전체 화면): the accelerator and label main sent. */
export function shortcutPill(item: LearnEventMap['demoShortcut'], platform: string): DemoPill {
  return { keys: acceleratorKeys(item.accelerator, platform), label: item.label };
}

/** KeyboardEvent.key → accelerator key name, for the keys that act in the window without a menu item. */
const WINDOW_KEYS: Readonly<Record<string, string>> = {
  Tab: 'Tab', Enter: 'Enter', Escape: 'Escape', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', F6: 'F6',
};

/**
 * A key that never reaches the menu but moves or acts in the window — ⇥, ↩, esc, the arrows, F6 — with ⇧ when held.
 * Letters (typing), chords with ⌘/⌃/⌥ (the menu's, shown by commandPill), an IME composition and key repeat show none.
 */
export function keyPill(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing' | 'repeat'>, platform: string): DemoPill | null {
  if (e.isComposing || e.repeat || e.altKey || e.ctrlKey || e.metaKey) return null;
  const name = WINDOW_KEYS[e.key];
  if (!name) return null;
  return { keys: acceleratorKeys(e.shiftKey ? `Shift+${name}` : name, platform), label: '' };
}
