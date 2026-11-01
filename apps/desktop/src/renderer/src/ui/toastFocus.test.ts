import { describe, expect, it } from 'vitest';
import { createToastFocusReturn } from './toastFocus';

function setup(others: Record<string, string | null> = {}) {
  const region = new Set<string>(['cancel', 'region', 'toast-a', 'toast-b']);
  const log: string[] = [];
  const state = { active: 'body', connected: new Set(['table']) };
  const ret = createToastFocusReturn({
    active: () => state.active as unknown as Element,
    inRegion: (el) => el !== null && region.has(el as unknown as string),
    connected: (el) => state.connected.has(el as unknown as string),
    focus: (el) => {
      state.active = el as unknown as string;
      log.push(`focus ${el as unknown as string}`);
    },
    fallback: () => {
      state.active = 'content';
      log.push('fallback');
    },
    release: (to) => log.push(`release ${to as unknown as string}`),
    holds: (toast, el) => (toast as unknown as string) === 'toast-a' && (el as unknown as string) === 'cancel',
    another: (toast) => (others[toast as unknown as string] ?? null) as unknown as Element | null,
  });
  const el = (n: string | null) => n as unknown as Element | null;
  return { ret, state, log, el };
}

describe('the focus a job toast takes with it when it turns into its result', () => {
  it('goes back to where it was before it entered the region, and the hold ends', () => {
    const { ret, state, log, el } = setup();
    ret.entered(el('table'));
    ret.entered(el('cancel')); // inside the region already: the origin stays
    state.active = 'body'; // the button was replaced: no blur
    ret.settled();
    expect(log).toEqual(['focus table', 'release table']);
  });
  it('goes to the main content when the place it came from is gone', () => {
    const { ret, state, log, el } = setup();
    ret.entered(el('table'));
    state.connected.clear();
    state.active = 'body';
    ret.settled();
    expect(log).toEqual(['fallback', 'release content']);
  });
  it('does nothing when the focus is still in the region, or was never in it, or left by itself', () => {
    const a = setup();
    a.ret.entered(a.el('table'));
    a.state.active = 'cancel';
    a.ret.settled();
    const b = setup();
    b.ret.settled();
    const c = setup();
    c.ret.entered(c.el('table'));
    c.ret.left(c.el('table'));
    c.state.active = 'body';
    c.ret.settled();
    expect([a.log, b.log, c.log]).toEqual([[], [], []]);
  });
});

describe('the focus a toast takes with it when it closes (review N1)', () => {
  it('moves to the next toast when one is left, and stays in the region', () => {
    const { ret, state, log, el } = setup({ 'toast-a': 'toast-b' });
    ret.entered(el('table'));
    state.active = 'cancel';
    ret.closing(el('toast-a')!);
    expect(log).toEqual(['focus toast-b']);
  });
  it('with no toast left goes back to where it was, else to the main content, and the hold ends', () => {
    const a = setup();
    a.ret.entered(a.el('table'));
    a.state.active = 'cancel';
    a.ret.closing(a.el('toast-a')!);
    expect(a.log).toEqual(['focus table', 'release table']);
    const b = setup();
    b.state.active = 'cancel';
    b.ret.closing(b.el('toast-a')!);
    expect(b.log).toEqual(['fallback', 'release content']);
  });
  it('does nothing for a toast the focus is not on', () => {
    const { ret, state, log, el } = setup({ 'toast-b': 'toast-a' });
    ret.entered(el('table'));
    state.active = 'cancel';
    ret.closing(el('toast-b')!);
    expect(log).toEqual([]);
  });
});
