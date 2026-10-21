import { BrowserWindow, screen } from 'electron';
import { layout } from '../renderer/src/design/tokens';
import { attachEditContextMenu } from './menu/edit-context-menu';
import { FullScreenFrameKeeper, defaultFrame } from './window-frame';
import { mainWindowChrome, type ChromeOptions } from './window-options';
import { trackWindowState } from './window-state';

export interface MainWindowOptions {
  preload: string;
  url: string;
  /** Title bar, traffic lights, vibrancy and the first-frame colour (window-options.ts). */
  chrome: ChromeOptions;
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

  trackWindowState(win); // windowState push: only on an actual change of full screen, focus or sheet

  void win.loadURL(opts.url);
  return win;
}

/**
 * A full-screen round trip returns the window to the frame it had before (R3-1: macOS restored the 1440-wide frame
 * first asked for, not the one the window had). The rules are FullScreenFrameKeeper's (window-frame.ts): the windowed
 * frame is noted once a move or resize has settled, and only while the window is neither zoomed nor full screen; a
 * zoomed window is left to AppKit; otherwise the frame from before is put back 400 ms after leaving (AppKit's restore
 * lands first) unless the user moved or resized the window meanwhile.
 */
function keepFrameAcrossFullScreen(win: BrowserWindow): void {
  const keeper = new FullScreenFrameKeeper();
  const now = () => ({ bounds: win.getBounds(), zoomed: win.isMaximized(), fullscreen: win.isFullScreen(), minimized: win.isMinimized() });
  let settle: ReturnType<typeof setTimeout> | undefined;
  let reapply: ReturnType<typeof setTimeout> | undefined;
  const note = () => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (!win.isDestroyed()) keeper.settled(now());
    }, 250);
  };
  // Between leaving full screen and the re-apply, a move or resize inside the work area is the user's (the keeper
  // causes none before it); one that leaves the window off screen or oversize is not, and the re-apply fixes it.
  const changed = () => {
    if (!win.isDestroyed()) {
      const now = win.getBounds();
      keeper.moved(now, screen.getDisplayMatching(now).workArea);
    }
    note();
  };
  win.on('show', note);
  win.on('resize', changed);
  win.on('move', changed);
  win.on('maximize', () => keeper.settled(now()));
  win.on('unmaximize', () => keeper.settled(now()));
  win.on('enter-full-screen', () => {
    clearTimeout(settle);
    clearTimeout(reapply);
    keeper.enter(win.getNormalBounds());
  });
  win.on('leave-full-screen', () => {
    if (!keeper.leave(win.getBounds())) return;
    clearTimeout(reapply);
    reapply = setTimeout(() => {
      const target = keeper.target;
      if (win.isDestroyed() || win.isFullScreen() || !target) return;
      const fix = keeper.due(win.getBounds(), screen.getDisplayMatching(target).workArea);
      if (fix) win.setBounds(fix);
    }, 400);
  });
}
