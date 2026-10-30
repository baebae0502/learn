import { describe, expect, it } from 'vitest';
import { addFieldKey, type FieldKeyEvent } from './addFieldKeys';

const key = (k: string, over: Partial<FieldKeyEvent> = {}): FieldKeyEvent => ({ key: k, keyCode: 0, isComposing: false, altKey: false, ctrlKey: false, metaKey: false, ...over });
const state = (over: Partial<{ text: string; active: number; count: number }> = {}) => ({ text: '', active: -1, count: 0, ...over });

describe('the add field\'s keys (spec 6.1)', () => {
  it('↓ and ↑ choose among the suggestions, from "none" down and back to "none"; they do nothing with no suggestions', () => {
    expect(addFieldKey(key('ArrowDown'), state({ count: 3 }))).toEqual({ do: 'move', to: 0 });
    expect(addFieldKey(key('ArrowDown'), state({ count: 3, active: 1 }))).toEqual({ do: 'move', to: 2 });
    expect(addFieldKey(key('ArrowDown'), state({ count: 3, active: 2 }))).toEqual({ do: 'move', to: 2 }); // clamps at the last
    expect(addFieldKey(key('ArrowUp'), state({ count: 3, active: 1 }))).toEqual({ do: 'move', to: 0 });
    expect(addFieldKey(key('ArrowUp'), state({ count: 3, active: 0 }))).toEqual({ do: 'move', to: -1 });
    expect(addFieldKey(key('ArrowUp'), state({ count: 3 }))).toEqual({ do: 'move', to: -1 });
    expect(addFieldKey(key('ArrowDown'), state())).toEqual({ do: 'ignore' });
    expect(addFieldKey(key('ArrowUp'), state())).toEqual({ do: 'ignore' });
  });
  it('↩ attaches the chosen suggestion or, with none chosen, the typed name; an empty field attaches nothing', () => {
    expect(addFieldKey(key('Enter'), state({ count: 3, active: 1 }))).toEqual({ do: 'commit' });
    expect(addFieldKey(key('Enter'), state({ text: '수용체' }))).toEqual({ do: 'commit' });
    expect(addFieldKey(key('Enter'), state({ text: '   ' }))).toEqual({ do: 'ignore' });
    expect(addFieldKey(key('Enter'), state())).toEqual({ do: 'ignore' });
  });
  it('esc closes the field', () => {
    expect(addFieldKey(key('Escape'), state({ text: 'x' }))).toEqual({ do: 'close' });
  });
  it('⌫ in an empty field removes nothing — and does not reach the chips — while in a field with text it is the field\'s', () => {
    expect(addFieldKey(key('Backspace'), state())).toEqual({ do: 'ignore' });
    expect(addFieldKey(key('Backspace'), state({ text: 'x' }))).toEqual({ do: 'none' });
  });
  it('a key that belongs to a Korean composition — isComposing, keyCode 229, the Process key — neither moves, attaches nor closes', () => {
    for (const k of ['Enter', 'Escape', 'ArrowDown', 'ArrowUp', 'Backspace']) {
      expect(addFieldKey(key(k, { isComposing: true }), state({ text: '수용', count: 2 })), `${k} composing`).toEqual({ do: 'ignore' });
      expect(addFieldKey(key(k, { keyCode: 229 }), state({ text: '수용', count: 2 })), `${k} 229`).toEqual({ do: 'ignore' });
    }
    expect(addFieldKey(key('Process'), state({ text: '수' }))).toEqual({ do: 'ignore' });
  });
  it('keys with ⌘ ⌃ ⌥ and ordinary typing are the field\'s own (select all, copy, letters)', () => {
    expect(addFieldKey(key('a', { metaKey: true }), state())).toEqual({ do: 'none' });
    expect(addFieldKey(key('Enter', { metaKey: true }), state({ text: 'x' }))).toEqual({ do: 'none' });
    expect(addFieldKey(key('가'), state())).toEqual({ do: 'none' });
    expect(addFieldKey(key('Tab'), state())).toEqual({ do: 'none' });
  });
});
