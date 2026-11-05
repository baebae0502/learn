import { describe, expect, it } from 'vitest';
import { stageKeyAction, type KeyLike } from './stageKeys';

const k = (over: Partial<KeyLike>): KeyLike => ({ code: 'Space', key: ' ', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 32, ...over });

describe('the reader stage keys', () => {
  it('scrolls a screen with space and shift+space', () => {
    expect(stageKeyAction(k({}), false)).toBe('screenDown');
    expect(stageKeyAction(k({ shiftKey: true }), false)).toBe('screenUp');
  });
  it('turns a page with the side arrows', () => {
    expect(stageKeyAction(k({ code: 'ArrowLeft', key: 'ArrowLeft', keyCode: 37 }), false)).toBe('previousPage');
    expect(stageKeyAction(k({ code: 'ArrowRight', key: 'ArrowRight', keyCode: 39 }), false)).toBe('nextPage');
  });
  it('does nothing while a field has the focus, while composing, or with a modifier', () => {
    expect(stageKeyAction(k({}), true)).toBeNull();
    expect(stageKeyAction(k({ isComposing: true }), false)).toBeNull();
    expect(stageKeyAction(k({ keyCode: 229 }), false)).toBeNull();
    for (const mod of ['altKey', 'ctrlKey', 'metaKey'] as const) {
      expect(stageKeyAction(k({ [mod]: true }), false)).toBeNull();
      expect(stageKeyAction(k({ code: 'ArrowRight', [mod]: true }), false)).toBeNull();
    }
  });
  it('leaves shift+arrow and other keys alone', () => {
    expect(stageKeyAction(k({ code: 'ArrowRight', shiftKey: true }), false)).toBeNull();
    expect(stageKeyAction(k({ code: 'KeyJ' }), false)).toBeNull();
  });
});
