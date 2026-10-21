import { useState, type KeyboardEvent } from 'react';

export type SheetKey = 'default' | 'cancel' | 'interact' | 'none';

const MODIFIERS = new Set(['Shift', 'Meta', 'Control', 'Alt', 'AltGraph', 'CapsLock']);

/**
 * What a keydown means to a sheet (design-spec 6 버튼): a plain ↩ runs the default button wherever focus is, esc
 * cancels; Space still presses the focused button. Any other key is the user taking over the keyboard. Nothing counts
 * while an IME composes.
 */
export function sheetKey(e: { key: string; isComposing: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): SheetKey {
  if (e.isComposing) return 'none';
  if (e.key === 'Escape') return 'cancel';
  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return 'default';
  return MODIFIERS.has(e.key) ? 'none' : 'interact';
}

/**
 * Root props of a sheet. ↩ and esc are taken in the capture phase, so the focused button never sees them (↩ on
 * 새 자료로 추가 still skips). The sheet opens "fresh": the default button shows only its accent fill, no focus ring,
 * as a macOS sheet does; the first key (other than ↩/esc) or pointer press ends that, and rings show as usual.
 */
export function useSheetKeys(onDefault: () => void, onCancel: () => void) {
  const [fresh, setFresh] = useState(true);
  return {
    'data-fresh': fresh ? '' : undefined,
    onKeyDownCapture(ev: KeyboardEvent<HTMLElement>) {
      const { key, metaKey, ctrlKey, altKey, shiftKey } = ev;
      const what = sheetKey({ key, metaKey, ctrlKey, altKey, shiftKey, isComposing: ev.nativeEvent.isComposing });
      if (what === 'default' || what === 'cancel') {
        ev.preventDefault();
        ev.stopPropagation();
        if (!ev.repeat) (what === 'default' ? onDefault : onCancel)();
      } else if (what === 'interact') setFresh(false);
    },
    onPointerDownCapture() {
      setFresh(false);
    },
  };
}
