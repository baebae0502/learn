import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchDay, type DayWatchTargets } from './useNow';

/** Window and document stand-ins: focus on the one, visibilitychange (with visibilityState) on the other. */
function targets(): DayWatchTargets & { doc: EventTarget & { visibilityState: string } } {
  return { win: new EventTarget(), doc: Object.assign(new EventTarget(), { visibilityState: 'visible' }) };
}

describe('watchDay (useNow: 오늘/어제 move on with the calendar day)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 21, 23, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('reports the new day just after local midnight, then stops', () => {
    const onDay = vi.fn();
    watchDay(new Date(), onDay, targets());
    vi.advanceTimersByTime(60 * 60 * 1000); // 00:00:00 — the 1 s slack has not passed yet
    expect(onDay).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onDay).toHaveBeenCalledExactlyOnceWith(new Date(2026, 9, 22, 0, 0, 1));
  });

  it('on focus or on becoming visible, reports only a changed day (sleep, clock or time zone change)', () => {
    const onDay = vi.fn();
    const t = targets();
    watchDay(new Date(), onDay, t);
    t.win.dispatchEvent(new Event('focus'));
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(onDay).not.toHaveBeenCalled(); // same day: no re-render
    vi.setSystemTime(new Date(2026, 9, 23, 9, 0)); // woke up two days later; the timer has not fired yet
    t.doc.visibilityState = 'hidden';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(onDay).not.toHaveBeenCalled(); // hidden: nothing to show
    t.doc.visibilityState = 'visible';
    t.doc.dispatchEvent(new Event('visibilitychange'));
    expect(onDay).toHaveBeenCalledExactlyOnceWith(new Date(2026, 9, 23, 9, 0));
    t.win.dispatchEvent(new Event('focus'));
    expect(onDay).toHaveBeenCalledTimes(1); // stopped after reporting: the next watch starts from the new day
  });

  it('a timer that fires on the same day (clock set back) waits for the next midnight', () => {
    const onDay = vi.fn();
    watchDay(new Date(), onDay, targets());
    vi.setSystemTime(new Date(2026, 9, 21, 20, 0)); // set back 3 h before the timer fires
    vi.advanceTimersByTime(60 * 60 * 1000 + 1000);
    expect(onDay).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    expect(onDay).toHaveBeenCalledTimes(1);
  });

  it('stop removes the listeners and the timer', () => {
    const onDay = vi.fn();
    const t = targets();
    const stop = watchDay(new Date(), onDay, t);
    stop();
    vi.setSystemTime(new Date(2026, 9, 25, 9, 0));
    t.win.dispatchEvent(new Event('focus'));
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);
    expect(onDay).not.toHaveBeenCalled();
  });
});
