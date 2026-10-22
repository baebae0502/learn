// First: ESM evaluates imports in order, so the cold-start marks module runs before anything else (its value is
// performance.timeOrigin either way).
import { markPerf } from './perf';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, Menu, systemPreferences, type BrowserWindow, type WebContents } from 'electron';
import {
  COMMANDS, LearnError, availableMenuCommands, commandById, commandLabel, sameCommandContext, toLearnError, type AppInfo, type CommandContextState, type CommandId,
  type ErrorCode,
} from '@learn/domain';
import { windowBackground } from '../renderer/src/design/tokens.generated';
import { aboutPanelOptions } from './about';
import { createActivateGate } from './activate-gate';
import { APP_SCHEME, handleAppProtocol, registerAppScheme } from './app-protocol';
import { isDemoOverlay } from './demo';
import { DETERMINISTIC_SWITCHES, isDeterministic } from './deterministic';
import { sendEvent } from './events';
import { registerAllIpc } from './ipc/all';
import { createHandle, type IpcDeps } from './ipc/register';
import { openLibraryContext, type LibraryContext } from './library-context';
import { FULL_SCREEN, applyFullScreenItem, applyMenuEnabled, applyMenuLabels, buildAppMenu } from './menu/app-menu';
import { openPrefsStore, resolveLibraryRoot } from './prefs';
import { hardenApp } from './security';
import { createSettingsWindow } from './settings-window';
import { createSheetHost } from './sheets';
import { applyTheme, currentTheme, onThemeChange } from './theme';
import { createThemeFollower, type ThemeMark } from './theme-follow';
import { findUpdateBackup } from './update-backup';
import { createMainWindow } from './window';
import { applyChromeTheme, shouldUseVibrancy, type ChromeOptions } from './window-options';
import { isSheetOpen, sheetClosed, sheetShown } from './window-state';
import { windowUrl } from './window-url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Same app name (and thus userData path) whether launched via `electron .` or the built entry.
app.setName('Learn');

// macOS: 보기's 전체 화면 is our own plain item (app-menu.ts); AppKit is also told, in the app's own defaults, not to
// add a full-screen item of its own (older macOS does when no item uses its selector). Task 8 R2-1.
if (process.platform === 'darwin') systemPreferences.setUserDefault('NSFullScreenMenuItemEverywhere', 'boolean', false);

// E2E and multi-profile runs isolate userData (also scopes the single-instance lock).
if (process.env['LEARN_USER_DATA_DIR']) app.setPath('userData', process.env['LEARN_USER_DATA_DIR']);

const devServerUrl = !app.isPackaged ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null;
const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null;
/** "개발자 도구" menu item: unpackaged runs only; E2E (LEARN_E2E=1) tests the shipped menu. */
const isDevBuild = !app.isPackaged && process.env['LEARN_E2E'] !== '1';

const deterministic = isDeterministic(process.env);
if (deterministic) for (const [name, value] of DETERMINISTIC_SWITCHES) app.commandLine.appendSwitch(name, value);

/** Every window loads the same renderer; `?window=` picks what it shows (main, settings, sheet). */
const rendererBase = devServerUrl ?? `${APP_SCHEME}://app/index.html`;
const vibrancy = shouldUseVibrancy(process.platform, process.env);
const urlOptions = { platform: process.platform, deterministic, vibrancy, demo: isDemoOverlay(app.isPackaged, process.env) };
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
  win.on('enter-full-screen', refreshFullScreenItem);
  win.on('leave-full-screen', refreshFullScreenItem);
  win.on('closed', () => {
    if (mainWindow !== win) return;
    mainWindow = null;
    // Linux/Windows: closing the main window ends the app (window-all-closed), so the settings window goes with it;
    // there is no dock to bring a main window back. macOS keeps the app, and the settings window, open (R-22).
    if (process.platform !== 'darwin') settingsWindow.current()?.close();
    // No renderer left to act on menu commands (macOS keeps the app running): back to the pre-report state.
    setUiContext(BEFORE_FIRST_REPORT);
    refreshFullScreenItem();
  });
  // A crashed renderer runs nothing either; a reloaded one reports again.
  win.webContents.on('render-process-gone', () => {
    if (mainWindow === win) setUiContext(BEFORE_FIRST_REPORT);
  });
  return win;
}

