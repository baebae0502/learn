import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { _electron as electron, expect, type ElectronApplication, type Locator, type Page, type TestInfo } from '@playwright/test';
import { COMMANDS, menuItemId, type CommandArgs, type CommandId } from '../../packages/domain/src/commands';
import type { LearnApi, UpdateMetadataInput } from '../../packages/domain/src/ipc';
import type { JobProgress } from '../../packages/domain/src/backup';
import type { ImportQueueState, ImportReport, LibraryCheck, LibraryItem, StorageMode } from '../../packages/domain/src/library';
import type { OrganizeSnapshot } from '../../packages/domain/src/organize';
import { TAG_COLORS, type TagColorId } from '../../packages/domain/src/tag-colors';
import { settingsContentHeight } from '../../apps/desktop/src/main/settings-geometry';
import type { FsyncProbeInput, FsyncProbeResult, SeedAssetsInput, SeedAssetsResult } from '../../apps/desktop/src/main/test-hooks';
import type { SeedBodyTextInput } from '../../apps/desktop/src/main/text/seed-body-text';
import { compareShots, isTranslucent, sidebarFallback, type Pixels } from './shot-compare';

declare global {
  interface Window {
    learn: LearnApi;
    /** The renderer's E2E switch (library/useImportQueue.ts): importPaths' runs show no busy screen and no toast. */
    __learnQuietImports?: number;
  }
}

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const MAIN = path.join(ROOT, 'apps/desktop/out/main/index.js');
export const FIXTURES = path.join(ROOT, 'fixtures/generated');

export interface Session {
  app: ElectronApplication;
  page: Page;
}

export interface LaunchOptions {
  /** Extra environment variables, applied after the library/userData variables. */
  env?: Record<string, string>;
  /**
   * Passed through to Playwright. Caution: with Playwright 1.64.1 + Electron 44 the first window stays
   * paused before navigation when this is set (M0 spike, docs/mac-verification.md).
   */
  recordVideo?: { dir: string; size?: { width: number; height: number } };
  /** Electron/Chromium switches, placed before the app path. */
  args?: string[];
  /** Packaged app executable. When set, the unpackaged `apps/desktop` path is not passed. */
  executablePath?: string;
  /**
   * prefers-color-scheme emulation. Playwright emulates 'light' by default; `null` turns emulation off so the app's
   * own theme pref (nativeTheme.themeSource) drives it, as on a user's machine (visual tour).
   */
  colorScheme?: null | 'light' | 'dark';
}

/** How long a session's close may take before the app process is killed. */
const CLOSE_GRACE_MS = 10_000;

/**
 * Launch the built app. `null` for a directory leaves that variable unset so the app uses its
 * default location (only for disposable machines such as CI runners).
 */
export async function launch(libraryDir: string | null, userDataDir: string | null, opts: LaunchOptions = {}): Promise<Session> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  delete env['LEARN_LIBRARY_DIR'];
  delete env['LEARN_USER_DATA_DIR'];
  if (libraryDir !== null) env['LEARN_LIBRARY_DIR'] = libraryDir;
  if (userDataDir !== null) env['LEARN_USER_DATA_DIR'] = userDataDir;
  env['LEARN_E2E'] = '1'; // the shipped menu (no "개발자 도구"); a caller's env can still override it
  Object.assign(env, opts.env);
  const app = await electron.launch({
    args: opts.executablePath ? [...(opts.args ?? [])] : [...(opts.args ?? []), path.join(ROOT, 'apps/desktop')],
    env,
    ...(opts.executablePath ? { executablePath: opts.executablePath } : {}),
    ...(opts.recordVideo ? { recordVideo: opts.recordVideo } : {}),
    ...(opts.colorScheme !== undefined ? { colorScheme: opts.colorScheme } : {}),
  });
  // The app refuses to quit while an edited field is invalid, so a test that failed in that state would wait on close()
  // until the worker's teardown timeout and take the rest of the run with it. A close that has not finished by then is
  // killed, so the test's own failure is what gets reported.
  const close = app.close.bind(app);
  app.close = async () => {
    const child = app.process();
    const timer = setTimeout(() => child.kill('SIGKILL'), CLOSE_GRACE_MS);
    try {
      await close();
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    const page = await app.firstWindow();
    shownTestIds(page);
    await expect(page.getByTestId('app-ready')).toBeAttached();
    // The menu bar stays disabled until the renderer's first ui:reportContext (M3 Task 2).
    await expect.poll(() => app.evaluate(() => (globalThis as { __learnMenuStateVersion?: number }).__learnMenuStateVersion ?? 0)).toBeGreaterThan(0);
    // Once the main window is idle main prepares the settings window hidden. Every session starts from there (the
    // main window and a prepared settings window), so no test races its making (window events, window counts).
    await expect.poll(() => settingsPreparedState(app), { message: 'main prepared the settings window once the main window was idle', timeout: 15_000 }).toBe('ready');
    return { app, page };
  } catch (e) {
    await app.close().catch(() => {}); // don't leak the process (and its single-instance lock) on a failed start
    throw e;
  }
}

/**
 * Reader tabs that are not shown stay in the page, hidden (spec 3.7): their test ids are there too. A test id on this page
 * names the one the user sees: whatever is inside a hidden tab panel is left out. The panels themselves (`tab-panel`) are counted as they are.
 */
function shownTestIds(page: Page): void {
  const own = page.getByTestId.bind(page);
  page.getByTestId = (id) => (typeof id === 'string' ? page.locator(`[data-testid=${JSON.stringify(id)}]:not([data-active="false"] *)`) : own(id));
}

/**
 * The main window's BrowserWindow, as a handle evaluated in the main process: the window whose URL has
 * `window=main` (sheets and the settings window are other windows; `getAllWindows()[0]` is not
 * reliably the main one once they exist). `(await mainWindow(app)).evaluate((w) => …)`.
 */
export function mainWindow(app: ElectronApplication) {
  return app.evaluateHandle(({ BrowserWindow }) => {
    // A window being closed can still be listed: skip destroyed ones (their webContents throws).
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && !x.webContents.isDestroyed() && x.webContents.getURL().includes('window=main'));
    if (!w) throw new Error('no main window (window=main)');
    return w;
  });
}

/**
 * Every window by its `?window=` kind, sorted, with " (hidden)" after one not on screen — e.g. ['main', 'settings (hidden)']:
 * the settings window main prepares ahead of ⌘, is there from launch on.
 */
export const windowKinds = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && !w.webContents.isDestroyed())
      .map((w) => `${/[?&]window=(\w+)/.exec(w.webContents.getURL())?.[1] ?? ''}${w.isVisible() ? '' : ' (hidden)'}`)
      .sort(),
  );

/**
 * How far the settings window main prepares once the main window is idle has got: not made yet ('none'), loading, loaded
 * but not yet measured ('unsized', data-sized), or ready. A launch that waits in vain says which step it stopped at.
 */
export async function settingsPreparedState(app: ElectronApplication): Promise<'none' | 'loading' | 'unsized' | 'ready'> {
  return app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && !x.webContents.isDestroyed() && x.webContents.getURL().includes('window=settings'));
    if (!w) return 'none';
    if (w.webContents.isLoading()) return 'loading';
    return (await w.webContents.executeJavaScript("document.documentElement.dataset.sized === '1'", false)) === true ? 'ready' : 'unsized';
  });
}

/** Whether the settings window main prepares once the main window is idle exists, loaded and measured (data-sized). */
export async function settingsPrepared(app: ElectronApplication): Promise<boolean> {
  return (await settingsPreparedState(app)) === 'ready';
}

/**
 * The shown settings window is as tall as its content (design-spec 6), also after a message appeared in it; on a display
 * whose work area cannot hold that, as tall as the work area leaves below its title bar, the page scrolling inside it
 * (R-4). The macOS runner's 1024 × 768 with the Dock leaves 656 px for 681 (Mac run 41797171352).
 */
export async function settingsFitsContent(app: ElectronApplication, settings: Page): Promise<boolean> {
  const content = await settings.locator('[data-settings-root]').evaluate((el) => Math.ceil(el.getBoundingClientRect().height));
  const shown = await app.evaluate(({ BrowserWindow, screen }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('window=settings'));
    if (!w?.isVisible()) return null;
    const height = w.getContentSize()[1]!;
    return { height, chrome: w.getBounds().height - height, room: screen.getDisplayMatching(w.getBounds()).workArea.height };
  });
  return shown !== null && shown.height === settingsContentHeight(content, shown.room, shown.chrome);
}

/**
 * Replace the native file dialog in the main process for the next calls; resets the call counter. The real dialog is
 * kept the first time (`restoreOpenDialog` puts it back): a stub otherwise stays for the rest of the session, and a later
 * step that needs the real panel gets the stub's files instead (Mac run 39779536146: the settings folder panel got a PDF).
 */
export async function stubOpenDialog(app: ElectronApplication, filePaths: string[], opts: { once?: boolean } = {}): Promise<void> {
  await app.evaluate(
    ({ dialog }, { paths, once }) => {
      const g = globalThis as { __learnOpenDialogCalls?: number; __learnRealOpenDialog?: typeof dialog.showOpenDialog };
      g.__learnRealOpenDialog ??= dialog.showOpenDialog;
      g.__learnOpenDialogCalls = 0;
      dialog.showOpenDialog = (async () => {
        g.__learnOpenDialogCalls = (g.__learnOpenDialogCalls ?? 0) + 1;
        // `once`: the files the first time only; any later call is a cancel (a late ⌘O then imports nothing twice).
        if (once && g.__learnOpenDialogCalls > 1) return { canceled: true, filePaths: [] };
        return { canceled: false, filePaths: paths };
      }) as typeof dialog.showOpenDialog;
    },
    { paths: filePaths, once: opts.once === true },
  );
}

/**
 * An open dialog that stays up until `releaseOpenDialog` (a user still choosing files): the import that asked for it
 * is in progress meanwhile (the window is held). No paths = cancelled.
 */
export const holdOpenDialog = (app: ElectronApplication, paths: string[]) =>
  app.evaluate(({ dialog }, paths) => {
    const g = globalThis as { __learnReleaseDialog?: () => void; __learnRealOpenDialog?: typeof dialog.showOpenDialog };
    g.__learnRealOpenDialog ??= dialog.showOpenDialog;
    dialog.showOpenDialog = (() =>
      new Promise((resolve) => {
        g.__learnReleaseDialog = () => resolve({ canceled: paths.length === 0, filePaths: paths });
      })) as typeof dialog.showOpenDialog;
  }, paths);
export const releaseOpenDialog = (app: ElectronApplication) => app.evaluate(() => (globalThis as { __learnReleaseDialog?: () => void }).__learnReleaseDialog?.());

/** Puts the real native file dialog back after `stubOpenDialog` / `holdOpenDialog` (a no-op when none was stubbed). */
export const restoreOpenDialog = (app: ElectronApplication) =>
  app.evaluate(({ dialog }) => {
    const g = globalThis as { __learnRealOpenDialog?: typeof dialog.showOpenDialog };
    if (g.__learnRealOpenDialog) dialog.showOpenDialog = g.__learnRealOpenDialog;
  });

/** How many times the stubbed open dialog ran since the last `stubOpenDialog`. */
export const openDialogCalls = (app: ElectronApplication): Promise<number> =>
  app.evaluate(() => (globalThis as { __learnOpenDialogCalls?: number }).__learnOpenDialogCalls ?? 0);

/** What main handed the OS since the last stubShell, in order: Finder에서 보기 = reveal, 기본 앱으로 열기 = open. */
export type ShellCall = ['reveal' | 'open', string];

