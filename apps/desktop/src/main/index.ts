import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu } from 'electron';
import {
  COMMANDS, LearnError, availableMenuCommands, sameCommandContext, toLearnError, type AppInfo, type CommandContextState, type CommandId, type ErrorCode,
} from '@learn/domain';
import { createActivateGate } from './activate-gate';
import { APP_SCHEME, handleAppProtocol, registerAppScheme } from './app-protocol';
import { DETERMINISTIC_SWITCHES, isDeterministic } from './deterministic';
import { sendEvent } from './events';
import { registerAllIpc } from './ipc/all';
import { createHandle, type IpcDeps } from './ipc/register';
import { openLibraryContext, type LibraryContext } from './library-context';
import { applyMenuEnabled, buildAppMenu } from './menu/app-menu';
import { openPrefsStore, resolveLibraryRoot } from './prefs';
import { hardenApp } from './security';
import { applyTheme } from './theme';
import { createMainWindow } from './window';
import { windowUrl } from './window-url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Same app name (and thus userData path) whether launched via `electron .` or the built entry.
app.setName('Learn');

// E2E and multi-profile runs isolate userData (also scopes the single-instance lock).
if (process.env['LEARN_USER_DATA_DIR']) app.setPath('userData', process.env['LEARN_USER_DATA_DIR']);

const devServerUrl = !app.isPackaged ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null;
const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null;
/** "개발자 도구" menu item: unpackaged runs only; E2E (LEARN_E2E=1) tests the shipped menu. */
const isDevBuild = !app.isPackaged && process.env['LEARN_E2E'] !== '1';

const deterministic = isDeterministic(process.env);
if (deterministic) for (const [name, value] of DETERMINISTIC_SWITCHES) app.commandLine.appendSwitch(name, value);

registerAppScheme();

let ctx: LibraryContext | null = null;
let libraryError: { code: ErrorCode; message: string } | null = null;
let mainWindow: BrowserWindow | null = null;

function openMainWindow(): BrowserWindow {
  const win = createMainWindow({
    preload: path.join(here, '../preload/index.cjs'),
    url: windowUrl(devServerUrl ?? `${APP_SCHEME}://app/index.html`, 'main', {
      platform: process.platform,
      deterministic,
      vibrancy: false, // Task 8
      demo: false, // Task 13
    }),
  });
  win.on('closed', () => {
    if (mainWindow !== win) return;
    mainWindow = null;
    // No renderer left to act on menu commands (macOS keeps the app running): back to the pre-report state.
    setUiContext(BEFORE_FIRST_REPORT);
  });
  // A crashed renderer runs nothing either; a reloaded one reports again.
  win.webContents.on('render-process-gone', () => {
    if (mainWindow === win) setUiContext(BEFORE_FIRST_REPORT);
  });
  return win;
}

const activation = createActivateGate({
  openWindow: () => {
    mainWindow = openMainWindow();
  },
  windowCount: () => BrowserWindow.getAllWindows().length,
});

/** The command context before the main window's renderer reports, and after it closed or crashed: nothing runs. */
const BEFORE_FIRST_REPORT: CommandContextState = Object.freeze({ view: 'library', blocked: true });
/** Last command context of the main window (ADR-0005 §2). */
let uiContext: CommandContextState = BEFORE_FIRST_REPORT;
/** E2E marker: bumped on every accepted context report (tests wait for the first one). */
const menuState = globalThis as { __learnMenuStateVersion?: number };
let appMenu: Menu | null = null;

/**
 * Builds and installs the application menu. Once at startup: labels and accelerators do not change at runtime
 * (rebuild here only for a platform or label change), and context reports flip `enabled` in place (setUiContext).
 */
function installAppMenu(): void {
  appMenu = Menu.buildFromTemplate(
    buildAppMenu({ isDev: isDevBuild, platform: process.platform, commands: COMMANDS, enabled: new Set(availableMenuCommands(uiContext)), onCommand: dispatchMenuCommand }),
  );
  Menu.setApplicationMenu(appMenu);
}

/** Records the main window's context and toggles the registry items in place (no rebuild, open menus stay open). */
function setUiContext(next: CommandContextState): void {
  if (sameCommandContext(uiContext, next)) return;
  uiContext = next;
  if (appMenu) applyMenuEnabled(appMenu, new Set(availableMenuCommands(next)));
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
          // Only the main window drives the menu (settings and sheet windows report nothing that counts).
          if (!mainWindow || mainWindow.isDestroyed() || sender.id !== mainWindow.webContents.id) return;
          menuState.__learnMenuStateVersion = (menuState.__learnMenuStateVersion ?? 0) + 1; // received, even if unchanged
          setUiContext(ctx);
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
