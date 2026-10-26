// First: ESM evaluates imports in order, so the cold-start marks module runs before anything else (its value is
// performance.timeOrigin either way).
import { markPerf } from './perf';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, Menu, systemPreferences, type BrowserWindow, type WebContents } from 'electron';
import { readOrganizeSnapshot } from '@learn/db';
import {
  COMMANDS, LearnError, NO_LIBRARY_VIEW, SUBMENUS, availableMenuCommands, commandById, commandLabel, sameCommandContext, toLearnError, type AppInfo, type CommandArgs, type CommandContextState, type CommandId,
  type ErrorCode, type OrganizeSnapshot,
} from '@learn/domain';
import { windowBackground } from '../renderer/src/design/tokens.generated';
import { aboutPanelOptions } from './about';
import { createActivateGate } from './activate-gate';
import { APP_SCHEME, handleAppProtocol, registerAppScheme } from './app-protocol';
import { isDemoOverlay } from './demo';
import { DETERMINISTIC_SWITCHES, isDeterministic, isE2E } from './deterministic';
import { createFlushGate } from './edit-flush';
import { broadcast, onBroadcast, sendEvent } from './events';
import { registerAllIpc } from './ipc/all';
import { createHandle, type IpcDeps } from './ipc/register';
import { openLibraryContext, type LibraryContext } from './library-context';
import { FULL_SCREEN, applyFullScreenItem, applyMenuEnabled, applyMenuLabels, buildAppMenu, menuLabelState, menuLabelsChanged, submenuShapeKey } from './menu/app-menu';
import { createMenuRebuilder } from './menu/rebuild';
import { menuNeedsOrganize } from './menu/submenus';
import { openPrefsStore, resolveLibraryRoot } from './prefs';
import { hardenApp } from './security';
import { createSettingsWindow } from './settings-window';
import { createSheetHost, sheetHeightKey, shortcutsDigest } from './sheets';
import { mainStrings } from './strings';
import { installTestHooks } from './test-hooks';
import { applyTheme, currentTheme, onThemeChange } from './theme';
import { createThemeFollower, shownPages, type ThemeMark } from './theme-follow';
import { findUpdateBackup } from './update-backup';
import { createMainWindow } from './window';
import { applyChromeTheme, shouldUseVibrancy, type ChromeOptions } from './window-options';
import { isSheetOpen, resyncAllWindowStates, sheetClosed, sheetShown } from './window-state';
import { windowUrl } from './window-url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Same app name (and thus userData path) whether launched via `electron .` or the built entry.
app.setName('Learn');

// macOS: 보기's 전체 화면 is our own plain item (app-menu.ts); AppKit is also told, in the app's own defaults, not to
// add a full-screen item of its own (older macOS does when no item uses its selector). Task 8 R2-1.
// Unpackaged too, on purpose (final review m11): the evidence runs the unpackaged app and counts one 전체 화면 row in
// 보기. The cost: unpackaged, the defaults domain is Electron's own (com.github.Electron), so the key is written for
// every unpackaged Electron app on that Mac. It is a hint AppKit reads, harmless to other apps (docs/mac-verification.md,
// 알려진 한계), and `defaults delete com.github.Electron NSFullScreenMenuItemEverywhere` removes it.
if (process.platform === 'darwin') systemPreferences.setUserDefault('NSFullScreenMenuItemEverywhere', 'boolean', false);

// E2E and multi-profile runs isolate userData (also scopes the single-instance lock).
if (process.env['LEARN_USER_DATA_DIR']) app.setPath('userData', process.env['LEARN_USER_DATA_DIR']);

const devServerUrl = !app.isPackaged ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null;
const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null;
/** "개발자 도구" menu item: unpackaged runs only; E2E (LEARN_E2E=1) tests the shipped menu. */
const isDevBuild = !app.isPackaged && !isE2E(app.isPackaged, process.env);

const deterministic = isDeterministic(app.isPackaged, process.env);
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

/** Closing or quitting over an open 정보 편집 (spec §5.3): the page saves first, or keeps the window and the app (edit-flush.ts). */
const editFlush = createFlushGate({
  mainWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
  quit: () => app.quit(),
  record: (entry) => {
    // E2E reads what each close or quit was answered.
    if (isE2E(app.isPackaged, process.env)) ((globalThis as { __learnEditFlushLog?: unknown[] }).__learnEditFlushLog ??= []).push(entry);
  },
});

