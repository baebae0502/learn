import { BrowserWindow, screen, type Rectangle } from 'electron';
import type { WindowState } from '@learn/domain';
import { layout } from '../renderer/src/design/tokens';
import { sendEvent } from './events';
import { attachEditContextMenu } from './menu/edit-context-menu';
import { defaultFrame, frameAfterFullScreen } from './window-frame';
import { mainWindowChrome, type ChromeOptions } from './window-options';

export interface MainWindowOptions {
  preload: string;
  url: string;
  /** Title bar, traffic lights, vibrancy and the first-frame colour (window-options.ts). */
  chrome: ChromeOptions;
}

const sheets = new WeakMap<BrowserWindow, boolean>();

/** What the windowState push and the ui.windowState query report. */
export const windowStateOf = (win: BrowserWindow): WindowState => ({ fullscreen: win.isFullScreen(), focused: win.isFocused(), sheetOpen: sheets.get(win) ?? false });

/** Whether one of our sheets is attached to `win` now. */
export const isSheetOpen = (win: BrowserWindow): boolean => sheets.get(win) ?? false;

/** The sheet host reports a sheet attached to (or gone from) `win`; the window state is pushed when it changes. */
export function setSheetOpen(win: BrowserWindow, open: boolean): void {
  if (win.isDestroyed()) return;
  sheets.set(win, open);
  resyncWindowState(win);
}

const pushers = new WeakMap<BrowserWindow, () => void>();
/**
 * Re-reads a main window's state and pushes it if it changed. For the moments Electron emits no event: macOS makes
 * the parent key again when its sheet closes without a 'focus' event, which left the renderer showing an inactive
 * window (neutral selection, no tooltips) on run 39631541294.
 */
export function resyncWindowState(win: BrowserWindow): void {
  pushers.get(win)?.();
}

/** The main window in the M3 chrome (design-spec 2.1): hidden title bar, traffic lights or the controls overlay. */
export function createMainWindow(opts: MainWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    // Electron 44: bounds and maximized/fullscreen restored across restarts (stored per name in userData); a saved
    // state wins over the default frame below.
    name: 'main',
    windowStatePersistence: { bounds: true, displayMode: true },
    // 1440 × 900 inside the work area, centred (R3-1: never larger than the screen).
    ...defaultFrame(screen.getPrimaryDisplay().workArea),
    minWidth: layout.windowMinWidth,
    minHeight: layout.windowMinHeight,
    show: false,
    title: 'Learn',
    ...mainWindowChrome(opts.chrome),
    webPreferences: {
      preload: opts.preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  attachEditContextMenu(win.webContents);
  keepFrameAcrossFullScreen(win);

  // windowState push: only on an actual change of fullscreen/focus.
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

  void win.loadURL(opts.url);
  return win;
}

/**
 * A full-screen round trip returns the window to the frame it had before (R3-1: macOS restored the 1440-wide frame
 * first asked for, not the one the window had). The windowed frame is noted once a move or resize has settled; on
 * leaving full screen, AppKit's own restore lands first, then the frame from before is put back if it differs.
 */
function keepFrameAcrossFullScreen(win: BrowserWindow): void {
  let windowed: Rectangle | null = null;
  let settle: ReturnType<typeof setTimeout> | undefined;
  const note = () => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (!win.isDestroyed() && !win.isFullScreen() && !win.isMaximized() && !win.isMinimized()) windowed = win.getBounds();
    }, 250);
  };
  win.on('show', note);
  win.on('resize', note);
  win.on('move', note);
  let before: Rectangle | null = null;
  win.on('enter-full-screen', () => {
    clearTimeout(settle);
    before = windowed ?? win.getNormalBounds();
  });
  win.on('leave-full-screen', () => {
    const want = before;
    before = null;
    setTimeout(() => {
      if (win.isDestroyed() || win.isFullScreen() || !want) return;
      const fix = frameAfterFullScreen(want, win.getBounds(), screen.getDisplayMatching(want).workArea);
      if (fix) win.setBounds(fix);
    }, 400);
  });
}