/** Record shell calls in main instead of opening Finder or another app; `openFails` makes openPath report an error. */
export async function stubShell(app: ElectronApplication, opts: { openFails?: boolean } = {}): Promise<void> {
  await app.evaluate(({ shell }, openFails) => {
    const g = globalThis as { __learnShell?: Array<['reveal' | 'open', string]> };
    g.__learnShell = [];
    shell.showItemInFolder = (p: string) => void g.__learnShell!.push(['reveal', p]);
    shell.openPath = async (p: string) => {
      g.__learnShell!.push(['open', p]);
      return openFails ? 'No application knows how to open this file' : '';
    };
  }, opts.openFails === true);
}
export const shellCalls = (app: ElectronApplication): Promise<ShellCall[]> => app.evaluate(() => (globalThis as { __learnShell?: ShellCall[] }).__learnShell ?? []);

/** Record the URLs main hands to the system (shell.openExternal) instead of opening a browser or a mail program. */
export async function stubOpenExternal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as { __learnExternal?: string[] };
    g.__learnExternal = [];
    shell.openExternal = async (url: string) => void g.__learnExternal!.push(url);
  });
}
export const openExternalCalls = (app: ElectronApplication): Promise<string[]> => app.evaluate(() => (globalThis as { __learnExternal?: string[] }).__learnExternal ?? []);

/**
 * Zoom the open PDF through the reader's handle (the E2E-only window.__learnReader store): 1 is 100 %. It waits for the saved place:
 * the reader applies it once the stage has settled and the position has come, and a zoom set before that is overwritten by it (on the
 * Mac runner that can be after the first page is drawn, run 41846187098).
 */
export const setPdfZoom = async (page: Page, zoom: number | 'auto' | 'page-width' | 'page-fit'): Promise<void> => {
  await expect(page.locator('[data-testid="pdf-scroll"][data-restored]')).toBeAttached();
  await page.evaluate((z) => {
    const store = (window as unknown as { __learnReader?: { getState(): { handle: { setZoom(z: unknown): void } | null } } }).__learnReader;
    const handle = store?.getState().handle;
    if (!handle) throw new Error('no PDF is open');
    handle.setZoom(z);
  }, zoom);
};

/**
 * The colour the screen shows at a point of the window (a 1 x 1 screenshot, decoded in the page), as [r, g, b].
 * `x` and `y` are CSS px from the window's top left.
 */
export async function pixelAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const shot = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, animations: 'disabled', caret: 'hide' });
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }), { premultiplyAlpha: 'none' });
    const ctx = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  }, shot.toString('base64'));
}

/** The RGBA pixels of a rectangle of the window (CSS px), row by row. */
export async function shotPixels(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<{ width: number; height: number; data: Uint8Array }> {
  const shot = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  const r = await page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }), { premultiplyAlpha: 'none' });
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let binary = '';
    for (let i = 0; i < d.length; i += 0x8000) binary += String.fromCharCode(...d.subarray(i, i + 0x8000));
    return { width: bitmap.width, height: bitmap.height, data: btoa(binary) };
  }, shot.toString('base64'));
  return { width: r.width, height: r.height, data: Buffer.from(r.data, 'base64') };
}

/** The darkest colour on the screen inside a rectangle of the window (CSS px), as [r, g, b]: whether ink stays ink. */
export async function darkestPixel(page: Page, clip: { x: number; y: number; width: number; height: number }): Promise<[number, number, number]> {
  const shot = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  return page.evaluate(async (b64) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }), { premultiplyAlpha: 'none' });
    const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    const d = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    let best: [number, number, number] = [255, 255, 255];
    for (let i = 0; i < d.length; i += 4) if (d[i]! + d[i + 1]! + d[i + 2]! < best[0] + best[1] + best[2]) best = [d[i]!, d[i + 1]!, d[i + 2]!];
    return best;
  }, shot.toString('base64'));
}

/**
 * What a colour expression of the page's own CSS (`var(--bg-sunken)`, a light-dark() token) comes out as in sRGB, as [r, g, b]:
 * a probe element resolves it as the stage computes it, and a canvas converts what it computed.
 */
export const resolveColor = (page: Page, expression: string): Promise<[number, number, number]> =>
  page.evaluate((expr) => {
    const probe = document.createElement('div');
    probe.style.background = expr;
    document.body.append(probe);
    const css = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const ctx = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!] as [number, number, number];
  }, expression);

/**
 * A mouse drag along a text line as a hand makes it: one pointer position per frame, a few px apart. The selection follows the
 * positions the pointer was seen at; a single jump onto the text layer's endOfContent (user-select none, Chromium 152) leaves it
 * where the last text position put it, so a burst of Playwright's `steps` (coalesced to a frame) loses the line's last glyphs.
 */
export async function dragAlong(page: Page, fromX: number, toX: number, y: number): Promise<void> {
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  const dir = toX >= fromX ? 1 : -1;
  for (let x = fromX + 3 * dir; dir * (toX - x) > 0; x += 3 * dir) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(16);
  }
  await page.mouse.move(toX, y);
  await page.waitForTimeout(16);
  await page.mouse.up();
}

/**
 * The canvas of one page of the open PDF (pdf.js draws a canvas in each page's wrapper). Not the detail canvas pdf.js
 * adds over the visible part when the screen area caps the page's canvas (capCanvasAreaFactor; the 1024 × 768 macOS
 * runner at 200 %, Mac run 41797171352): that one is aria-hidden, the page's own has role presentation.
 */
export const pdfCanvas = (page: Page, pageNumber = 1): Locator =>
  page.getByTestId('pdf-viewer').locator(`.page[data-page-number="${pageNumber}"] canvas[role="presentation"]`);


/** One call of the stubbed save panel: whether it hung on a window (a sheet), and what it was asked to show. */
export interface SaveDialogCall {
  parent: boolean;
  title: string | null;
  defaultPath: string | null;
  properties: string[];
  extensions: string[];
}

/**
 * Replace the native save panel in main for the rest of the session: it answers `filePath` (null: cancelled) and records
 * every call, from none (saveDialogCalls counts them, saveDialogLog says what each was asked to show).
 */
export async function stubSaveDialog(app: ElectronApplication, filePath: string | null): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    const g = globalThis as { __learnSaveDialogCalls?: SaveDialogCall[] };
    g.__learnSaveDialogCalls = [];
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      const o = (args.length > 1 ? args[1] : args[0]) as { title?: string; defaultPath?: string; properties?: string[]; filters?: Array<{ extensions: string[] }> };
      g.__learnSaveDialogCalls!.push({
        parent: args.length > 1,
        title: o.title ?? null,
        defaultPath: o.defaultPath ?? null,
        properties: o.properties ?? [],
        extensions: (o.filters ?? []).flatMap((f) => f.extensions),
      });
      return answer === null ? { canceled: true, filePath: '' } : { canceled: false, filePath: answer };
    }) as typeof dialog.showSaveDialog;
  }, filePath);
}
/** How many times the stubbed (or held) save panel was shown since the last stubSaveDialog / holdSaveDialog, as openDialogCalls counts. */
export const saveDialogCalls = (app: ElectronApplication): Promise<number> =>
  app.evaluate(() => (globalThis as { __learnSaveDialogCalls?: SaveDialogCall[] }).__learnSaveDialogCalls?.length ?? 0);
/** What each of those panels was asked to show, oldest first. */
export const saveDialogLog = (app: ElectronApplication): Promise<SaveDialogCall[]> =>
  app.evaluate(() => (globalThis as { __learnSaveDialogCalls?: SaveDialogCall[] }).__learnSaveDialogCalls ?? []);

/** A save panel that stays up (the user still choosing) until releaseSaveDialog, then answers `filePath`; calls are recorded from none. */
export const holdSaveDialog = (app: ElectronApplication, filePath: string) =>
  app.evaluate(({ dialog }, answer) => {
    const g = globalThis as { __learnReleaseSave?: () => void; __learnSaveDialogCalls?: SaveDialogCall[] };
    delete g.__learnReleaseSave;
    g.__learnSaveDialogCalls = [];
    dialog.showSaveDialog = ((...args: unknown[]) => {
      const o = (args.length > 1 ? args[1] : args[0]) as { title?: string; defaultPath?: string; properties?: string[]; filters?: Array<{ extensions: string[] }> };
      g.__learnSaveDialogCalls!.push({
        parent: args.length > 1,
        title: o.title ?? null,
        defaultPath: o.defaultPath ?? null,
        properties: o.properties ?? [],
        extensions: (o.filters ?? []).flatMap((f) => f.extensions),
      });
      return new Promise((resolve) => (g.__learnReleaseSave = () => resolve({ canceled: false, filePath: answer })));
    }) as typeof dialog.showSaveDialog;
  }, filePath);
/** Answers the held save panel; waits until main has shown it (the menu click returns before the IPC arrives). */
export async function releaseSaveDialog(app: ElectronApplication): Promise<void> {
  await expect.poll(() => app.evaluate(() => typeof (globalThis as { __learnReleaseSave?: () => void }).__learnReleaseSave)).toBe('function');
  await app.evaluate(() => (globalThis as { __learnReleaseSave?: () => void }).__learnReleaseSave!());
}

/**
 * Every copy main makes from now (node:fs/promises copyFile: imports, named copies, exports) waits until releaseCopies.
 * The real copyFile is kept the first time, so holding again does not stack waits.
 */
export async function holdCopies(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const fsp = process.getBuiltinModule('node:fs/promises');
    const g = globalThis as { __learnRealCopyFile?: typeof fsp.copyFile; __learnReleaseCopy?: () => void };
    const real = (g.__learnRealCopyFile ??= fsp.copyFile);
    const held = new Promise<void>((resolve) => (g.__learnReleaseCopy = resolve));
    fsp.copyFile = (async (...args: Parameters<typeof real>) => {
      await held;
      return real(...args);
    }) as typeof real;
  });
}
export const releaseCopies = (app: ElectronApplication) => app.evaluate(() => (globalThis as { __learnReleaseCopy?: () => void }).__learnReleaseCopy?.());

/**
 * Imports files through `learn.library.import` and waits for the queue's run to end (P-22): every path must come in as a
 * new item; they come back in the order given. The run is quiet — no busy screen, no progress or result toast — as this
 * helper was before the queue. `allowDuplicate`: the same content as an item already there comes in as a new item (no
 * question). Call it while no other import runs: the run must be this call's alone.
 */
