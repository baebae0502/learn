import { describe, expect, it, vi } from 'vitest';
import { ACTIVATE_RETRY_ATTEMPTS, ACTIVATE_RETRY_MS, createActivateGate } from './activate-gate';

describe('activate gate', () => {
  it('opens no window on activate until protocol + IPC registration has finished', () => {
    let windows = 0;
    const openWindow = vi.fn(() => void (windows += 1));
    const gate = createActivateGate({ openWindow, windowCount: () => windows });

    gate.onActivate(); // dock click while the library is still opening
    gate.onActivate();
    expect(openWindow).not.toHaveBeenCalled();

    gate.markReady();
    gate.onActivate();
    expect(openWindow).toHaveBeenCalledTimes(1);
    gate.onActivate(); // a window exists: nothing more
    expect(openWindow).toHaveBeenCalledTimes(1);

    windows = 0; // all windows closed (macOS keeps running)
    gate.onActivate();
    expect(openWindow).toHaveBeenCalledTimes(2);
  });

  it('a dock click just after the main window closed waits for its name: Electron frees "main" a moment after the window is gone', () => {
    vi.useFakeTimers();
    try {
      let windows = 0;
      let refusals = 2;
      const inUse = () => new Error("Window name 'main' is already in use. Window names must be unique.");
      const openWindow = vi.fn(() => {
        if (refusals > 0) {
          refusals -= 1;
          throw inUse();
        }
        windows += 1;
      });
      const gate = createActivateGate({ openWindow, windowCount: () => windows });
      gate.markReady();

      gate.onActivate();
      expect(openWindow).toHaveBeenCalledTimes(1);
      gate.onActivate(); // a second click while the first waits: still one window to come
      expect(openWindow).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(ACTIVATE_RETRY_MS);
      expect(openWindow).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(ACTIVATE_RETRY_MS);
      expect(openWindow).toHaveBeenCalledTimes(3);
      expect(windows).toBe(1);
      vi.advanceTimersByTime(ACTIVATE_RETRY_MS * 10);
      expect(openWindow).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('any other failure to open the window is thrown as before, and the name is waited for only so long', () => {
    vi.useFakeTimers();
    try {
      const gate = createActivateGate({ openWindow: () => { throw new Error('boom'); }, windowCount: () => 0 });
      gate.markReady();
      expect(() => gate.onActivate()).toThrow('boom');

      const always = vi.fn(() => { throw new Error("Window name 'main' is already in use. Window names must be unique."); });
      const warn = vi.fn();
      const stuck = createActivateGate({ openWindow: always, windowCount: () => 0, warn });
      stuck.markReady();
      stuck.onActivate();
      for (let i = 1; i < ACTIVATE_RETRY_ATTEMPTS; i++) vi.advanceTimersByTime(ACTIVATE_RETRY_MS);
      expect(always).toHaveBeenCalledTimes(ACTIVATE_RETRY_ATTEMPTS);
      expect(() => vi.advanceTimersByTime(ACTIVATE_RETRY_MS)).not.toThrow();
      expect(always).toHaveBeenCalledTimes(ACTIVATE_RETRY_ATTEMPTS);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
