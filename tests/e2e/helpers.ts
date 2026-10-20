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

export async function launch(libraryDir: string, userDataDir: string): Promise<Session> {
  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, LEARN_LIBRARY_DIR: libraryDir, LEARN_USER_DATA_DIR: userDataDir },
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
