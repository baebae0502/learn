import type { Move } from './selectionModel';

/** What a key press on the table does (M4 spec 3.3, design-spec 7.1). */
export type GridKey =
  | { kind: 'move'; to: Move; extend: boolean }
  | { kind: 'all' }
  | { kind: 'open' }
  | { kind: 'clear' }
  /** Space: nothing (the scroll view would page down; Quick Look is not a feature). */
  | { kind: 'swallow' };

const MOVES: Readonly<Record<string, Move>> = { ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end', PageUp: 'pageUp', PageDown: 'pageDown' };

/**
 * The table's keys: ↑ ↓ Home End PageUp PageDown (⇧ extends), ⌘A (Ctrl+A off macOS, by key position so the Korean
 * input source does not matter), ↩ and esc. Nothing during an IME composition (keyCode 229 included, as keymap.ts),
 * nothing with another chord held (the menus own those), and no letters: there is no type-ahead (it fights the Korean
 * IME; ⌘F finds instead). ← / → are left to the scroll view (a table wider than the window scrolls sideways).
 */
export function gridKey(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing' | 'keyCode'>,
  mac: boolean,
): GridKey | null {
  if (e.isComposing || e.keyCode === 229) return null;
  const mod = mac ? e.metaKey : e.ctrlKey;
  const other = mac ? e.ctrlKey : e.metaKey;
  if (e.altKey || other) return null;
  if (mod) return e.code === 'KeyA' && !e.shiftKey ? { kind: 'all' } : null;
  const to = MOVES[e.key];
  if (to) return { kind: 'move', to, extend: e.shiftKey };
  if (e.shiftKey) return null;
  if (e.key === 'Enter') return { kind: 'open' };
  if (e.key === 'Escape') return { kind: 'clear' };
  if (e.key === ' ') return { kind: 'swallow' };
  return null;
}
