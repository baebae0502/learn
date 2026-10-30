import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REBUILD_DELAY_MS, createMenuRebuilder } from './rebuild';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the menu bar rebuild (debounced, never under an open menu)', () => {
  it('rebuilds once, 100 ms after the last request', () => {
    const rebuild = vi.fn();
    const r = createMenuRebuilder(rebuild);
    expect(REBUILD_DELAY_MS).toBe(100);
    r.request();
    vi.advanceTimersByTime(60);
    r.request(); // a burst of notices: the clock starts over
    vi.advanceTimersByTime(99);
    expect(rebuild).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(rebuild).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });
  it('waits while a native menu is open, and rebuilds 100 ms after it closes', () => {
    const rebuild = vi.fn();
    const r = createMenuRebuilder(rebuild);
    r.menuOpenChanged(true);
    r.request();
    vi.advanceTimersByTime(5000);
    expect(rebuild).not.toHaveBeenCalled();
    r.menuOpenChanged(false);
    vi.advanceTimersByTime(99); // AppKit sends the clicked item's action after the menu closes: the item must still exist
    expect(rebuild).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });
  it('a close before the clock ran out changes nothing: one rebuild, when the clock does', () => {
    const rebuild = vi.fn();
    const r = createMenuRebuilder(rebuild);
    r.request();
    vi.advanceTimersByTime(50);
    r.menuOpenChanged(true);
    r.menuOpenChanged(false);
    vi.advanceTimersByTime(50);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });
  it('a menu that opens and closes with nothing asked for rebuilds nothing', () => {
    const rebuild = vi.fn();
    const r = createMenuRebuilder(rebuild);
    r.menuOpenChanged(true);
    r.menuOpenChanged(false);
    vi.advanceTimersByTime(1000);
    expect(rebuild).not.toHaveBeenCalled();
  });
  it('a request during the wait after a close starts the clock again; cancel drops what is pending', () => {
    const rebuild = vi.fn();
    const r = createMenuRebuilder(rebuild);
    r.menuOpenChanged(true);
    r.request();
    vi.advanceTimersByTime(200);
    r.menuOpenChanged(false);
    vi.advanceTimersByTime(60);
    r.request();
    vi.advanceTimersByTime(99);
    expect(rebuild).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(rebuild).toHaveBeenCalledTimes(1);
    r.request();
    r.cancel();
    vi.advanceTimersByTime(1000);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });
});
