import { BrowserWindow } from 'electron';
import type { LearnEventMap } from '@learn/domain';
import { sendEvent } from './events';
import { attachEditContextMenu } from './menu/edit-context-menu';

export interface MainWindowOptions {
  preload: string;
  url: string;
}

/** Same window options as before M2 (the visual redesign is M3). */
export function createMainWindow(opts: MainWindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Learn',
    backgroundColor: '#eef2f6',
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

  // windowState push: only on an actual change of fullscreen/focus.
  let last: LearnEventMap['windowState'] | null = null;
  const pushState = () => {
    if (win.isDestroyed()) return;
    const next = { fullscreen: win.isFullScreen(), focused: win.isFocused() };
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
