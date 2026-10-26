import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { EventChannels } from '@learn/domain';

/** The window Electron reports key now (BrowserWindow.getFocusedWindow); tests move it as the focus moves. */
let keyWindow: { id: number; getParentWindow(): { id: number } | null } | null = null;
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => keyWindow } }));
const { isSheetOpen, resyncAllWindowStates, sheetClosed, sheetShown, trackWindowState, windowStateOf } = await import('./window-state');

let nextId = 1;
/** A BrowserWindow stand-in: tests set focus and full screen, emit its events, and read the pushes it received. */
class FakeWindow extends EventEmitter {
  readonly id = nextId++;
  focused = false;
  fullscreen = false;
  destroyed = false;
  readonly webContents = { isDestroyed: () => this.destroyed, send: vi.fn() };
  isFocused = () => this.focused;
  isFullScreen = () => this.fullscreen;
  isDestroyed = () => this.destroyed;
  getParentWindow = (): FakeWindow | null => null;
  /** The windowState payloads pushed to this window's renderer, oldest first. */
  pushes = () => this.webContents.send.mock.calls.filter(([channel]) => channel === EventChannels.windowState).map(([, payload]) => payload);
}
const win = (w: FakeWindow) => w as unknown as BrowserWindow;
/** One of our sheet windows over `parent`: only its identity matters to the window state. */
const sheetOver = (parent: FakeWindow) => ({ id: nextId++, getParentWindow: () => parent });

beforeEach(() => {
  vi.useFakeTimers();
  keyWindow = null;
});
afterEach(() => vi.useRealTimers());

describe('window state per window (main and settings each get their own)', () => {
  it('pushes a window its own state on a real change, and never another window\'s', () => {
    const main = new FakeWindow();
    const settings = new FakeWindow();
    trackWindowState(win(main));
    trackWindowState(win(settings));
    settings.focused = true;
    settings.emit('focus');
    expect(settings.pushes()).toEqual([{ fullscreen: false, focused: true, sheetOpen: false, main: true }]);
    expect(main.pushes()).toEqual([]); // the main window was not told about the settings window's focus
    main.emit('blur'); // the main window's own event: its own state
    settings.emit('focus'); // unchanged: nothing sent
    expect(main.pushes()).toEqual([{ fullscreen: false, focused: false, sheetOpen: false, main: false }]);
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
    expect(settings.pushes().at(-1)).toEqual({ fullscreen: false, focused: false, sheetOpen: true, main: true });
    sheetClosed(win(settings));
    expect(isSheetOpen(win(settings))).toBe(false);
    expect(windowStateOf(win(settings))).toMatchObject({ sheetOpen: true, main: true }); // still main until it is key again: no dimmed flash
    settings.focused = true; // AppKit makes it key again without a 'focus' event
    vi.advanceTimersByTime(250);
    expect(settings.pushes().at(-1)).toEqual({ fullscreen: false, focused: true, sheetOpen: false, main: true });
    expect(main.pushes()).toEqual([]); // the main window's state is untouched throughout
  });

  it('a native dialog on a window: not key under it although no blur comes (macOS), key again once it is gone (critique m2)', () => {
    const settings = new FakeWindow();
    trackWindowState(win(settings));
    settings.focused = true;
    settings.emit('focus');
    sheetShown(win(settings), { native: true });
    // Electron still says focused and sends no 'blur' on macOS: the push says not key, still main.
    expect(settings.pushes().at(-1)).toEqual({ fullscreen: false, focused: false, sheetOpen: true, main: true });
    expect(windowStateOf(win(settings)).focused).toBe(false);
    sheetClosed(win(settings), { native: true }); // the dialog resolved; the window is key (isFocused) at once
    expect(settings.pushes().at(-1)).toEqual({ fullscreen: false, focused: true, sheetOpen: false, main: true });

    // Our own sheet window takes the key itself (its parent gets 'blur'): not marked, the parent's own focus counts.
    sheetShown(win(settings));
    expect(windowStateOf(win(settings))).toEqual({ fullscreen: false, focused: true, sheetOpen: true, main: true });
    sheetClosed(win(settings));
  });

  it('two native dialogs in flight on one window: it stays under a sheet, not key, until the last one closes (re-review m7)', () => {
    const main = new FakeWindow();
    trackWindowState(win(main));
    main.focused = true;
    main.emit('focus');
    sheetShown(win(main), { native: true });
    sheetShown(win(main), { native: true });
    sheetClosed(win(main), { native: true }); // the first resolves
    expect(isSheetOpen(win(main))).toBe(true);
    expect(windowStateOf(win(main))).toEqual({ fullscreen: false, focused: false, sheetOpen: true, main: true });
    vi.advanceTimersByTime(500);
    expect(main.pushes().at(-1)).toEqual({ fullscreen: false, focused: false, sheetOpen: true, main: true }); // nothing released meanwhile
    sheetClosed(win(main), { native: true }); // the last one: released at once (the window is key)
    expect(isSheetOpen(win(main))).toBe(false);
    expect(main.pushes().at(-1)).toEqual({ fullscreen: false, focused: true, sheetOpen: false, main: true });
    // A close with nothing open changes nothing, and does not leave a debt for the next sheet.
    sheetClosed(win(main), { native: true });
    sheetShown(win(main), { native: true });
    expect(windowStateOf(win(main))).toEqual({ fullscreen: false, focused: false, sheetOpen: true, main: true });
    sheetClosed(win(main), { native: true });
    expect(windowStateOf(win(main))).toEqual({ fullscreen: false, focused: true, sheetOpen: false, main: true });
  });
});