export async function importPaths(page: Page, paths: string[], opts: { mode?: StorageMode; allowDuplicate?: true } = {}): Promise<LibraryItem[]> {
  const r = await page.evaluate(
    async ({ paths, mode, allowDuplicate }) => {
      const learn = window.learn;
      const ids: string[] = [];
      const offs: Array<() => void> = [];
      const ended = new Promise<{ report: ImportReport } | { asked: true }>((resolve) => {
        offs.push(learn.on('libraryChanged', (c) => void (c.reason === 'import' && ids.push(...(c.itemIds ?? [])))));
        offs.push(learn.on('import:progress', (s) => void (s.state === 'waiting-choice' && resolve({ asked: true }))));
        offs.push(learn.on('import:finished', ({ report }) => resolve({ report })));
      });
      window.__learnQuietImports = (window.__learnQuietImports ?? 0) + 1;
      try {
        const sent = await learn.library.import({ paths, mode, ...(allowDuplicate ? { allowDuplicate: true } : {}) });
        if (!sent.ok) {
          window.__learnQuietImports = Math.max(0, (window.__learnQuietImports ?? 1) - 1);
          return { error: `library.import failed: ${sent.code}` };
        }
        const end = await ended;
        if ('asked' in end) return { error: 'importPaths: a duplicate was asked (pass allowDuplicate, or answer the sheet in the test)' };
        const got = ids.length > 0 ? await learn.library.getItems({ ids }) : { ok: true as const, data: [] as LibraryItem[] };
        if (!got.ok) return { error: `library.getItems failed: ${got.code}` };
        return { report: end.report, items: got.data };
      } finally {
        for (const off of offs) off();
      }
    },
    { paths, mode: opts.mode ?? 'managed', allowDuplicate: opts.allowDuplicate === true },
  );
  if ('error' in r) throw new Error(r.error);
  if (r.report.requested !== paths.length) throw new Error(`importPaths: the run had ${r.report.requested} files, not ${paths.length} (another import was running)`);
  if (r.report.failed.length > 0 || r.items.length !== paths.length) {
    throw new Error(`importPaths: ${r.report.failed.map((f) => `${f.name}: ${f.message}`).join('; ') || `${r.items.length} of ${paths.length} came in`}`);
  }
  return r.items;
}

/**
 * Until the import has ended for this window: main's queue idle, nothing being handed over, no run's end being shown (its
 * toasts are up). Call it after something showed that the run began (a toast, a sheet, a row).
 */
export async function waitImportIdle(page: Page): Promise<void> {
  const marker = page.getByTestId('import-queue');
  await expect.poll(() => marker.evaluate((e) => `${e.getAttribute('data-state')}|${e.getAttribute('data-sending')}|${e.getAttribute('data-settling') ?? ''}`), { message: 'the import ended' }).toBe('idle|0|');
}

/** Main's E2E import hooks (main/test-hooks.ts, P-6, Q-3c, Q-4i). */
export type ImportPausePoint = 'afterStage' | 'afterPlace' | 'beforeCommit';
interface QueueTestHooks {
  importPause(input: { at: ImportPausePoint | null }): void;
  importResume(): void;
  importWaiting(): ImportPausePoint | null;
  importQueueState(): ImportQueueState;
  holdJob(input: { kind: 'backup' | 'restore' }): void;
  releaseJob(): void;
}
type WithQueueHooks = { __learnTest: QueueTestHooks };
/** The next file of an import waits at `at` until importResume; null calls it off. */
export const importPause = (app: ElectronApplication, at: ImportPausePoint | null) => app.evaluate((_e, at) => (globalThis as unknown as WithQueueHooks).__learnTest.importPause({ at }), at);
/**
 * Lets the held file go. A resume sent before the file has reached its hold is lost and the file then waits there for good (Mac
 * all 41387123318; here the empty-library busy screen test under taskset -c 0-3), so it waits for the file to be held first.
 * Nothing held within the wait: the resume goes anyway (a test that calls it off with no file coming).
 */
export const importResume = async (app: ElectronApplication) => {
  await expect.poll(() => importWaiting(app), { timeout: 15_000 }).not.toBeNull().catch(() => undefined);
  await app.evaluate(() => (globalThis as unknown as WithQueueHooks).__learnTest.importResume());
};
export const importWaiting = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithQueueHooks).__learnTest.importWaiting());
export const importQueueState = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithQueueHooks).__learnTest.importQueueState());
/** A job of another kind holds the work line until releaseJob: an import put in meanwhile waits behind it. */
export const holdJob = (app: ElectronApplication, kind: 'backup' | 'restore' = 'backup') => app.evaluate((_e, kind) => (globalThis as unknown as WithQueueHooks).__learnTest.holdJob({ kind }), kind);
export const releaseJob = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithQueueHooks).__learnTest.releaseJob());

/**
 * Metadata (and, when given, a title) for an item through `learn.library.updateMetadata` from the page. Main
 * broadcasts libraryChanged{metadata}, so the list is read again; the updated row comes back.
 */
export async function seedMetadata(page: Page, itemId: string, metadata: NonNullable<UpdateMetadataInput['metadata']>, title?: string): Promise<LibraryItem> {
  const r = await page.evaluate((input) => window.learn.library.updateMetadata(input), { itemId, metadata, ...(title === undefined ? {} : { title }) });
  if (!r.ok) throw new Error(`library.updateMetadata failed: ${r.code}`);
  return r.data;
}

/** The system clipboard's text, read in main: the page may write the clipboard but never read it. */
export const readClipboard = (app: ElectronApplication): Promise<string> => app.evaluate(({ clipboard }) => clipboard.readText());

/** Import through the real menu path (stubbed dialog): 파일 › 파일 가져오기… or 외부 파일 연결…. */
export async function importFiles(s: Session, paths: string[], mode: 'managed' | 'linked' = 'managed'): Promise<void> {
  await stubOpenDialog(s.app, paths);
  await runMenuCommand(s.app, mode === 'managed' ? 'file.importManaged' : 'file.importLinked');
}

/**
 * A control disabled with a reason (ui/disabledReason.tsx, M-2): focusable but aria-disabled, and the reason is its
 * accessible description (the same text its tooltip shows). `null`: enabled again, with no reason left behind.
 */
export async function expectDisabledReason(control: Locator, reason: string | null): Promise<void> {
  if (reason === null) {
    await expect(control).not.toHaveAttribute('aria-disabled', 'true');
    await expect(control).toHaveAccessibleDescription('');
  } else {
    await expect(control).toHaveAttribute('aria-disabled', 'true');
    await expect(control).toHaveAccessibleDescription(reason);
  }
}

/** A sheet window is shown at its measured size, and its page's viewport has that size. */
async function sheetShownAtSize(app: ElectronApplication, page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const shown = await app.evaluate(({ BrowserWindow }, url) => {
          const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL() === url);
          return w?.isVisible() ? w.getContentSize().join('x') : null;
        }, page.url());
        return shown !== null && shown === (await page.evaluate(() => `${innerWidth}x${innerHeight}`));
      },
      { message: 'the sheet is shown at its measured size' },
    )
    .toBe(true);
}

/**
 * Run `trigger` and return the window it opens (`?window=<kind>`), once its React root has rendered. The first ⌘, of a
 * session shows the settings window main prepared hidden instead of making one: its page, already open, is the one
 * returned. A sheet is
 * returned once main has shown it at its measured size (hidden → sized to its content → shown), and the page's
 * viewport has that size: geometry and screenshots never see the first, full-height layout. The settings window is
 * returned once it is shown and has the focus: it shows only after its measure and font wait, 120–150 ms after its
 * page renders, and until then the main window keeps the focus (the CI race fixed in 0ae8aba). When no window of
 * ours has the focus (the app itself is not the active one, which macOS 14+ may refuse to change), shown is enough.
 */
export async function expectWindow(app: ElectronApplication, kind: 'settings' | 'sheet', trigger: () => Promise<unknown>): Promise<Page> {
  // ⌘, shows the settings window main prepared when there is one; every sheet is a new window.
  const prepared = kind === 'settings' ? app.windows().find((p) => !p.isClosed() && p.url().includes('window=settings')) : undefined;
  const opened = prepared ? null : app.waitForEvent('window', { timeout: 15_000 });
  await trigger();
  const page = prepared ?? (await opened!);
  await expect.poll(() => page.url(), { message: `a ${kind} window` }).toContain(`window=${kind}`);
  await page.locator(kind === 'sheet' ? '[data-sheet-root]' : '[data-settings-root]').waitFor();
  if (kind === 'sheet') await sheetShownAtSize(app, page);
  if (kind === 'settings') {
    await expect
      .poll(
        () =>
          app.evaluate(({ BrowserWindow }, url) => {
            const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL() === url);
            return Boolean(w?.isVisible() && (w.isFocused() || BrowserWindow.getFocusedWindow() === null));
          }, page.url()),
        { message: 'the settings window is shown and has the focus' },
      )
      .toBe(true);
  }
  return page;
}

/**
 * Clicks a sheet button that answers the sheet (it closes at once), and waits for the close. The click can lose the
 * race with its own window: the page may be gone before Playwright's click returns ("Target page … has been closed",
 * CI run 39752290686); that is the click having worked, as in closeSheet.
 */
export async function clickToCloseSheet(sheet: Page, button: Locator): Promise<void> {
  const closed = sheet.waitForEvent('close');
  await button.click().catch((e: unknown) => {
    if (!sheet.isClosed()) throw e;
  });
  await closed;
}

/**
 * Press a key that closes the sheet and wait for its window to close (R-12). esc acts on keydown, as on a native
 * sheet, so the window can be gone before Playwright sends the keyup: a press that failed because the page closed is
 * the expected end, any other failure is not.
 */
export async function closeSheet(sheet: Page, key: 'Escape' | 'Enter'): Promise<void> {
  const closed = sheet.waitForEvent('close');
  await sheet.keyboard.press(key).catch((e: unknown) => {
    if (!sheet.isClosed()) throw e;
  });
  await closed;
}

/** Real files in a hidden `#drop-source` file input: their File objects have a location on disk, as Finder's do. */
export async function dropSource(page: Page, paths: string[]): Promise<void> {
  await page.evaluate(() => {
    document.getElementById('drop-source')?.remove();
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.multiple = true;
    picker.id = 'drop-source';
    picker.hidden = true;
    document.body.append(picker);
  });
  await page.locator('#drop-source').setInputFiles(paths);
}

export type DragType = 'dragenter' | 'dragover' | 'dragleave' | 'drop';
/**
 * What a synthetic drag carries: files by [name, MIME type] (no location on disk, like an in-memory file), the real
 * files of `#drop-source` (dropSource), or text from another app.
 */
export type DragCarry = ReadonlyArray<readonly [string, string]> | 'source' | 'text';

/**
 * One event of a synthetic drag from another app, on <body> or on the element at the middle of the window. As the OS
 * does, a drag that is over the window repeats dragover (every 100 ms, the last ⌥ state) until it leaves or drops, so
 * the overlay's idle timeout does not end a drag the test still holds; `repeat: false` sends this one event only.
 *
 * Returns the dropEffect the page left on the event: on a dragover "none" where the window takes no drop, else "copy"
 * or "link". A constructed DataTransfer ignores dropEffect writes (it is not in drag-and-drop mode; Chromium keeps
 * "none"), so each event carries a stand-in for the browser's own: the real items, files and types, and a writable
 * dropEffect that starts as "copy" on a dragover (the browser's start for a copy-or-link drag from Finder).
 */
export function drag(page: Page, type: DragType, carry: DragCarry, opts: { altKey?: boolean; at?: 'centre'; repeat?: boolean } = {}): Promise<string> {
  return page.evaluate(
    ({ type, carry, altKey, centre, repeat }) => {
      const transfer = () => {
        const dt = new DataTransfer();
        if (carry === 'text') dt.setData('text/plain', '세포 신호 전달');
        else if (carry === 'source') for (const f of Array.from((document.getElementById('drop-source') as HTMLInputElement).files!)) dt.items.add(f);
        else for (const [name, mime] of carry) dt.items.add(new File(['x'], name, { type: mime }));
        return dt;
      };
      const fire = (target: EventTarget, kind: string, dt: DataTransfer) => {
        const event = new DragEvent(kind, { dataTransfer: dt, altKey, bubbles: true, cancelable: true });
        const shim = { types: dt.types, items: dt.items, files: dt.files, effectAllowed: 'copyLink', dropEffect: kind === 'dragover' ? 'copy' : 'none' };
        Object.defineProperty(event, 'dataTransfer', { value: shim });
        target.dispatchEvent(event);
        return shim.dropEffect;
      };
      const g = window as unknown as { __learnDragRepeat?: ReturnType<typeof setInterval> };
      clearInterval(g.__learnDragRepeat);
      delete g.__learnDragRepeat;
      const effect = fire((centre ? document.elementFromPoint(innerWidth / 2, innerHeight / 2) : null) ?? document.body, type, transfer());
      if (repeat && (type === 'dragenter' || type === 'dragover')) g.__learnDragRepeat = setInterval(() => fire(document.body, 'dragover', transfer()), 100);
      return effect;
    },
    { type, carry, altKey: opts.altKey ?? false, centre: opts.at === 'centre', repeat: opts.repeat ?? true },
  );
}

