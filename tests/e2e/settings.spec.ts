// ⌘, settings window (design-spec 6 설정 창, 10.6): theme, density, text size, library location (R4); ⌘+ / ⌘− / ⌘0.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { windowBackground } from '../../apps/desktop/src/renderer/src/design/tokens.generated';
import { mainWindowChrome, shouldUseVibrancy } from '../../apps/desktop/src/main/window-options';
import { FIXTURES, closeSheet, expectWindow, holdOpenDialog, importPaths, launch, mainWindow, menuItemEnabled, releaseOpenDialog, rowAt, runMenuCommand, settingsPrepared, windowKinds } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const dirs = (i: { outputPath(...p: string[]): string }) => [i.outputPath('library'), i.outputPath('userdata')] as const;
const prefsFile = (ud: string) => JSON.parse(fs.readFileSync(path.join(ud, 'preferences.json'), 'utf8')) as Record<string, unknown>;
/** Every window, on purpose: the settings window must be one window, opened once. */
const windowCount = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
/** The settings window's BrowserWindow, evaluated in main. */
const settingsWindow = (app: ElectronApplication) =>
  app.evaluateHandle(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && x.webContents.getURL().includes('window=settings'));
    if (!w) throw new Error('no settings window');
    return w;
  });
const inactive = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute('data-window-inactive'));
/** A CSS colour token as the page computes it. */
const token = (page: Page, name: string) =>
  page.evaluate((v) => {
    const probe = document.createElement('span');
    document.body.append(probe);
    probe.style.color = `var(${v})`;
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, name);
/** The selection ring of a theme tile: its frame's border colour (critic T10-m1: a 2 px gap that shows the group). */
const ring = (settings: Page, theme: string) => settings.getByTestId(`theme-tile-${theme}`).locator('.frame').evaluate((el) => getComputedStyle(el).borderTopColor);
/** The settings window is shown exactly as tall as its content (design-spec 6), also after a message appeared in it. */
const fitsContent = async (app: ElectronApplication, settings: Page) =>
  (await (await settingsWindow(app)).evaluate((w) => w.isVisible() && w.getContentSize()[1])) ===
  (await settings.locator('[data-settings-root]').evaluate((el) => Math.ceil(el.getBoundingClientRect().height)));

test('⌘, opens one 600 px settings window; theme, density and text size apply at once to the main window only', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  // No colour-scheme emulation: the theme pref drives prefers-color-scheme through nativeTheme, as for a user.
  const { app, page } = await launch(lib, ud, { colorScheme: null });
  try {
    await importPaths(page, [PDF]);
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    expect(await settings.evaluate(() => innerWidth)).toBe(600);
    await expect.poll(() => settings.title()).toBe('설정'); // set by an effect after the first render (R-21)
    expect(await (await settingsWindow(app)).evaluate((w) => w.isResizable())).toBe(false);
    await runMenuCommand(app, 'app.settings'); // brings the same window forward
    expect(await windowCount(app)).toBe(2);
    await expect.poll(() => fitsContent(app, settings)).toBe(true);

    // Each window has its own window state: the settings window is key, the main window is not (and the reverse).
    await (await settingsWindow(app)).evaluate((w) => w.focus());
    await expect.poll(() => inactive(page)).toBe(true);
    await expect.poll(() => inactive(settings)).toBe(false);
    // The selected tile's ring is the accent ring, 2 px off the picture with nothing painted between; the others have none.
    expect(await ring(settings, 'system')).toBe(await token(settings, '--accent-ring'));
    expect(await ring(settings, 'dark')).toBe('rgba(0, 0, 0, 0)');
    expect(await settings.getByTestId('theme-tile-system').locator('.frame').evaluate((el) => [getComputedStyle(el).padding, getComputedStyle(el).backgroundColor])).toEqual(['2px', 'rgba(0, 0, 0, 0)']);
    await (await mainWindow(app)).evaluate((w) => w.focus());
    await expect.poll(() => inactive(page)).toBe(false);
    await expect.poll(() => inactive(settings)).toBe(true);
    // Not key: the selection turns neutral (design-spec 2.1, 3.1).
    expect(await ring(settings, 'system')).toBe(await token(settings, '--border-strong'));
    // Each text size names its value in pt in a tooltip (settings.html, design-spec 10.6).
    for (const size of [12, 13, 14, 15]) await expect(settings.locator(`[title="${size}pt"]`).getByTestId(`font-size-${size}`)).toHaveCount(1);

    // The tile is selected by the click itself, before the pref's round trip through main: checked after microtasks
    // only (React renders a click's update in one), where no IPC answer can arrive. The page's theme does not change
    // on the click; it changes when main sends the saved prefs to both windows at once.
    expect(
      await settings.evaluate(async () => {
        const before = document.documentElement.dataset['theme'];
        const tile = document.querySelector<HTMLElement>('[data-testid="theme-tile-dark"]')!;
        tile.click();
        for (let i = 0; i < 10; i++) await Promise.resolve();
        return { selected: tile.dataset['selected'] ?? null, themeKept: document.documentElement.dataset['theme'] === before };
      }),
    ).toEqual({ selected: 'true', themeKept: true });
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark');
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    await expect.poll(() => settings.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    await expect(settings.getByTestId('theme-tile-dark')).toHaveAttribute('data-selected', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(settings.locator('html')).toHaveAttribute('data-theme', 'dark');
    // T13R4-m1: the native theme followed the pages. Each page said it has the change (right after its swap),
    // its window's chrome followed it, and the app-wide native theme came last, once both had (not by the fallback).
    const steps = await app.evaluate(() =>
      ((globalThis as { __learnThemeLog?: Array<{ event: string; window?: string | null; reason?: string; at: number }> }).__learnThemeLog ?? []).map(
        (e) => `${e.event}${e.window ? `:${e.window}` : ''}${e.reason ? `:${e.reason}` : ''}`,
      ),
    );
    const from = steps.lastIndexOf('requested');
    const change = steps.slice(from);
    expect(change[0]).toBe('requested');
    for (const w of ['main', 'settings']) {
      expect(change.indexOf(`chrome:${w}`), w).toBeGreaterThan(change.indexOf(`shown:${w}`));
      expect(change.indexOf('source:shown'), w).toBeGreaterThan(change.indexOf(`chrome:${w}`));
    }
    expect(change).not.toContain('source:timeout');
    // Both windows' native backgrounds follow the theme by name (not only the main window's). On macOS the main window
    // has the sidebar vibrancy, which shows only through a clear window background (window-options.ts: #00000000, read
    // back without its alpha), so it stays clear in both themes; the settings window has no vibrancy and follows.
    await expect.poll(async () => (await (await settingsWindow(app)).evaluate((w) => w.getBackgroundColor())).toLowerCase()).toBe(windowBackground.dark);
    // The main window's own chrome rule (window-options.ts): with vibrancy (macOS, unless LEARN_VIBRANCY=0) the clear
    // #00000000, which getBackgroundColor reads back without its alpha; otherwise the theme's window background.
    const chrome = mainWindowChrome({ platform: process.platform, theme: 'dark', vibrancy: shouldUseVibrancy(process.platform, process.env) });
    const mainBackground = String(chrome.backgroundColor).slice(0, 7).toLowerCase();
    await expect.poll(async () => (await (await mainWindow(app)).evaluate((w) => w.getBackgroundColor())).toLowerCase()).toBe(mainBackground);

    await settings.getByTestId('density-compact').click();
    await expect.poll(async () => (await page.getByTestId('item-row').boundingBox())?.height).toBe(24);
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
    await settings.getByTestId('font-size-15').click();
    await expect.poll(() => rowAt(page, 0).locator('.item-title').evaluate((el) => getComputedStyle(el).fontSize)).toBe('15px');
    // Bars and rows keep their heights (only the type scales).
    expect(await page.getByTestId('toolbar').evaluate((el) => el.getBoundingClientRect().height)).toBe(52);
    expect((await page.getByTestId('item-row').boundingBox())?.height).toBe(24);
    // The settings window itself never scales (main window only): its segment labels stay footnote 12.
    expect(await settings.getByTestId('font-size-15').evaluate((el) => getComputedStyle(el).fontSize)).toBe('12px');
    expect(await settings.evaluate(() => document.documentElement.dataset['fontSize'] ?? null)).toBeNull();
    expect(prefsFile(ud)).toMatchObject({ theme: 'dark', density: 'compact', fontSize: 15 });
  } finally {
    await app.close();
  }
});

// T13-m6: the settings window was shown while Pretendard was still loading (130–170 ms with boxes and no text on Linux)
// and, in dark, one light frame was seen. Recorded in main at the window's 'show': the page's font loading and the
// native background colour it was created with. The window is prepared hidden while the theme is still light, and
// must show in dark all the same.
test('the settings window shows with its fonts loaded, and opened in dark it is dark from its first frame', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  const { app, page } = await launch(lib, ud, { colorScheme: null });
  try {
    await page.evaluate(() => window.learn.prefs.set({ theme: 'dark' }));
    await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    await app.evaluate(({ app: electronApp, BrowserWindow }) => {
      const g = globalThis as { __atShow?: Array<{ fonts: string; theme: string; background: string }> };
      g.__atShow = [];
      const watch = (w: InstanceType<typeof BrowserWindow>) =>
        w.once('show', () => {
          const background = w.getBackgroundColor().toLowerCase();
          void w.webContents
            .executeJavaScript('[document.fonts.status, document.documentElement.dataset.theme]', true)
            .then(([fonts, theme]: [string, string]) => g.__atShow!.push({ fonts, theme, background }));
        });
      // The settings window prepared hidden before the theme changed is the one ⌘, shows; a later one is new.
      for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed() && !w.isVisible()) watch(w);
      electronApp.on('browser-window-created', (_e, w) => watch(w));
    });
    await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    await expect.poll(() => app.evaluate(() => (globalThis as { __atShow?: unknown[] }).__atShow?.length ?? 0)).toBe(1);
    expect(await app.evaluate(() => (globalThis as { __atShow?: unknown[] }).__atShow)).toEqual([{ fonts: 'loaded', theme: 'dark', background: windowBackground.dark }]);
  } finally {
    await app.close();
  }
});