/** The macOS 전체 화면 item from the current main window (none, under a sheet, in full screen or not). */
function refreshFullScreenItem(): void {
  if (!appMenu) return;
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  applyFullScreenItem(appMenu, process.platform, { available: win !== null && !isSheetOpen(win), fullscreen: win?.isFullScreen() ?? false });
}

/** ⌘, (main-owned): one settings window, placed over the main window when there is one. */
const settingsWindow = createSettingsWindow({
  preload: path.join(here, '../preload/index.cjs'),
  url: () => windowUrl(rendererBase, 'settings', urlOptions),
  main: () => mainWindow,
});

const activation = createActivateGate({
  openWindow: () => {
    mainWindow = openMainWindow();
    refreshFullScreenItem();
  },
  // R-22: only the main window counts. With just the settings window left (macOS keeps the app running), a dock click
  // still opens a main window.
  windowCount: () => (mainWindow && !mainWindow.isDestroyed() ? 1 : 0),
});

/** The command context before the main window's renderer reports, and after it closed or crashed: nothing runs. */
const BEFORE_FIRST_REPORT: CommandContextState = Object.freeze({ view: 'library', blocked: true, textSize: 13 });
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
      fullScreenState: mainWindow !== null && !mainWindow.isDestroyed() && mainWindow.isFullScreen(),
      fullScreenAvailable: mainWindow !== null && !mainWindow.isDestroyed() && !isSheetOpen(mainWindow),
      onToggleFullScreen: () => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const fullscreen = mainWindow.isFullScreen();
        demoShortcut('Ctrl+Cmd+F', FULL_SCREEN.stateLabels[fullscreen ? 'fullscreen' : 'windowed']);
        mainWindow.setFullScreen(!fullscreen);
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

/**
 * Demo recordings only: a menu item main runs itself ran (no menuCommand reaches the renderer for it), so the main
 * window's demo overlay shows its shortcut. Nothing is sent without the overlay.
 */
function demoShortcut(accelerator: string, label: string): void {
  if (urlOptions.demo && mainWindow && !mainWindow.isDestroyed()) sendEvent(mainWindow.webContents, 'demoShortcut', { accelerator, label });
}

/**
 * The steps of the last theme changes (theme-follow.ts marks and nativeTheme 'updated'), for the evidence run's
 * theme-switch.json: unpackaged builds only, the last 40.
 */
type ThemeLogEntry = Omit<ThemeMark, 'event'> & { event: ThemeMark['event'] | 'updated'; window?: 'main' | 'settings' | null };
function themeLog(): { push(entry: ThemeLogEntry): void } | null {
  if (app.isPackaged) return null;
  const g = globalThis as { __learnThemeLog?: ThemeLogEntry[] };
  const log = (g.__learnThemeLog ??= []);
  return {
    push(entry) {
      log.push(entry);
      if (log.length > 40) log.splice(0, log.length - 40);
    },
  };
}

/** The main window's renderer (sheets and the settings window are other windows). */
const isMainWindow = (sender: WebContents): boolean => mainWindow !== null && !mainWindow.isDestroyed() && sender.id === mainWindow.webContents.id;
/** The settings window's renderer: the only caller of the library-location channels. */
const isSettingsWindow = (sender: WebContents): boolean => {
  const win = settingsWindow.current();
  return win !== null && !win.webContents.isDestroyed() && sender.id === win.webContents.id;
};

/**
 * Menu clicks and accelerators act on the main window (also when a settings or sheet window is focused), except the
 * main-owned 설정…, which main runs itself: it works even when the library failed to open or no main window exists.
 */
