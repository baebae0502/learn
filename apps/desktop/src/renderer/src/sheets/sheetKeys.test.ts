import { describe, expect, it } from 'vitest';
import { sheetKey } from './sheetKeys';

const key = (k: string, over: Partial<Parameters<typeof sheetKey>[0]> = {}) =>
  sheetKey({ key: k, isComposing: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });

describe('sheet keys (design-spec 6: the default button on ↩, esc cancels)', () => {
  it('↩ always runs the default button, whichever button has focus; esc cancels', () => {
    expect(key('Enter')).toBe('default');
    expect(key('Escape')).toBe('cancel');
  });
  it('a modified ↩ is not the default button (⌘↩, ⇧↩ …), and nothing counts while an IME composes', () => {
    for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const) expect(key('Enter', { [mod]: true }), mod).toBe('interact');
    expect(key('Enter', { isComposing: true })).toBe('none');
    expect(key('Escape', { isComposing: true })).toBe('none');
  });
  it('Tab, Space and arrows are the user taking over the keyboard (focus rings from now on); a lone modifier is not', () => {
    for (const k of ['Tab', ' ', 'ArrowRight', 'a']) expect(key(k), k).toBe('interact');
    for (const k of ['Shift', 'Meta', 'Control', 'Alt']) expect(key(k), k).toBe('none');
  });
});
