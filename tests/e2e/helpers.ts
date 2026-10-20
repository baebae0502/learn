import path from 'node:path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import type { LearnApi } from '../../packages/domain/src/ipc';

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
  /** Passed through to Playwright (records every window of the app). */
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
  Object.assign(env, opts.env);
  const app = await electron.launch({
    args: opts.executablePath ? [...(opts.args ?? [])] : [...(opts.args ?? []), path.join(ROOT, 'apps/desktop')],
    env,
    ...(opts.executablePath ? { executablePath: opts.executablePath } : {}),
    ...(opts.recordVideo ? { recordVideo: opts.recordVideo } : {}),
  });
  const page = await app.firstWindow();
  await expect(page.getByTestId('app-ready')).toBeAttached();
  return { app, page };
}

/** Replace the native file dialog in the main process for the next calls. */
export async function stubOpenDialog(app: ElectronApplication, filePaths: string[]): Promise<void> {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: paths })) as typeof dialog.showOpenDialog;
  }, filePaths);
}

export async function openItem(page: Page, title: string): Promise<void> {
  await page.locator(`[data-testid="open-item"][data-title="${title}"]`).click();
}
