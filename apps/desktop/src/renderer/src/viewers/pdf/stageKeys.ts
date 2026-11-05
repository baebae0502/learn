import type { KeyLike } from '../../commands/keymap';
import { isComposingKey } from '../../ui/ime';

export type { KeyLike };

export type StageKeyAction = 'screenDown' | 'screenUp' | 'previousPage' | 'nextPage' | null;

/**
 * What a key does on the reader's stage: the space bar scrolls a screen, the side arrows turn a page. Nothing while a
 * text field has the focus, while an IME composes, or with a modifier (those belong to the menu).
 */
export function stageKeyAction(e: KeyLike, editing: boolean): StageKeyAction {
  if (editing || isComposingKey(e)) return null;
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  if (e.code === 'Space') return e.shiftKey ? 'screenUp' : 'screenDown';
  if (e.shiftKey) return null;
  if (e.code === 'ArrowLeft') return 'previousPage';
  if (e.code === 'ArrowRight') return 'nextPage';
  return null;
}