test('⌘+ / ⌘− / ⌘0 step the text size within 12–15 (library only)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const size = () => page.evaluate(() => document.documentElement.dataset['fontSize']);
  try {
    expect(await size()).toBe('13');
    expect(await menuItemEnabled(app, 'view.textReset')).toBe(false);
    await runMenuCommand(app, 'view.textBigger');
    await expect.poll(size).toBe('14');
    await runMenuCommand(app, 'view.textBigger');
    await expect.poll(size).toBe('15');
    await expect.poll(() => menuItemEnabled(app, 'view.textBigger')).toBe(false);
    expect(await menuItemEnabled(app, 'view.textBigger#1' as never)).toBe(false); // the hidden ⌘= twin too
    await runMenuCommand(app, 'view.textReset');
    await expect.poll(size).toBe('13');
    await runMenuCommand(app, 'view.textSmaller');
    await expect.poll(size).toBe('12');
    await expect.poll(() => menuItemEnabled(app, 'view.textSmaller')).toBe(false);
    expect(await page.getByTestId('toolbar-title').evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px'); // title3 15 × 12/13
  } finally {
    await app.close();
  }
});

test('⌘, shows the settings window main prepared hidden once the main window was idle: no new window, placed over the main window as it is now', async ({}, testInfo) => {
  const { app } = await launch(...dirs(testInfo));
  try {
    // launch() returns once it is prepared: hidden, loaded, measured.
    expect(await windowKinds(app)).toEqual(['main', 'settings (hidden)']);
    const prepared = app.windows().find((p) => p.url().includes('window=settings'))!;
    await app.evaluate(({ app: electronApp }) => {
      const g = globalThis as { __made?: number };
      g.__made = 0;
      electronApp.on('browser-window-created', () => void (g.__made = (g.__made ?? 0) + 1));
    });
    // The main window moved after the window was measured: it is placed over where the main window is now.
    await (await mainWindow(app)).evaluate((w) => w.setPosition(60, 80));
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    expect(settings).toBe(prepared);
    expect(await app.evaluate(() => (globalThis as { __made?: number }).__made)).toBe(0);
    expect(await windowKinds(app)).toEqual(['main', 'settings']);
    await expect.poll(() => fitsContent(app, settings)).toBe(true);
    const [main, own] = await Promise.all([(await mainWindow(app)).evaluate((w) => w.getBounds()), (await settingsWindow(app)).evaluate((w) => w.getBounds())]);
    expect(Math.abs(own.x + own.width / 2 - (main.x + main.width / 2))).toBeLessThanOrEqual(1);
    expect(own.y).toBeGreaterThan(main.y);
    // Closed by the user, it is gone; the next ⌘, makes a new one (none is prepared behind it).
    await settings.close();
    await expect.poll(() => windowKinds(app)).toEqual(['main']);
    const again = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    expect(again).not.toBe(prepared);
    expect(await app.evaluate(() => (globalThis as { __made?: number }).__made)).toBe(1);
  } finally {
    await app.close();
  }
});

