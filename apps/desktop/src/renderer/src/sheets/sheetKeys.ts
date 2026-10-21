import { useEffect, useRef, useState, type MouseEvent } from 'react';

/** `swallow`: a key the sheet blocks without acting on it (a modified ↩ must not press the focused button). */
export type SheetKey = 'default' | 'cancel' | 'swallow' | 'interact' | 'none';

const MODIFIERS = new Set(['Shift', 'Meta', 'Control', 'Alt', 'AltGraph', 'CapsLock']);

/**
 * What a keydown means to a sheet (design-spec 6 버튼): a plain ↩ runs the default button wherever focus is, esc
 * cancels; ↩ with any modifier (⇧↩ ⌃↩ ⌥↩ ⌘↩) is swallowed, so it never presses the focused non-default button; Space
 * still presses the focused button. Any other key is the user taking over the keyboard. Nothing counts while an IME
 * composes.
 */
export function sheetKey(e: { key: string; isComposing: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): SheetKey {
  if (e.isComposing) return 'none';
  if (e.key === 'Escape') return 'cancel';
  if (e.key === 'Enter') return e.metaKey || e.ctrlKey || e.altKey || e.shiftKey ? 'swallow' : 'default';
  return MODIFIERS.has(e.key) ? 'none' : 'interact';
}

/** Elements that keep their own focus behaviour on a mouse press inside a sheet. */
const FOCUSABLE_ON_PRESS = 'button, input, textarea, select, [contenteditable]';

/**
 * Keys and root props of a sheet. A sheet window holds exactly one sheet, so ↩ and esc are taken by a window
 * capture listener: they work wherever focus is, also on <body> after a click on static text, and the focused button
 * never sees them (↩ on 새 자료로 추가 still skips).
 *
 * Assumes the sheet has no text inputs: a ↩ there would run the default button instead of reaching the field. If a
 * sheet ever gets one, let Enter through for `input` / `textarea` targets here.
 *
 * The sheet opens "fresh": the default button shows only its accent fill, no focus ring, as a macOS sheet does; the
 * first other key or pointer press ends that, and rings show as usual. A mouse press on static text (not a control)
 * keeps focus where it was, as on a macOS sheet.
 */
export function useSheetKeys(onDefault: () => void, onCancel: () => void) {
  const [fresh, setFresh] = useState(true);
  const latest = useRef({ onDefault, onCancel });
  latest.current = { onDefault, onCancel };
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const what = sheetKey(ev);
      if (what === 'default' || what === 'cancel' || what === 'swallow') {
        ev.preventDefault();
        ev.stopPropagation();
        if (what !== 'swallow' && !ev.repeat) (what === 'default' ? latest.current.onDefault : latest.current.onCancel)();
      }
      if (what === 'interact' || what === 'swallow') setFresh(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return {
    'data-fresh': fresh ? '' : undefined,
    onPointerDownCapture() {
      setFresh(false);
    },
    onMouseDown(e: MouseEvent<HTMLElement>) {
      if (!(e.target as Element).closest(FOCUSABLE_ON_PRESS)) e.preventDefault();
    },
  };
}
