import { useEffect, type RefObject } from 'react';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { currentScope, useReaderScope, type ReaderScope } from '../viewers/readerScope';
import type { TranslationView } from './store';

/** A keyboard selection (shift + arrows) is read once it has stood still this long; a pointer selection at once. */
export const KEYBOARD_SETTLE_MS = 300;

export interface SelectionStore {
  /** The text of the last selection made in the page: kept while the focus is in a field (the palette), cleared when the selection goes. */
  text: string;
  /** The pop-up is wanted: false after esc, a click outside or a selection that left the screen, until the next selection. */
  open: boolean;
  /** The range the pop-up is placed by; it is live, so its rectangles follow the page as it scrolls. */
  range: Range | null;
  /** The text of the selection last taken in, so the same words are not taken twice. */
  lastText: string;
}

export const createSelectionStore = (): StoreApi<SelectionStore> => createStore<SelectionStore>()(() => ({ text: '', open: false, range: null, lastText: '' }));

export { useSelection } from '../viewers/readerScope';

/** The states the pop-up draws: off and idle show nothing there. */
export const POPUP_STATES: ReadonlySet<TranslationView['kind']> = new Set(['consent', 'pending', 'done', 'error', 'tooLong']);
/** The pop-up of the reader (outside a reader, of the active one) is on screen now. */
export const popupVisible = (scope: ReaderScope = currentScope()): boolean => {
  const { open, text } = scope.selection.getState();
  return open && text !== '' && POPUP_STATES.has(scope.translation.getState().view.kind);
};

/** A text field has the focus (the palette, the panel's original): the selection is in it. A check box or a button is not one. */
function typing(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/** The range the pop-up is placed by. */
export const selectionRange = (scope: ReaderScope = currentScope()): Range | null => scope.selection.getState().range;

/** esc, a click outside, or a selection scrolled out of sight: the pop-up goes, the text stays for the palette command. */
export const dismissPopup = (scope: ReaderScope = currentScope()): void => scope.selection.setState({ open: false });

/** 선택한 글 번역 from the palette: the pop-up shows again for the text that was selected. */
export function reopenSelection(scope: ReaderScope = currentScope()): void {
  const { text, range } = scope.selection.getState();
  if (text === '') return;
  scope.selection.setState({ open: true });
  // The palette took the focus and with it the selection: the words are marked again, as they were when it was asked.
  if (range?.startContainer.isConnected) {
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  const t = scope.translation.getState();
  if (t.view.kind === 'idle' || t.view.kind === 'off' || t.view.kind === 'consent') t.resume();
}

function clearSelection(scope: ReaderScope): void {
  const { text, open } = scope.selection.getState();
  scope.selection.setState({ range: null, lastText: '', ...(text !== '' || open ? { text: '', open: false } : {}) });
}

const inTextLayer = (node: Node | null, stage: HTMLElement): boolean => {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el !== null && stage.contains(el) && el.closest('.textLayer') !== null;
};

/**
 * Reads the selection made in the text layer of the stage: after a pointer is let go, and 300 ms after a keyboard selection
 * stops changing. A selection elsewhere is none of its business; an empty or blank one closes the pop-up.
 */
export function useSelectionText(stageRef: RefObject<HTMLElement | null>, active: boolean): void {
  const scope = useReaderScope();
  useEffect(() => {
    const stage = stageRef.current;
    if (!active || !stage) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pointerDown = false;
    let upTimer: ReturnType<typeof setTimeout> | undefined;
    const read = () => {
      // A field has the focus (the palette, the panel's original): the selection is in it, and what was selected stays.
      if (typing(document.activeElement)) return;
      const selection = document.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const text = selection?.toString() ?? '';
      if (!range || selection!.isCollapsed || text.trim() === '') {
        clearSelection(scope);
        return;
      }
      // Moved out of the page's text (the panel's result box): the held selection is gone, and so is the command's context.
      if (!inTextLayer(range.startContainer, stage) || !inTextLayer(range.endContainer, stage)) {
        clearSelection(scope);
        return;
      }
      scope.selection.setState({ range: range.cloneRange() });
      if (text === scope.selection.getState().lastText) return;
      scope.selection.setState({ lastText: text, text, open: true });
      scope.translation.getState().select(text);
    };
    const onSelectionChange = () => {
      clearTimeout(timer);
      if (pointerDown) return;
      timer = setTimeout(read, KEYBOARD_SETTLE_MS);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('.sel-popup')) return;
      pointerDown = stage.contains(e.target as Node);
      if (pointerDown) scope.selection.setState({ lastText: '' }); // the press ends the selection that was there: the same words picked again are a new selection
      // A click outside the pop-up closes it; a selection made by this press opens it again when the pointer is let go.
      dismissPopup(scope);
    };
    const onPointerUp = () => {
      if (!pointerDown) return;
      pointerDown = false;
      clearTimeout(timer);
      upTimer = setTimeout(read, 0);
    };
    // esc with the focus on the page (or nowhere): the pop-up goes. Focus in the stage is the reader's own handler, which runs first.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !popupVisible(scope)) return;
      if (e.target !== document.body && !stage.contains(e.target as Node)) return;
      e.preventDefault();
      dismissPopup(scope);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerUp, true);
      clearTimeout(timer);
      clearTimeout(upTimer);
      clearSelection(scope);
    };
  }, [stageRef, active, scope]);
}