/**
 * The table row of the item titled exactly `title` . The table is virtualized: a row far from the viewport is
 * not in the DOM until it is scrolled to.
 */
export const rowByTitle = (page: Page, title: string): Locator => page.locator(`[data-testid="item-row"][data-title=${JSON.stringify(title)}]`);

/** The row at `index` in the table's current order (data-index): a virtualized body's DOM order need not be the visual one. */
export const rowAt = (page: Page, index: number): Locator => page.locator(`[data-testid="item-row"][data-index="${index}"]`);

/** Opens an item as a user does: a double-click on its row (M4 spec 3.3). A single click only selects. */
export async function openItem(page: Page, title: string): Promise<void> {
  const row = rowByTitle(page, title);
  await row.scrollIntoViewIfNeeded();
  await row.dblclick();
}

/**
 * Selects rows by title: a plain click on the first, a modifier-click on each of the rest. `Meta` (the default, toggle)
 * is the platform's: ⌘ on macOS, Ctrl elsewhere (the table's own rule, LibraryTable).
 */
export async function selectRows(page: Page, titles: readonly string[], opts: { modifier?: 'Meta' | 'Shift' | 'Control' } = {}): Promise<void> {
  const [first, ...rest] = titles;
  if (first === undefined) return;
  await rowByTitle(page, first).click();
  const wanted = opts.modifier ?? 'Meta';
  const modifier = wanted === 'Meta' && process.platform !== 'darwin' ? 'Control' : wanted;
  for (const title of rest) await rowByTitle(page, title).click({ modifiers: [modifier] });
}

/** One seeded item's facts, as main's test hook takes them (apps/desktop/src/main/test-hooks.ts). */
export interface SeedRow {
  title: string;
  creators: string[];
  year: number | null;
  createdAt: string;
  /** Long search fields, only for the 1만 항목 @perf (seedRows' `longTexts`). */
  abstract?: string;
  extra?: string;
}

const SEED_KO = ['세포', '신호', '전달', '단백질', '효소', '반응', '유전자', '발현', '대사', '경로', '면역', '수용체', '광합성', '열역학', '확률', '통계', '강의', '노트'];
const SEED_EN = ['Signal', 'Protein', 'Enzyme', 'Kinetics', 'Bayesian', 'Inference', 'Linear', 'Algebra', 'Membrane', 'Transport', 'Genome', 'Lecture', 'Notes', 'Review'];
const SEED_NAMES = ['김민지', '이서준', '박지훈', '최유나', '정하늘', 'Alice Kim', 'Brian Lee', 'Chen Wei', 'Dana Park', 'Erik Lund'];

/** Words from the Korean list up to `length` characters; from the row's number, so rows differ and every run is the same. */
function longText(from: number, length: number): string {
  const words: string[] = [];
  for (let k = from, size = 0; size < length; k++) {
    const word = SEED_KO[k % SEED_KO.length]!;
    words.push(word);
    size += word.length + 1;
  }
  return words.join(' ').slice(0, length);
}
/** One row in ten has a 600-character abstract; one in a hundred a 6,000-character abstract and a 5,000-character memo (past the 4,000 cut). */
const longTextsOf = (i: number): Pick<SeedRow, 'abstract' | 'extra'> =>
  i % 100 === 7 ? { abstract: longText(i, 6_000), extra: longText(i + 1, 5_000) } : i % 10 === 3 ? { abstract: longText(i, 600) } : {};

/**
 * `count` seeded rows from a fixed generator (mulberry32): Korean and English titles, each ending in its running number
 * (so every title is unique), 0–4 creators, a year or none, and 추가일 one minute apart going back from `base`.
 */
export function seedRows(count: number, seed = 1, base = Date.parse('2026-10-01T00:00:00.000Z'), opts: { longTexts?: boolean } = {}): SeedRow[] {
  let a = seed | 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  return Array.from({ length: count }, (_, i) => {
    const words = rand() < 0.6 ? SEED_KO : SEED_EN;
    const row: SeedRow = {
      title: `${pick(words)} ${pick(words)} ${i + 1}`,
      creators: Array.from({ length: Math.floor(rand() * 5) }, () => pick(SEED_NAMES)),
      year: rand() < 0.1 ? null : 1985 + Math.floor(rand() * 41),
      createdAt: new Date(base - i * 60_000).toISOString(),
    };
    return opts.longTexts ? { ...row, ...longTextsOf(i) } : row;
  });
}

/**
 * Adds `count` items that share `from`'s file — one managed copy, one transaction — through main's E2E hook.
 * Resolves once main has written them; the list follows its one libraryChanged.
 */
export async function seedLibrary(app: ElectronApplication, opts: { count: number; from: LibraryItem; seed?: number }): Promise<void> {
  const input = { fromItemId: opts.from.id, rows: seedRows(opts.count, opts.seed) };
  const added = await app.evaluate((_electron, arg) => (globalThis as unknown as { __learnTest: { seedItems(i: typeof arg): number } }).__learnTest.seedItems(arg), input);
  if (added !== opts.count) throw new Error(`seedLibrary: ${added} of ${opts.count} items added`);
}

/** E2E only: starts the render counts of R/ui/renderCount.ts in this page, from zero. */
export const watchRenders = (page: Page): Promise<void> =>
  page.evaluate(() => {
    (window as unknown as { __learnRenders?: Record<string, number> }).__learnRenders = {};
  });

/** How often each counted component rendered since watchRenders. */
export const renderCounts = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => ({ ...((window as unknown as { __learnRenders?: Record<string, number> }).__learnRenders ?? {}) }));

/** One application-menu entry as JSON. Runtime roles are lower-case (`selectall`, `togglefullscreen`). */
export interface MenuNode {
  label: string;
  role: string | null;
  accelerator: string | null;
  id: string | null;
  enabled: boolean;
  checked: boolean;
  type: string;
  submenu: MenuNode[] | null;
}

/** `Menu.getApplicationMenu()` as JSON (empty when no menu is set). */
export async function menuSnapshot(app: ElectronApplication): Promise<MenuNode[]> {
  return app.evaluate(({ Menu }) => {
    interface LiveItem {
      label: string; role?: string; accelerator?: string; id?: string; enabled: boolean; checked: boolean; type: string; submenu?: { items: LiveItem[] };
    }
    const walk = (items: LiveItem[]): MenuNode[] =>
      items.map((i) => ({
        label: i.label,
        role: i.role ?? null,
        accelerator: i.accelerator ?? null,
        id: i.id ?? null,
        enabled: i.enabled,
        checked: i.checked,
        type: i.type,
        submenu: i.submenu ? walk(i.submenu.items) : null,
      }));
    const menu = Menu.getApplicationMenu() as { items: LiveItem[] } | null;
    return menu ? walk(menu.items) : [];
  });
}

/** Registry commands enabled in the application menu right now (hidden ⌘= twins excluded). */
export async function enabledMenuCommands(app: ElectronApplication): Promise<CommandId[]> {
  const flat = (nodes: MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flat(n.submenu ?? [])]);
  const ids = new Set<string>(COMMANDS.map((c) => c.id));
  return flat(await menuSnapshot(app)).filter((n) => n.enabled && n.id !== null && ids.has(n.id)).map((n) => n.id as CommandId);
}

/**
 * Click an application-menu item the way Electron does for a mouse click: the MenuItem's own `click()` with the focused
 * window. `args` names a row of the command's submenu (보기 › 정렬 기준 ▸ 연도 = `{ column: 'year' }`); the command's own
 * item (the submenu's head) is what must be on. Waits up to 5 s for it to become clickable (the renderer reports its
 * context asynchronously), then throws when the item is missing, hidden or disabled (a user couldn't click it).
 */
export async function runMenuCommand(app: ElectronApplication, id: CommandId, args?: CommandArgs): Promise<void> {
  // A hidden item (⌘2…⌘9 in 윈도우) is not drawn and its key works: it is run as the key would.
  const hidden = COMMANDS.find((c) => c.id === id)?.menu?.hidden === true;
  await expect.poll(() => menuItemEnabled(app, id, { hidden }), { timeout: 5_000, message: `menu item ${id} never became clickable` }).toBe(true);
  const itemId = menuItemId(id, args);
  await app.evaluate(({ BrowserWindow, Menu, webContents }, { itemId, hidden }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (!item) throw new Error(`no application menu item with id ${itemId}`);
    if (!item.enabled || !(item.visible || hidden)) throw new Error(`menu item ${itemId} is not clickable`);
    item.click(undefined, BrowserWindow.getFocusedWindow() ?? undefined, webContents.getFocusedWebContents() ?? undefined);
  }, { itemId, hidden });
}

/**
 * Clicks an application-menu item as its accelerator would (`triggeredByAccelerator`): CDP keys never reach native
 * accelerators on Linux, and the page tells a key from a click (Q-6e: ⌘⌫ typed in a text field is the field's).
 * Resolves to main's clock at the click (epoch ms, performance.timeOrigin + now): where a key's timing starts (p1-perf).
 */
export async function runMenuAccelerator(app: ElectronApplication, id: CommandId): Promise<number> {
  await expect.poll(() => menuItemEnabled(app, id), { timeout: 5_000, message: `menu item ${id} never became clickable` }).toBe(true);
  return app.evaluate(({ BrowserWindow, Menu, webContents }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item?.enabled || !item.visible) throw new Error(`menu item ${id} is not clickable`);
    const at = performance.timeOrigin + performance.now();
    item.click({ triggeredByAccelerator: true } as Electron.KeyboardEvent, BrowserWindow.getFocusedWindow() ?? undefined, webContents.getFocusedWebContents() ?? undefined);
    return at;
  }, id);
}

/**
 * The item panel shown, whatever the window's width: if it is folded (by the width or by the user) it is shown on demand
 * as ⌥⌘I does, and the command is repeated only when a late resize folded it again. The window is judged only once its
 * width has stopped changing (a macOS window that cannot reach the width asked for resizes after the first look), and
 * the command waits for the page to answer before the state is read again, so one fold is never undone by a second
 * press. No widening: a 1024 px screen cannot give 1440, and the tests that use this are about behaviour, not width.
 */
export async function showItemPanel(app: ElectronApplication, page: Page): Promise<void> {
  const state = () => page.getByTestId('shell').getAttribute('data-inspector');
  let last = -1;
  await expect
    .poll(
      async () => {
        const width = await page.evaluate(() => innerWidth);
        const settled = width === last;
        last = width;
        if (!settled) return 'resizing';
        if ((await state()) !== 'shown') {
          await runMenuCommand(app, 'view.toggleInspector');
          await page.waitForFunction(() => document.querySelector('[data-testid="shell"]')?.getAttribute('data-inspector') === 'shown', undefined, { timeout: 2_000 }).catch(() => {});
        }
        return state();
      },
      { intervals: [200], timeout: 15_000, message: 'the item panel never showed' },
    )
    .toBe('shown');
}

