import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu } from 'electron';
import { COMMANDS, LearnError, toLearnError, type AppInfo, type CommandId, type ErrorCode } from '@learn/domain';
import { APP_SCHEME, handleAppProtocol, registerAppScheme } from './app-protocol';
import { sendEvent } from './events';
import { registerAllIpc } from './ipc/all';
import { createHandle, type IpcDeps } from './ipc/register';
import { openLibraryContext, type LibraryContext } from './library-context';
import { buildAppMenu } from './menu/app-menu';
import { openPrefsStore, resolveLibraryRoot } from './prefs';
import { hardenApp } from './security';
import { applyTheme } from './theme';
import { createMainWindow } from './window';

const here = path.dirname(fileURLToPath(import.meta.url));

// Same app name (and thus userData path) whether launched via `electron .` or the built entry.
app.setName('Learn');

// E2E and multi-profile runs isolate userData (also scopes the single-instance lock).
if (process.env['LEARN_USER_DATA_DIR']) app.setPath('userData', process.env['LEARN_USER_DATA_DIR']);

const devServerUrl = !app.isPackaged ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null;
const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null;
/** "개발자 도구" menu item: unpackaged runs only; E2E (LEARN_E2E=1) tests the shipped menu. */
const isDevBuild = !app.isPackaged && process.env['LEARN_E2E'] !== '1';

registerAppScheme();

let ctx: LibraryContext | null = null;
let libraryError: { code: ErrorCode; message: string } | null = null;
let mainWindow: BrowserWindow | null = null;

function openMainWindow(): BrowserWindow {
  const win = createMainWindow({
    preload: path.join(here, '../preload/index.cjs'),
    url: devServerUrl ?? `${APP_SCHEME}://app/index.html`,
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

/** Menu command → the focused window (accelerators and clicks), else the main window. */
function dispatchMenuCommand(commandId: CommandId): void {
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow;
  if (target && !target.isDestroyed()) sendEvent(target.webContents, 'menuCommand', { commandId });
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
    // First, before any await: Electron's default menu (English, with Reload) must never be live. Needs no library.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate(buildAppMenu({ isDev: isDevBuild, platform: process.platform, commands: COMMANDS, onCommand: dispatchMenuCommand })),
    );
    hardenApp(devOrigin);
    const prefs = openPrefsStore(app.getPath('userData'));
    if (prefs.readOnly) console.error('[prefs] read-only for this session: PREFS_UNAVAILABLE');
    applyTheme(prefs.get().theme); // before the first window, so native chrome starts in the right theme
    const libraryRoot = resolveLibraryRoot({ envDir: process.env['LEARN_LIBRARY_DIR'], prefs: prefs.get(), userData: app.getPath('userData') });
    try {
      ctx = await openLibraryContext(libraryRoot);
    } catch (e) {
      const le = toLearnError(e, '라이브러리를 여는 중 오류가 발생했습니다.');
      libraryError = { code: le.code, message: le.message };
      console.error(`[library] open failed: ${le.code}`);
    }
    handleAppProtocol({ getContext: () => ctx, rendererDir: path.join(here, '../renderer'), devOrigin });

    const deps: IpcDeps = {
      getContext: () => {
        if (!ctx) throw new LearnError('LIBRARY_UNAVAILABLE', libraryError?.message ?? '라이브러리를 열 수 없습니다.');
        return ctx;
      },
      appInfo: (): AppInfo => ({
        version: app.getVersion(),
        libraryRoot,
        schemaVersion: ctx?.schemaVersion ?? 0,
        platform: process.platform,
        libraryError,
      }),
      prefs,
    };
    registerAllIpc(createHandle(devOrigin), deps);

    mainWindow = openMainWindow();
  });

  app.on('activate', () => {
    if (app.isReady() && BrowserWindow.getAllWindows().length === 0) mainWindow = openMainWindow();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    if (ctx?.db.open) ctx.db.close();
  });
}
