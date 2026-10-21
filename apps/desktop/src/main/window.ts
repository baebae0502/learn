import { BrowserWindow } from 'electron';
import type { WindowState } from '@learn/domain';
import { layout } from '../renderer/src/design/tokens';
import { sendEvent } from './events';
import { attachEditContextMenu } from './menu/edit-context-menu';
import { mainWindowChrome, type ChromeOptions } from './window-options';

export interface MainWindowOptions {
  preload: string;
  url: string;
  /** Title bar, traffic lights, vibrancy and the first-frame colour (window-options.ts). */
  chrome: ChromeOptions;
}

/** What the windowState push and the ui.windowState query report. */
export const windowStateOf = (win: BrowserWindow): WindowState => ({ fullscreen: win.isFullScreen(), focused: win.isFocused() });

/** The main window in the M3 chrome (design-spec 2.1): hidden title bar, traffic lights or the controls overlay. */
export function createMainWindow(opts: MainWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    // Electron 44: bounds and maximized/fullscreen restored across restarts (stored per name in userData).
    name: 'main',
    windowStatePersistence: { bounds: true, displayMode: true },
    width: 1440,
    height: 900,
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
  // Sheets hang below the 52 px toolbar, not the (hidden) title bar (design-spec 6 시트).
  if (process.platform === 'darwin') win.setSheetOffset(layout.toolbarHeight);

  // windowState push: only on an actual change of fullscreen/focus.
  let last: WindowState | null = null;
  const pushState = () => {
    if (win.isDestroyed()) return;
    const next = windowStateOf(win);
    if (last && last.fullscreen === next.fullscreen && last.focused === next.focused) return;
    last = next;
    sendEvent(win.webContents, 'windowState', next);
  };
  win.on('enter-full-screen', pushState);
  win.on('leave-full-screen', pushState);
  win.on('enter-html-full-screen', pushState);
  win.on('leave-html-full-screen', pushState);
  win.on('focus', pushState);
  win.on('blur', pushState);

  void win.loadURL(opts.url);
  return win;
}
