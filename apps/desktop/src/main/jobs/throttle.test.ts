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
