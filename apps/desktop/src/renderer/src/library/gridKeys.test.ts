import { describe, expect, it } from 'vitest';
import { gridKey } from './gridKeys';

type Mods = Partial<Record<'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'isComposing', boolean>> & { keyCode?: number; code?: string };
const k = (key: string, mods: Mods = {}) => ({ key, code: mods.code ?? '', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 0, ...mods });

describe('the table keys (M4 spec 3.3, design-spec 7.1)', () => {
  it('moves with the arrows, Home/End and PageUp/PageDown; ⇧ extends', () => {
    expect(gridKey(k('ArrowDown'), true)).toEqual({ kind: 'move', to: 'down', extend: false });
    expect(gridKey(k('ArrowUp', { shiftKey: true }), false)).toEqual({ kind: 'move', to: 'up', extend: true });
    expect(gridKey(k('Home'), false)).toEqual({ kind: 'move', to: 'home', extend: false });
    expect(gridKey(k('End', { shiftKey: true }), true)).toEqual({ kind: 'move', to: 'end', extend: true });
    expect(gridKey(k('PageDown'), true)).toEqual({ kind: 'move', to: 'pageDown', extend: false });
    expect(gridKey(k('PageUp'), false)).toEqual({ kind: 'move', to: 'pageUp', extend: false });
  });
  it('selects all with ⌘A on macOS and Ctrl+A elsewhere, by key position (a Korean input source types ㅁ there)', () => {
    expect(gridKey(k('a', { metaKey: true, code: 'KeyA' }), true)).toEqual({ kind: 'all' });
    expect(gridKey(k('ㅁ', { metaKey: true, code: 'KeyA' }), true)).toEqual({ kind: 'all' });
    expect(gridKey(k('a', { ctrlKey: true, code: 'KeyA' }), false)).toEqual({ kind: 'all' });
    expect(gridKey(k('a', { ctrlKey: true, code: 'KeyA' }), true)).toBeNull(); // ⌃A on a Mac is not select-all
    expect(gridKey(k('a', { metaKey: true, code: 'KeyA', shiftKey: true }), true)).toBeNull();
  });
  it('opens with ↩, clears with esc, and keeps Space from paging the view', () => {
    expect(gridKey(k('Enter'), true)).toEqual({ kind: 'open' });
    expect(gridKey(k('Escape'), false)).toEqual({ kind: 'clear' });
    expect(gridKey(k(' '), true)).toEqual({ kind: 'swallow' });
  });
  it('does nothing for letters (no type-ahead), ← / →, Tab, F6, other chords, or a key of a Korean composition', () => {
    for (const key of ['a', 'ㄱ', '가', '7', 'ArrowLeft', 'ArrowRight', 'Tab', 'F6', 'Backspace']) expect(gridKey(k(key), true), key).toBeNull();
    expect(gridKey(k('ArrowDown', { altKey: true }), true)).toBeNull();
    expect(gridKey(k('ArrowDown', { metaKey: true }), true)).toBeNull();
    expect(gridKey(k('ArrowDown', { ctrlKey: true }), false)).toBeNull();
    expect(gridKey(k('Enter', { shiftKey: true }), true)).toBeNull();
    expect(gridKey(k('Enter', { isComposing: true }), true)).toBeNull();
    expect(gridKey(k('ArrowDown', { keyCode: 229 }), true)).toBeNull();
  });
});
