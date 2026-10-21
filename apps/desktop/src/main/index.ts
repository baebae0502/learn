import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, Menu, systemPreferences, type WebContents } from 'electron';
import {
  COMMANDS, LearnError, availableMenuCommands, sameCommandContext, toLearnError, type AppInfo, type CommandContextState, type CommandId, type ErrorCode,
} from '@learn/domain';
import { aboutPanelOptions } from './about';
import { createActivateGate } from './activate-gate';
import { APP_SCHEME, handleAppProtocol, registerAppScheme } from './app-protocol';
import { DETERMINISTIC_SWITCHES, isDeterministic } from './deterministic';
import { sendEvent } from './events';
import { registerAllIpc } from './ipc/all';
import { createHandle, type IpcDeps } from './ipc/register';
import { openLibraryContext, type LibraryContext } from './library-context';
import { applyFullScreenLabel, applyMenuEnabled, applyMenuLabels, buildAppMenu, type FullScreenItem } from './menu/app-menu';
import { openPrefsStore, resolveLibraryRoot } from './prefs';
import { hardenApp } from './security';
import { createSheetHost } from './sheets';
import { applyTheme, currentTheme, onThemeChange } from './theme';
import { findUpdateBackup } from './update-backup';
import { createMainWindow, resyncWindowState } from './window';
import { applyChromeTheme, shouldUseVibrancy, type ChromeOptions } from './window-options';
import { windowUrl } from './window-url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Same app name (and thus userData path) whether launched via `electron .` or the built entry.
app.setName('Learn');

/**
 * Task 8 R2-1 spike, evidence runs only (LEARN_E2E=1, never a user setting): which 전체 화면 item 보기 carries on
 * macOS — a role item (b), our own plain item on ⌃⌘F with AppKit's injection turned off (c), or none of ours (a).
 */
const fullScreenItem: FullScreenItem = (() => {
  if (process.platform !== 'darwin' || process.env['LEARN_E2E'] !== '1') return 'role';
  return ({ a: 'none', b: 'role', c: 'plain' } as const)[process.env['LEARN_FS_MENU'] as 'a' | 'b' | 'c'] ?? 'role';
})();
if (fullScreenItem === 'plain') systemPreferences.setUserDefault('NSFullScreenMenuItemEverywhere', 'boolean', false);

// E2E and multi-profile runs isolate userData (also scopes the single-instance lock).
if (process.env['LEARN_USER_DATA_DIR']) app.setPath('userData', process.env['LEARN_USER_DATA_DIR']);

const devServerUrl = !app.isPackaged ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null;
const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null;
/** "개발자 도구" menu item: unpackaged runs only; E2E (LEARN_E2E=1) tests the shipped menu. */
const isDevBuild = !app.isPackaged && process.env['LEARN_E2E'] !== '1';

const deterministic = isDeterministic(process.env);
if (deterministic) for (const [name, value] of DETERMINISTIC_SWITCHES) app.commandLine.appendSwitch(name, value);

/** Every window loads the same renderer; `?window=` picks what it shows (main, sheet, later settings). */
const rendererBase = devServerUrl ?? `${APP_SCHEME}://app/index.html`;
const vibrancy = shouldUseVibrancy(process.platform, process.env);
const urlOptions = { platform: process.platform, deterministic, vibrancy, demo: false };
const chrome = (): ChromeOptions => ({ platform: process.platform, theme: currentTheme(), vibrancy });

registerAppScheme();

let ctx: LibraryContext | null = null;
let libraryError: { code: ErrorCode; message: string } | null = null;
let mainWindow: BrowserWindow | null = null;