function openMainWindow(): BrowserWindow {
  const win = createMainWindow({
    preload: path.join(here, '../preload/main.cjs'),
    url: windowUrl(rendererBase, 'main', urlOptions),
    chrome: chrome(),
  });
  // The macOS 전체 화면 item says what it will do (전체 화면 시작 / 종료).
  win.on('enter-full-screen', refreshFullScreenItem);
  win.on('leave-full-screen', refreshFullScreenItem);
  win.on('close', (event) => editFlush.onClose(win, event));
  win.on('closed', () => {
    if (mainWindow !== win) return;
    mainWindow = null;
    // A settings window prepared for this main window and never asked for goes with it on every platform: hidden, it
    // would keep a Linux app alive (window-all-closed) and hold a renderer for nobody on macOS.
    settingsWindow.discardPrepared();
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
  preload: path.join(here, '../preload/settings.cjs'),
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
const BEFORE_FIRST_REPORT: CommandContextState = Object.freeze({
  view: 'library', blocked: true, textSize: 13, libraryCount: 0, selectionCount: 0, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW,
});
/** Last command context of the main window (ADR-0005 §2). */
let uiContext: CommandContextState = BEFORE_FIRST_REPORT;
/**
 * E2E markers: the version is bumped on every accepted context report (tests wait for the first one); the context is
 * the last accepted report, which tests read for what the renderer told main.
 */
const menuState = globalThis as { __learnMenuStateVersion?: number; __learnMenuContext?: CommandContextState };
let appMenu: Menu | null = null;

/** Whether any menu-bar item is read from the library (collections, colour tags): only then are its notices heard and its snapshot read. */
const menuUsesOrganize = menuNeedsOrganize(COMMANDS, SUBMENUS, 'menu');
/** Collections and tags for the menu bar's submenus; null when no item uses them, the library is not open, or reading failed. */
function menuOrganize(): OrganizeSnapshot | null {
  if (!menuUsesOrganize || !ctx) return null;
  try {
    return readOrganizeSnapshot(ctx.db);
  } catch (e) {
    console.warn(`[menu] reading the library for the menu bar failed: ${toLearnError(e).code}`); // the code only: no names in a log
    return null;
  }
}

/**
 * Builds and installs the application menu: once at startup, and again when what its submenus list changes — the sort
 * and the columns drawn (the reported context) and the collections and tags (main's own notices). Everything else in a
 * report flips `enabled` in place (setUiContext), so an open dropdown stays open.
 */
function installAppMenu(): void {
  appMenu = Menu.buildFromTemplate(
    buildAppMenu({
      isDev: isDevBuild,
      platform: process.platform,
      commands: COMMANDS,
      enabled: new Set(availableMenuCommands(uiContext)),
      onCommand: dispatchMenuCommand,
      labels: menuLabelState(uiContext),
      context: uiContext,
      organize: menuOrganize(),
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

/** The menu bar is rebuilt debounced, and never under an open menu (menu/rebuild.ts). */
const menuRebuild = createMenuRebuilder(() => {
  try {
    installAppMenu();
  } catch (e) {
    console.warn(`[menu] rebuilding the menu bar failed: ${toLearnError(e).code}`);
  }
});
// The collections and tags main announces change the menu bar's submenus, when it has any that list them.
onBroadcast((e) => {
  if (menuUsesOrganize && e.name === 'libraryChanged' && (e.payload.reason === 'collections' || e.payload.reason === 'tags')) menuRebuild.request();
});

let nativeMenuOpen = false;
/** Tells the main window's renderer a menu-bar menu is open, so no tooltip stays under it; a rebuild waits for it to close. */
function setNativeMenuOpen(open: boolean): void {
  if (open === nativeMenuOpen) return;
  nativeMenuOpen = open;
  menuRebuild.menuOpenChanged(open);
  if (mainWindow && !mainWindow.isDestroyed()) sendEvent(mainWindow.webContents, 'nativeMenu', { open });
}

/** Records the main window's context and updates the registry items in place (no rebuild, open menus stay open) — except where the submenus' rows change. */
function setUiContext(next: CommandContextState): void {
  if (sameCommandContext(uiContext, next)) return;
  const relabel = menuLabelsChanged(uiContext, next);
  const reshape = submenuShapeKey(uiContext) !== submenuShapeKey(next);
  uiContext = next;
  if (!appMenu) return;
  applyMenuEnabled(appMenu, new Set(availableMenuCommands(next)));
  if (relabel) applyMenuLabels(appMenu, process.platform, menuLabelState(next));
  if (reshape) menuRebuild.request();
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
function dispatchMenuCommand(commandId: CommandId, args?: CommandArgs): void {
  if (commandId === 'app.settings') {
    const c = commandById('app.settings');
    demoShortcut(c.accelerator!, commandLabel(c, process.platform));
    settingsWindow.open();
    return;
  }
  const target = mainWindow;
  if (!target || target.isDestroyed()) return;
  if (!target.isFocused()) target.focus();
  sendEvent(target.webContents, 'menuCommand', { commandId, ...(args ? { args } : {}) });
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
      // Pages on screen only: the settings window prepared hidden takes the change from the same broadcast, unseen.
      followers: () => shownPages([mainWindow, settingsWindow.current()]),
      // Asked before the native theme moves: 시스템 설정 is drawn in the current appearance until it is applied.
      shadeOf: (theme) => (theme === 'system' ? currentTheme() : theme),
      mark: (m: ThemeMark) => themeLog()?.push({ ...m, window: m.windowId !== undefined ? pageOf(m.windowId) : undefined }),
    });
    const libraryRoot = resolveLibraryRoot({ envDir: process.env['LEARN_LIBRARY_DIR'], prefs: prefs.get(), userData: app.getPath('userData') });
    try {
      ctx = await openLibraryContext(libraryRoot);
      if (menuUsesOrganize) menuRebuild.request(); // the menu bar was built before the library opened
    } catch (e) {
      const le = toLearnError(e, mainStrings.library.openFailed);
      libraryError = { code: le.code, message: le.message };
      console.error(`[library] open failed: ${le.code}`);
    }
    handleAppProtocol({ getContext: () => ctx, rendererDir: path.join(here, '../renderer'), devOrigin });

    // A sheet — our sheet window or a native dialog — keeps its parent the main window (chrome undimmed) until the parent
    // is key again, re-read within 250 ms (no 'focus' event comes for it on macOS); 전체 화면 waits for the main
    // window's sheet.
    const onSheetShown = (parent: BrowserWindow, opts: { native?: boolean } = {}) => {
      sheetShown(parent, opts);
      refreshFullScreenItem();
    };
    const onSheetClosed = (parent: BrowserWindow, opts: { native?: boolean } = {}) => {
      sheetClosed(parent, opts);
      refreshFullScreenItem();
    };

    /** The ⌘/ sheet lists the registry's shortcuts: its height is kept per what it is drawn from. */
    const shortcutsSheetDigest = shortcutsDigest(COMMANDS, process.platform);
    const deps: IpcDeps = {
      getContext: () => {
        if (!ctx) throw new LearnError('LIBRARY_UNAVAILABLE', libraryError?.message ?? mainStrings.library.unavailable);
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
          menuState.__learnMenuContext = ctx;
          setUiContext(ctx);
        },
        current: () => uiContext,
      },
      isMainWindow,
      isSettingsWindow,
      sheets: createSheetHost({
        preload: path.join(here, '../preload/sheet.cjs'),
        url: () => windowUrl(rendererBase, 'sheet', urlOptions),
        platform: process.platform,
        onSheetShown,
        onSheetClosed,
        staticKey: (payload) =>
          payload.kind === 'shortcuts'
            ? sheetHeightKey({ platform: process.platform, fontSize: prefs.get().fontSize, density: prefs.get().density, digest: shortcutsSheetDigest })
            : null,
      }),
      windows: {
        openSettings: () => void settingsWindow.open(),
        async asSheet(owner, show) {
          onSheetShown(owner, { native: true }); // the dialog takes the key: owner is not key under it (critique m2)
          try {
            return await show();
          } finally {
            if (!owner.isDestroyed()) onSheetClosed(owner, { native: true });
          }
        },
      },
      theme: {
        changed: (theme) => themeFollower.pageChanged(theme),
        shown: (sender, shade) => themeFollower.shown(sender.id, shade),
      },
      prepareSettings: () => settingsWindow.prepare(),
      relaunch() {
        if (isE2E(app.isPackaged, process.env)) {
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
    // E2E only (LEARN_E2E=1, never packaged): the seeding hook a large-library test calls through app.evaluate.
    if (isE2E(app.isPackaged, process.env)) installTestHooks({ repo: () => deps.getContext().repo, broadcast });

    activation.markReady();
    mainWindow = openMainWindow();
    refreshFullScreenItem();
  });

  // Ignored until the ready path above has registered the protocol and IPC (it opens the first window itself).
  app.on('activate', () => activation.onActivate());
  // A window under a sheet is main only while no other window of ours has the key: every window is re-read whenever
  // one of ours (a sheet included) gains the focus.
  app.on('browser-window-focus', () => {
    resyncAllWindowStates();
    // On X11 the window still reports the old key window when the event arrives; read once more when it has settled.
    setTimeout(resyncAllWindowStates, 50);
  });

  // Before anything closes: an open 정보 편집 is saved first, or keeps the app (marked fields). Any other before-quit
  // cleanup registers after this one and must skip a quit this called off (event.defaultPrevented).
  app.on('before-quit', (event) => editFlush.onBeforeQuit(event));

  // ⌘Q, the app menu's 종료, or a relaunch: a prepared settings window nobody opened is closed first — but only when the
  // quit goes ahead; the edit-flush gate above may call this attempt off and quit again after saving.
  app.on('before-quit', (event) => {
    if (!event.defaultPrevented) settingsWindow.discardPrepared();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    if (ctx?.db.open) ctx.db.close();
  });
}
