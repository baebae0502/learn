import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { EventChannels } from '@learn/domain';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
const { isSheetOpen, sheetClosed, sheetShown, trackWindowState, windowStateOf } = await import('./window-state');

/** A BrowserWindow stand-in: tests set focus and full screen, emit its events, and read the pushes it received. */
class FakeWindow extends EventEmitter {
  focused = false;
  fullscreen = false;
  destroyed = false;
  readonly webContents = { isDestroyed: () => this.destroyed, send: vi.fn() };
  isFocused = () => this.focused;
  isFullScreen = () => this.fullscreen;
  isDestroyed = () => this.destroyed;
  /** The windowState payloads pushed to this window's renderer, oldest first. */
  pushes = () => this.webContents.send.mock.calls.filter(([channel]) => channel === EventChannels.windowState).map(([, payload]) => payload);
}
const win = (w: FakeWindow) => w as unknown as BrowserWindow;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('window state per window (main and settings each get their own)', () => {
  it('pushes a window its own state on a real change, and never another window\'s', () => {
    const main = new FakeWindow();
    const settings = new FakeWindow();
    trackWindowState(win(main));
    trackWindowState(win(settings));
    settings.focused = true;
    settings.emit('focus');
    expect(settings.pushes()).toEqual([{ fullscreen: false, focused: true, sheetOpen: false }]);
    expect(main.pushes()).toEqual([]); // the main window was not told about the settings window's focus
    main.emit('blur'); // the main window's own event: its own state
    settings.emit('focus'); // unchanged: nothing sent
    expect(main.pushes()).toEqual([{ fullscreen: false, focused: false, sheetOpen: false }]);
    expect(settings.pushes()).toHaveLength(1);
  });

  it('a native sheet on the settings window: it stays main under it, and is re-read once it is key again (38e3a9e for any owner)', () => {
    const main = new FakeWindow();
    const settings = new FakeWindow();
    trackWindowState(win(main));
    trackWindowState(win(settings));
    settings.focused = true;
    settings.emit('focus');
    sheetShown(win(settings)); // the folder dialog / restart confirmation attaches to the settings window
    expect(isSheetOpen(win(settings))).toBe(true);
    settings.focused = false;
    settings.emit('blur'); // the sheet is key now; the settings window is still main (sheetOpen)
    expect(settings.pushes().at(-1)).toEqual({ fullscreen: false, focused: false, sheetOpen: true });
    sheetClosed(win(settings));
    expect(isSheetOpen(win(settings))).toBe(false);
    expect(windowStateOf(win(settings)).sheetOpen).toBe(true); // still main until it is key again: no dimmed flash
    settings.focused = true; // AppKit makes it key again without a 'focus' event
    vi.advanceTimersByTime(250);
    expect(settings.pushes().at(-1)).toEqual({ fullscreen: false, focused: true, sheetOpen: false });
    expect(main.pushes()).toEqual([]); // the main window's state is untouched throughout
  });
});
