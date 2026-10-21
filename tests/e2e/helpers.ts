import path from 'node:path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
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
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId('app-ready')).toBeAttached();
    return { app, page };
  } catch (e) {
    await app.close().catch(() => {}); // don't leak the process (and its single-instance lock) on a failed start
    throw e;
  }
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
 * with the focused window. Throws when the item is missing, hidden or disabled (a user couldn't click it).
 */
export async function runMenuCommand(app: ElectronApplication, id: CommandId): Promise<void> {
  await app.evaluate(({ BrowserWindow, Menu, webContents }, id) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(id);
    if (!item) throw new Error(`no application menu item with id ${id}`);
    if (!item.enabled || !item.visible) throw new Error(`menu item ${id} is not clickable`);
    item.click(undefined, BrowserWindow.getFocusedWindow() ?? undefined, webContents.getFocusedWebContents() ?? undefined);
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