/**
 * The pointer over a control as a person brings it there: first a move to a quiet spot of the window (its centre), then
 * the hover. A hover tooltip opens only if the last input was a pointer one when the pointer enters the control, and a
 * browser reports the entering before the move that carries it, so a single jump from outside the page, or from a
 * keystroke, onto the control is a hover react-aria ignores (the window then has no pointer input yet, or the last
 * input was a key; the Mac runner, whose cursor is not over a new window, never shows the tooltip). A person's pointer
 * moves over the window on its way, which this move stands for.
 */
export async function hoverLikeUser(page: Page, testId: string): Promise<void> {
  const [x, y] = await page.evaluate(() => [Math.round(innerWidth / 2), Math.round(innerHeight / 2)] as const);
  await page.mouse.move(x, y);
  await page.getByTestId(testId).hover();
}

/**
 * The tooltip after a hover has this text. When none shows, the failure says why the page held it back: which reasons
 * block tooltips (data-tooltip-block), whether the window is inactive or not main, whether the page has the focus, and
 * which element the pointer is over: a hover tooltip that never comes on a runner is one of those or the pointer itself.
 */
export async function expectTooltipText(page: Page, expected: string | RegExp, hovered: string): Promise<void> {
  try {
    await expect(page.getByRole('tooltip')).toHaveText(expected);
  } catch (error) {
    const state = await page
      .evaluate((testId) => {
        const root = document.documentElement.dataset;
        return {
          tooltipBlock: root['tooltipBlock'] ?? null,
          windowInactive: 'windowInactive' in root,
          windowNotMain: 'windowNotMain' in root,
          hasFocus: document.hasFocus(),
          targetHovered: document.querySelector(`[data-testid="${testId}"]`)?.matches(':hover') ?? null,
          tooltips: document.querySelectorAll('.tooltip').length,
        };
      }, hovered)
      .catch((e: unknown) => ({ evaluateFailed: String(e) }));
    throw new Error(`${(error as Error).message}\npage state when no tooltip showed: ${JSON.stringify(state)}`);
  }
}

/** What decides how the sidebar's top 88 px is drawn, read when a shot of it is taken (see `sidebarTop88`). */
const shotStates = new WeakMap<Buffer, Record<string, unknown>>();

/**
 * The sidebar's top 88 px (the toggle, the launcher), shot with the pointer parked away from every control. The state
 * the pixels depend on is read at the same moment and kept with the shot, so a comparison that fails names it: the
 * window's key/main flags, the page's focus, which element has it, hover on the two controls, their disabled marks,
 * the toggle's tooltip, and the document's scroll.
 */
export async function sidebarTop88(page: Page): Promise<Buffer> {
  await page.mouse.move(900, 700);
  const state = await page.evaluate(() => {
    const root = document.documentElement.dataset;
    const control = (selector: string) => {
      const el = document.querySelector(selector);
      return el === null ? null : { hover: el.matches(':hover'), focus: el.matches(':focus, :focus-visible'), disabled: el.getAttribute('aria-disabled') === 'true' || el.matches(':disabled') };
    };
    const active = document.activeElement;
    return {
      windowInactive: 'windowInactive' in root,
      windowNotMain: 'windowNotMain' in root,
      hasFocus: document.hasFocus(),
      activeElement: active === null ? null : `${active.tagName.toLowerCase()}${active.getAttribute('data-testid') ? `[${active.getAttribute('data-testid')}]` : ''}`,
      toggle: control('.sidebar-top .icon-btn'),
      launcher: control('.sidebar .launcher'),
      tooltips: document.querySelectorAll('.tooltip').length,
      innerWidth,
    };
  });
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 240, height: 88 }, animations: 'disabled', caret: 'hide' });
  shotStates.set(shot, state);
  return shot;
}

/**
 * Two screenshots of the same clip are byte-identical, or the failure says where they differ (pixel count, bounding box,
 * the first differing pixel's two colours), decoded in the page: a pixel-identity test that fails on a machine whose
 * images cannot be looked at must name what moved. A difference also attaches both PNGs and a diff image (differing
 * pixels red on a dimmed copy, enlarged 4 times) to the test, and the page state each shot was taken in (`sidebarTop88`).
 * On macOS, where the sidebar is clear over the window material, translucent pixels are compared after laying both shots
 * over the sidebar's opaque colour with a small tolerance, and a few anti-aliased corner pixels may differ more (`compareShots`);
 * on Linux the compare stays exact.
 */
export async function expectSameShot(page: Page, testInfo: TestInfo, shot: Buffer, reference: Buffer, name: string): Promise<void> {
  if (shot.equals(reference)) return;
  const decoded = await page.evaluate(async ([a, b]) => {
    const decode = async (b64: string) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }), { premultiplyAlpha: 'none' });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      let binary = '';
      for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
      return { width, height, data: btoa(binary) };
    };
    // The sidebar's opaque colour without the window material: the token the sidebar paints when it is not clear.
    // It is a light-dark() value, which a canvas cannot parse: a probe element resolves it, and the canvas paints what it computed.
    const probe = document.createElement('div');
    probe.style.background = 'var(--bg-sidebar)';
    document.body.append(probe);
    const css = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const swatch = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true })!;
    swatch.fillStyle = css;
    swatch.fillRect(0, 0, 1, 1);
    return { x: await decode(a!), y: await decode(b!), css, swatch: Array.from(swatch.getImageData(0, 0, 1, 1).data) };
  }, [shot.toString('base64'), reference.toString('base64')] as const);
  const pixels = (d: { width: number; height: number; data: string }): Pixels => ({ width: d.width, height: d.height, data: Buffer.from(d.data, 'base64') });
  const [x, y] = [pixels(decoded.x), pixels(decoded.y)];
  let report: string;
  let diff: string | null = null;
  if (x.width !== y.width || x.height !== y.height) report = `sizes differ: ${x.width}x${x.height} vs ${y.width}x${y.height}`;
  else {
    // Over the macOS window material the shots are translucent and the renderer's soft edges vary by a few steps from
    // shot to shot, and so do a rounded corner's anti-aliased pixels; only there is the compare alpha-aware (see `compareShots`). Everywhere else it is exact.
    const result = compareShots(x, y, process.platform === 'darwin' ? sidebarFallback(decoded.css, decoded.swatch) : null);
    if (result.count === 0) {
      if (process.platform === 'darwin' && (isTranslucent(x) || isTranslucent(y))) return;
      report = 'same pixels, different PNG bytes (encoder)';
    } else {
      const { box } = result;
      report = `${result.count} px differ (largest channel step ${result.maxDelta}) in x ${box!.x0}–${box!.x1}, y ${box!.y0}–${box!.y1}; ${result.first}`;
      diff = await page.evaluate(async ([a, flags, w, h]) => {
        const src = Uint8Array.from(atob(a!), (c) => c.charCodeAt(0));
        const mark = Uint8Array.from(atob(flags!), (c) => c.charCodeAt(0));
        const out = new ImageData(w!, h!);
        for (let i = 0; i < mark.length; i++) out.data.set(mark[i] ? [255, 0, 0, 255] : [src[i * 4]! >> 1, src[i * 4 + 1]! >> 1, src[i * 4 + 2]! >> 1, 255], i * 4);
        const big = new OffscreenCanvas(w! * 4, h! * 4);
        const small = new OffscreenCanvas(w!, h!);
        small.getContext('2d')!.putImageData(out, 0, 0);
        const bigCtx = big.getContext('2d')!;
        bigCtx.imageSmoothingEnabled = false;
        bigCtx.drawImage(small, 0, 0, big.width, big.height);
        const bytes = new Uint8Array(await (await big.convertToBlob({ type: 'image/png' })).arrayBuffer());
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return btoa(binary);
      }, [Buffer.from(x.data).toString('base64'), Buffer.from(result.differs).toString('base64'), x.width, x.height] as const);
    }
  }
  const states = { shot: shotStates.get(shot) ?? null, reference: shotStates.get(reference) ?? null };
  await testInfo.attach(`${name}-shot.png`, { body: shot, contentType: 'image/png' });
  await testInfo.attach(`${name}-reference.png`, { body: reference, contentType: 'image/png' });
  if (diff !== null) await testInfo.attach(`${name}-diff.png`, { body: Buffer.from(diff, 'base64'), contentType: 'image/png' });
  await testInfo.attach(`${name}-states.json`, { body: JSON.stringify(states, null, 2), contentType: 'application/json' });
  expect(`${report}\nstates: ${JSON.stringify(states)}`, `${name}: the shots differ`).toBe('identical');
}

/** Whether the application-menu item exists, is visible and is enabled right now. */
export async function menuItemEnabled(app: ElectronApplication, id: string, opts: { hidden?: boolean } = {}): Promise<boolean> {
  return app.evaluate(({ Menu }, { id, hidden }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    return Boolean(item && item.enabled && (item.visible || hidden));
  }, { id, hidden: opts.hidden === true });
}

/**
 * The window takes commands again after a sheet or a native panel closed. Main keeps the parent held (blocked) until it
 * is key again, up to 250 ms on macOS, and a click or a picked menu row in that gap is refused without a trace. Main's
 * answer follows its push to the page on the same channel, so once it says the sheet is gone the page has the news too;
 * the frame lets React apply it.
 */
export async function sheetReleased(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => window.learn.ui.windowState().then((r) => (r.ok ? r.data.sheetOpen : null))), { message: 'the sheet never let go of the window' })
    .toBe(false);
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
}

/** 목록으로 돌아가기 from the reader, once a sheet closed before it has let go of the window. */
export async function backFromReader(page: Page): Promise<void> {
  await sheetReleased(page);
  await libraryTab(page).click();
}

/** Leaves the reader by closing its tab, so the next open of the item builds its reader afresh (a tab left open is kept mounted and shows at once). */
export async function closeReaderTab(page: Page): Promise<void> {
  await sheetReleased(page);
  await page.locator('.tab-item.is-active [data-testid="tab-close"]').click();
}

/** The tab strip's first tab: the library (a window with no reader tab has no strip, so none). */
export const libraryTab = (page: Page): Locator => page.locator('[data-testid="tab"][data-item-id="library"]');

/** The reader tab of an item, by its id. */
export const readerTab = (page: Page, itemId: string): Locator => page.locator(`[data-testid="tab"][data-item-id="${itemId}"]`);

/** One item of a native popup menu, as recorded by `stubContextMenu`. */
export interface PopupItem {
  id: string | null;
  label: string;
  enabled: boolean;
  /** A checkbox item's mark (the column header menu); false for the others. */
  checked: boolean;
  type: string;
  /** The rows of a submenu (컬렉션에 추가 ▸, 색 태그 ▸), as recorded. */
  submenu?: PopupItem[];
}

/**
 * Replace native popups in main for the rest of the session: every `Menu.prototype.popup` records its items (submenus
 * too) and the point it opened at, then (one task later, like a user) clicks the enabled row `pick` names through its
 * own `click()` and closes the menu. `pick` is a label, or a path of labels down the submenus (`['컬렉션에 추가', '학회']`);
 * a path that ends on a submenu's head, a null `pick`, or no enabled row with that label only closes the menu (dismissed).
 */
