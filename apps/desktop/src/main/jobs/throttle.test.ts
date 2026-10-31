import { afterEach, describe, expect, it, vi } from 'vitest';
import { createThrottle } from './throttle';

afterEach(() => {
  vi.useRealTimers();
});

describe('createThrottle (spec 3.3: progress notices at most 10 a second)', () => {
  it('fires at once, then at most once a period, keeping one call for the end of it', () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const t = createThrottle(fire, 100);
    t.request();
    expect(fire).toHaveBeenCalledTimes(1);
    t.request();
    t.request();
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(99);
    expect(fire).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(fire).toHaveBeenCalledTimes(2); // nothing asked meanwhile
    t.request();
    expect(fire).toHaveBeenCalledTimes(3); // quiet for a period: at once again
  });

  it('a timer that fires before the clock has reached the period waits out the rest: two notices are never closer than the period', () => {
    vi.useFakeTimers();
    let clock = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const fire = vi.fn();
    const t = createThrottle(fire, 100);
    t.request();
    t.request();
    clock = 99.5; // the timer's own time is up, the clock's is not
    vi.advanceTimersByTime(100);
    expect(fire).toHaveBeenCalledTimes(1);
    clock = 100;
    vi.advanceTimersByTime(1);
    expect(fire).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('flush fires a pending call now, and nothing when none is pending', () => {
    vi.useFakeTimers();
    const fire = vi.fn();
    const t = createThrottle(fire, 1000);
    t.flush();
    expect(fire).not.toHaveBeenCalled();
    t.request();
    t.request();
    t.flush();
    expect(fire).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(2000);
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it('at 100 ms it never fires more than ten times in any second, however often it is asked', () => {
    vi.useFakeTimers();
    const stamps: number[] = [];
    const t = createThrottle(() => stamps.push(Date.now()), 100);
    for (let ms = 0; ms < 3000; ms++) {
      t.request();
      vi.advanceTimersByTime(1);
    }
    const busiest = Math.max(...stamps.map((s) => stamps.filter((x) => x >= s && x < s + 1000).length));
    expect(busiest).toBe(10);
  });
});
