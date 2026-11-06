import type { ScrollModeName } from '@learn/domain';
import type { KeyLike } from '../../commands/keymap';
import { isComposingKey } from '../../ui/ime';

export type { KeyLike };

export type StageKeyAction = 'screenDown' | 'screenUp' | 'screenRight' | 'screenLeft' | 'pageForward' | 'pageBack' | 'previousPage' | 'nextPage' | null;

/**
 * What a key does on the reader's stage: the space bar scrolls a screen, the side arrows turn a page. Nothing while a
 * text field has the focus, while an IME composes, or with a modifier (those belong to the menu). Sideways, the screen keys
 * move a stage width across; a page at a time, ↓ ↑ and the screen keys go on from the end of a page to the next one.
 */
export function stageKeyAction(e: KeyLike, editing: boolean, mode: ScrollModeName = 'vertical'): StageKeyAction {
  if (editing || isComposingKey(e)) return null;
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  const forward = (e.code === 'Space' && !e.shiftKey) || (!e.shiftKey && (e.code === 'PageDown' || e.code === 'ArrowDown'));
  const back = (e.code === 'Space' && e.shiftKey) || (!e.shiftKey && (e.code === 'PageUp' || e.code === 'ArrowUp'));
  if (mode === 'page' && (forward || back)) return forward ? 'pageForward' : 'pageBack';
  if (e.code === 'Space') return e.shiftKey ? (mode === 'horizontal' ? 'screenLeft' : 'screenUp') : mode === 'horizontal' ? 'screenRight' : 'screenDown';
  if (mode === 'horizontal' && !e.shiftKey) {
    if (e.code === 'PageDown') return 'screenRight';
    if (e.code === 'PageUp') return 'screenLeft';
  }
  if (e.shiftKey) return null;
  if (e.code === 'ArrowLeft') return 'previousPage';
  if (e.code === 'ArrowRight') return 'nextPage';
  return null;
}

/** A screen's scroll by the space bar leaves a tenth of it in view, so the eye keeps its place. */
export const SCREEN_STEP = 0.9;

export type PageStep = { kind: 'scroll'; top: number } | { kind: 'turn'; direction: 'next' | 'previous' };

/** A page-at-a-time key: inside the page a screen's scroll (the delta), at its end (or top, going back) the next (or previous) page. */
export function pageStepAction(action: 'pageForward' | 'pageBack', box: { scrollTop: number; clientHeight: number; scrollHeight: number }): PageStep {
  const END = 1;
  if (action === 'pageForward') {
    return box.scrollTop + box.clientHeight >= box.scrollHeight - END ? { kind: 'turn', direction: 'next' } : { kind: 'scroll', top: box.clientHeight * SCREEN_STEP };
  }
  return box.scrollTop <= END ? { kind: 'turn', direction: 'previous' } : { kind: 'scroll', top: -box.clientHeight * SCREEN_STEP };
}
