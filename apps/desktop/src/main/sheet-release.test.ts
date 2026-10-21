import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { releaseWhenKey, type KeyWindow } from './sheet-release';

class FakeParent extends EventEmitter implements KeyWindow {
  focused = false;
  destroyed = false;
  isDestroyed = () => this.destroyed;
  isFocused = () => this.focused;
  focus() {
    this.focused = true;
    this.emit('focus');
  }
}

describe('releaseWhenKey: a sheet\'s parent stays main until it is key again (polish minor 1)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('releases at once when the parent is already key', () => {
    const parent = new FakeParent();
    parent.focused = true;
    const release = vi.fn();
    releaseWhenKey(parent, release);
    expect(release).toHaveBeenCalledTimes(1);
    expect(parent.listenerCount('focus')).toBe(0);
  });

  it('holds until the parent is focused, then releases once (not again at the re-read)', () => {
    const parent = new FakeParent();
    const release = vi.fn();
    releaseWhenKey(parent, release);
    vi.advanceTimersByTime(100);
    expect(release).not.toHaveBeenCalled(); // the chrome stays undimmed between the close and the key
    parent.focus();
    expect(release).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1_000);
    expect(release).toHaveBeenCalledTimes(1);
    expect(parent.listenerCount('focus')).toBe(0);
  });

  it('releases at the re-read when no focus event comes (macOS makes the parent key silently, or another app took it)', () => {
    const parent = new FakeParent();
    const release = vi.fn();
    releaseWhenKey(parent, release, 250);
    vi.advanceTimersByTime(249);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(parent.listenerCount('focus')).toBe(0);
  });

  it('a new sheet before the release cancels it', () => {
    const parent = new FakeParent();
    const release = vi.fn();
    const cancel = releaseWhenKey(parent, release);
    cancel();
    parent.focus();
    vi.advanceTimersByTime(1_000);
    expect(release).not.toHaveBeenCalled();
    expect(parent.listenerCount('focus')).toBe(0);
  });

  it('never releases a destroyed parent', () => {
    const parent = new FakeParent();
    const release = vi.fn();
    releaseWhenKey(parent, release);
    parent.destroyed = true;
    vi.advanceTimersByTime(1_000);
    expect(release).not.toHaveBeenCalled();
  });
});
