import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
import { LearnError, toLearnError, type AppInfo, type ErrorCode } from '@learn/domain';
import { APP_SCHEME, handleAppProtocol, registerAppScheme } from './app-protocol';
import { registerIpc } from './ipc';
import { openLibraryContext, type LibraryContext } from './library-context';
import { hardenApp } from './security';

const here = path.dirname(fileURLToPath(import.meta.url));

// E2E and multi-profile runs isolate userData (also scopes the single-instance lock).
if (process.env['LEARN_USER_DATA_DIR']) app.setPath('userData', process.env['LEARN_USER_DATA_DIR']);

const devServerUrl = !app.isPackaged ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null;
const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null;
const libraryRoot = (): string => process.env['LEARN_LIBRARY_DIR'] ?? path.join(app.getPath('userData'), 'Library');

registerAppScheme();

let ctx: LibraryContext | null = null;
let libraryError: { code: ErrorCode; message: string } | null = null;
let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Learn',
    backgroundColor: '#eef2f6',
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(devServerUrl ?? `${APP_SCHEME}://app/index.html`);
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    hardenApp(devOrigin);
    try {
      ctx = await openLibraryContext(libraryRoot());
    } catch (e) {
      const le = toLearnError(e, '라이브러리를 여는 중 오류가 발생했습니다.');
      libraryError = { code: le.code, message: le.message };
      console.error(`[library] open failed: ${le.code}`);
    }
    handleAppProtocol({ getContext: () => ctx, rendererDir: path.join(here, '../renderer'), devOrigin });
    registerIpc({
      getContext: () => {
        if (!ctx) throw new LearnError('LIBRARY_UNAVAILABLE', libraryError?.message ?? '라이브러리를 열 수 없습니다.');
        return ctx;
      },
      appInfo: (): AppInfo => ({
        version: app.getVersion(),
        libraryRoot: libraryRoot(),
        schemaVersion: ctx?.schemaVersion ?? 0,
        platform: process.platform,
        libraryError,
      }),
      devOrigin,
    });
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });

  app.on('activate', () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    if (ctx?.db.open) ctx.db.close();
  });
}
