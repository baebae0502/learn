// First: ESM evaluates imports in order, so the cold-start marks module runs before anything else (its value is
// performance.timeOrigin either way).
import { markPerf } from './perf';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, Menu, net, session, shell, systemPreferences, webContents, type MessageBoxOptions, type OpenDialogOptions, type WebContents } from 'electron';
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
import { DETERMINISTIC_SWITCHES, isDeterministic, isE2E, isTranslationNetIntercept } from './deterministic';
import { createFlushGate } from './edit-flush';
import { broadcast, onBroadcast, sendEvent } from './events';
import { registerAllIpc } from './ipc/all';
import { revealBackupFolder, revealRestoredFolder } from './ipc/backup';
import { IMPORT_FILTERS } from './ipc/library';
import { endPositionNotices } from './ipc/reader';
import { createHandle, type IpcDeps } from './ipc/register';
import { createBackupJob } from './jobs/backup-job';
import { createRestoreJob } from './jobs/restore-job';
import { createDuplicateAsker } from './jobs/duplicate-asker';
import { createImportQueue } from './jobs/import-queue';
import { createJobLane } from './jobs/lane';
import { createQuitGuard, type QuitGuard } from './jobs/quit-guard';
import { createLibrarySwitch, refuseLinkedInside, type LibrarySwitch } from './library-folder';
import { createCheckSheets, startLibraryCheck, type AutoOutcome } from './library-check';
import { openLibraryContext, type LibraryContext } from './library-context';
import { FULL_SCREEN, applyFullScreenItem, applyMenuEnabled, applyMenuLabels, buildAppMenu, menuLabelState, menuLabelsChanged, submenuShapeKey } from './menu/app-menu';
import { createMenuRebuilder } from './menu/rebuild';
import { menuNeedsOrganize } from './menu/submenus';
import { openPrefsStore, resolveLibraryRoot } from './prefs';
import { hardenApp } from './security';
import { createSettingsWindow } from './settings-window';
import { createSheetHost, sheetHeightKey, shortcutsDigest } from './sheets';
import { mainStrings } from './strings';
import { createTextExtractor } from './text/extractor';
import { forkTextWorker, pdfjsAssetsDir } from './text/fork';
import { installTestHooks } from './test-hooks';
import { applyTheme, currentTheme, onThemeChange } from './theme';
import { createThemeFollower, shownPages, type ThemeMark } from './theme-follow';
import { findUpdateBackup } from './update-backup';
import { createMainWindow } from './window';
import { remoteFetch } from './net-policy';
import { createFakeEngine } from './translation/fake';
import { createGoogleWebEngine } from './translation/google-web';
import { createTranslationNetIntercept } from './translation/net-intercept';
import { createTranslationService } from './translation/service';
import { applyChromeTheme, shouldUseVibrancy, type ChromeOptions } from './window-options';
import { isSheetOpen, resyncAllWindowStates, sheetClosed, sheetShown } from './window-state';
import { windowUrl } from './window-url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The body-text worker's keeper: one utility process, started by the first job and gone after thirty idle seconds. */
const textExtractor = createTextExtractor({ fork: () => forkTextWorker(path.join(here, 'text-worker.js')) });

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
const urlOptions = { platform: process.platform, deterministic, vibrancy, demo: isDemoOverlay(app.isPackaged, process.env), e2e: isE2E(app.isPackaged, process.env) };
const chrome = (): ChromeOptions => ({ platform: process.platform, theme: currentTheme(), vibrancy });

registerAppScheme();

let ctx: LibraryContext | null = null;
let libraryError: { code: ErrorCode; message: string } | null = null;
let mainWindow: BrowserWindow | null = null;

/** Closing or quitting over an open 정보 편집 (spec §5.3): the page saves first, or keeps the window and the app (edit-flush.ts). */
const editFlush = createFlushGate({
  mainWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
  quit: () => app.quit(),
  onStay: () => cancelLibrarySwitch(),
  record: (entry) => {
    // E2E reads what each close or quit was answered.
    if (isE2E(app.isPackaged, process.env)) ((globalThis as { __learnEditFlushLog?: unknown[] }).__learnEditFlushLog ??= []).push(entry);
  },
});

