import { createHash } from 'node:crypto';
import { BrowserWindow, nativeTheme, type WebContents } from 'electron';
import { LearnError, commandLabel, type CommandSpec, type SheetAction, type SheetPayload, type SheetResult } from '@learn/domain';
import { themeHex } from '../renderer/src/design/tokens.generated';
import { REMEASURE_MS, capHeight, contentHeight, followContentHeight, fontsReady, holdHeight, markSized } from './measure';
import { SHEET_MARGIN, SHEET_TOP, sheetMaxHeight } from './sheet-geometry';
import { mainStrings } from './strings';
import { registerWindowKind } from './window-kinds';

export { SHEET_MARGIN, SHEET_TOP, sheetMaxHeight };

/** The ⌘/ sheet is 780 wide so every pair line of design-spec 7.4 (registry names) fits one line: with Ctrl keycaps (Linux, Windows) a label has 74 px at 560, and with the Mac's symbols 560 still wraps five of the ten; 760 left 3 px on the longest Linux row, 780 leaves 13. */
export const SHEET_WIDTH: Readonly<Record<SheetPayload['kind'], number>> = { duplicate: 440, shortcuts: 780, purge: 440, libraryCheck: 560, backupDone: 440, restoreDone: 560 };
/** Room the library check keeps below its parent's height (P-26: at most the parent's height − 120, the list scrolls). */
export const CHECK_SHEET_ROOM = 120;
/** Sheets whose content changes while they are open (sheet:act): the window follows its content up to the cap; the backup and restore result sheets grow by their reveal error line. */
export const FOLLOWING_SHEETS: ReadonlySet<SheetPayload['kind']> = new Set<SheetPayload['kind']>(['libraryCheck', 'backupDone', 'restoreDone']);

/** The tallest a sheet of `kind` may be over a parent `roomHeight` tall. */
export function sheetHeightCap(kind: SheetPayload['kind'], roomHeight: number, platform: NodeJS.Platform): number {
  return kind === 'libraryCheck' ? Math.max(160, roomHeight - CHECK_SHEET_ROOM) : sheetMaxHeight(roomHeight, platform);
}

/**
 * The height a following sheet takes when its content is `next` tall, in a window `current` tall, under `cap`. macOS
 * centres a sheet itself, so a window that shrank would move the head and the row just fixed (Q-8l): there it only
 * grows, and the spare height stays under the list; the next open starts from the content height. Elsewhere the sheet
 * hangs from a fixed top and follows its content both ways.
 */
export function followedHeight(next: number, current: number, cap: number, platform: NodeJS.Platform): number {
  const wanted = Math.min(next, cap);
  return platform === 'darwin' ? Math.min(Math.max(current, wanted), cap) : wanted;
}

/** The sheet an action runs for: its window (where its own open panel hangs), its parent, and what it shows now. */
export interface ActingSheet {
  window: BrowserWindow;
  parent: BrowserWindow;
  payload: SheetPayload;
}
export type SheetActHandler = (action: SheetAction, sheet: ActingSheet) => Promise<SheetPayload>;

/** A sheet not shown this long after its page began loading is given up (null), so the parent never stays blocked. */
export const SHEET_SHOW_TIMEOUT_MS = 10_000;
/** An unresponsive sheet is given up only if it does not answer again within this grace period (a long task is fine). */
export const UNRESPONSIVE_GRACE_MS = 5_000;

/**
 * The key of a static sheet's natural height: what that height can depend on. The ⌘/ sheet does not follow the text
 * size or density today (those apply to the main window); they are in the key so that a sheet that does is never sized
 * from another setting. The view the sheet opened from is in it: the viewer's keys are listed by view.
 */
export function sheetHeightKey(o: { platform: string; fontSize: number; density: string; digest: string; view: string }): string {
  return `${o.platform}|${o.fontSize}|${o.density}|${o.digest}|${o.view}`;
}

