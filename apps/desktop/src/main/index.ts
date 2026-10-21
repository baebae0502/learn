import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu } from 'electron';
import { COMMANDS, LearnError, availableMenuCommands, toLearnError, type AppInfo, type CommandContextState, type CommandId, type ErrorCode } from '@learn/domain';
import { createActivateGate } from './activate-gate';
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
    if (mainWindow !== win) return;
    mainWindow = null;
    // No renderer left to act on menu commands (macOS keeps the app running): back to the pre-report state.
    uiContext = { view: 'library', blocked: true };
    installAppMenu();
  });
  return win;
}

const activation = createActivateGate({
  openWindow: () => {
    mainWindow = openMainWindow();
  },
  windowCount: () => BrowserWindow.getAllWindows().length,
});

/** Last command context of the main window (ADR-0005 §2); blocked until the renderer's first report. */
let uiContext: CommandContextState = { view: 'library', blocked: true };
/** E2E marker: bumped on every accepted context report (tests wait for the first one). */
const menuState = globalThis as { __learnMenuStateVersion?: number };

function installAppMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildAppMenu({ isDev: isDevBuild, platform: process.platform, commands: COMMANDS, enabled: new Set(availableMenuCommands(uiContext)), onCommand: dispatchMenuCommand }),
    ),
  );
}

/** Menu clicks and accelerators always act on the main window (also when a settings or sheet window is focused). */
function dispatchMenuCommand(commandId: CommandId): void {
  const target = mainWindow;
  if (!target || target.isDestroyed()) return;
  if (!target.isFocused()) target.focus();
  sendEvent(target.webContents, 'menuCommand', { commandId });
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
    // Registry items stay disabled until the main window's renderer reports its context.
    installAppMenu();
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
      uiContext: {
        report(sender, ctx) {
          if (!mainWindow || sender !== mainWindow.webContents) return; // only the main window drives the menu
          uiContext = ctx;
          installAppMenu();
          menuState.__learnMenuStateVersion = (menuState.__learnMenuStateVersion ?? 0) + 1;
        },
        current: () => uiContext,
      },
    };
    registerAllIpc(createHandle(devOrigin), deps);

    activation.markReady();
    mainWindow = openMainWindow();
  });

  // Ignored until the ready path above has registered the protocol and IPC (it opens the first window itself).
  app.on('activate', () => activation.onActivate());

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    if (ctx?.db.open) ctx.db.close();
  });
}
