import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { _electron as electron, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { CommandId } from '../../packages/domain/src/commands';
import type { LearnApi } from '../../packages/domain/src/ipc';
import type { LibraryItem } from '../../packages/domain/src/library';

declare global {
  interface Window {
    learn: LearnApi;
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
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('app-ready')).toBeAttached();
    // The menu bar stays disabled until the renderer's first ui:reportContext (M3 Task 2).
    await expect.poll(() => app.evaluate(() => (globalThis as { __learnMenuStateVersion?: number }).__learnMenuStateVersion ?? 0)).toBeGreaterThan(0);
    return { app, page };
  } catch (e) {
    await app.close().catch(() => {}); // don't leak the process (and its single-instance lock) on a failed start
    throw e;
  }
}

/**
 * The main window's BrowserWindow, as a handle evaluated in the main process: the window whose URL has
 * `window=main` (sheets, and from Task 10 the settings window, are other windows; `getAllWindows()[0]` is not
 * reliably the main one once they exist). `(await mainWindow(app)).evaluate((w) => …)`.
 */
export function mainWindow(app: ElectronApplication) {
  return app.evaluateHandle(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('window=main'));
    if (!w) throw new Error('no main window (window=main)');
    return w;
  });
}

/** Replace the native file dialog in the main process for the next calls; resets the call counter. */
export async function stubOpenDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    const g = globalThis as { __learnOpenDialogCalls?: number };
    g.__learnOpenDialogCalls = 0;
    dialog.showOpenDialog = (async () => {
      g.__learnOpenDialogCalls = (g.__learnOpenDialogCalls ?? 0) + 1;
      return { canceled: false, filePaths: paths };
    }) as typeof dialog.showOpenDialog;
  }, filePaths);
}

/** How many times the stubbed open dialog ran since the last `stubOpenDialog`. */
export const openDialogCalls = (app: ElectronApplication): Promise<number> =>
  app.evaluate(() => (globalThis as { __learnOpenDialogCalls?: number }).__learnOpenDialogCalls ?? 0);

/** Import files through `learn.library.import` (managed); every path must come back as a new item. */
export async function importPaths(page: Page, paths: string[]): Promise<LibraryItem[]> {
  const r = await page.evaluate((paths) => window.learn.library.import({ paths, mode: 'managed' }), paths);
  if (!r.ok) throw new Error(`library.import failed: ${r.code}`);
  return r.data.map((o) => {
    if (o.status !== 'imported') throw new Error(`library.import: ${o.path} → ${o.status}`);
    return o.item;
  });
}

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

/**
 * Run `trigger` and return the window it opens (`?window=<kind>`), once its React root has rendered. A sheet is
 * returned once main has shown it at its measured size (hidden → sized to its content → shown), and the page's
 * viewport has that size: geometry and screenshots never see the first, full-height layout.
 */