test('R4: the renderer cannot set the library path; main picks, checks, confirms and relaunches', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  const target = testInfo.outputPath('other-library');
  fs.mkdirSync(target, { recursive: true });
  const { app, page } = await launch(lib, ud);
  try {
    expect(await page.evaluate(() => window.learn.prefs.set({ libraryRoot: '/tmp/x' } as never))).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    // Only the settings window asks for the library location: the main window's preload has no such invoker, and
    // main refuses its kind on those channels (app.test.ts, register.test.ts).
    expect(await page.evaluate(() => Object.keys(window.learn.app))).toEqual(['info']);
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    // It takes no input at all: a path sent anyway is refused before any dialog.
    expect(await settings.evaluate(() => (window.learn.app.chooseLibraryFolder as (input: unknown) => Promise<unknown>)({ path: '/tmp/x' }))).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    await expect(settings.getByTestId('library-path')).toHaveAttribute('title', lib);
    await app.evaluate(({ dialog, shell }, dir) => {
      const g = globalThis as { __revealed?: string; __asked?: number };
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
      dialog.showMessageBox = (async () => {
        g.__asked = (g.__asked ?? 0) + 1;
        return { response: 0, checkboxChecked: false };
      }) as typeof dialog.showMessageBox;
      shell.showItemInFolder = (p: string) => void (g.__revealed = p);
    }, target);
    await settings.getByTestId('library-reveal').click();
    await expect.poll(() => app.evaluate(() => (globalThis as { __revealed?: string }).__revealed)).toBe(lib);
    await settings.getByTestId('library-choose').click();
    await expect.poll(() => app.evaluate(() => (globalThis as { __learnRelaunchRequested?: boolean }).__learnRelaunchRequested)).toBe(true);
    expect(await app.evaluate(() => (globalThis as { __asked?: number }).__asked)).toBe(1);
    expect(prefsFile(ud)['libraryRoot']).toBe(target);
    await expect(settings.getByTestId('library-error')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('under its own folder dialog the settings window is not key (its ring goes) but stays main; key again after (critique m2)', async ({}, testInfo) => {
  const { app } = await launch(...dirs(testInfo));
  try {
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    await expect.poll(() => inactive(settings)).toBe(false);
    const choose = settings.getByTestId('library-choose');
    const ringed = () => choose.evaluate((el) => getComputedStyle(el).outlineStyle !== 'none' && el === document.activeElement);
    await choose.focus();
    await settings.keyboard.press('Shift+Tab');
    await settings.keyboard.press('Tab'); // keyboard focus: its ring
    await expect.poll(ringed).toBe(true);
    await holdOpenDialog(app, []);
    await settings.keyboard.press('Enter'); // the folder dialog hangs on the settings window (a sheet on macOS)
    const html = settings.locator('html');
    await expect(html).toHaveAttribute('data-window-inactive', '');
    await expect(html).not.toHaveAttribute('data-window-not-main', ''); // still main: the chrome does not dim
    expect(await ringed()).toBe(false);
    await releaseOpenDialog(app); // cancelled
    await expect(html).not.toHaveAttribute('data-window-inactive', '');
    await expect.poll(ringed).toBe(true);
  } finally {
    await app.close();
  }
});

test('a sheet keeps the main window main only while no other window of ours has the key: the settings window clicked dims it, its sheet clicked undims it (final review m5)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const html = page.locator('html');
  /** One of our windows takes the key, as a click on it would (Xvfb has no window manager to click through). */
  const focusWindow = (part: string) =>
    app.evaluate(({ BrowserWindow }, part) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes(part))?.focus(), part);
  try {
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'app.shortcuts'));
    await expect(html).toHaveAttribute('data-window-inactive', '');
    await expect(html).not.toHaveAttribute('data-window-not-main', ''); // under its own sheet: still main
    await focusWindow('window=settings');
    await expect.poll(() => inactive(settings)).toBe(false);
    await expect(html).toHaveAttribute('data-window-not-main', ''); // the settings window is AppKit's main window now
    expect(await menuItemEnabled(app, 'app.shortcuts')).toBe(false); // the sheet still holds the main window
    await focusWindow('window=sheet');
    await expect(html).not.toHaveAttribute('data-window-not-main', '');
    await expect(html).toHaveAttribute('data-window-inactive', '');
    await closeSheet(sheet, 'Enter');
    await expect(html).not.toHaveAttribute('data-window-inactive', '');
    await expect(html).not.toHaveAttribute('data-window-not-main', '');
  } finally {
    await app.close();
  }
});