export async function stubContextMenu(app: ElectronApplication, pick: string | readonly string[] | null): Promise<void> {
  await app.evaluate(({ Menu }, pick) => {
    interface LiveItem { id?: string; label: string; enabled: boolean; visible: boolean; checked: boolean; type: string; submenu?: { items: LiveItem[] }; click(): void }
    interface Recorded { id: string | null; label: string; enabled: boolean; checked: boolean; type: string; submenu?: Recorded[] }
    const g = globalThis as { __learnPopups?: Recorded[][]; __learnPopupAt?: Array<{ x: number; y: number }>; __learnPopupTimes?: number[] };
    g.__learnPopups = [];
    g.__learnPopupAt = [];
    g.__learnPopupTimes = [];
    const record = (items: LiveItem[]): Recorded[] =>
      items.map((i) => ({ id: i.id ?? null, label: i.label, enabled: i.enabled, checked: i.checked, type: i.type, ...(i.submenu ? { submenu: record(i.submenu.items) } : {}) }));
    Menu.prototype.popup = function popup(this: { items: LiveItem[] }, options?: { x?: number; y?: number; callback?: () => void }) {
      // Epoch ms with the fraction: a page's `performance.timeOrigin + event.timeStamp` is on the same clock to about a millisecond.
      g.__learnPopupTimes!.push(performance.timeOrigin + performance.now());
      g.__learnPopups!.push(record(this.items));
      g.__learnPopupAt!.push({ x: options?.x ?? Number.NaN, y: options?.y ?? Number.NaN });
      const path = pick === null ? [] : typeof pick === 'string' ? [pick] : pick;
      let level: LiveItem[] = this.items;
      let found: LiveItem | undefined;
      for (const label of path) {
        found = level.find((i) => i.label === label && i.enabled && i.visible);
        if (!found) break;
        level = found.submenu?.items ?? [];
      }
      const target = path.length > 0 && found && !found.submenu ? found : undefined;
      setTimeout(() => {
        target?.click();
        options?.callback?.();
      }, 0);
    };
  }, pick);
}

/** The point (window coordinates) each popup menu recorded since `stubContextMenu` opened at, oldest first. */
export const recordedPopupPoints = (app: ElectronApplication): Promise<Array<{ x: number; y: number }>> =>
  app.evaluate(() => (globalThis as { __learnPopupAt?: Array<{ x: number; y: number }> }).__learnPopupAt ?? []);

/** When each popup menu was shown since `stubContextMenu` (epoch ms), oldest first: the moment main called `Menu.popup`. */
export const recordedPopupTimes = (app: ElectronApplication): Promise<number[]> =>
  app.evaluate(() => (globalThis as { __learnPopupTimes?: number[] }).__learnPopupTimes ?? []);

/** Every popup menu recorded since `stubContextMenu`, oldest first. */
export const recordedPopups = (app: ElectronApplication): Promise<PopupItem[][]> =>
  app.evaluate(() => (globalThis as { __learnPopups?: PopupItem[][] }).__learnPopups ?? []);

/** macOS privacy (TCC) refused System Events: automation (-1743), keystrokes (1002), assistive access (-1719, -25211). */
export class NativeInputNotPermitted extends Error {
  override name = 'NativeInputNotPermitted';
}

const NOT_PERMITTED = /\((?:1002|-1719|-1743|-25211)\)|not allowed|assistive access|not authori[sz]ed/i;

/**
 * The longest one osascript call may take. A run that must not freeze for long on a stuck Apple Event lowers it (the
 * demo recording uses 5 s) and puts it back after.
 */
export const osascriptLimits = { timeoutMs: 15_000 };

/**
 * darwin only: run an AppleScript (one `-e` per line) through /usr/bin/osascript and return its trimmed stdout.
 * Throws NativeInputNotPermitted when macOS refuses it, any other failure as a plain Error with osascript's stderr.
 */
export function osascript(script: string): string {
  if (process.platform !== 'darwin') throw new Error('osascript is macOS only');
  try {
    return execFileSync('/usr/bin/osascript', script.split('\n').flatMap((line) => ['-e', line]), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: osascriptLimits.timeoutMs,
    }).trim();
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? '').trim();
    if (NOT_PERMITTED.test(stderr)) throw new NativeInputNotPermitted(stderr.split('\n')[0] ?? stderr);
    throw new Error(`osascript failed: ${stderr || (e as Error).message}`);
  }
}

export interface FrontmostProcess {
  name: string;
  pid: number;
}

/** darwin only: the frontmost application process according to System Events. */
export function frontmostProcess(): FrontmostProcess {
  const out = osascript(
    ['tell application "System Events"', 'set p to first application process whose frontmost is true',
      'return (unix id of p as text) & "|" & (name of p)', 'end tell'].join('\n'),
  );
  const bar = out.indexOf('|');
  const pid = Number(out.slice(0, bar));
  if (bar < 0 || !Number.isInteger(pid)) throw new Error(`unexpected System Events answer: ${out}`);
  return { pid, name: out.slice(bar + 1) };
}

/**
 * darwin only: make the app the frontmost macOS application (main-process `app.focus({steal})` + window focus),
 * then wait until System Events reports the app's own main process as frontmost. Returns that process.
 */
export async function bringAppToFront(app: ElectronApplication, timeoutMs = 10_000): Promise<FrontmostProcess> {
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    electronApp.focus({ steal: true });
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('window=main'))?.focus();
  });
  const pid = app.process().pid;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const front = frontmostProcess();
    if (front.pid === pid) return front;
    if (Date.now() > deadline) throw new Error(`the app (pid ${pid}) never became frontmost; frontmost is ${front.name} (pid ${front.pid})`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * darwin only: make Finder the frontmost application — the app's windows become inactive, as behind any other app —
 * and wait (up to `timeoutMs`) until System Events reports it. Returns the frontmost process then (Finder, unless the
 * wait ran out).
 */
export async function bringFinderToFront(timeoutMs = 5_000): Promise<FrontmostProcess> {
  osascript('tell application "Finder" to activate');
  const deadline = Date.now() + timeoutMs;
  let front = frontmostProcess();
  while (front.name !== 'Finder' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    front = frontmostProcess();
  }
  return front;
}

export type KeyModifier = 'command' | 'control' | 'option' | 'shift';

export interface NativeKeystroke {
  frontmost: FrontmostProcess;
  script: string;
  output: string;
  /** nativeKeyCode: which window (`?window=` kind) was focused right before the key went out. */
  focusedWindow?: string | null;
  /** Date.now() right before osascript posted the key (an effect seen earlier is not the key's). */
  sentAt: number;
}

/** The AppleScript ` using …` clause for System Events `keystroke` / `key code`. */
function usingClause(modifiers: readonly KeyModifier[]): string {
  const downs = modifiers.map((m) => `${m} down`);
  return downs.length === 0 ? '' : downs.length === 1 ? ` using ${downs[0]}` : ` using {${downs.join(', ')}}`;
}

/**
 * darwin only: a real OS-level key press (System Events `keystroke`), which goes through NSMenu key equivalents
 * unlike Playwright's CDP keys. Brings the app frontmost first. `key` is one printable ASCII character.
 */
export async function nativeKeystroke(app: ElectronApplication, key: string, modifiers: readonly KeyModifier[] = []): Promise<NativeKeystroke> {
  if (!/^[ -~]$/.test(key)) throw new Error(`nativeKeystroke: one printable ASCII character expected, got ${JSON.stringify(key)}`);
  const frontmost = await bringAppToFront(app);
  const script = `tell application "System Events" to keystroke ${JSON.stringify(key)}${usingClause(modifiers)}`;
  const sentAt = Date.now();
  return { frontmost, script, output: osascript(script), sentAt };
}

/** macOS virtual key codes for the keys `nativeKeystroke` cannot type. */
export const KEY_CODE = { return: 36, escape: 53, delete: 51, down: 125 } as const;

/**
 * darwin only: a real OS-level press of a non-printable key (System Events `key code`, e.g. KEY_CODE.return), with the
 * same frontmost and permission handling as `nativeKeystroke`. `window: 'sheet'` then makes the open sheet the key
 * window (bringAppToFront focuses the main window), so the press reaches the sheet as a user's would.
 */
export async function nativeKeyCode(
  app: ElectronApplication,
  code: number,
  modifiers: readonly KeyModifier[] = [],
  opts: { window?: 'main' | 'sheet' } = {},
): Promise<NativeKeystroke> {
  if (!Number.isInteger(code) || code < 0 || code > 127) throw new Error(`nativeKeyCode: a macOS virtual key code (0–127) expected, got ${code}`);
  const frontmost = await bringAppToFront(app);
  if (opts.window === 'sheet') {
    const found = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('window=sheet'));
      w?.focus();
      return Boolean(w);
    });
    if (!found) throw new Error('nativeKeyCode: no sheet window to send the key to');
    await new Promise((resolve) => setTimeout(resolve, 300)); // AppKit moves key status asynchronously
  }
  const focusedWindow = await app.evaluate(({ BrowserWindow }) => /[?&]window=(\w+)/.exec(BrowserWindow.getFocusedWindow()?.webContents.getURL() ?? '')?.[1] ?? null);
  const script = `tell application "System Events" to key code ${code}${usingClause(modifiers)}`;
  const sentAt = Date.now();
  return { frontmost, script, output: osascript(script), focusedWindow, sentAt };
}

/**
 * Organize setup through the page's preload API (`window.learn.collections.*`, `tags.*`), as the sidebar will call it. The
 * screen's own flows are checked through the screen by the specs that own them; these make the data those specs need.
 */
export async function createCollection(page: Page, name: string, parentId: string | null = null): Promise<string> {
  const r = await page.evaluate((input) => window.learn.collections.create(input), { name, parentId });
  if (!r.ok) throw new Error(`collections.create failed: ${r.code}`);
  return r.data.id;
}

/** Files the items in the collection; the number of memberships that are new. */
export async function addToCollection(page: Page, collectionId: string, itemIds: readonly string[]): Promise<number> {
  const r = await page.evaluate((input) => window.learn.collections.addItems(input), { collectionId, itemIds: [...itemIds] });
  if (!r.ok) throw new Error(`collections.addItems failed: ${r.code}`);
  return r.data.length;
}

export async function createTag(page: Page, name: string): Promise<string> {
  const r = await page.evaluate((input) => window.learn.tags.create(input), { name });
  if (!r.ok) throw new Error(`tags.create failed: ${r.code}`);
  return r.data.id;
}

/** Puts the tag on the items; the number of assignments that are new. */
export async function assignTag(page: Page, tagId: string, itemIds: readonly string[]): Promise<number> {
  const r = await page.evaluate((input) => window.learn.tags.assign(input), { tagId, itemIds: [...itemIds] });
  if (!r.ok) throw new Error(`tags.assign failed: ${r.code}`);
  return r.data;
}

/** Colour and position together, as the screen always sets them (a position holds one tag). */
export async function setTagColor(page: Page, tagId: string, color: TagColorId | null, position: number | null): Promise<void> {
  const r = await page.evaluate((input) => window.learn.tags.setColor(input), { tagId, color, position });
  if (!r.ok) throw new Error(`tags.setColor failed: ${r.code}`);
}

/** The organize snapshot as main sends it. Counts as a `library:organize` call. */
export async function organizeSnapshot(page: Page): Promise<OrganizeSnapshot> {
  const r = await page.evaluate(() => window.learn.library.organize());
  if (!r.ok) throw new Error(`library.organize failed: ${r.code}`);
  return r.data;
}

/** Moves items to the trash through the page's API (library.trash), as ⌘⌫ does; the number that moved. */
export async function trashItems(page: Page, itemIds: readonly string[]): Promise<number> {
  const r = await page.evaluate((input) => window.learn.library.trash(input), { itemIds: [...itemIds] });
  if (!r.ok) throw new Error(`library.trash failed: ${r.code}`);
  return r.data;
}

