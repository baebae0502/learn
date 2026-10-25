import { BrowserWindow, screen } from 'electron';
import { windowBackground } from '../renderer/src/design/tokens.generated';
import { REMEASURE_MS, contentHeight, followContentHeight, fontsReady, markSized } from './measure';
import { mainStrings } from './strings';
import { currentTheme } from './theme';
import { registerWindowKind } from './window-kinds';
import { trackWindowState } from './window-state';

export const SETTINGS_WIDTH = 600;
/** Off a main window, the settings window opens this far below its top edge (centred across it). */
const BELOW_MAIN_TOP = 96;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the settings window goes over a main window: centred across it, BELOW_MAIN_TOP below its top, then moved to lie
 * wholly inside the work area of its display (final review m4: a main window low on the screen, or on a second display,
 * put it partly off screen; AppKit only keeps the title bar below the menu bar). Taller than the work area: its top.
 */
export function settingsPosition(main: Rect, size: { width: number; height: number }, workArea: Rect): { x: number; y: number } {
  const x = Math.round(main.x + (main.width - size.width) / 2);
  const y = main.y + BELOW_MAIN_TOP;
  return {
    x: Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - size.width)),
    y: Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - size.height)),
  };
}

export interface SettingsWindow {
  /** ⌘, : shows the settings window — the one prepared hidden, when there is one — or brings the open one to the front. */
  open(): BrowserWindow;
  /** The settings window, shown or prepared (theme changes, the window-kind registry and the IPC checks reach it). */
  current(): BrowserWindow | null;
  /**
   * Makes the settings window hidden — loaded, measured and sized — so the next ⌘, only places and shows it (spec 8).
   * Nothing when one exists. Main calls it when the main window's page reports it is idle (ui.reportIdle).
   */
  prepare(): void;
  /**
   * Closes a prepared window nobody asked for yet (the main window closed, the app quits): a hidden window must never
   * keep the app alive (window-all-closed). One that was asked for or shown stays (macOS keeps it after the main window).
   */
  discardPrepared(): void;
}

/**
 * ⌘, (design-spec 6 설정 창): one standard window with the title "설정", 600 wide, as tall as its content (also when a
 * message appears in it), not resizable by hand. Changes apply at once; it has no 완료 or × button of its own (closed by
 * its traffic light or ⌘W). Prepared hidden once the main window is idle, so the first ⌘, does not wait for a renderer
 * to start; a window closed by the user is gone, and the next ⌘, makes a new one.
 */