function openMainWindow(): BrowserWindow {
  const win = createMainWindow({
    preload: path.join(here, '../preload/index.cjs'),
    url: windowUrl(rendererBase, 'main', urlOptions),
    chrome: chrome(),
  });
  // The macOS 전체 화면 item says what it will do (전체 화면 시작 / 종료).
  const relabelFullScreen = (fullscreen: boolean) => {
    if (appMenu) applyFullScreenLabel(appMenu, process.platform, fullscreen);
  };
  win.on('enter-full-screen', () => relabelFullScreen(true));
  win.on('leave-full-screen', () => relabelFullScreen(false));
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
    buildAppMenu({
      isDev: isDevBuild,
      platform: process.platform,
      commands: COMMANDS,
      enabled: new Set(availableMenuCommands(uiContext)),
      onCommand: dispatchMenuCommand,
      labels: { ...(uiContext.sidebar ? { sidebar: uiContext.sidebar } : {}) },
      fullScreen: fullScreenItem,
      fullScreenState: mainWindow !== null && !mainWindow.isDestroyed() && mainWindow.isFullScreen(),
      onToggleFullScreen: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setFullScreen(!mainWindow.isFullScreen());
      },
    }),
  );
  Menu.setApplicationMenu(appMenu);
  // macOS reports a menu opening on the application menu's root model; the submenus are watched too in case.
  for (const m of [appMenu, ...appMenu.items.flatMap((i) => (i.submenu ? [i.submenu] : []))]) {
    m.on('menu-will-show', () => setNativeMenuOpen(true));
    m.on('menu-will-close', () => setNativeMenuOpen(false));
  }
}

let nativeMenuOpen = false;
/** Tells the main window's renderer a menu-bar menu is open, so no tooltip stays under it. */
function setNativeMenuOpen(open: boolean): void {
  if (open === nativeMenuOpen) return;
  nativeMenuOpen = open;
  if (mainWindow && !mainWindow.isDestroyed()) sendEvent(mainWindow.webContents, 'nativeMenu', { open });
}

/** Records the main window's context and updates the registry items in place (no rebuild, open menus stay open). */
function setUiContext(next: CommandContextState): void {
  if (sameCommandContext(uiContext, next)) return;
  const relabel = next.sidebar !== uiContext.sidebar;
  uiContext = next;
  if (!appMenu) return;
  applyMenuEnabled(appMenu, new Set(availableMenuCommands(next)));
  if (relabel) applyMenuLabels(appMenu, process.platform, { ...(next.sidebar ? { sidebar: next.sidebar } : {}) });
}

/** The main window's renderer (sheets and the settings window are other windows). */
const isMainWindow = (sender: WebContents): boolean => mainWindow !== null && !mainWindow.isDestroyed() && sender.id === mainWindow.webContents.id;

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
    app.setAboutPanelOptions(aboutPanelOptions(app.getVersion(), process.versions.electron));
    onThemeChange(() => {
      if (mainWindow && !mainWindow.isDestroyed()) applyChromeTheme(mainWindow, chrome());
    });
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
        homeDir: app.getPath('home'),
        // Looked up when asked (the fatal screen asks once): a backup the user restores meanwhile is not cached.
        backupFile: libraryError ? findUpdateBackup(libraryRoot) : null,
      }),
      prefs,
      uiContext: {
        report(sender, ctx) {
          // Only the main window drives the menu (settings and sheet windows report nothing that counts).
          if (!isMainWindow(sender)) return;
          menuState.__learnMenuStateVersion = (menuState.__learnMenuStateVersion ?? 0) + 1; // received, even if unchanged
          setUiContext(ctx);
        },
        current: () => uiContext,
      },
      isMainWindow,
      sheets: createSheetHost({
        preload: path.join(here, '../preload/index.cjs'),
        url: () => windowUrl(rendererBase, 'sheet', urlOptions),
        platform: process.platform,
        // Now and once AppKit has settled the key window (no 'focus' event comes for it on macOS).
        onSheetClosed: (parent) => {
          resyncWindowState(parent);
          setTimeout(() => {
            if (!parent.isDestroyed()) resyncWindowState(parent);
          }, 250);
        },
      }),
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