/** How often main ran each IPC channel since launch (E2E only: ipc/register.ts counts, test-hooks.ts installs the counter). */
export const ipcCalls = (app: ElectronApplication): Promise<Record<string, number>> =>
  app.evaluate(() => ({ ...((globalThis as { __learnIpcCalls?: Record<string, number> }).__learnIpcCalls ?? {}) }));

/**
 * The `library:*` call counts once none has changed for `quietMs`: what a change read is then final, and a count taken
 * next cannot be missing a read that is still on its way.
 */
export async function quietLibraryCalls(app: ElectronApplication, quietMs = 500): Promise<Record<string, number>> {
  const read = async () => Object.fromEntries(Object.entries(await ipcCalls(app)).filter(([k]) => k.startsWith('library:')));
  let last = JSON.stringify(await read());
  let since = Date.now();
  while (Date.now() - since < quietMs) {
    await new Promise((r) => setTimeout(r, 100));
    const now = JSON.stringify(await read());
    if (now !== last) {
      last = now;
      since = Date.now();
    }
  }
  return JSON.parse(last) as Record<string, number>;
}

// ---- M5 sidebar and collections ------------------------------------------------------------------------------------

/** A special view's row (spec 3.2): 내 라이브러리, 최근 연 자료, 미분류, 중복 항목. */
export const specialRow = (page: Page, kind: 'all' | 'recent' | 'unfiled' | 'duplicates' | 'trash'): Locator => page.getByTestId(`nav-scope-${kind}`);
/** A collection's row in the tree. */
export const treeRow = (page: Page, collectionId: string): Locator => page.getByTestId(`nav-collection-${collectionId}`);

/**
 * dialog.showMessageBox replaced in main for the rest of the session (the ui.confirm sheet): it answers `answer` — 'confirm'
 * is the first button — and records every question. Calling it again resets the record.
 */
export async function stubConfirm(app: ElectronApplication, answer: 'confirm' | 'cancel'): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    const g = globalThis as { __learnConfirms?: unknown[]; __learnRealMessageBox?: typeof dialog.showMessageBox };
    g.__learnConfirms = [];
    g.__learnRealMessageBox ??= dialog.showMessageBox;
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const o = (args.length > 1 ? args[1] : args[0]) as { type?: string; message: string; detail?: string; buttons?: string[]; defaultId?: number; cancelId?: number };
      g.__learnConfirms!.push({ type: o.type ?? null, message: o.message, detail: o.detail ?? '', buttons: o.buttons ?? [], defaultId: o.defaultId ?? null, cancelId: o.cancelId ?? null });
      return { response: answer === 'confirm' ? 0 : 1, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  }, answer);
}
export interface ConfirmCall {
  /** The dialog's type: 'warning' carries the caution symbol, 'none' the app icon. */
  type: string | null;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number | null;
  cancelId: number | null;
}
/** The questions the stubbed sheet was asked since `stubConfirm`, oldest first. */
export const confirmCalls = (app: ElectronApplication): Promise<ConfirmCall[]> =>
  app.evaluate(() => (globalThis as { __learnConfirms?: ConfirmCall[] }).__learnConfirms ?? []);

/** A made-up tree of collections: ids in creation order, each one's parent (null at the top) and children (in creation order). */
export interface CollectionTree {
  ids: string[];
  parent: Record<string, string | null>;
  children: Record<string, string[]>;
}
/**
 * `count` collections named 과목 000, 과목 001 … (so creation order is name order), eight at the top and then breadth first
 * with four children each, at most four levels deep (200 fit). Made through the page's own API, one call each.
 */
export async function createCollectionTree(page: Page, count: number): Promise<CollectionTree> {
  return page.evaluate(async (count) => {
    const ids: string[] = [];
    const parent: Record<string, string | null> = {};
    const children: Record<string, string[]> = {};
    const depth: Record<string, number> = {};
    const queue: string[] = [];
    for (let i = 0; i < count; i++) {
      let parentId: string | null = null;
      if (i >= 8) {
        while ((children[queue[0]!] ?? []).length >= 4 || depth[queue[0]!]! >= 4) queue.shift();
        parentId = queue[0]!;
      }
      const made = await window.learn.collections.create({ name: `과목 ${String(i).padStart(3, '0')}`, parentId });
      if (!made.ok) throw new Error(`collections.create failed: ${made.code}`);
      const id = made.data.id;
      ids.push(id);
      parent[id] = parentId;
      children[id] = [];
      depth[id] = parentId === null ? 1 : depth[parentId]! + 1;
      if (parentId !== null) children[parentId]!.push(id);
      queue.push(id);
    }
    return { ids, parent, children };
  }, count);
}
/** Every collection that has children stored as open (sidebar.expanded), then the page reloaded so the tree starts that way. */
export async function expandAll(page: Page, tree: CollectionTree): Promise<void> {
  const open = tree.ids.filter((id) => tree.children[id]!.length > 0);
  await page.evaluate((ids) => window.learn.settings.set({ key: 'sidebar.expanded', value: ids }), open);
  await page.reload();
  await page.getByTestId('app-ready').waitFor({ state: 'attached' });
}
/** ⌘K, the query, and the row of `commandId` (the palette closes and the command runs from where the focus was). */
export async function runPalette(page: Page, app: ElectronApplication, query: string, commandId: CommandId): Promise<void> {
  await runMenuCommand(app, 'app.palette');
  await page.getByTestId('palette-input').fill(query);
  await page.locator(`[data-testid="palette-item"][data-command-id="${commandId}"]`).click();
}

// ---- M5 tags -------------------------------------------------------------------------------------------------------------

/** A chip of the tag selector (the item panel may show the same tag too, so the selector is named). */
export const tagChip = (page: Page, tagId: string): Locator => page.getByTestId('tag-selector').getByTestId(`tag-chip-${tagId}`);

/** The colour a token resolves to in this page (light-dark() resolved), as getComputedStyle writes it. */
export const tokenColor = (page: Page, token: string): Promise<string> =>
  page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.background = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, token);

/**
 * Tags through the page's API, as the screen sets them: the ids in the order given. `slot` is colour N = slot N (colour and
 * slot together, as the screen always sets them); `items` are the ones the tag goes on.
 */
export async function makeTags<const S extends ReadonlyArray<{ name: string; slot?: number; items?: readonly string[] }>>(page: Page, specs: S): Promise<{ -readonly [K in keyof S]: string }> {
  const ids: string[] = [];
  for (const spec of specs) {
    const tagId = await createTag(page, spec.name);
    if (spec.slot !== undefined) await setTagColor(page, tagId, TAG_COLORS[spec.slot - 1]!.id, spec.slot);
    if (spec.items && spec.items.length > 0) await assignTag(page, tagId, spec.items);
    ids.push(tagId);
  }
  return ids as { -readonly [K in keyof S]: string };
}

/**
 * `count` PDFs that differ by one trailing comment: each imports as an item of its own, with its own file and revision
 * (items the E2E hook seeds share one revision, so a page-count probe would be answered from the cache).
 */
export function distinctPdfs(dir: string, count: number, source = 'sample.pdf'): string[] {
  fs.mkdirSync(dir, { recursive: true });
  const bytes = fs.readFileSync(path.join(FIXTURES, source));
  return Array.from({ length: count }, (_, i) => {
    const file = path.join(dir, `distinct-${String(i + 1).padStart(2, '0')}.pdf`);
    fs.writeFileSync(file, Buffer.concat([bytes, Buffer.from(`\n% copy ${i + 1}\n`)]));
    return file;
  });
}

/** Takes the tag off by the chip's × (it shows on hover and focus, so the chip is hovered first). The × is the chip body's sibling. */
export async function removeChip(chip: Locator): Promise<void> {
  await chip.hover();
  await chip.locator('xpath=..').getByTestId('tag-chip-remove').click();
}

// ---- M6 라이브러리 점검 ----------------------------------------------------------------------------------------------

/**
 * A sheet main opened by itself (the automatic library check): the one on screen or the next to come, once shown at its
 * measured size. A sheet a test asks for is expectWindow's.
 */
export async function waitForSheet(app: ElectronApplication): Promise<Page> {
  const isSheet = (p: Page) => !p.isClosed() && p.url().includes('window=sheet');
  await expect.poll(() => app.windows().some(isSheet), { message: 'a sheet window', timeout: 20_000 }).toBe(true);
  const page = app.windows().find(isSheet)!;
  await page.locator('[data-sheet-root]').waitFor();
  await sheetShownAtSize(app, page);
  return page;
}
interface CheckTestHooks {
  libraryCheck(): { check: LibraryCheck | null; auto: 'requested' | 'not-due' | 'stopped' | 'pending' };
  requestLibraryCheck(): Promise<void>;
}
type WithCheckHooks = { __learnTest: CheckTestHooks };
/** The newest library check and what the startup check did about the automatic sheet. */
export const libraryCheckState = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithCheckHooks).__learnTest.libraryCheck());
/** A fresh check and the automatic sheet again (after a test sized the window). */
export const requestLibraryCheck = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithCheckHooks).__learnTest.requestLibraryCheck());

// ---- M6 backup -------------------------------------------------------------------------------------------------------

/** One call of the stubbed folder panel (백업 만들기…): whether it hung on a window (a sheet), and what it said. */
export interface FolderPickCall {
  parent: boolean;
  title: string | null;
  message: string | null;
  buttonLabel: string | null;
  defaultPath: string | null;
  properties: string[];
}

/**
 * Replace the native open panel in main with a folder picker that answers `folder` (null: cancelled), recording every
 * call from none (folderPicks). The real panel is kept the first time, as stubOpenDialog keeps it.
 */
export async function stubFolderPicker(app: ElectronApplication, folder: string | null): Promise<void> {
  await app.evaluate(({ dialog }, answer) => {
    const g = globalThis as { __learnFolderPicks?: unknown[]; __learnRealOpenDialog?: typeof dialog.showOpenDialog };
    g.__learnRealOpenDialog ??= dialog.showOpenDialog;
    g.__learnFolderPicks = [];
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const o = (args.length > 1 ? args[1] : args[0]) as { title?: string; message?: string; buttonLabel?: string; defaultPath?: string; properties?: string[] };
      g.__learnFolderPicks!.push({
        parent: args.length > 1,
        title: o.title ?? null,
        message: o.message ?? null,
        buttonLabel: o.buttonLabel ?? null,
        defaultPath: o.defaultPath ?? null,
        properties: o.properties ?? [],
      });
      return answer === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [answer] };
    }) as typeof dialog.showOpenDialog;
  }, folder);
}
export const folderPicks = (app: ElectronApplication): Promise<FolderPickCall[]> =>
  app.evaluate(() => ((globalThis as { __learnFolderPicks?: FolderPickCall[] }).__learnFolderPicks ?? []));
/** Where main opens the folder panel the first time (spec 8.1: the documents folder). */
export const documentsDir = (app: ElectronApplication): Promise<string> => app.evaluate(({ app }) => app.getPath('documents'));

type WithBackupHooks = {
  __learnTest: {
    backupPause(input: { at: 'afterCopy' | null }): void;
    backupResume(): void;
    backupWaiting(): string | null;
    backupState(): JobProgress;
  };
};
/** The next backup holds its first copy once written, before it is read back, until backupResume (null lifts it). */
export const backupPause = (app: ElectronApplication, at: 'afterCopy' | null = 'afterCopy') =>
  app.evaluate((_e, at) => (globalThis as unknown as WithBackupHooks).__learnTest.backupPause({ at }), at);