/** What the ⌘/ sheet is drawn from: every registry shortcut as it lists one (id, label, keys), hashed. */
export function shortcutsDigest(commands: readonly CommandSpec[], platform: string): string {
  const rows = commands
    .filter((c) => c.accelerator !== undefined || c.key !== undefined)
    .map((c) => [c.id, commandLabel(c, platform), c.accelerator ?? '', JSON.stringify(c.key ?? null)].join('\u0001'));
  return createHash('sha256').update(rows.join('\u0002')).digest('hex').slice(0, 16);
}

export interface SheetHost {
  /**
   * A modal sheet over `parent`; resolves with the sheet's result, or null when it closed without one (or its page
   * failed). One sheet at a time per window: a second request waits until the first has closed. `signal`: the work that
   * asked is over (an import stopped): the sheet closes unanswered, or is never opened if it is still waiting.
   */
  open(parent: BrowserWindow, payload: SheetPayload, signal?: AbortSignal): Promise<SheetResult | null>;
  /**
   * What the sheet page shows. A window made ahead (`prepare`) has its payload held until a sheet opens in it, so the page
   * waits here; anyone that is not a sheet window is PERMISSION_DENIED (rejected).
   */
  payloadFor(contents: WebContents): Promise<SheetPayload>;
  /**
   * Makes the ⌘/ sheet's window ahead, hidden, with its page loaded and waiting for its payload: opening the sheet then
   * costs the measuring and showing, not a window and a page. One per parent; made again a second after a ⌘/ sheet closes.
   */
  prepare(parent: BrowserWindow): void;
  /** Closes the window made ahead for `parent` (its window is closing) and stops making new ones. */
  discardPrepared(parent: BrowserWindow): void;
  resolve(contents: WebContents, result: SheetResult): void;
  /**
   * sheet:act (P-17): the open sheet's own action, run by its kind's handler; the sheet shows the payload answered, and a
   * reload of its page reads that one. One action at a time per sheet: a second waits for the first.
   */
  act(contents: WebContents, action: SheetAction): Promise<SheetPayload>;
  /** The handler of a kind's actions; a kind with none refuses every action. */
  onAct(kind: SheetPayload['kind'], handler: SheetActHandler): void;
}

/** A shortcuts sheet window made ahead: loaded, hidden, its page holding on for the payload. */
interface Prepared {
  window: BrowserWindow;
  parent: BrowserWindow;
  loaded: boolean;
  /** What the page's payloadFor waits for. */
  held: Promise<SheetPayload>;
  release(payload: SheetPayload): void;
  /** Stops the watching of the window's early failure: a sheet in it settles for itself. */
  detach(): void;
}

/** A ⌘/ sheet made ahead is made again this long after one closes (the close and its focus hand-back settle first). */
export const PREPARE_AGAIN_MS = 1000;

interface Pending {
  payload: SheetPayload;
  settle(result: SheetResult | null): void;
  window: BrowserWindow;
  parent: BrowserWindow;
  /** The action under way (sheet:act), which the next one waits for. */
  acting: Promise<void>;
}

