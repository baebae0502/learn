import { BrowserWindow, nativeTheme, type WebContents } from 'electron';
import { LearnError, type SheetPayload, type SheetResult } from '@learn/domain';
import { themeHex } from '../renderer/src/design/tokens.generated';
import { contentHeight, markSized } from './measure';

export const SHEET_WIDTH: Readonly<Record<SheetPayload['kind'], number>> = { duplicate: 440, shortcuts: 560 };
/** 8 px under the 52 px toolbar (macOS does this itself through setSheetOffset; elsewhere we place it). */
export const SHEET_TOP = 60;

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

export function createSheetHost(opts: { preload: string; url(): string; platform: NodeJS.Platform }): SheetHost {
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
      const maxHeight = Math.max(160, room.height - SHEET_TOP - 16);
      const win = new BrowserWindow({
        parent,
        modal: true, // macOS: attached as a sheet below parent.setSheetOffset(52)
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
      const settle = (result: SheetResult | null) => {
        if (done) return;
        done = true;
        pending.delete(id);
        resolve(result);
        if (!win.isDestroyed()) win.close();
      };
      pending.set(id, { payload, settle });
      win.on('closed', () => settle(null));
      // A sheet whose page never comes up must not hold the import (or the window) forever: it ends unanswered.
      win.webContents.on('render-process-gone', () => settle(null));
      win.once('ready-to-show', () => {
        void (async () => {
          const height = Math.min(await contentHeight(win.webContents, '[data-sheet-root]'), maxHeight);
          if (win.isDestroyed()) return;
          win.setContentSize(width, height);
          if (opts.platform !== 'darwin') win.setPosition(Math.round(room.x + (room.width - width) / 2), room.y + SHEET_TOP);
          await markSized(win.webContents);
          win.show();
        })().catch(() => {
          // Only a window closed mid-measure gets here (settled already); otherwise show it unsized rather than lose the question.
          if (!win.isDestroyed()) win.show();
        });
      });
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
