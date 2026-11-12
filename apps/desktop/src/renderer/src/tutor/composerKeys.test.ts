import { describe, expect, it } from 'vitest';
import { afterBusy, composerKey } from './composerKeys';

const k = (key: string, o: Partial<{ shiftKey: boolean; isComposing: boolean; keyCode: number }> = {}) => ({ key, shiftKey: false, isComposing: false, keyCode: 0, ...o });
const ready = { hasText: true, streaming: false, canSend: true };

describe('the composer\'s keys (spec 8.4, 8.11)', () => {
  it('↩ sends, ⇧↩ breaks the line, nothing while composing (isComposing or keyCode 229)', () => {
    expect(composerKey(k('Enter'), ready)).toBe('send');
    expect(composerKey(k('Enter', { shiftKey: true }), ready)).toBe('newline');
    expect(composerKey(k('Enter', { isComposing: true }), ready)).toBeNull();
    expect(composerKey(k('Enter', { keyCode: 229 }), ready)).toBeNull();
    expect(composerKey(k('Enter'), { ...ready, hasText: false })).toBeNull();
    expect(composerKey(k('Enter'), { ...ready, canSend: false })).toBeNull();
  });
  it('esc stops while an answer comes, never during a composition', () => {
    expect(composerKey(k('Escape'), { ...ready, streaming: true })).toBe('stop');
    expect(composerKey(k('Escape', { keyCode: 229 }), { ...ready, streaming: true })).toBeNull();
    expect(composerKey(k('Escape'), ready)).toBeNull();
  });
  it('↩ sends nothing while an answer comes; esc is the stop then, and other keys are the text area\'s', () => {
    expect(composerKey(k('Enter'), { ...ready, streaming: true })).toBeNull();
    expect(composerKey(k('Escape', { isComposing: true }), { ...ready, streaming: true })).toBeNull();
    expect(composerKey(k('a'), ready)).toBeNull();
    expect(composerKey(k('ArrowUp'), { ...ready, streaming: true })).toBeNull();
  });
});

describe('a question that waits for another session\'s answer (M19)', () => {
  it('waits while that answer still comes, and is sent at once when it has ended or is not there', () => {
    expect(afterBusy('streaming')).toBe('wait');
    expect(afterBusy('complete')).toBe('send-now');
    expect(afterBusy('stopped')).toBe('send-now');
    expect(afterBusy('failed')).toBe('send-now');
    expect(afterBusy(null)).toBe('send-now');
  });
});