export function createSheetHost(opts: {
  preload: string;
  url(): string;
  platform: NodeJS.Platform;
  /** The sheet is about to show over `parent` (it takes the key window; the parent stays the main window). */
  onSheetShown?(parent: BrowserWindow): void;
  /**
   * The sheet's window has closed and the parent has the focus back. macOS makes the parent key again without a
   * 'focus' event (run 39631541294), so main re-reads the parent's window state here. Only for a sheet that was shown
   * (onSheetShown): the two come in pairs, as main counts the sheets on a window.
   */
  onSheetClosed?(parent: BrowserWindow): void;
  /**
   * The height key of a sheet whose content never changes between opens (sheetHeightKey), or null to measure every
   * time (the duplicate question names a file).
   */
  staticKey?(payload: SheetPayload): string | null;
}): SheetHost {
  const pending = new Map<number, Pending>();
  /** Per parent window: the sheet showing now (and any queued behind it). */
  const queues = new Map<number, Promise<unknown>>();
  const heights = new Map<string, number>(); // a static sheet's natural height, measured in its own font
  const handlers = new Map<SheetPayload['kind'], SheetActHandler>();
  /** The window made ahead per parent window id, and the same by the window's contents. */
  const prepared = new Map<number, Prepared>();
  const preparedByContents = new Map<number, Prepared>();
  /** Parents prepare() was called for: a ⌘/ sheet closing over one of them makes the next. */
  const preparing = new Set<number>();
  const prepareTimers = new Map<number, ReturnType<typeof setTimeout>>();

  function sheetWindow(parent: BrowserWindow, kind: SheetPayload['kind'], height: number): BrowserWindow {
    const win = new BrowserWindow({
      parent,
      modal: true, // macOS: a sheet, centred over the parent and dimming it (the system's placement)
      show: false,
      width: SHEET_WIDTH[kind],
      // Measured at full height first, then shrunk to the content; a static sheet measured before starts at that height.
      height,
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
    registerWindowKind(win.webContents, 'sheet');
    return win;
  }

  function forgetPrepared(entry: Prepared): void {
    if (prepared.get(entry.parent.id) === entry) prepared.delete(entry.parent.id);
    preparedByContents.delete(entry.window.webContents.id);
  }

  /** The window made ahead for `parent`, when it is alive and its page has loaded; it leaves the stock either way it is taken. */
  function takePrepared(parent: BrowserWindow): Prepared | null {
    const entry = prepared.get(parent.id);
    if (!entry || entry.window.isDestroyed() || !entry.loaded) return null;
    forgetPrepared(entry);
    entry.detach();
    return entry;
  }

  function prepare(parent: BrowserWindow): void {
    if (parent.isDestroyed()) return;
    if (!preparing.has(parent.id)) {
      // The window closing takes the one made ahead with it, and the stock stops.
      const parentId = parent.id;
      parent.once('closed', () => discardPreparedFor(parentId));
    }
    preparing.add(parent.id);
    if (prepared.has(parent.id)) return;
    const room = parent.getContentBounds();
    const win = sheetWindow(parent, 'shortcuts', sheetHeightCap('shortcuts', room.height, opts.platform));
    let release: (payload: SheetPayload) => void = () => {};
    const held = new Promise<SheetPayload>((resolve) => (release = resolve));
    const entry: Prepared = { window: win, parent, loaded: false, held, release, detach: () => {} };
    prepared.set(parent.id, entry);
    preparedByContents.set(win.webContents.id, entry);
    // A window that fails before it is used is dropped; the next ⌘/ makes its own.
    const drop = (): void => {
      forgetPrepared(entry);
      if (!win.isDestroyed()) win.close();
    };
    const onLoaded = (): void => void (entry.loaded = true);
    const onFailed = (_event: unknown, _code: number, _description: string, _url: string, isMainFrame: boolean): void => {
      if (isMainFrame) drop();
    };
    win.webContents.once('did-finish-load', onLoaded);
    win.webContents.on('render-process-gone', drop);
    win.webContents.on('did-fail-load', onFailed);
    // The page's request for its payload is answered before the window goes: an unanswered one made the renderer, which the
    // main window shares, stop answering.
    win.once('close', () => release({ kind: 'shortcuts' }));
    win.once('closed', () => forgetPrepared(entry));
    entry.detach = () => {
      win.webContents.off('did-finish-load', onLoaded);
      win.webContents.off('render-process-gone', drop);
      win.webContents.off('did-fail-load', onFailed);
    };
    win.loadURL(opts.url()).catch(drop);
  }

  /** By id: the parent may be destroyed already (its 'closed'), when its properties can no longer be read. */
  function discardPreparedFor(parentId: number): void {
    preparing.delete(parentId);
    clearTimeout(prepareTimers.get(parentId));
    prepareTimers.delete(parentId);
    const entry = prepared.get(parentId);
    if (!entry) return;
    forgetPrepared(entry);
    if (!entry.window.isDestroyed()) entry.window.close();
  }
  const discardPrepared = (parent: BrowserWindow): void => discardPreparedFor(parent.id);

  function prepareLater(parent: BrowserWindow): void {
    if (!preparing.has(parent.id)) return;
    clearTimeout(prepareTimers.get(parent.id));
    const timer = setTimeout(() => {
      prepareTimers.delete(parent.id);
      if (preparing.has(parent.id) && !parent.isDestroyed()) prepare(parent);
    }, PREPARE_AGAIN_MS);
    timer.unref?.();
    prepareTimers.set(parent.id, timer);
  }
  const find = (contents: WebContents): Pending => {
    const p = pending.get(contents.id);
    if (!p) throw new LearnError('PERMISSION_DENIED', mainStrings.callerRefused);
    return p;
  };

  function show(parent: BrowserWindow, payload: SheetPayload, signal: AbortSignal | undefined): Promise<SheetResult | null> {
    return new Promise((resolve) => {
      if (signal?.aborted) {
        resolve(null);
        return;
      }
      const width = SHEET_WIDTH[payload.kind];
      const room = parent.getContentBounds();
      const follows = FOLLOWING_SHEETS.has(payload.kind);
      /** A following sheet's cap moves with its parent's height (P-26: the parent − 120). */
      let maxHeight = sheetHeightCap(payload.kind, room.height, opts.platform);
      /** The window's content height now, for the sheets that follow their content. */
      let current = 0;
      const key = opts.staticKey?.(payload) ?? null;
      const known = key === null ? undefined : heights.get(key);
      // The ⌘/ sheet takes the window made ahead when there is a loaded one; every other sheet makes its own.
      const reuse = payload.kind === 'shortcuts' ? takePrepared(parent) : null;
      const win = reuse?.window ?? sheetWindow(parent, payload.kind, known === undefined ? maxHeight : Math.min(known, maxHeight));
      const id = win.webContents.id;
      let done = false;
      const giveUp = (): void => settle(null);
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      let hung: ReturnType<typeof setTimeout> | undefined;
      const onParentResize = (): void => {
        if (win.isDestroyed() || parent.isDestroyed() || current === 0) return;
        maxHeight = sheetHeightCap(payload.kind, parent.getContentBounds().height, opts.platform);
        capHeight(win.webContents, maxHeight).catch(() => {});
        if (current > maxHeight) {
          current = maxHeight;
          win.setContentSize(width, current);
        }
      };
      const settle = (result: SheetResult | null) => {
        if (done) return;
        done = true;
        if (follows) parent.off('resize', onParentResize);
        signal?.removeEventListener('abort', giveUp);
        clearTimeout(watchdog);
        clearTimeout(hung);
        pending.delete(id);
        resolve(result);
        if (!win.isDestroyed()) {
          if (reuse) win.hide();
          win.close();
        }
        // Keyboard focus goes back to the window the sheet hung over (Linux/Windows do not always hand it back).
        if (!parent.isDestroyed()) parent.focus();
        if (payload.kind === 'shortcuts' && !parent.isDestroyed()) prepareLater(parent);
      };
      pending.set(id, { payload, settle, window: win, parent, acting: Promise.resolve() });
      signal?.addEventListener('abort', giveUp, { once: true });
      /** onSheetShown ran for this sheet: only then does its closing tell the parent (shown and closed come in pairs). */
      let announced = false;
      const announce = () => {
        if (announced || parent.isDestroyed()) return;
        announced = true;
        opts.onSheetShown?.(parent);
      };
      win.on('closed', () => {
        settle(null);
        if (announced && !parent.isDestroyed()) opts.onSheetClosed?.(parent);
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
      // Measured from the moment its document exists, alongside the first paint rather than after it: rendered, its
      // font loaded (at most 300 ms more), then measured again — never boxes with no text. null: the measurement
      // failed, and the sheet is shown unsized rather than the question lost.
      let startMeasuring: () => void = () => {};
      const height = new Promise<number | null>((settled) => {
        const measure = (): void => {
          void (async () => {
            const rendered = await contentHeight(win.webContents, '[data-sheet-root]');
            const fonts = await fontsReady(win.webContents, '[data-sheet-root]');
            if (known !== undefined) return Math.min(known, maxHeight);
            // Re-measured briefly, keeping the first height otherwise: the show watchdog never loses this race.
            const natural = await contentHeight(win.webContents, '[data-sheet-root]', rendered, REMEASURE_MS);
            if (key !== null && fonts) heights.set(key, natural); // a height in a fallback font is not worth keeping
            return Math.min(natural, maxHeight);
          })().then(settled, () => settled(null));
        };
        // A window made ahead is past dom-ready and its page waits for the payload: measuring starts when that is released.
        if (reuse) startMeasuring = measure;
        else win.webContents.once('dom-ready', measure);
      });
      // Shown only once the page has painted (ready-to-show) and been sized: the first frame on screen is the sized one. A
      // window made ahead painted long ago; the page's content is in by the time it has been measured.
      const painted = reuse ? Promise.resolve() : new Promise<void>((settled) => win.once('ready-to-show', () => settled()));
      void Promise.all([height, painted]).then(async ([h]) => {
        if (win.isDestroyed()) return;
        if (h !== null) {
          try {
            win.setContentSize(width, h);
            current = h;
            if (opts.platform !== 'darwin') win.setPosition(Math.round(room.x + (room.width - width) / 2), room.y + SHEET_TOP);
            if (follows) await capHeight(win.webContents, maxHeight);
            await markSized(win.webContents);
            if (follows && opts.platform === 'darwin') await holdHeight(win.webContents);
          } catch {
            // Closed or gone mid-way: shown as it is, below, if it is still there.
          }
        }
        if (win.isDestroyed()) return;
        clearTimeout(watchdog);
        announce();
        win.show();
        // The library check changes while it is open (sheet:act): the window follows its content, up to the cap.
        if (follows && h !== null) {
          parent.on('resize', onParentResize);
          followContentHeight(win.webContents, '[data-sheet-root]', h, (next) => {
            if (win.isDestroyed()) return;
            current = followedHeight(next, current, maxHeight, opts.platform);
            win.setContentSize(width, current);
          });
        }
      });
      watchdog = setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible()) settle(null);
      }, SHEET_SHOW_TIMEOUT_MS);
      if (reuse) {
        // The payload is in `pending` before the page can ask again (a reload); the page that waits gets it now.
        reuse.release(payload);
        startMeasuring();
      } else {
        win.loadURL(opts.url()).catch(() => settle(null));
      }
    });
  }

  return {
    open(parent, payload, signal) {
      // One sheet at a time per window, as macOS attaches them: a second request waits for the first to close.
      const key = parent.id;
      const before = queues.get(key) ?? Promise.resolve(null);
      const next = before.catch(() => null).then(() => (parent.isDestroyed() ? null : show(parent, payload, signal)));
      queues.set(key, next);
      const forget = () => {
        if (queues.get(key) === next) queues.delete(key);
      };
      next.then(forget, forget);
      return next;
    },
    async payloadFor(contents) {
      const pendingSheet = pending.get(contents.id);
      if (pendingSheet) return pendingSheet.payload;
      const ahead = preparedByContents.get(contents.id);
      if (ahead) return ahead.held;
      return find(contents).payload; // refuses
    },
    prepare,
    discardPrepared,
    resolve(contents, result) {
      const p = find(contents);
      if (p.payload.kind !== result.kind) throw new LearnError('VALIDATION_FAILED', mainStrings.badRequest);
      p.settle(result);
    },
    async act(contents, action) {
      const p = find(contents);
      const handler = handlers.get(p.payload.kind);
      if (action.kind !== p.payload.kind || !handler) throw new LearnError('VALIDATION_FAILED', mainStrings.badRequest);
      const run = p.acting.then(() => handler(action, { window: p.window, parent: p.parent, payload: p.payload }));
      p.acting = run.then(
        () => undefined,
        () => undefined,
      );
      const next = await run;
      if (pending.get(contents.id) === p) p.payload = next;
      return next;
    },
    onAct(kind, handler) {
      handlers.set(kind, handler);
    },
  };
}