describe('a sheet keeps its window main only while no other window of ours has the key (final review m5)', () => {
  it('the main window under its sheet: the settings window taking the key makes it not main, its sheet taking it back makes it main again', () => {
    const main = new FakeWindow();
    const settings = new FakeWindow();
    trackWindowState(win(main));
    trackWindowState(win(settings));
    main.focused = true;
    keyWindow = main;
    main.emit('focus');
    sheetShown(win(main)); // the ⌘/ sheet is about to show over the main window
    const sheet = sheetOver(main);
    main.focused = false;
    keyWindow = sheet;
    main.emit('blur'); // the sheet has the key: the main window is not key, still main
    expect(main.pushes().at(-1)).toEqual({ fullscreen: false, focused: false, sheetOpen: true, main: true });

    // A click on the settings window: AppKit makes it key and main. The main window gets no event of its own for it.
    const before = main.pushes().length;
    keyWindow = settings;
    settings.focused = true;
    settings.emit('focus');
    expect(main.pushes()).toHaveLength(before);
    resyncAllWindowStates(); // main/index.ts runs this on app 'browser-window-focus'
    expect(main.pushes().at(-1)).toEqual({ fullscreen: false, focused: false, sheetOpen: true, main: false });
    expect(settings.pushes().at(-1)).toEqual({ fullscreen: false, focused: true, sheetOpen: false, main: true });
    expect(isSheetOpen(win(main))).toBe(true); // still held by its sheet: its commands stay refused

    // Back on the sheet: main again.
    keyWindow = sheet;
    settings.focused = false;
    settings.emit('blur');
    resyncAllWindowStates();
    expect(main.pushes().at(-1)).toEqual({ fullscreen: false, focused: false, sheetOpen: true, main: true });
    // No key window reported (between one window's blur and the next one's focus): no dimmed flash.
    keyWindow = null;
    const settled = main.pushes().length;
    resyncAllWindowStates();
    expect(main.pushes()).toHaveLength(settled);
  });

  it('the settings window under its native folder dialog: the main window taking the key makes it not main, its own key back makes it main again', () => {
    const main = new FakeWindow();
    const settings = new FakeWindow();
    trackWindowState(win(main));
    trackWindowState(win(settings));
    settings.focused = true;
    keyWindow = settings;
    settings.emit('focus');
    sheetShown(win(settings), { native: true }); // Electron keeps reporting the settings window key under its dialog
    expect(settings.pushes().at(-1)).toEqual({ fullscreen: false, focused: false, sheetOpen: true, main: true });

    settings.focused = false;
    main.focused = true;
    keyWindow = main;
    main.emit('focus');
    resyncAllWindowStates();
    expect(settings.pushes().at(-1)).toEqual({ fullscreen: false, focused: false, sheetOpen: true, main: false });
    expect(main.pushes().at(-1)).toEqual({ fullscreen: false, focused: true, sheetOpen: false, main: true });

    main.focused = false;
    settings.focused = true;
    keyWindow = settings;
    main.emit('blur');
    settings.emit('focus');
    expect(settings.pushes().at(-1)).toEqual({ fullscreen: false, focused: false, sheetOpen: true, main: true });
    sheetClosed(win(settings), { native: true });
    expect(settings.pushes().at(-1)).toEqual({ fullscreen: false, focused: true, sheetOpen: false, main: true });
  });

  it('after its sheet closed a window stays main until it is key, unless another window of ours takes the key meanwhile', () => {
    const main = new FakeWindow();
    const settings = new FakeWindow();
    trackWindowState(win(main));
    trackWindowState(win(settings));
    sheetShown(win(main));
    keyWindow = sheetOver(main);
    main.emit('blur');
    sheetClosed(win(main)); // the sheet is gone; AppKit has not made the main window key yet
    keyWindow = null;
    expect(windowStateOf(win(main))).toEqual({ fullscreen: false, focused: false, sheetOpen: true, main: true });
    keyWindow = settings;
    settings.focused = true;
    settings.emit('focus');
    resyncAllWindowStates();
    expect(main.pushes().at(-1)).toEqual({ fullscreen: false, focused: false, sheetOpen: true, main: false });
    vi.advanceTimersByTime(250); // released without becoming key: no sheet, not main
    expect(main.pushes().at(-1)).toEqual({ fullscreen: false, focused: false, sheetOpen: false, main: false });
  });

  it('a closed window leaves the re-read list', () => {
    const w = new FakeWindow();
    trackWindowState(win(w));
    w.emit('closed');
    w.focused = true;
    resyncAllWindowStates();
    expect(w.pushes()).toEqual([]);
  });
});