function dispatchMenuCommand(commandId: CommandId): void {
  if (commandId === 'app.settings') {
    const c = commandById('app.settings');
    demoShortcut(c.accelerator!, commandLabel(c, process.platform));
    settingsWindow.open();
    return;
  }
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
    markPerf('ready');
    // First, before any await: Electron's default menu (English, with Reload) must never be live. Needs no library.
    // Registry items stay disabled until the main window's renderer reports its context.
    installAppMenu();
    hardenApp(devOrigin);
    const prefs = openPrefsStore(app.getPath('userData'));
    if (prefs.readOnly) console.error('[prefs] read-only for this session: PREFS_UNAVAILABLE');
    applyTheme(prefs.get().theme); // before the first window, so native chrome starts in the right theme
    app.setAboutPanelOptions(aboutPanelOptions(app.getVersion(), process.versions.electron));
    onThemeChange(() => {
      const log = themeLog();
      if (log) log.push({ event: 'updated', theme: currentTheme(), at: Date.now() });
      if (mainWindow && !mainWindow.isDestroyed()) applyChromeTheme(mainWindow, chrome());
      // The settings window has the standard frame: only its background (seen while it resizes) follows.
      settingsWindow.current()?.setBackgroundColor(windowBackground[currentTheme()]);
    });
    // A theme picked in a page: the pages change first, then each window's chrome, then the native theme (T13R4-m1).
    const pageOf = (id: number): 'main' | 'settings' | null => {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.id === id) return 'main';
      const settings = settingsWindow.current();
      return settings && settings.webContents.id === id ? 'settings' : null;
    };
    const themeFollower = createThemeFollower({
      applySource: applyTheme,
      applyWindowChrome(id, shade) {
        const page = pageOf(id);
        if (page === 'main') applyChromeTheme(mainWindow!, { ...chrome(), theme: shade });
        if (page === 'settings') settingsWindow.current()?.setBackgroundColor(windowBackground[shade]);
      },
      followers: () =>
        [mainWindow, settingsWindow.current()].flatMap((w) => (w && !w.isDestroyed() && !w.webContents.isDestroyed() ? [w.webContents.id] : [])),
      // Asked before the native theme moves: 시스템 설정 is drawn in the current appearance until it is applied.
      shadeOf: (theme) => (theme === 'system' ? currentTheme() : theme),
      mark: (m: ThemeMark) => themeLog()?.push({ ...m, window: m.windowId !== undefined ? pageOf(m.windowId) : undefined }),
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

    // A sheet — our sheet window or a native dialog — keeps its parent the main window (chrome undimmed) until the parent
    // is key again, re-read within 250 ms (no 'focus' event comes for it on macOS); 전체 화면 waits for the main
    // window's sheet.
    const onSheetShown = (parent: BrowserWindow) => {
      sheetShown(parent);
      refreshFullScreenItem();
    };
    const onSheetClosed = (parent: BrowserWindow) => {
      sheetClosed(parent);
      refreshFullScreenItem();
    };

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
      isSettingsWindow,
      sheets: createSheetHost({
        preload: path.join(here, '../preload/index.cjs'),
        url: () => windowUrl(rendererBase, 'sheet', urlOptions),
        platform: process.platform,
        onSheetShown,
        onSheetClosed,
      }),
      windows: {
        openSettings: () => void settingsWindow.open(),
        async asSheet(owner, show) {
          onSheetShown(owner);
          try {
            return await show();
          } finally {
            if (!owner.isDestroyed()) onSheetClosed(owner);
          }
        },
      },
      theme: {
        changed: (theme) => themeFollower.pageChanged(theme),
        shown: (sender, shade) => themeFollower.shown(sender.id, shade),
      },
      relaunch() {
        if (process.env['LEARN_E2E'] === '1') {
          // Playwright cannot follow a relaunched process: E2E only records the request.
          (globalThis as { __learnRelaunchRequested?: boolean }).__learnRelaunchRequested = true;
          return;
        }
        setImmediate(() => {
          app.relaunch();
          app.quit();
        });
      },
    };
    registerAllIpc(createHandle(devOrigin), deps);

    activation.markReady();
    mainWindow = openMainWindow();
    refreshFullScreenItem();
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