test('the other way round (m5): under its own folder dialog the settings window dims once the main window has the key', async ({}, testInfo) => {
  const { app } = await launch(...dirs(testInfo));
  try {
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    const html = settings.locator('html');
    await holdOpenDialog(app, []);
    await settings.getByTestId('library-choose').click(); // the folder dialog hangs on the settings window (a sheet on macOS)
    await expect(html).toHaveAttribute('data-window-inactive', '');
    await expect(html).not.toHaveAttribute('data-window-not-main', '');
    await (await mainWindow(app)).evaluate((w) => w.focus());
    await expect(html).toHaveAttribute('data-window-not-main', '');
    await (await settingsWindow(app)).evaluate((w) => w.focus());
    await expect(html).not.toHaveAttribute('data-window-not-main', '');
    await releaseOpenDialog(app); // cancelled
    await expect(html).not.toHaveAttribute('data-window-inactive', '');
  } finally {
    await app.close();
  }
});

test('R4: a folder that is not writable is refused in the settings window', async ({}, testInfo) => {
  test.skip(process.getuid?.() === 0, 'root can write anywhere');
  const [lib, ud] = dirs(testInfo);
  const ro = testInfo.outputPath('read-only');
  fs.mkdirSync(ro, { recursive: true, mode: 0o555 });
  const { app } = await launch(lib, ud);
  try {
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    await app.evaluate(({ dialog }, dir) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
    }, ro);
    await expect.poll(() => fitsContent(app, settings)).toBe(true);
    const before = await settings.evaluate(() => innerHeight);
    await settings.getByTestId('library-choose').click();
    await expect(settings.getByTestId('library-error')).toHaveText('이\u00a0폴더에는 쓸 수 없습니다. 쓰기 권한이 있는 폴더를 고르세요.');
    // The window grows by the message: nothing is cut off (it cannot be resized by hand).
    await expect.poll(() => fitsContent(app, settings)).toBe(true);
    expect(await settings.evaluate(() => innerHeight)).toBeGreaterThan(before);
    await expect(settings.getByTestId('library-error')).toBeInViewport({ ratio: 1 });
    expect(fs.existsSync(path.join(ud, 'preferences.json')) ? prefsFile(ud)['libraryRoot'] ?? null : null).toBeNull();
  } finally {
    await app.close();
    fs.chmodSync(ro, 0o755);
  }
});

