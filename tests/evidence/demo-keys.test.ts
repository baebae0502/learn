import { describe, expect, it } from 'vitest';
import { LATE_KEY_MS, SETTLE_MS, pressKey, type KeyPress } from './demo-keys';

class NotPermitted extends Error {}

/**
 * A sidebar and a ⌃⌘S whose System Events call times out. `lateAt`: when (ms after the press) the stuck key lands
 * anyway and toggles the sidebar; null: never. The menu fallback drives the sidebar to the target, never toggles it.
 */
function sidebarPress(opts: { lateAt: number | null; target?: 'hidden' | 'shown'; refuse?: boolean }) {
  let t = 0;
  let sidebar: 'hidden' | 'shown' = 'shown';
  const target = opts.target ?? 'hidden';
  const notes: string[] = [];
  let lateDone = false;
  const toggle = () => (sidebar = sidebar === 'shown' ? 'hidden' : 'shown');
  const advance = (ms: number) => {
    const end = t + ms;
    if (opts.lateAt !== null && !lateDone && opts.lateAt <= end) {
      lateDone = true;
      toggle();
    }
    t = end;
  };
  const press: KeyPress = {
    name: 'control+command+s',
    native: async () => {
      advance(5000); // the 5 s Apple Event limit
      throw opts.refuse ? new NotPermitted('-1743') : new Error('ETIMEDOUT');
    },
    fallback: async () => {
      if (sidebar !== target) toggle(); // idempotent: to the target, never past it
    },
    landed: async () => sidebar === target,
    settle: { holds: async () => sidebar === target, restore: async () => void (sidebar = target) },
    isNotPermitted: (e) => e instanceof NotPermitted,
    note: (text) => notes.push(text),
    sleep: async (ms) => advance(ms),
    errorText: (e) => (e as Error).message,
  };
  return { press, notes, sidebar: () => sidebar, now: () => t };
}

describe('a core key through System Events, with its menu item as the fallback (re-review minor 1)', () => {
  it('a key that went out is all there is', async () => {
    const notes: string[] = [];
    let ran = 0;
    const r = await pressKey({
      name: 'command+k',
      native: async () => {},
      fallback: async () => void ran++,
      isNotPermitted: () => false,
      note: (text) => notes.push(text),
      sleep: async () => {},
      errorText: String,
    });
    expect([r, ran, notes]).toEqual(['native', 0, []]);
  });

  it('a stuck key that lands within a second is not run again', async () => {
    const s = sidebarPress({ lateAt: 5000 + LATE_KEY_MS / 2 });
    expect(await pressKey(s.press)).toBe('late');
    expect(s.sidebar()).toBe('hidden');
    expect(s.notes).toEqual(['control+command+s through System Events failed (ETIMEDOUT): the menu item instead', 'control+command+s had landed late: not run again']);
  });

  it('a stuck key that never lands: the menu item brings the state, and it still holds 2 s later', async () => {
    const s = sidebarPress({ lateAt: null });
    expect(await pressKey(s.press)).toBe('menu');
    expect(s.sidebar()).toBe('hidden');
    expect(s.now()).toBe(5000 + LATE_KEY_MS + SETTLE_MS);
    expect(s.notes).toHaveLength(1);
  });

  it('a key that lands after the menu item undid it: the state is put back, with a note', async () => {
    const s = sidebarPress({ lateAt: 5000 + LATE_KEY_MS + SETTLE_MS / 2 });
    expect(await pressKey(s.press)).toBe('menu');
    expect(s.sidebar()).toBe('hidden');
    expect(s.notes.at(-1)).toBe('control+command+s landed after its menu item and undid it: the state was put back');
  });

  it('a refused key runs the menu item at once: nothing was queued that could land', async () => {
    const s = sidebarPress({ lateAt: null, refuse: true });
    expect(await pressKey(s.press)).toBe('menu');
    expect(s.sidebar()).toBe('hidden');
    expect(s.now()).toBe(5000);
    expect(s.notes).toEqual(['System Events refused control+command+s (-1743): the menu item instead']);
  });

  it('the fallback drives the state to the target: run when it is already there, it changes nothing', async () => {
    const s = sidebarPress({ lateAt: null, target: 'shown' });
    expect(await pressKey(s.press)).toBe('late'); // already shown: "landed"
    expect(s.sidebar()).toBe('shown');
  });
});
