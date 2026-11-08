import { describe, expect, it } from 'vitest';
import { stageKeyAction, pageStepAction, type KeyLike } from './stageKeys';

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

describe('the stage keys by scroll mode', () => {
  const down = k({ code: 'ArrowDown', key: 'ArrowDown', keyCode: 40 });
  const up = k({ code: 'ArrowUp', key: 'ArrowUp', keyCode: 38 });
  const pgDown = k({ code: 'PageDown', key: 'PageDown', keyCode: 34 });
  const pgUp = k({ code: 'PageUp', key: 'PageUp', keyCode: 33 });
  it('vertical: the same as before; the arrows up and down and the page keys are left to the browser', () => {
    for (const e of [k({}), k({ shiftKey: true }), k({ code: 'ArrowLeft' }), k({ code: 'ArrowRight' }), down, up, pgDown, pgUp]) {
      expect(stageKeyAction(e, false, 'vertical'), e.code).toBe(stageKeyAction(e, false));
    }
    expect(stageKeyAction(down, false, 'vertical')).toBeNull();
    expect(stageKeyAction(pgDown, false, 'vertical')).toBeNull();
  });
  it('horizontal: space, shift+space, PageDown and PageUp scroll a stage width sideways; the side arrows still turn a page', () => {
    expect(stageKeyAction(k({}), false, 'horizontal')).toBe('screenRight');
    expect(stageKeyAction(k({ shiftKey: true }), false, 'horizontal')).toBe('screenLeft');
    expect(stageKeyAction(pgDown, false, 'horizontal')).toBe('screenRight');
    expect(stageKeyAction(pgUp, false, 'horizontal')).toBe('screenLeft');
    expect(stageKeyAction(k({ code: 'ArrowLeft' }), false, 'horizontal')).toBe('previousPage');
    expect(stageKeyAction(k({ code: 'ArrowRight' }), false, 'horizontal')).toBe('nextPage');
    expect(stageKeyAction(pgDown, true, 'horizontal')).toBeNull();
    expect(stageKeyAction({ ...pgDown, metaKey: true }, false, 'horizontal')).toBeNull();
  });
  it('a page at a time: ↓ space and PageDown go on from a page end, ↑ shift+space and PageUp back from a page top, otherwise they scroll', () => {
    for (const e of [down, k({}), pgDown]) {
      expect(stageKeyAction(e, false, 'page'), e.code).toBe('pageForward');
    }
    for (const e of [up, k({ shiftKey: true }), pgUp]) {
      expect(stageKeyAction(e, false, 'page'), e.code).toBe('pageBack');
    }
    expect(stageKeyAction(k({ code: 'ArrowLeft' }), false, 'page')).toBe('previousPage');
    expect(stageKeyAction(k({ code: 'ArrowRight' }), false, 'page')).toBe('nextPage');
  });
  it('pageStepAction: at the end of the page a forward key turns the page, inside it scrolls; a screen is 0.9 of the stage', () => {
    const box = { scrollTop: 0, clientHeight: 500, scrollHeight: 1200 };
    expect(pageStepAction('pageForward', box)).toEqual({ kind: 'scroll', top: 450 });
    expect(pageStepAction('pageForward', { ...box, scrollTop: 700 })).toEqual({ kind: 'turn', direction: 'next' });
    expect(pageStepAction('pageForward', { ...box, scrollTop: 699.5 })).toEqual({ kind: 'turn', direction: 'next' });
    expect(pageStepAction('pageBack', box)).toEqual({ kind: 'turn', direction: 'previous' });
    expect(pageStepAction('pageBack', { ...box, scrollTop: 300 })).toEqual({ kind: 'scroll', top: -450 });
    expect(pageStepAction('pageForward', { scrollTop: 0, clientHeight: 500, scrollHeight: 500 })).toEqual({ kind: 'turn', direction: 'next' });
  });
});
