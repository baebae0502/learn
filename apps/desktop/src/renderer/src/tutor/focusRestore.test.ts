import { describe, expect, it } from 'vitest';
import { createFocusRestore } from './focusRestore';

describe('the focus after a search', () => {
  it('returns to the pressed button once a search that showed has ended', () => {
    const r = createFocusRestore();
    r.hold('#research');
    expect(r.step(true, false)).toBeNull(); // started, not shown yet
    expect(r.step(true, true)).toBeNull(); // shown: the button is disabled
    expect(r.step(false, true)).toBeNull(); // answered, the line goes a frame later
    expect(r.step(false, false)).toBe('#research');
    expect(r.step(false, false)).toBeNull(); // once
  });
  it('forgets the button of a search that ended before it showed, so a later search elsewhere moves nothing', () => {
    const r = createFocusRestore();
    r.hold('#research');
    expect(r.step(true, false)).toBeNull();
    expect(r.step(false, false)).toBeNull(); // fast: nothing was disabled
    expect(r.step(true, false)).toBeNull(); // a search nobody pressed for
    expect(r.step(true, true)).toBeNull();
    expect(r.step(false, true)).toBeNull();
    expect(r.step(false, false)).toBeNull();
  });
  it('holds nothing for a press that had no focus', () => {
    const r = createFocusRestore();
    r.hold(null);
    r.step(true, false);
    r.step(true, true);
    expect(r.step(false, false)).toBeNull();
  });
});