test('a change the preferences store refuses is said in the settings window, and nothing moves', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    // As when preferences.json could neither be read nor moved aside (prefs.ts read-only session).
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('prefs:set');
      ipcMain.handle('prefs:set', () => ({ ok: false, code: 'PREFS_UNAVAILABLE', message: '환경설정을 저장할 수 없습니다.', retryable: false }));
    });
    await settings.getByTestId('density-compact').click();
    await expect(settings.getByTestId('prefs-error')).toHaveText('환경설정을 저장할 수 없습니다.');
    await expect(settings.getByTestId('density-regular')).toHaveAttribute('data-selected', 'true');
    expect(await page.evaluate(() => document.documentElement.dataset['density'])).toBe('regular');
  } finally {
    await app.close();
  }
});

test('settings opens from the fatal screen when the library cannot be opened', async ({}, testInfo) => {
  const lib = testInfo.outputPath('broken');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'library.sqlite'), 'not a database');
  const { app, page } = await launch(lib, testInfo.outputPath('userdata'));
  try {
    expect(await menuItemEnabled(app, 'app.settings')).toBe(true); // main-owned: enabled with nothing else
    // Secondary: the notice's sentence asks for something else (restart, or the backup) — critic T10-m3.
    await expect(page.getByTestId('fatal-settings')).toHaveClass(/btn-secondary/);
    const settings = await expectWindow(app, 'settings', () => page.getByTestId('fatal-settings').click());
    await expect(settings.getByTestId('library-choose')).toBeVisible();
    await expect(settings.getByTestId('library-path')).toHaveAttribute('title', lib);
    // When main refuses, the screen says so (review minor 6) instead of a button that does nothing.
    await settings.close();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('ui:openSettings');
      ipcMain.handle('ui:openSettings', () => ({ ok: false, code: 'INTERNAL', message: '설정 창을 열지 못했습니다.', retryable: false }));
    });
    await page.getByTestId('fatal-settings').click();
    await expect(page.getByTestId('action-error')).toContainText('설정 창을 열지 못했습니다.');
  } finally {
    await app.close();
  }
});

