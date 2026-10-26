import { BrowserWindow } from 'electron';
import type { WindowState } from '@learn/domain';
import { sendEvent } from './events';
import { releaseWhenKey } from './sheet-release';

/**
 * Each window's state as its renderer sees it (the main and the settings window alike): full screen, key, and whether
 * one of our sheets — a sheet window or a native dialog attached to it — keeps it the main window.
 *
 * Sheets per parent: 'open' while one is attached; 'releasing' from its closing until the parent is key again, during
 * which the parent is still held and main (windowState.sheetOpen, .main) but the sheet is gone (isSheetOpen).
 */
const sheets = new WeakMap<BrowserWindow, 'open' | 'releasing'>();
/**
 * Windows a native dialog (an open panel, an alert) hangs on now. The dialog is the key window, but Electron sends its
 * parent no 'blur' for it on macOS (Mac run 39779536146: the settings window kept its focus ring under its own
 * restart sheet, `underSheet.notKey` false; critique m2), so the parent counts as not key while it is up.
 */
const nativeSheets = new WeakMap<BrowserWindow, number>();
/** How many sheets (ours and native dialogs) hang on each window now: the last one to close releases it (re-review m7). */
const openCount = new WeakMap<BrowserWindow, number>();
const bump = (map: WeakMap<BrowserWindow, number>, win: BrowserWindow, by: 1 | -1): number => {
  const n = Math.max(0, (map.get(win) ?? 0) + by);
  if (n === 0) map.delete(win);
  else map.set(win, n);
  return n;
};
const releases = new WeakMap<BrowserWindow, () => void>();
const pushers = new WeakMap<BrowserWindow, () => void>();
/** Every tracked window's push, for a focus change anywhere among our windows (resyncAllWindowStates). */
const tracked = new Set<() => void>();

/**
 * Whether a window of ours other than `win` and its own sheets has the key: AppKit then makes that
 * window the main one, so `win` is neither key nor main even with a sheet attached. No key window at all (Electron's
 * report between one window's blur and the next one's focus, or with another app in front) does not count, nor does
 * `win` itself (Electron keeps reporting the parent of a native dialog key on macOS).
 */
function keyElsewhere(win: BrowserWindow): boolean {
  const key = BrowserWindow.getFocusedWindow();
  return key !== null && key.id !== win.id && key.getParentWindow()?.id !== win.id;
}

/** What the windowState push and the ui.windowState query report. */
export const windowStateOf = (win: BrowserWindow): WindowState => {
  const focused = win.isFocused() && !nativeSheets.has(win);
  const sheetOpen = sheets.has(win);
  return { fullscreen: win.isFullScreen(), focused, sheetOpen, main: focused || (sheetOpen && !keyElsewhere(win)) };
};

/** Whether one of our sheets is attached to `win` now. */
export const isSheetOpen = (win: BrowserWindow): boolean => sheets.get(win) === 'open';

/**
 * The windowState push for `win`: its own state, sent to its own renderer on an actual change of full screen, focus or
 * sheet. Each window has its own; another window's focus reaches it only through resyncAllWindowStates.
 */
export function trackWindowState(win: BrowserWindow): void {
  let last: WindowState | null = null;
  const pushState = () => {
    if (win.isDestroyed()) return;
    const next = windowStateOf(win);
    if (last && last.fullscreen === next.fullscreen && last.focused === next.focused && last.sheetOpen === next.sheetOpen && last.main === next.main) return;
    last = next;
    sendEvent(win.webContents, 'windowState', next);
  };
  win.on('enter-full-screen', pushState);
  win.on('leave-full-screen', pushState);
  win.on('enter-html-full-screen', pushState);
  win.on('leave-html-full-screen', pushState);
  win.on('focus', pushState);
  win.on('blur', pushState);
  pushers.set(win, pushState);
  tracked.add(pushState);
  win.once('closed', () => tracked.delete(pushState));
}

/**
 * Re-reads a window's state and pushes it if it changed. For the moments Electron emits no event: macOS makes the
 * parent key again when its sheet closes without a 'focus' event, which left the renderer showing an inactive window
 * (neutral selection, no tooltips) on run 39631541294.
 */
export function resyncWindowState(win: BrowserWindow): void {
  pushers.get(win)?.();
}

/**
 * Re-reads every tracked window's state and pushes the ones that changed. main/index.ts runs it whenever a window of
 * ours gains the focus (app 'browser-window-focus'): a window under a sheet stops being main when another window of
 * ours takes the key, and is main again when its sheet takes it back, with no event of its own.
 */
export function resyncAllWindowStates(): void {
  for (const push of tracked) push();
}

/**
 * A sheet is about to show on `win` (any window: main, settings): it stays main (design-spec 2.1); a pending release is
 * cancelled. `native`: a native dialog, which leaves `win` not key until its sheetClosed (nativeSheets). Counted: with
 * two in flight on one window, the mark holds until the last one closes.
 */
export function sheetShown(win: BrowserWindow, opts: { native?: boolean } = {}): void {
  if (win.isDestroyed()) return;
  if (opts.native) bump(nativeSheets, win, 1);
  bump(openCount, win, 1);
  releases.get(win)?.();
  releases.delete(win);
  sheets.set(win, 'open');
  resyncWindowState(win);
}

/**
 * A sheet on `win` has closed (`native`: one shown with `native`). While another is still attached the window stays
 * as it is (its state re-read). When the last one closes, `win` keeps counting as main until it is key again, so its
 * chrome never dims between the two (polish minor 1; sheet-release.ts); the window state is re-read then.
 */
export function sheetClosed(win: BrowserWindow, opts: { native?: boolean } = {}): void {
  if (opts.native) bump(nativeSheets, win, -1);
  const left = bump(openCount, win, -1);
  if (win.isDestroyed() || !sheets.has(win)) return;
  if (left > 0) {
    resyncWindowState(win);
    return;
  }
  sheets.set(win, 'releasing');
  releases.get(win)?.();
  const cancel = releaseWhenKey(win, () => {
    releases.delete(win);
    sheets.delete(win);
    resyncWindowState(win);
  });
  if (sheets.get(win) === 'releasing') releases.set(win, cancel);
}
