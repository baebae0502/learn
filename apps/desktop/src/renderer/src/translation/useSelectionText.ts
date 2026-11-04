import { useEffect, type RefObject } from 'react';
import { create } from 'zustand';
import { useTranslation, type TranslationView } from './store';

/** A keyboard selection (shift + arrows) is read once it has stood still this long; a pointer selection at once. */
export const KEYBOARD_SETTLE_MS = 300;

interface SelectionState {
  /** The text of the last selection made in the page: kept while the focus is in a field (the palette), cleared when the selection goes. */
  text: string;
  /** The pop-up is wanted: false after esc, a click outside or a selection that left the screen, until the next selection. */
  open: boolean;
}

export const useSelection = create<SelectionState>()(() => ({ text: '', open: false }));

/** The states the pop-up draws: off and idle show nothing there. */
export const POPUP_STATES: ReadonlySet<TranslationView['kind']> = new Set(['consent', 'pending', 'done', 'error', 'tooLong']);
/** The pop-up is on screen now. */
export const popupVisible = (): boolean => useSelection.getState().open && useSelection.getState().text !== '' && POPUP_STATES.has(useTranslation.getState().view.kind);

/** A text field has the focus (the palette, the panel's original): the selection is in it. A check box or a button is not one. */
function typing(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/** The range the pop-up is placed by; it is live, so its rectangles follow the page as it scrolls. */
let liveRange: Range | null = null;
export const selectionRange = (): Range | null => liveRange;

/** esc, a click outside, or a selection scrolled out of sight: the pop-up goes, the text stays for the palette command. */
export const dismissPopup = (): void => useSelection.setState({ open: false });

/** 선택한 글 번역 from the palette: the pop-up shows again for the text that was selected. */
export function reopenSelection(): void {
  const { text } = useSelection.getState();
  if (text === '') return;
  useSelection.setState({ open: true });
  // The palette took the focus and with it the selection: the words are marked again, as they were when it was asked.
  if (liveRange?.startContainer.isConnected) {
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(liveRange);
  }
  const t = useTranslation.getState();
  if (t.view.kind === 'idle' || t.view.kind === 'off' || t.view.kind === 'consent') t.resume();
}

function clearSelection(): void {
  liveRange = null;
  lastText = '';
  if (useSelection.getState().text !== '' || useSelection.getState().open) useSelection.setState({ text: '', open: false });
}

let lastText = '';

const inTextLayer = (node: Node | null, stage: HTMLElement): boolean => {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  return el !== null && stage.contains(el) && el.closest('.textLayer') !== null;
};

/**
 * Reads the selection made in the text layer of the stage: after a pointer is let go, and 300 ms after a keyboard selection
 * stops changing. A selection elsewhere is none of its business; an empty or blank one closes the pop-up.
 */
export function useSelectionText(stageRef: RefObject<HTMLElement | null>, active: boolean): void {
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
        clearSelection();
        return;
      }
      // Moved out of the page's text (the panel's result box): the held selection is gone, and so is the command's context.
      if (!inTextLayer(range.startContainer, stage) || !inTextLayer(range.endContainer, stage)) {
        clearSelection();
        return;
      }
      liveRange = range.cloneRange();
      if (text === lastText) return;
      lastText = text;
      useSelection.setState({ text, open: true });
      useTranslation.getState().select(text);
    };
    const onSelectionChange = () => {
      clearTimeout(timer);
      if (pointerDown) return;
      timer = setTimeout(read, KEYBOARD_SETTLE_MS);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('.sel-popup')) return;
      pointerDown = stage.contains(e.target as Node);
      if (pointerDown) lastText = ''; // the press ends the selection that was there: the same words picked again are a new selection
      // A click outside the pop-up closes it; a selection made by this press opens it again when the pointer is let go.
      dismissPopup();
    };
    const onPointerUp = () => {
      if (!pointerDown) return;
      pointerDown = false;
      clearTimeout(timer);
      upTimer = setTimeout(read, 0);
    };
    // esc with the focus on the page (or nowhere): the pop-up goes. Focus in the stage is the reader's own handler, which runs first.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !popupVisible()) return;
      if (e.target !== document.body && !stage.contains(e.target as Node)) return;
      e.preventDefault();
      dismissPopup();
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
      clearSelection();
    };
  }, [stageRef, active]);
}