test('Linux/Windows: closing the main window closes the settings window too, and the app quits (review minor 2)', async ({}, testInfo) => {
  test.skip(process.platform === 'darwin', 'macOS keeps the app and the settings window open (the next test)');
  const { app } = await launch(...dirs(testInfo));
  try {
    await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    const quit = app.waitForEvent('close');
    await (await mainWindow(app)).evaluate((w) => w.close());
    await quit; // window-all-closed: no settings window was left behind to keep the app alive
  } finally {
    await app.close().catch(() => {});
  }
});

test('Linux/Windows: a prepared settings window nobody opened never keeps the app alive: closing the main window quits', async ({}, testInfo) => {
  test.skip(process.platform === 'darwin', 'macOS keeps the app running without windows (the next test)');
  const { app } = await launch(...dirs(testInfo));
  try {
    expect(await windowKinds(app)).toEqual(['main', 'settings (hidden)']);
    const quit = app.waitForEvent('close');
    await (await mainWindow(app)).evaluate((w) => w.close());
    await quit; // window-all-closed came: the hidden window went with the main window
  } finally {
    await app.close().catch(() => {});
  }
});


test('macOS: with only the settings window left, activate (dock click) opens a new main window (R-22)', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin', 'Linux/Windows quit with the main window (the test above)');
  const { app } = await launch(...dirs(testInfo));
  try {
    await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    await (await mainWindow(app)).evaluate((w) => w.close());
    await expect.poll(() => windowCount(app)).toBe(1); // the settings window keeps the app running
    const reopened = app.waitForEvent('window');
    await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
    const main = await reopened;
    await expect.poll(() => main.url()).toContain('window=main');
    await expect(main.getByTestId('app-ready')).toBeAttached();
    // ⌘, now places the existing settings window, still one.
    await runMenuCommand(app, 'app.settings');
    expect(await windowCount(app)).toBe(2);
  } finally {
    await app.close();
  }
});

test('macOS: closing the main window discards the prepared settings window; the next main window prepares one again', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin', 'Linux/Windows quit with the main window (the test above)');
  const { app } = await launch(...dirs(testInfo));
  try {
    expect(await windowKinds(app)).toEqual(['main', 'settings (hidden)']);
    await (await mainWindow(app)).evaluate((w) => w.close());
    await expect.poll(() => windowKinds(app)).toEqual([]); // no hidden renderer left for nobody
    const reopened = app.waitForEvent('window');
    await app.evaluate(({ app: electronApp }) => electronApp.emit('activate'));
    const main = await reopened;
    await expect(main.getByTestId('app-ready')).toBeAttached();
    await expect.poll(() => settingsPrepared(app), { timeout: 15_000 }).toBe(true);
    expect(await windowKinds(app)).toEqual(['main', 'settings (hidden)']);
  } finally {
    await app.close();
  }
});

