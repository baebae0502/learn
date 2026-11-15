import { describe, expect, it } from 'vitest';
import { createComposerFocus } from './composerFocus';

const clock = () => {
  let t = 0;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
};

describe('the focus owed to the composer after 시작 in the chooser', () => {
  it('is asked for once the same tab shows its session, whether main\'s notice came before or after', () => {
    const c = clock();
    const f = createComposerFocus(c.now);
    f.owe('tab-a');
    expect(f.step('chooser', 'tab-a')).toBe(false); // the prefs notice is still to come
    expect(f.step('ready', 'tab-a')).toBe(true);
    expect(f.step('ready', 'tab-a')).toBe(false); // once
    // Already on screen when 시작 resolves (the notice came first): asked for at once.
    f.owe('tab-a');
    expect(f.step('ready', 'tab-a')).toBe(true);
  });
  it('is let go when nothing owes it: never asked for unasked', () => {
    const f = createComposerFocus(clock().now);
    expect(f.step('ready', 'tab-a')).toBe(false);
  });
  it('is let go when the tab changes, when the panel goes another way, or when the session does not come in time', () => {
    const c = clock();
    const f = createComposerFocus(c.now);
    f.owe('tab-a');
    expect(f.step('ready', 'tab-b')).toBe(false); // another tab is shown
    expect(f.step('ready', 'tab-a')).toBe(false); // back: nothing owed any more
    f.owe('tab-a');
    expect(f.step('consent', 'tab-a')).toBe(false);
    expect(f.step('ready', 'tab-a')).toBe(false);
    f.owe('tab-a');
    c.advance(2_001); // past the panel focus request's own bound
    expect(f.step('ready', 'tab-a')).toBe(false);
    // The control: within the bound it is paid.
    f.owe('tab-a');
    c.advance(1_999);
    expect(f.step('ready', 'tab-a')).toBe(true);
  });
});