export function createSettingsWindow(deps: { preload: string; url(): string; main(): BrowserWindow | null }): SettingsWindow {
  let win: BrowserWindow | null = null;
  /** measuring: loading and being measured; ready: sized and hidden; shown: on screen (or was). */
  let phase: 'measuring' | 'ready' | 'shown' = 'measuring';
  /** A ⌘, came while it was being measured: it shows itself once sized, never unsized. */
  let wanted = false;
  const live = (): BrowserWindow | null => (win && !win.isDestroyed() ? win : null);

  /** Over the main window as it is now (it may have moved since it was measured), inside that display's work area. */
  function place(w: BrowserWindow): void {
    const main = deps.main();
    if (!main || main.isDestroyed()) return;
    const b = main.getBounds();
    const size = w.getBounds(); // the frame, title bar included
    // The display it would land on, then that display's work area.
    const { workArea } = screen.getDisplayMatching({ x: Math.round(b.x + (b.width - size.width) / 2), y: b.y + BELOW_MAIN_TOP, width: size.width, height: size.height });
    const at = settingsPosition(b, size, workArea);
    w.setPosition(at.x, at.y);
  }
  function reveal(w: BrowserWindow): void {
    place(w);
    phase = 'shown';
    // Awake before it is on screen: a prepared window sleeps (timers slowed, frames paused) and must paint at once.
    w.webContents.setBackgroundThrottling(false);
    w.show();
  }

  /**
   * A window that is not on screen whose page died (its renderer went away, or its page did not load) shows a blank page
   * if it is ever revealed. It is destroyed and forgotten; one a ⌘, was waiting for is replaced by a fresh window shown
   * as a normal open does — once only, so a page that cannot load does not loop.
   */
  function replaceDead(dead: BrowserWindow, replacement: boolean): void {
    if (win !== dead || phase === 'shown') return; // a visible window keeps what it has; a forgotten one is already handled
    const asked = wanted;
    win = null;
    phase = 'measuring';
    wanted = false;
    if (!dead.isDestroyed()) dead.destroy();
    if (asked && !replacement) create(true, true);
  }

  function create(show: boolean, replacement = false): BrowserWindow {
    phase = 'measuring';
    wanted = show;
    const created = new BrowserWindow({
      width: SETTINGS_WIDTH,
      height: 560, // measured at this height first, then fitted to the content
      useContentSize: true,
      show: false,
      title: mainStrings.settingsWindow.title,
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
    // IPC knows the window by its webContents, the prepared one too: before its page loads.
    registerWindowKind(created.webContents, 'settings');
    created.webContents.on('render-process-gone', () => replaceDead(created, replacement));
    created.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) replaceDead(created, replacement); // -3: a load cancelled by the next one
    });
    // ⌘W or the close light: off the screen first, then torn down. Closing tears the page down before AppKit takes the
    // window away, which showed an empty body for 2 frames on the Mac; hidden, that happens unseen.
    created.on('close', () => {
      if (!created.isDestroyed() && created.isVisible()) created.hide();
    });
    created.on('closed', () => {
      if (win === created) win = null;
    });
    // Not key: no rings, neutral selection; under its own sheet it stays main (design-spec 2.1).
    trackWindowState(created);
    created.once('ready-to-show', () => {
      void (async () => {
        // Rendered, then its font loaded (at most 300 ms more), then measured: never boxes with no text, and the
        // height is the one its own font gives.
        const rendered = await contentHeight(created.webContents, '[data-settings-root]', 480);
        await fontsReady(created.webContents, '[data-settings-root]');
        if (created.isDestroyed()) return;
        // Re-measured with its own font; briefly (the page has rendered), keeping the first height otherwise, so a page
        // that never renders still shows within the first measurement's 5 s.
        const height = await contentHeight(created.webContents, '[data-settings-root]', rendered, REMEASURE_MS);
        if (created.isDestroyed()) return;
        created.setContentSize(SETTINGS_WIDTH, height);
        await markSized(created.webContents);
        if (created.isDestroyed()) return;
        phase = 'ready';
        if (wanted) reveal(created);
        else created.webContents.setBackgroundThrottling(true); // only prepared: asleep until a ⌘, shows it
        // A message that appears (a refused folder) or goes makes the window as tall as its content again; on macOS the
        // bottom edge slides as AppKit's own windows do (`animate` is ignored elsewhere).
        followContentHeight(created.webContents, '[data-settings-root]', height, (next) => {
          if (!created.isDestroyed()) created.setContentSize(SETTINGS_WIDTH, next, true);
        });
      })().catch(() => {
        // A window closed mid-measure gets here, and so does one whose renderer died (the call rejects, perhaps before the
        // crash event): that one is replaced, never shown. Otherwise it is shown unsized when asked rather than not at all.
        if (created.isDestroyed() || win !== created) return;
        if (created.webContents.isCrashed()) return replaceDead(created, replacement);
        phase = 'ready';
        if (wanted) reveal(created);
      });
    });
    void created.loadURL(deps.url());
    return created;
  }

  return {
    current: live,
    open(): BrowserWindow {
      const w = live();
      if (!w) return create(true);
      if (phase === 'measuring') {
        wanted = true; // it shows itself, sized, in a moment (and takes the focus then)
        return w;
      }
      if (phase === 'ready') reveal(w);
      else w.show();
      w.focus();
      return w;
    },
    prepare(): void {
      if (!live()) create(false);
    },
    discardPrepared(): void {
      const w = live();
      // Never shown: torn down at once (close() is asynchronous and would let a quit go on with a window still alive).
      if (w && phase !== 'shown' && !wanted) {
        win = null;
        w.destroy();
      }
    },
  };
}
