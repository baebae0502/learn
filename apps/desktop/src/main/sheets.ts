import { BrowserWindow, nativeTheme, type WebContents } from 'electron';
import { LearnError, type SheetPayload, type SheetResult } from '@learn/domain';
import { themeHex } from '../renderer/src/design/tokens.generated';
import { contentHeight, fontsReady, markSized } from './measure';

export const SHEET_WIDTH: Readonly<Record<SheetPayload['kind'], number>> = { duplicate: 440, shortcuts: 560 };
/**
 * Off macOS: 8 px under the 52 px toolbar, centred across the window (design-spec 6 시트). macOS places a sheet itself:
 * centred over the parent window, which it dims (Big Sur and later — every macOS Electron 44 runs on).
 */
export const SHEET_TOP = 60;
/** Room kept at each free end of a sheet: below it off macOS, above and below the centred macOS sheet. */
export const SHEET_MARGIN = 16;

/**
 * The tallest a sheet may be over a parent `roomHeight` tall before its body scrolls (design-spec 6 시트: as tall as
 * its content). macOS centres the sheet itself (we set no sheet offset), so only a margin at each end is kept there;
 * elsewhere the sheet hangs SHEET_TOP down. Critic T12-m1: the ⌘/ sheet (743) fits the default window of a
 * 1440 × 900 Mac with the Dock (about 806 tall).
 */
export function sheetMaxHeight(roomHeight: number, platform: NodeJS.Platform): number {
  return Math.max(160, roomHeight - (platform === 'darwin' ? 2 * SHEET_MARGIN : SHEET_TOP + SHEET_MARGIN));
}
/** A sheet not shown this long after its page began loading is given up (null), so the parent never stays blocked. */
export const SHEET_SHOW_TIMEOUT_MS = 10_000;
/** An unresponsive sheet is given up only if it does not answer again within this grace period (a long task is fine). */
export const UNRESPONSIVE_GRACE_MS = 5_000;

export interface SheetHost {
  /**
   * A modal sheet over `parent`; resolves with the sheet's result, or null when it closed without one (or its page
   * failed). One sheet at a time per window: a second request waits until the first has closed.
   */
  open(parent: BrowserWindow, payload: SheetPayload): Promise<SheetResult | null>;
  payloadFor(contents: WebContents): SheetPayload;
  resolve(contents: WebContents, result: SheetResult): void;
}

interface Pending {
  payload: SheetPayload;
  settle(result: SheetResult | null): void;
}

export function createSheetHost(opts: {
  preload: string;
  url(): string;
  platform: NodeJS.Platform;
  /** The sheet is about to show over `parent` (it takes the key window; the parent stays the main window). */
  onSheetShown?(parent: BrowserWindow): void;
  /**
   * The sheet's window has closed and the parent has the focus back. macOS makes the parent key again without a
   * 'focus' event (run 39631541294), so main re-reads the parent's window state here.
   */
  onSheetClosed?(parent: BrowserWindow): void;
}): SheetHost {
  const pending = new Map<number, Pending>();
  /** Per parent window: the sheet showing now (and any queued behind it). */
  const queues = new Map<number, Promise<unknown>>();
  const find = (contents: WebContents): Pending => {
    const p = pending.get(contents.id);
    if (!p) throw new LearnError('PERMISSION_DENIED', '허용되지 않은 호출자입니다.');
    return p;
  };

  function show(parent: BrowserWindow, payload: SheetPayload): Promise<SheetResult | null> {
    return new Promise((resolve) => {
      const width = SHEET_WIDTH[payload.kind];
      const room = parent.getContentBounds();
      const maxHeight = sheetMaxHeight(room.height, opts.platform);
      const win = new BrowserWindow({
        parent,
        modal: true, // macOS: a sheet, centred over the parent and dimming it (the system's placement)
        show: false,
        width,
        height: maxHeight, // measured at full height first, then shrunk to the content
        useContentSize: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        frame: opts.platform === 'darwin',
        title: '',
        backgroundColor: themeHex[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'].bgRaised,
        webPreferences: {
          preload: opts.preload,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          spellcheck: false,
          backgroundThrottling: false,
        },
      });
      const id = win.webContents.id;
      let done = false;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      let hung: ReturnType<typeof setTimeout> | undefined;
      const settle = (result: SheetResult | null) => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        clearTimeout(hung);
        pending.delete(id);
        resolve(result);
        if (!win.isDestroyed()) win.close();
        // Keyboard focus goes back to the window the sheet hung over (Linux/Windows do not always hand it back).
        if (!parent.isDestroyed()) parent.focus();
      };
      pending.set(id, { payload, settle });
      win.on('closed', () => {
        settle(null);
        if (!parent.isDestroyed()) opts.onSheetClosed?.(parent);
      });
      // A sheet whose page never comes up, or stops answering, must not hold the import (or the window) forever: it
      // ends unanswered.
      win.webContents.on('render-process-gone', () => settle(null));
      win.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
        if (isMainFrame) settle(null);
      });
      win.on('unresponsive', () => {
        clearTimeout(hung);
        hung = setTimeout(() => settle(null), UNRESPONSIVE_GRACE_MS);
      });
      win.on('responsive', () => clearTimeout(hung));
      win.once('ready-to-show', () => {
        void (async () => {
          // Rendered, its font loaded (at most 300 ms more), then measured: never boxes with no text (T13-m6).
          await contentHeight(win.webContents, '[data-sheet-root]');
          await fontsReady(win.webContents, '[data-sheet-root]');
          const height = Math.min(await contentHeight(win.webContents, '[data-sheet-root]'), maxHeight);
          if (win.isDestroyed()) return;
          win.setContentSize(width, height);
          if (opts.platform !== 'darwin') win.setPosition(Math.round(room.x + (room.width - width) / 2), room.y + SHEET_TOP);
          await markSized(win.webContents);
          clearTimeout(watchdog);
          if (!parent.isDestroyed()) opts.onSheetShown?.(parent);
          win.show();
        })().catch(() => {
          // Only a window closed mid-measure gets here (settled already); otherwise show it unsized rather than lose the question.
          if (win.isDestroyed()) return;
          clearTimeout(watchdog);
          if (!parent.isDestroyed()) opts.onSheetShown?.(parent);
          win.show();
        });
      });
      watchdog = setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible()) settle(null);
      }, SHEET_SHOW_TIMEOUT_MS);
      win.loadURL(opts.url()).catch(() => settle(null));
    });
  }

  return {
    open(parent, payload) {
      // One sheet at a time per window, as macOS attaches them: a second request waits for the first to close.
      const key = parent.id;
      const before = queues.get(key) ?? Promise.resolve(null);
      const next = before.catch(() => null).then(() => (parent.isDestroyed() ? null : show(parent, payload)));
      queues.set(key, next);
      const forget = () => {
        if (queues.get(key) === next) queues.delete(key);
      };
      next.then(forget, forget);
      return next;
    },
    payloadFor: (contents) => find(contents).payload,
    resolve(contents, result) {
      const p = find(contents);
      if (p.payload.kind !== result.kind) throw new LearnError('VALIDATION_FAILED', '잘못된 요청입니다.');
      p.settle(result);
    },
  };
}
