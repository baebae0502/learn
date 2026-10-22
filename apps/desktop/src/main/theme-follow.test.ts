import { describe, expect, it } from 'vitest';
import { THEME_FOLLOW_MS, createThemeFollower, type ThemeFollowDeps, type ThemeMark } from './theme-follow';

/** A follower with a fake clock and timers; `log` records what was applied, in order. */
function setup(followers: number[] = [1, 2]) {
  let t = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextTimer = 1;
  const log: string[] = [];
  const marks: ThemeMark[] = [];
  const deps: ThemeFollowDeps = {
    applySource: (theme) => log.push(`source:${theme}`),
    applyWindowChrome: (id, shade) => log.push(`chrome:${id}:${shade}`),
    followers: () => followers,
    mark: (m) => marks.push(m),
    now: () => t,
    setTimer: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
  };
  const advance = (ms: number) => {
    t += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= t) {
        timers.delete(id);
        timer.fn();
      }
    }
  };
  return { follower: createThemeFollower(deps), log, marks, advance, timers };
}

describe('the native theme follows the page (T13R4-m1)', () => {
  it('applies nothing native until each page shows the change: its own chrome then, the app-wide theme after the last', () => {
    const { follower, log, advance } = setup([1, 2]);
    follower.pageChanged('dark');
    advance(40);
    expect(log).toEqual([]);
    follower.shown(2, 'dark'); // the settings page (it changed at the click)
    expect(log).toEqual(['chrome:2:dark']);
    advance(60);
    follower.shown(1, 'dark'); // the main page, after prefsChanged
    expect(log).toEqual(['chrome:2:dark', 'chrome:1:dark', 'source:dark']);
    advance(THEME_FOLLOW_MS);
    expect(log).toHaveLength(3); // the fallback was cleared
  });

  it('never waits for a page more than THEME_FOLLOW_MS: the native theme applies anyway', () => {
    const { follower, log, advance, marks } = setup([1, 2]);
    follower.pageChanged('light');
    follower.shown(2, 'light');
    advance(THEME_FOLLOW_MS - 1);
    expect(log).toEqual(['chrome:2:light']);
    advance(1);
    expect(log).toEqual(['chrome:2:light', 'source:light']);
    expect(marks.at(-1)).toMatchObject({ event: 'source', reason: 'timeout', theme: 'light', at: THEME_FOLLOW_MS });
    // A report that comes after it changes nothing.
    follower.shown(1, 'light');
    expect(log).toEqual(['chrome:2:light', 'source:light']);
  });

  it('ignores a report with no change pending, a second report from one page, and a page that is not a follower', () => {
    const { follower, log } = setup([1]);
    follower.shown(1, 'dark');
    expect(log).toEqual([]);
    follower.pageChanged('dark');
    follower.shown(9, 'dark');
    expect(log).toEqual([]);
    follower.shown(1, 'dark');
    follower.shown(1, 'dark');
    expect(log).toEqual(['chrome:1:dark', 'source:dark']);
  });

  it('applies at once when no page follows', () => {
    const { follower, log, timers } = setup([]);
    follower.pageChanged('dark');
    expect(log).toEqual(['source:dark']);
    expect(timers.size).toBe(0);
  });

  it('a second pick before the first was shown replaces it: only the latest is applied', () => {
    const { follower, log, advance } = setup([1]);
    follower.pageChanged('dark');
    advance(30);
    follower.pageChanged('light');
    follower.shown(1, 'light');
    expect(log).toEqual(['chrome:1:light', 'source:light']);
    advance(THEME_FOLLOW_MS);
    expect(log).toEqual(['chrome:1:light', 'source:light']);
  });

  it('marks every step with its time, for the evidence run', () => {
    const { follower, marks, advance } = setup([1]);
    follower.pageChanged('dark');
    advance(120);
    follower.shown(1, 'dark');
    expect(marks.map((m) => [m.event, m.at, m.windowId ?? null, m.reason ?? null])).toEqual([
      ['requested', 0, null, null],
      ['shown', 120, 1, null],
      ['chrome', 120, 1, null],
      ['source', 120, null, 'shown'],
    ]);
  });
});