export const backupResume = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithBackupHooks).__learnTest.backupResume());
/** The held copy's path inside the backup being made, or null. */
export const backupWaiting = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithBackupHooks).__learnTest.backupWaiting());
export const backupState = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithBackupHooks).__learnTest.backupState());
/** Until main's backup has ended (its last notice sent). */
export const waitBackupIdle = (app: ElectronApplication) =>
  expect.poll(async () => (await backupState(app)).state, { message: 'the backup ended' }).toBe('idle');

// ---- M6 restore ------------------------------------------------------------------------------------------------------

/**
 * Like stubFolderPicker, but the panel answers `answers` in turn (null: cancelled; past the last, cancelled): 백업에서
 * 복원… asks twice, for the backup and for where to restore. Every call is recorded for folderPicks.
 */
export async function stubFolderPicks(app: ElectronApplication, answers: Array<string | null>): Promise<void> {
  await app.evaluate(({ dialog }, list) => {
    const g = globalThis as { __learnFolderPicks?: unknown[]; __learnRealOpenDialog?: typeof dialog.showOpenDialog };
    g.__learnRealOpenDialog ??= dialog.showOpenDialog;
    g.__learnFolderPicks = [];
    const queue = [...list];
    dialog.showOpenDialog = (async (...args: unknown[]) => {
      const o = (args.length > 1 ? args[1] : args[0]) as { title?: string; message?: string; buttonLabel?: string; defaultPath?: string; properties?: string[] };
      g.__learnFolderPicks!.push({
        parent: args.length > 1,
        title: o.title ?? null,
        message: o.message ?? null,
        buttonLabel: o.buttonLabel ?? null,
        defaultPath: o.defaultPath ?? null,
        properties: o.properties ?? [],
      });
      const answer = queue.length > 0 ? queue.shift()! : null;
      return answer === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [answer] };
    }) as typeof dialog.showOpenDialog;
  }, answers);
}

/** Main was asked to restart (E2E records it instead: Playwright cannot follow a new process). */
export const relaunchRequested = (app: ElectronApplication): Promise<boolean> =>
  app.evaluate(() => (globalThis as { __learnRelaunchRequested?: boolean }).__learnRelaunchRequested ?? false);

type WithRestoreHooks = {
  __learnTest: {
    restorePause(input: { at: 'afterCopy' | null }): void;
    restoreResume(): void;
    restoreWaiting(): string | null;
    restoreState(): JobProgress;
  };
};
/** The next restore holds its first copy once written, before it is read back, until restoreResume (null lifts it). */
export const restorePause = (app: ElectronApplication, at: 'afterCopy' | null = 'afterCopy') =>
  app.evaluate((_e, at) => (globalThis as unknown as WithRestoreHooks).__learnTest.restorePause({ at }), at);
export const restoreResume = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithRestoreHooks).__learnTest.restoreResume());
/** The held copy's path inside the library being made, or null. */
export const restoreWaiting = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithRestoreHooks).__learnTest.restoreWaiting());
export const restoreState = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithRestoreHooks).__learnTest.restoreState());
/** Until main's restore has ended (its last notice sent). */
export const waitRestoreIdle = (app: ElectronApplication) =>
  expect.poll(async () => (await restoreState(app)).state, { message: 'the restore ended' }).toBe('idle');

// ---- M6 P1 gate and @perf ------------------------------------------------------------------------------------------------

export { factCounts, libraryFacts, type FactCounts, type LibraryFacts } from './library-facts';

/**
 * SIGKILL of the Electron main process, as a crash or a power cut ends the app: no quit handler and no beforeunload run.
 * Waits at most `timeoutMs` for the exit.
 */
export async function hardKill(app: ElectronApplication, timeoutMs = 10_000): Promise<void> {
  const proc = app.process();
  const pid = proc.pid!;
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
  process.kill(pid, 'SIGKILL');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Electron main process ${pid} did not exit within ${timeoutMs} ms of SIGKILL`)), timeoutMs);
  });
  try {
    await Promise.race([exited, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

type WithSeedHooks = {
  __learnTest: { seedAssets(input: SeedAssetsInput): SeedAssetsResult; fsyncProbe(input: FsyncProbeInput): Promise<FsyncProbeResult> };
};
/** Writes the files and rows in main, then announces one import; resolves with the ids and hashes in the rows' order. */
export const seedAssets = (app: ElectronApplication, input: SeedAssetsInput): Promise<SeedAssetsResult> =>
  app.evaluate((_electron, arg) => (globalThis as unknown as WithSeedHooks).__learnTest.seedAssets(arg), input);
export const fsyncProbe = (app: ElectronApplication, input: FsyncProbeInput): Promise<FsyncProbeResult> =>
  app.evaluate((_electron, arg) => (globalThis as unknown as WithSeedHooks).__learnTest.fsyncProbe(arg), input);

// ---- M7a translation (main's fake engine, main/test-hooks.ts; E2E never reaches the real service) ----------------------------------

export type TranslationFakeMode = 'ok' | 'offline' | 'rateLimited' | 'blocked' | 'unavailable' | 'badResponse' | 'slow';
type WithTranslationHooks = { __learnTest: { translationFake(mode: TranslationFakeMode): void; translationCalls(): number } };
/** How the fake engine answers from now on. */
export const translationFake = (app: ElectronApplication, mode: TranslationFakeMode) =>
  app.evaluate((_e, mode) => (globalThis as unknown as WithTranslationHooks).__learnTest.translationFake(mode), mode);
/** Requests the fake engine has taken since launch (a cache hit, a refusal and Korean into Korean take none). */
export const translationCalls = (app: ElectronApplication): Promise<number> => app.evaluate(() => (globalThis as unknown as WithTranslationHooks).__learnTest.translationCalls());

/** One request the test's translation host took (main/translation/net-intercept.ts). */
export interface TranslationNetRequest {
  method: string;
  host: string;
  path: string;
  search: string;
  contentType: string | null;
  body: string;
}
/** Launch options for the real translation engine over net.fetch, answered by the test's handler on the default session (R-17). */
export const TRANSLATION_NET_ENV = { LEARN_TRANSLATION_NET: 'intercept' } as const;
/** What that host took and what it refused (every other https request). */
export const translationNet = (app: ElectronApplication): Promise<{ requests: TranslationNetRequest[]; refused: string[] }> =>
  app.evaluate(() => (globalThis as unknown as { __learnTest: { translationNet(): { requests: TranslationNetRequest[]; refused: string[] } } }).__learnTest.translationNet());

/** Selects the text of `sentence` in the text layer of page `pageNumber`, across the spans it runs through (a user's drag). */
export async function selectInPage(page: Page, sentence: string, pageNumber = 1): Promise<void> {
  const found = await page.evaluate(
    ({ sentence, pageNumber }) => {
      // The shown reader's: a kept tab that is not shown has its pages in the document too.
      const shown = document.querySelector('[data-testid="tab-panel"][data-active="true"]') ?? document;
      const layer = shown.querySelector(`.page[data-page-number="${pageNumber}"] .textLayer`);
      if (!layer) return false;
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
      // The text as one string with a space between spans (a line break reads as one).
      let joined = '';
      const starts = nodes.map((n) => {
        const at = joined.length;
        joined += `${n.data} `;
        return at;
      });
      const from = joined.indexOf(sentence);
      if (from < 0) return false;
      const to = from + sentence.length;
      const locate = (offset: number, end: boolean) => {
        for (let i = nodes.length - 1; i >= 0; i--) if (starts[i]! < offset || (!end && starts[i]! === offset)) return { node: nodes[i]!, at: Math.min(offset - starts[i]!, nodes[i]!.data.length) };
        return { node: nodes[0]!, at: 0 };
      };
      const a = locate(from, false);
      const b = locate(to, true);
      const range = document.createRange();
      range.setStart(a.node, a.at);
      range.setEnd(b.node, b.at);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    },
    { sentence, pageNumber },
  );
  if (!found) throw new Error(`selectInPage: "${sentence}" is not in the text layer of page ${pageNumber}`);
}

/**
 * The one console line a test lets through: pdf.js's own error for a getPage still in flight when a document is closed on
 * purpose (leaving the reader). Nothing else is allowed; the value is the same in every spec that watches the console.
 */
export const CLOSE_NOISE = /^Unable to get page .*Transport destroyed/s;
export const isCloseNoise = (text: string): boolean => CLOSE_NOISE.test(text);

// ---- M7c body text (main/text, the utility-process worker) --------------------------------------------------------------

export interface ExtractFileResult {
  outcome: { kind: 'done'; pages: number; truncated: boolean } | { kind: 'failed'; reason: 'locked' | 'damaged' | 'too-large' } | { kind: 'crashed' | 'timeout' | 'bad-message' | 'stopped' };
  opened: number | null;
  batches: Array<{ from: number; texts: string[] }>;
}
type WithTextHooks = {
  __learnTest: { extractFile(input: { file: string; startPage?: number; limits?: Partial<{ maxPages: number; maxPageChars: number; maxDocChars: number; maxFileBytes: number }> }): Promise<ExtractFileResult> };
};
/** Reads a PDF's body text through the app's worker, without writing to the library. */
export const extractFile = (
  app: ElectronApplication,
  input: Parameters<WithTextHooks['__learnTest']['extractFile']>[0],
): Promise<ExtractFileResult> => app.evaluate((_e, arg) => (globalThis as unknown as WithTextHooks).__learnTest.extractFile(arg), input);

// ---- M7c body text scheduling (main/text/scheduler.ts, main/test-hooks.ts) -----------------------------------------------

type TextJobRow = { sha256: string; state: string; attempts: number; nextPage: number; error: string | null };
type WithTextSchedulerHooks = {
  __learnTest: {
    seedBodyText(input: SeedBodyTextInput): { itemIds: string[]; sha256: string[] };
    textExtraction(mode: 'pause' | 'resume' | 'now'): void;
    textIdle(): Promise<void>;
    pageTextCount(input: { itemId: string } | { sha256: string }): number;
    textJobs(): TextJobRow[];
    textHold(input: { afterPages: number | null }): void;
    textHeld(): boolean;
    textStats(): { batchMs: number[]; pagesWritten: number; activeMs: number };
  };
};
/** PDF items with their body text already stored, without waiting for the worker; announces one import. */
export const seedBodyText = (app: ElectronApplication, input: SeedBodyTextInput) => app.evaluate((_e, arg) => (globalThis as unknown as WithTextSchedulerHooks).__learnTest.seedBodyText(arg), input);
/** Under E2E the body-text scheduler starts paused: 'now' runs it without the five-second delay (the startup check is still waited for). */
export const textExtraction = (app: ElectronApplication, mode: 'pause' | 'resume' | 'now') => app.evaluate((_e, arg) => (globalThis as unknown as WithTextSchedulerHooks).__learnTest.textExtraction(arg), mode);
/** Resolves when no PDF outside the trash has a queued job and nothing runs. */
export const textIdle = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithTextSchedulerHooks).__learnTest.textIdle());
export const pageTextCount = (app: ElectronApplication, input: { itemId: string } | { sha256: string }) => app.evaluate((_e, arg) => (globalThis as unknown as WithTextSchedulerHooks).__learnTest.pageTextCount(arg), input);
export const textJobs = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithTextSchedulerHooks).__learnTest.textJobs());
export const textHold = (app: ElectronApplication, afterPages: number | null) => app.evaluate((_e, arg) => (globalThis as unknown as WithTextSchedulerHooks).__learnTest.textHold({ afterPages: arg }), afterPages);
export const textHeld = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithTextSchedulerHooks).__learnTest.textHeld());
export const textStats = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as WithTextSchedulerHooks).__learnTest.textStats());