/** A library switch waiting for the quit to go ahead (library-folder.ts): forgotten when a gate keeps the app, applied in will-quit. */
let cancelLibrarySwitch = (): void => {};
let applyLibrarySwitch = (): void => {};

/** The work line (spec 3.1): imports, backups and restores run on it one at a time. */
const jobs = createJobLane();
/** Asked before the edit-flush gate on every quit; made with the import queue once the app is ready. */
let quitGuard: QuitGuard | null = null;
/** The automatic check sheet stands down once a check sheet is shown or the app quits (library-check.ts AutoGate). */
let checkStopped = false;
/** What the startup check did about the automatic sheet (E2E reads it). */
let autoCheck: AutoOutcome | 'pending' = 'pending';

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
    endPositionNotices();
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
function dispatchMenuCommand(commandId: CommandId, args?: CommandArgs, byKey?: true): void {
  if (commandId === 'app.settings') {
    const c = commandById('app.settings');
    demoShortcut(c.accelerator!, commandLabel(c, process.platform));
    settingsWindow.open();
    return;
  }
  const target = mainWindow;
  // ⌘W in the settings window closes that window, as the window menu's role did before ⌘W became 탭 닫기.
  if (commandId === 'tab.close') {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && focused !== target) {
      focused.close();
      return;
    }
  }
  if (!target || target.isDestroyed()) return;
  if (!target.isFocused()) target.focus();
  sendEvent(target.webContents, 'menuCommand', { commandId, ...(args ? { args } : {}), ...(byKey ? { byKey } : {}) });
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
    const getContext = (): LibraryContext => {
      if (!ctx) throw new LearnError('LIBRARY_UNAVAILABLE', libraryError?.message ?? mainStrings.library.unavailable);
      return ctx;
    };
    const sheets = createSheetHost({
      preload: path.join(here, '../preload/sheet.cjs'),
      url: () => windowUrl(rendererBase, 'sheet', urlOptions),
      platform: process.platform,
      onSheetShown,
      onSheetClosed,
      staticKey: (payload) =>
        payload.kind === 'shortcuts'
          ? sheetHeightKey({ platform: process.platform, fontSize: prefs.get().fontSize, density: prefs.get().density, digest: shortcutsSheetDigest, view: payload.view ?? 'library' })
          : null,
    });
    /** Every native dialog with a parent window goes through this (IpcDeps.windows.asSheet). */
    const asSheet = async <T>(owner: BrowserWindow, show: () => Promise<T>): Promise<T> => {
      onSheetShown(owner, { native: true }); // the dialog takes the key: owner is not key under it (critique m2)
      try {
        return await show();
      } finally {
        if (!owner.isDestroyed()) onSheetClosed(owner, { native: true });
      }
    };
    const liveMainWindow = (): BrowserWindow | null => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null);
    // Every window's imports, one file at a time on the work line; a duplicate question hangs on the window that asked.
    const imports = createImportQueue({
      lane: jobs,
      importer: () => {
        const c = getContext();
        return refuseLinkedInside(c.importer, c.layout.root);
      },
      card: (itemId) => {
        const item = ctx?.repo.getItem(itemId);
        return item ? { title: item.title, type: item.type, size: item.size, createdAt: item.createdAt, storageMode: item.storageMode } : null;
      },
      ask: createDuplicateAsker<BrowserWindow>({
        windowOf: (id) => {
          const win = liveMainWindow();
          return win && win.webContents.id === id ? win : null;
        },
        anyMainWindow: liveMainWindow,
        sheet: (parent, payload, signal) => sheets.open(parent, payload, signal),
        messageBox: (options) => dialog.showMessageBox(options),
      }),
      fileExisting: (collectionId, itemIds) => {
        const filed = getContext().collections.addItemsChanged(collectionId, itemIds);
        if (filed.length > 0) broadcast('libraryChanged', { reason: 'collections', itemIds: filed });
        return filed.length;
      },
      announce: (itemIds) => broadcast('libraryChanged', { reason: 'import', itemIds }),
    });
    // Every window hears the queue (the progress toast, the busy screen); 기존 자료 열기 opens in the window it was
    // answered on, which may not be the one that put the file in (spec 3.4).
    imports.onProgress((state) => broadcast('import:progress', state));
    imports.onFinished((report, openIn) => {
      broadcast('import:finished', { report });
      if (report.openItemId === null || openIn === null) return;
      const contents = webContents.fromId(openIn);
      if (contents && !contents.isDestroyed()) sendEvent(contents, 'item:openRequested', { itemId: report.openItemId });
    });
    /** The main window drew its first list and went idle (ui.reportIdle): the automatic check sheet may follow. */
    let firstScreenDrawn = (): void => {};
    const firstScreen = new Promise<void>((resolve) => {
      firstScreenDrawn = resolve;
    });
    const announceAvailability = (itemIds: string[]) => broadcast('libraryChanged', { reason: 'availability', itemIds });
    // 라이브러리 점검 (spec 7): the sheet and its actions. Its open panel hangs on the check sheet that asked (Q-8g).
    const checks = createCheckSheets({
      context: getContext,
      sheets,
      imports,
      announce: announceAvailability,
      relinked: (itemIds) => broadcast('libraryChanged', { reason: 'relink', itemIds }),
      homeDir: app.getPath('home'),
      pickFile: async (owner, words) => {
        const res = await asSheet(owner, () => dialog.showOpenDialog(owner, { ...words, properties: ['openFile'], filters: IMPORT_FILTERS }));
        return res.canceled ? null : (res.filePaths[0] ?? null);
      },
      reveal: (file) => shell.showItemInFolder(file),
      stopAuto: () => {
        checkStopped = true;
      },
    });
    sheets.onAct('libraryCheck', (action, sheet) => checks.act(action, sheet));
    /**
     * Another library folder (설정, the restore's 전환): the app is asked to quit, and the folder is saved and the restart
     * armed in will-quit, when the quit really goes ahead. E2E applies at once and only records the request: Playwright
     * cannot follow a new process.
     */
    const e2e = isE2E(app.isPackaged, process.env);
    const librarySwitch: LibrarySwitch = createLibrarySwitch({
      prefs,
      arm: () => {
        if (e2e) (globalThis as { __learnRelaunchRequested?: boolean }).__learnRelaunchRequested = true;
        else app.relaunch();
      },
      quit: () => {
        if (e2e) librarySwitch.apply();
        else setImmediate(() => app.quit());
      },
    });
    cancelLibrarySwitch = () => librarySwitch.cancel();
    applyLibrarySwitch = () => librarySwitch.apply();
    const switchLibrary = (target: string): void => librarySwitch.request(target);
    // 백업 만들기… on the same work line (spec 8.1): the folder panel hangs on the window that asked; the result sheet too.
    const backup = createBackupJob<BrowserWindow>({
      lane: jobs,
      library: () => {
        const c = getContext();
        return { layout: c.layout, db: c.db, repo: c.repo, settings: c.settings };
      },
      pickFolder: async (owner, { defaultPath }) => {
        const copy = mainStrings.backup;
        const options: OpenDialogOptions = { title: copy.pickTitle, message: copy.pickMessage, buttonLabel: copy.pickButton, defaultPath, properties: ['openDirectory', 'createDirectory'] };
        const res = owner && !owner.isDestroyed() ? await asSheet(owner, () => dialog.showOpenDialog(owner, options)) : await dialog.showOpenDialog(options);
        return res.canceled ? null : (res.filePaths[0] ?? null);
      },
      backupDir: () => prefs.get().backupDir,
      rememberDir: (dir) => {
        if (prefs.get().backupDir !== dir) broadcast('prefsChanged', { prefs: prefs.set({ backupDir: dir }) });
      },
      documentsDir: () => app.getPath('documents'),
      homeDir: () => app.getPath('home'),
      progress: (p) => broadcast('job:progress', p),
      stored: () => broadcast('settingsChanged', { keys: ['backup.last'] }),
      showResult: (owner, payload) => {
        const parent = owner && !owner.isDestroyed() ? owner : liveMainWindow();
        if (!parent) return; // no window left to show it on (macOS): 마지막 백업 in settings still says it
        void sheets.open(parent, payload);
      },
    });
    // The result sheet's Finder에서 보기 (sheet:act): the folder that sheet names, kept in main; the sheet stays as it is.
    sheets.onAct('backupDone', async (action, sheet) => {
      if (action.kind === 'backupDone' && action.act === 'reveal' && sheet.payload.kind === 'backupDone') revealBackupFolder(sheet.payload.location);
      return sheet.payload;
    });
    /** A folder panel over `owner` (a sheet on macOS), or on its own when there is no window. */
    const pickFolderOver = async (owner: BrowserWindow | null, options: OpenDialogOptions): Promise<string | null> => {
      const res = owner && !owner.isDestroyed() ? await asSheet(owner, () => dialog.showOpenDialog(owner, options)) : await dialog.showOpenDialog(options);
      return res.canceled ? null : (res.filePaths[0] ?? null);
    };
    const restoreWords = mainStrings.restore;
    // 백업에서 복원… on the same work line (spec 9): two folder panels over the window that asked, the result sheet after.
    const restore = createRestoreJob<BrowserWindow>({
      lane: jobs,
      libraryRoot: () => libraryRoot,
      pickBackup: (owner, { defaultPath }) =>
        pickFolderOver(owner, { title: restoreWords.pickBackupTitle, message: restoreWords.pickBackupMessage, buttonLabel: restoreWords.pickBackupButton, defaultPath, properties: ['openDirectory'] }),
      pickParent: (owner, { defaultPath }) =>
        pickFolderOver(owner, {
          title: restoreWords.pickParentTitle, message: restoreWords.pickParentMessage, buttonLabel: restoreWords.pickParentButton, defaultPath, properties: ['openDirectory', 'createDirectory'],
        }),
      backupDir: () => prefs.get().backupDir,
      documentsDir: () => app.getPath('documents'),
      homeDir: () => app.getPath('home'),
      progress: (p) => broadcast('job:progress', p),
      showResult: (owner, payload) => {
        const parent = owner && !owner.isDestroyed() ? owner : liveMainWindow();
        // No window left (macOS): the folder is there all the same, and 설정's 다른 폴더 선택… can switch to it.
        return parent ? sheets.open(parent, payload) : Promise.resolve(null);
      },
      switchTo: switchLibrary,
      switchFailed: (owner, error) => {
        const parent = owner && !owner.isDestroyed() ? owner : liveMainWindow();
        const box: MessageBoxOptions = { type: 'warning', message: restoreWords.switchFailed, detail: error.message, buttons: [restoreWords.ok], defaultId: 0, noLink: true };
        void (parent ? asSheet(parent, () => dialog.showMessageBox(parent, box)) : dialog.showMessageBox(box));
      },
    });
    // The result sheet's Finder에서 보기: the folder main made, from the payload main holds (the page sends no path).
    sheets.onAct('restoreDone', async (action, sheet) => {
      if (action.kind === 'restoreDone' && action.act === 'reveal' && sheet.payload.kind === 'restoreDone') revealRestoredFolder(sheet.payload.location);
      return sheet.payload;
    });
    /** recovery:show: the main window asks for the automatic sheet itself, held as under any sheet it asks for (Q-8d). */
    const requestAutoCheck = (): void => {
      const win = liveMainWindow();
      if (win) sendEvent(win.webContents, 'recovery:show', {});
    };
    // E2E never reaches the network: the app always runs on the fake engine there.
    // Unless a test asks for the real engine over its own network end (R-17: the engine and remoteFetch → net.fetch run,
    // a handler on the default session answers the translation host and refuses every other https request).
    const translationNet = isTranslationNetIntercept(app.isPackaged, process.env) ? createTranslationNetIntercept() : null;
    if (translationNet) session.defaultSession.protocol.handle('https', (request) => translationNet.handle(request));
    const fakeTranslation = isE2E(app.isPackaged, process.env) && !translationNet ? createFakeEngine() : null;
    const translation = createTranslationService({
      engine: fakeTranslation ?? createGoogleWebEngine({ fetch: remoteFetch, isOnline: () => net.isOnline() }),
      cache: () => getContext().translations,
      prefs: () => prefs.get(),
    });
    const deps: IpcDeps = {
      getContext,
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
      translation,
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
      sheets,
      jobs,
      imports,
      backup,
      restore,
      checks,
      windows: { openSettings: () => void settingsWindow.open(), asSheet },
      theme: {
        changed: (theme) => themeFollower.pageChanged(theme),
        shown: (sender, shade) => themeFollower.shown(sender.id, shade),
      },
      // The main window drew its first list and went idle: the settings window is prepared, and the automatic check may show.
      prepareSettings: () => {
        settingsWindow.prepare();
        firstScreenDrawn();
      },
      switchLibrary,
    };
    registerAllIpc(createHandle(devOrigin), deps);
    // A running import, backup or restore is asked about before the edit-flush gate on every quit.
    quitGuard = createQuitGuard<BrowserWindow>({
      lane: jobs,
      remaining: () => {
        const s = imports.state();
        return s.total - s.done;
      },
      owner: liveMainWindow,
      ask: async (owner, question) => {
        const options: MessageBoxOptions = { ...question, buttons: [...question.buttons], noLink: true };
        const { response } = owner ? await asSheet(owner, () => dialog.showMessageBox(owner, options)) : await dialog.showMessageBox(options);
        return response === 0;
      },
      quit: () => app.quit(),
      // Linux/Windows quit when the last window closes: staying on without one would leave no way back into the app.
      onStay: () => {
        cancelLibrarySwitch();
        if (process.platform === 'darwin' || liveMainWindow() !== null) return;
        mainWindow = openMainWindow();
        refreshFullScreenItem();
      },
    });
    // E2E only (LEARN_E2E=1, never packaged): the hooks tests call through app.evaluate (seeding, the import pause and queue).
    if (isE2E(app.isPackaged, process.env)) {
      installTestHooks({
        repo: () => deps.getContext().repo,
        importCommits: () => deps.getContext().repo,
        organize: () => {
          const ctx = deps.getContext();
          return { db: ctx.db, collections: ctx.collections, tags: ctx.tags };
        },
        broadcast,
        text: { extractor: textExtractor, assetsDir: pdfjsAssetsDir(here) },
        translation: fakeTranslation ?? undefined,
        translationNet: translationNet ?? undefined,
        imports: { importer: () => getContext().importer, queue: imports, mainWindowId: () => liveMainWindow()?.webContents.id ?? null, lane: jobs },
        backup,
        restore,
        seedFiles: () => {
          const c = getContext();
          return { db: c.db, repo: c.repo, layout: c.layout };
        },
        check: {
          state: () => ({ check: ctx?.check ?? null, auto: autoCheck }),
          request: async () => {
            await checks.recheck();
            requestAutoCheck();
          },
        },
      });
    }

    activation.markReady();
    mainWindow = openMainWindow();
    markPerf('windowCreated');
    refreshFullScreenItem();
    // P-18: the library check runs once the window exists, in the background: the first paint never waits for the disk.
    if (ctx) {
      void startLibraryCheck(ctx, {
        announce: announceAvailability,
        requestAuto: requestAutoCheck,
        gate: {
          firstScreen,
          busy: () => {
            const win = liveMainWindow();
            return win === null || isSheetOpen(win) || jobs.busy() !== null || imports.state().state !== 'idle';
          },
          stopped: () => checkStopped,
          sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        },
      }).then(
        (outcome) => {
          autoCheck = outcome;
        },
        (e: unknown) => console.error(`[check] the startup check failed: ${toLearnError(e).code}`),
      );
    }
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

  // Before anything closes: a running import, backup or restore is asked about first (it stops, or the quit is off),
  // then an open 정보 편집 is saved, or keeps the app (marked fields). Any other before-quit cleanup registers after this
  // one and must skip a quit this called off (event.defaultPrevented).
  app.on('before-quit', (event) => {
    if (quitGuard?.onBeforeQuit(event)) return;
    editFlush.onBeforeQuit(event);
  });

  // ⌘Q, the app menu's 종료, or a relaunch: a prepared settings window nobody opened is closed first — but only when the
  // quit goes ahead; the edit-flush gate above may call this attempt off and quit again after saving.
  app.on('before-quit', (event) => {
    if (!event.defaultPrevented) settingsWindow.discardPrepared();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    applyLibrarySwitch();
    checkStopped = true;
    textExtractor.dispose();
    menuRebuild.cancel();
    if (ctx?.db.open) ctx.db.close();
  });
}
