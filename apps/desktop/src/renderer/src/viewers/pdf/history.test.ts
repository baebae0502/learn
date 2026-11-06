import { describe, expect, test } from 'vitest';
import { canGoBack, canGoForward, emptyHistory, goBack, goForward, HISTORY_MAX, recordJump } from './history';

describe('history', () => {
  test('forward returns to the last place, not the jump target', () => {
    const h = recordJump(emptyHistory<string>(), 'p1');
    const b = goBack(h, 'p50, read on to p52')!;
    expect(b.target).toBe('p1');
    const f = goForward(b.history, 'p1')!;
    expect(f.target).toBe('p50, read on to p52');
  });
  test('a new jump after going back drops what was ahead', () => {
    let h = recordJump(recordJump(emptyHistory<string>(), 'a'), 'b');
    h = goBack(h, 'c')!.history;
    h = recordJump(h, 'b2');
    expect(canGoForward(h)).toBe(false);
    expect(h.entries).toEqual(['a', 'b2', null]);
  });
  test('fifty entries at most', () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < 60; i++) h = recordJump(h, i);
    expect(h.entries.length).toBe(HISTORY_MAX);
    expect(h.entries[0]).toBe(11);
  });
  test('an empty history cannot go back, the end cannot go forward', () => {
    const h = emptyHistory<string>();
    expect(goBack(h, 'x')).toBeNull();
    expect(goForward(h, 'x')).toBeNull();
    expect(canGoBack(h)).toBe(false);
    expect(canGoForward(h)).toBe(false);
    const j = recordJump(h, 'a');
    expect(canGoBack(j)).toBe(true);
    expect(goForward(j, 'b')).toBeNull();
  });
  test('back twice, then forward twice walks the same places', () => {
    let h = recordJump(recordJump(emptyHistory<string>(), 'a'), 'b');
    const b1 = goBack(h, 'c')!;
    expect(b1.target).toBe('b');
    const b2 = goBack(b1.history, 'b')!;
    expect(b2.target).toBe('a');
    const f1 = goForward(b2.history, 'a')!;
    expect(f1.target).toBe('b');
    expect(goForward(f1.history, 'b')!.target).toBe('c');
    h = f1.history;
    expect(canGoBack(h)).toBe(true);
  });
});
