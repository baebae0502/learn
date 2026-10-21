import { describe, expect, it, vi } from 'vitest';
import { createActivateGate } from './activate-gate';

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
});
