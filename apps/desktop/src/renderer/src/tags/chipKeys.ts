export interface ChipKey {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}
export type ChipRole = 'filter' | 'assigned';
export type ChipKeyAction = { kind: 'move'; to: 'previous' | 'next' | 'first' | 'last' } | { kind: 'rename' } | { kind: 'remove' } | null;

/**
 * What a key does on a focused chip (spec 4.3, design-spec 6 태그 칩). Space is left to the button (it toggles the filter);
 * the menu key is `isContextMenuKey`'s. A filter chip is renamed with ↩; an assigned chip has no name field and is taken
 * off with ⌫ (or Delete).
 */
export function chipKeyAction(e: ChipKey, role: ChipRole): ChipKeyAction {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  switch (e.key) {
    case 'ArrowLeft':
      return { kind: 'move', to: 'previous' };
    case 'ArrowRight':
      return { kind: 'move', to: 'next' };
    case 'Home':
      return { kind: 'move', to: 'first' };
    case 'End':
      return { kind: 'move', to: 'last' };
    case 'Enter':
      return role === 'filter' ? { kind: 'rename' } : null;
    case 'Backspace':
    case 'Delete':
      return role === 'assigned' ? { kind: 'remove' } : null;
    default:
      return null;
  }
}
