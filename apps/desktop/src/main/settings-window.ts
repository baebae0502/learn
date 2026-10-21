import { BrowserWindow } from 'electron';
import { windowBackground } from '../renderer/src/design/tokens.generated';
import { contentHeight, followContentHeight, markSized } from './measure';
import { currentTheme } from './theme';
import { trackWindowState } from './window-state';

export const SETTINGS_WIDTH = 600;
/** Off a main window, the settings window opens this far below its top edge (centred across it). */
const BELOW_MAIN_TOP = 96;

export interface SettingsWindow {
  /** ⌘, : opens the settings window, or brings the open one to the front. */
  open(): BrowserWindow;
  /** The open settings window, if any (theme changes reach it by name). */
  current(): BrowserWindow | null;
}

/**
 * ⌘, (design-spec 6 설정 창): one standard window with the title "설정", 600 wide, as tall as its content (also when a
 * message appears in it), not resizable by hand. Changes apply at once; it has no 완료 or × button of its own (closed by
 * its traffic light or ⌘W).
 */
export function createSettingsWindow(deps: { preload: string; url(): string; main(): BrowserWindow | null }): SettingsWindow {
  let win: BrowserWindow | null = null;
  return {
    current: () => (win && !win.isDestroyed() ? win : null),
    open(): BrowserWindow {
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
        return win;
      }
      const created = new BrowserWindow({
        width: SETTINGS_WIDTH,
        height: 560, // measured at this height first, then fitted to the content
        useContentSize: true,
        show: false,
        title: '설정',
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        autoHideMenuBar: true,
        backgroundColor: windowBackground[currentTheme()],
        webPreferences: {
          preload: deps.preload,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          spellcheck: false,
          backgroundThrottling: false,
        },
      });
      win = created;
      created.on('closed', () => {
        if (win === created) win = null;
      });
      // Not key: no rings, neutral selection; under its own sheet it stays main (design-spec 2.1, Task 8 window states).
      trackWindowState(created);
      created.once('ready-to-show', () => {
        void (async () => {
          const height = await contentHeight(created.webContents, '[data-settings-root]', 480);
          if (created.isDestroyed()) return;
          created.setContentSize(SETTINGS_WIDTH, height);
          const main = deps.main();
          if (main && !main.isDestroyed()) {
            const b = main.getBounds();
            created.setPosition(Math.round(b.x + (b.width - SETTINGS_WIDTH) / 2), b.y + BELOW_MAIN_TOP);
          }
          await markSized(created.webContents);
          created.show();
          // A message that appears (a refused folder) or goes makes the window as tall as its content again.
          followContentHeight(created.webContents, '[data-settings-root]', height, (next) => {
            if (!created.isDestroyed()) created.setContentSize(SETTINGS_WIDTH, next);
          });
        })().catch(() => {
          // Only a window closed mid-measure gets here; otherwise show it unsized rather than not at all.
          if (!created.isDestroyed()) created.show();
        });
      });
      void created.loadURL(deps.url());
      return created;
    },
  };
}
