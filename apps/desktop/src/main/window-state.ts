import type { BrowserWindow } from 'electron';
import type { WindowState } from '@learn/domain';
import { sendEvent } from './events';
import { releaseWhenKey } from './sheet-release';

/**
 * Each window's state as its renderer sees it (the main and the settings window alike): full screen, key, and whether
 * one of our sheets — a sheet window or a native dialog attached to it — keeps it the main window.
 *
 * Sheets per parent: 'open' while one is attached; 'releasing' from its closing until the parent is key again, during
 * which the parent still counts as main (windowState.sheetOpen) but the sheet is gone (isSheetOpen).
 */
const sheets = new WeakMap<BrowserWindow, 'open' | 'releasing'>();
/**
 * Windows a native dialog (an open panel, an alert) hangs on now. The dialog is the key window, but Electron sends its
 * parent no 'blur' for it on macOS (Mac run 39779536146: the settings window kept its focus ring under its own
 * restart sheet, `underSheet.notKey` false; critique m2), so the parent counts as not key while it is up.
 */
const nativeSheets = new WeakSet<BrowserWindow>();
const releases = new WeakMap<BrowserWindow, () => void>();
const pushers = new WeakMap<BrowserWindow, () => void>();

/** What the windowState push and the ui.windowState query report. */
export const windowStateOf = (win: BrowserWindow): WindowState => ({
  fullscreen: win.isFullScreen(),
  focused: win.isFocused() && !nativeSheets.has(win),
  sheetOpen: sheets.has(win),
});

/** Whether one of our sheets is attached to `win` now. */
export const isSheetOpen = (win: BrowserWindow): boolean => sheets.get(win) === 'open';

/**
 * The windowState push for `win`: its own state, sent to its own renderer on an actual change of full screen, focus or
 * sheet. Each window has its own; one window's focus never reaches another's renderer.
 */
export function trackWindowState(win: BrowserWindow): void {
  let last: WindowState | null = null;
  const pushState = () => {
    if (win.isDestroyed()) return;
    const next = windowStateOf(win);
    if (last && last.fullscreen === next.fullscreen && last.focused === next.focused && last.sheetOpen === next.sheetOpen) return;
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
 * A sheet is about to show on `win` (any window: main, settings): it stays main (design-spec 2.1); a pending release is
 * cancelled. `native`: a native dialog, which leaves `win` not key until sheetClosed (nativeSheets).
 */
export function sheetShown(win: BrowserWindow, opts: { native?: boolean } = {}): void {
  if (win.isDestroyed()) return;
  if (opts.native) nativeSheets.add(win);
  releases.get(win)?.();
  releases.delete(win);
  sheets.set(win, 'open');
  resyncWindowState(win);
}

/**
 * The sheet on `win` has closed. `win` keeps counting as main until it is key again, so its chrome never dims
 * between the two (polish minor 1; sheet-release.ts); the window state is re-read then.
 */
export function sheetClosed(win: BrowserWindow): void {
  nativeSheets.delete(win);
  if (win.isDestroyed() || !sheets.has(win)) return;
  sheets.set(win, 'releasing');
  releases.get(win)?.();
  const cancel = releaseWhenKey(win, () => {
    releases.delete(win);
    sheets.delete(win);
    resyncWindowState(win);
  });
  if (sheets.get(win) === 'releasing') releases.set(win, cancel);
}
