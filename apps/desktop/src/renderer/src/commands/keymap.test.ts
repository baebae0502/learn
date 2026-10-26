import { describe, expect, it } from 'vitest';
import type { CommandSpec } from '@learn/domain';
import { keyCommand, type KeyLike } from './keymap';

const C: CommandSpec[] = [
  { id: 'view.nextPane', label: '다음 패널로 이동', key: { code: 'F6', inText: true }, contexts: ['app'] },
  { id: 'view.previousPane', label: '이전 패널로 이동', key: { code: 'F6', shift: true, inText: true }, contexts: ['app'] },
  // A letter shortcut as M8 will add (J), to pin the guards now.
  { id: 'nav.back', label: '10초 뒤로', key: { code: 'KeyJ' }, contexts: ['viewer'] },
];
const k = (over: Partial<KeyLike>): KeyLike => ({ code: 'F6', key: 'F6', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 117, ...over });

describe('renderer keymap (ADR-0005 §3)', () => {
  it('matches by physical key and shift', () => {
    expect(keyCommand(k({}), false, C)).toBe('view.nextPane');
    expect(keyCommand(k({ shiftKey: true }), false, C)).toBe('view.previousPane');
    expect(keyCommand(k({ code: 'KeyJ', key: 'ㅓ', keyCode: 74 }), false, C)).toBe('nav.back'); // Korean input source: key is ㅓ, code is KeyJ
  });
  it('ignores IME composition and modifier chords (those belong to the menu)', () => {
    expect(keyCommand(k({ isComposing: true }), false, C)).toBeNull();
    expect(keyCommand(k({ keyCode: 229 }), false, C)).toBeNull();
    expect(keyCommand(k({ metaKey: true }), false, C)).toBeNull();
    expect(keyCommand(k({ ctrlKey: true }), false, C)).toBeNull();
    expect(keyCommand(k({ altKey: true }), false, C)).toBeNull();
  });
  it('letters never fire while typing; keys marked inText (F6) do', () => {
    expect(keyCommand(k({ code: 'KeyJ', key: 'j', keyCode: 74 }), true, C)).toBeNull();
    expect(keyCommand(k({}), true, C)).toBe('view.nextPane');
  });
  it('reads the registry by default: F6 / ⇧F6 are the pane commands', () => {
    expect(keyCommand(k({}), false)).toBe('view.nextPane');
    expect(keyCommand(k({ shiftKey: true }), true)).toBe('view.previousPane');
    expect(keyCommand(k({ code: 'F7', key: 'F7', keyCode: 118 }), false)).toBeNull();
  });
});

describe('the colour keys 1–8 of the registry (spec 4.2)', () => {
  const digit = (n: number, over: Partial<KeyLike> = {}) => k({ code: `Digit${n}`, key: String(n), keyCode: 48 + n, ...over });
  it('are matched by the physical digit key, whatever the input source', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) expect(keyCommand(digit(n), false), `${n}`).toBe(`tag.color${n}`);
    expect(keyCommand(digit(3, { key: 'ㄷ' }), false)).toBe('tag.color3');
  });
  it('never act in a text field, during a composition (keyCode 229 too), with ⌘ ⌃ ⌥ held, or with ⇧ (that is !)', () => {
    expect(keyCommand(digit(1), true)).toBeNull();
    expect(keyCommand(digit(1, { isComposing: true }), false)).toBeNull();
    expect(keyCommand(digit(1, { keyCode: 229 }), false)).toBeNull();
    for (const mod of ['metaKey', 'ctrlKey', 'altKey', 'shiftKey'] as const) expect(keyCommand(digit(1, { [mod]: true }), false), mod).toBeNull();
  });
  it('are 1–8 only: 9, 0 and the numpad are not colour keys', () => {
    expect(keyCommand(digit(9), false)).toBeNull();
    expect(keyCommand(k({ code: 'Digit0', key: '0', keyCode: 48 }), false)).toBeNull();
    expect(keyCommand(k({ code: 'Numpad1', key: '1', keyCode: 97 }), false)).toBeNull();
  });
});