export async function expectWindow(app: ElectronApplication, kind: 'settings' | 'sheet', trigger: () => Promise<unknown>): Promise<Page> {
  const opened = app.waitForEvent('window', { timeout: 15_000 });
  await trigger();
  const page = await opened;
  await expect.poll(() => page.url(), { message: `a ${kind} window` }).toContain(`window=${kind}`);
  await page.locator(kind === 'sheet' ? '[data-sheet-root]' : '[data-settings-root]').waitFor();
  if (kind === 'sheet') {
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
  return page;
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

export async function openItem(page: Page, title: string): Promise<void> {
  await page.locator(`[data-testid="open-item"][data-title="${title}"]`).click();
}

/** One application-menu entry as JSON. Runtime roles are lower-case (`selectall`, `togglefullscreen`). */
export interface MenuNode {
  label: string;
  role: string | null;
  accelerator: string | null;
  id: string | null;
  enabled: boolean;
  type: string;
  submenu: MenuNode[] | null;
}

/** `Menu.getApplicationMenu()` as JSON (empty when no menu is set). */
export async function menuSnapshot(app: ElectronApplication): Promise<MenuNode[]> {
  return app.evaluate(({ Menu }) => {
    interface LiveItem {
      label: string; role?: string; accelerator?: string; id?: string; enabled: boolean; type: string; submenu?: { items: LiveItem[] };
    }
    const walk = (items: LiveItem[]): MenuNode[] =>
      items.map((i) => ({
        label: i.label,
        role: i.role ?? null,
        accelerator: i.accelerator ?? null,
        id: i.id ?? null,
        enabled: i.enabled,
        type: i.type,
        submenu: i.submenu ? walk(i.submenu.items) : null,
      }));
    const menu = Menu.getApplicationMenu() as { items: LiveItem[] } | null;
    return menu ? walk(menu.items) : [];
  });
}

/**
 * Click an application-menu item by id the way Electron does for a mouse click: the MenuItem's own `click()`
 * with the focused window. Waits up to 5 s for the item to become clickable (the renderer reports its context
 * asynchronously), then throws when it is missing, hidden or disabled (a user couldn't click it).
 */
export async function runMenuCommand(app: ElectronApplication, id: CommandId): Promise<void> {
  await expect.poll(() => menuItemEnabled(app, id), { timeout: 5_000, message: `menu item ${id} never became clickable` }).toBe(true);
  await app.evaluate(({ BrowserWindow, Menu, webContents }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item) throw new Error(`no application menu item with id ${id}`);
    if (!item.enabled || !item.visible) throw new Error(`menu item ${id} is not clickable`);
    item.click(undefined, BrowserWindow.getFocusedWindow() ?? undefined, webContents.getFocusedWebContents() ?? undefined);
  }, id);
}

/** Whether the application-menu item exists, is visible and is enabled right now. */
export async function menuItemEnabled(app: ElectronApplication, id: CommandId): Promise<boolean> {
  return app.evaluate(({ Menu }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    return Boolean(item && item.enabled && item.visible);
  }, id);
}

/** One item of a native popup menu, as recorded by `stubContextMenu`. */
export interface PopupItem {
  id: string | null;
  label: string;
  enabled: boolean;
  type: string;
}

/**
 * Replace native popups in main for the rest of the session: every `Menu.prototype.popup` records its items, then
 * (one task later, like a user) clicks the enabled item labelled `pick` through its own `click()` and closes the
 * menu. A null `pick`, or no enabled item with that label, only closes it (dismissed).
 */
export async function stubContextMenu(app: ElectronApplication, pick: string | null): Promise<void> {
  await app.evaluate(({ Menu }, pick) => {
    interface LiveItem { id?: string; label: string; enabled: boolean; visible: boolean; type: string; click(): void }
    const g = globalThis as { __learnPopups?: PopupItem[][] };
    g.__learnPopups = [];
    Menu.prototype.popup = function popup(this: { items: LiveItem[] }, options?: { callback?: () => void }) {
      g.__learnPopups!.push(this.items.map((i) => ({ id: i.id ?? null, label: i.label, enabled: i.enabled, type: i.type })));
      const target = pick === null ? undefined : this.items.find((i) => i.label === pick && i.enabled && i.visible);
      setTimeout(() => {
        target?.click();
        options?.callback?.();
      }, 0);
    };
  }, pick);
}

/** Every popup menu recorded since `stubContextMenu`, oldest first. */
export const recordedPopups = (app: ElectronApplication): Promise<PopupItem[][]> =>
  app.evaluate(() => (globalThis as { __learnPopups?: PopupItem[][] }).__learnPopups ?? []);

/** macOS privacy (TCC) refused System Events: automation (-1743), keystrokes (1002), assistive access (-1719, -25211). */
export class NativeInputNotPermitted extends Error {
  override name = 'NativeInputNotPermitted';
}

const NOT_PERMITTED = /\((?:1002|-1719|-1743|-25211)\)|not allowed|assistive access|not authori[sz]ed/i;

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
      timeout: 15_000,
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
export const KEY_CODE = { return: 36, escape: 53 } as const;

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
