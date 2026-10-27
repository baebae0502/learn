import { isComposingKey } from '../ui/ime';

/** What the add field reads of a key press (the React event's fields, `isComposing` taken from the native event). */
export interface FieldKeyEvent {
  key: string;
  keyCode: number;
  isComposing: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/**
 * none: not ours, the field types or the window handles it. ignore: ours and nothing happens — and nobody above sees it.
 * move: the highlighted suggestion becomes `to` (-1 = none, the typed name). commit: ↩. close: esc.
 */
export type FieldKeyAction = { do: 'none' } | { do: 'ignore' } | { do: 'move'; to: number } | { do: 'commit' } | { do: 'close' };

const NONE: FieldKeyAction = { do: 'none' };
const IGNORE: FieldKeyAction = { do: 'ignore' };

/**
 * The add field's keys (spec 6.1): ↑↓ choose among the suggestions, ↩ attaches the chosen one or the typed name, esc
 * closes, ⌫ in an empty field removes nothing. A key that belongs to a Korean composition — `isComposing`, the keyCode 229
 * macOS IMEs send without it, the Process key — does nothing here: it only finishes the composition.
 */
export function addFieldKey(e: FieldKeyEvent, s: { text: string; active: number; count: number }): FieldKeyAction {
  if (isComposingKey(e) || e.key === 'Process') return IGNORE;
  if (e.altKey || e.ctrlKey || e.metaKey) return NONE;
  switch (e.key) {
    case 'ArrowDown':
      return s.count === 0 ? IGNORE : { do: 'move', to: Math.min(s.active + 1, s.count - 1) };
    case 'ArrowUp':
      return s.count === 0 ? IGNORE : { do: 'move', to: Math.max(s.active - 1, -1) };
    case 'Enter':
      return s.active >= 0 || s.text.trim() !== '' ? { do: 'commit' } : IGNORE;
    case 'Escape':
      return { do: 'close' };
    case 'Backspace':
      return s.text === '' ? IGNORE : NONE;
    default:
      return NONE;
  }
}
