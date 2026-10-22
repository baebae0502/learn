// Keyboard only (AC18, design-spec 8.3). In-page keys are real key presses; ⌘ shortcuts go through the menu items
// (runMenuCommand) because CDP keys never reach native accelerators on Linux — the macOS lane presses them for real.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import { FIXTURES, closeSheet, drag, dropSource, expectWindow, holdOpenDialog, importPaths, launch, mainWindow, openItem, releaseOpenDialog, runMenuCommand, stubOpenDialog } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');

/** The data-pane the focus is in (sidebar, content, toasts), or null. */
const inPane = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') ?? null);
/** The test id of the element with the focus (or of its nearest ancestor that has one). */
const focusedTestId = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? null);
/** The `?window=` kind of the focused BrowserWindow. */
const focusedWindow = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => /[?&]window=(\w+)/.exec(BrowserWindow.getFocusedWindow()?.webContents.getURL() ?? '')?.[1] ?? null);

test('import → open → page → back → palette → settings → shortcuts, with axe at every stop', async ({}, testInfo) => {
  // No colour-scheme emulation: the theme the settings window picks reaches prefers-color-scheme (axe in both themes).
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: null });
  try {
    await expectNoSeriousA11y(page, 'empty library');
    await stubOpenDialog(app, [MP4, PDF]); // newest first: the PDF heads the list
    await page.keyboard.press('F6'); // sidebar
    expect(await focusedTestId(page)).toBe('nav-library');
    await page.keyboard.press('F6'); // content: first control of the first-run screen
    expect(await focusedTestId(page)).toBe('import-managed');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    // The first-run screen took the focus along: the list's first title has it now (MainWindow's handover).
    await expect(page.getByTestId('open-item').first()).toBeFocused();
    await expectNoSeriousA11y(page, 'library list');

    await page.keyboard.press('Shift+F6'); // sidebar (whether or not the success toast is still up)
    expect(await focusedTestId(page)).toBe('nav-library');
    await page.keyboard.press('F6'); // content: the first title
    expect(await focusedTestId(page)).toBe('open-item');
    await expect(page.locator('.table-row:has(.row-open:focus-visible)')).toHaveCount(1); // keyboard cursor ring
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expectNoSeriousA11y(page, 'PDF reader');

    await page.keyboard.press('F6'); // sidebar
    await page.keyboard.press('F6'); // content: 다음 쪽 (이전 쪽 is disabled on page 1)
    expect(await focusedTestId(page)).toBe('pdf-next');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pdf-page-indicator')).toHaveText('2 / 3쪽');
    await page.keyboard.press('Shift+Tab'); // 이전 쪽
    await page.keyboard.press('Shift+Tab'); // toolbar: 라이브러리로 돌아가기
    expect(await focusedTestId(page)).toBe('viewer-back');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('library-table')).toBeVisible();

    await runMenuCommand(app, 'app.palette'); // ⌘K
    await expectNoSeriousA11y(page, 'palette');
    await page.keyboard.type('ㅅㅇㄷㅂ');
    await expectNoSeriousA11y(page, 'palette, 초성 results');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await runMenuCommand(app, 'view.toggleSidebar'); // ⌃⌘S

    await runMenuCommand(app, 'app.palette');
    await page.keyboard.type('효소 억제제');
    await expect(page.getByTestId('palette-empty')).toBeVisible();
    await expectNoSeriousA11y(page, 'palette, no results');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toHaveCount(0);

    const settings = await expectWindow(app, 'settings', async () => {
      await runMenuCommand(app, 'app.palette');
      await page.keyboard.type('설정');
      await page.keyboard.press('Enter');
    });
    // Light, then dark, each picked by keyboard and checked on the page itself. (Not colorScheme: 'light' at launch:
    // that emulation would hold the page light through the dark pick.)
    await settings.keyboard.press('Tab'); // the theme radio group
    await settings.keyboard.press('ArrowRight'); // 시스템 설정 → 라이트
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light');
    await expect.poll(() => settings.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches)).toBe(true);
    await expectNoSeriousA11y(settings, 'settings window, light');
    await settings.keyboard.press('ArrowRight'); // 다크
    await expect.poll(() => settings.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    await expectNoSeriousA11y(settings, 'settings window, dark');
    await settings.close();

    const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'app.shortcuts')); // ⌘/
    await expectNoSeriousA11y(sheet, 'shortcut sheet');
    await closeSheet(sheet, 'Enter');
  } finally {
    await app.close();
  }
});

test('F6 / ⇧F6 cycle sidebar ↔ content, also out of a text field; a folded sidebar is skipped', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    // After a click, F6 is keyboard navigation again: the row it reaches shows its keyboard ring (react-aria's
    // focus-visible never saw the key, which the keymap stopped on window capture).
    await page.getByTestId('content').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('sidebar');
    await expect(page.getByTestId('nav-library')).toHaveAttribute('data-focus-visible', 'true');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('content');
    await page.keyboard.press('Shift+F6');
    expect(await inPane(page)).toBe('sidebar');
    await page.keyboard.press('Shift+F6'); // wraps
    expect(await inPane(page)).toBe('content');

    // Out of a text field (the zoom field is a <select>, where letters would type): F6 is marked inText.
    await importPaths(page, [PDF]);
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await page.getByTestId('pdf-zoom').focus();
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('sidebar');
    await page.getByTestId('pdf-zoom').focus();
    await page.keyboard.press('Shift+F6');
    expect(await inPane(page)).toBe('sidebar');

    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('content');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('content');
  } finally {
    await app.close();
  }
});

/**
 * R-1: react-aria's LandmarkManager listens for F6 on document capture and swallows it while it has a landmark — a
 * toast region would be one. RAC 1.22.1 never registers ours (the region mounts empty and its label is fixed, so the
 * registering effect does not run again when a toast appears), so its listener is stood in for here: the keymap, on
 * window capture, must get F6 before it.
 */
const standInForLandmarkManager = (page: Page) =>
  page.evaluate(() =>
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'F6') return;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    ),
  );

// R-1: the keymap keeps F6 while a toast is up and puts the toast region last in the cycle instead.
test('F6 reaches a visible toast and keeps cycling: sidebar → content → toasts → sidebar', async ({}, testInfo) => {
  const notes = testInfo.outputPath('src', 'notes.txt');
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.writeFileSync(notes, 'plain text');
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await stubOpenDialog(app, [notes]);
    await runMenuCommand(app, 'file.importManaged');
    await expect(page.getByTestId('import-failures')).toBeVisible(); // an error toast stays until closed
    await standInForLandmarkManager(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (const pane of ['sidebar', 'content', 'toasts', 'sidebar']) {
      await page.keyboard.press('F6');
      expect(await inPane(page)).toBe(pane);
    }
    await page.keyboard.press('Shift+F6');
    expect(await inPane(page)).toBe('toasts');
    await expectNoSeriousA11y(page, 'error toast');
    // From the toast, Escape closes it (C-6) and the focus goes back where ⇧F6 came from; with no toast left, F6
    // cycles the two panes again.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('import-failures')).toHaveCount(0);
    expect(await inPane(page)).toBe('sidebar');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('content');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('sidebar');
  } finally {
    await app.close();
  }
});

// Task 12 ruling: modal surfaces swallow F6 — the focus stays inside them, also with a toast up (the landmark manager
// would otherwise move it to the toast).
test('the palette, the drop overlay and the ⌘/ sheet keep the focus on F6 / ⇧F6', async ({}, testInfo) => {
  const notes = testInfo.outputPath('src', 'notes.txt');
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.writeFileSync(notes, 'plain text');
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await stubOpenDialog(app, [notes]);
    await runMenuCommand(app, 'file.importManaged');
    await expect(page.getByTestId('import-failures')).toBeVisible();

    await runMenuCommand(app, 'app.palette');
    await expect(page.getByTestId('palette-input')).toBeFocused();
    for (const key of ['F6', 'Shift+F6']) {
      await page.keyboard.press(key);
      await expect(page.getByTestId('palette-input')).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toHaveCount(0);

    await page.keyboard.press('F6');
    expect(await focusedTestId(page)).toBe('nav-library');
    await drag(page, 'dragenter', [['a.pdf', 'application/pdf']]);
    await expect(page.getByTestId('drop-overlay')).toBeVisible();
    await expectNoSeriousA11y(page, 'drop overlay');
    for (const key of ['F6', 'Shift+F6']) {
      await page.keyboard.press(key);
      expect(await focusedTestId(page)).toBe('nav-library');
    }
    await drag(page, 'dragleave', [['a.pdf', 'application/pdf']]);
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
    await page.keyboard.press('F6'); // the keymap is back
    expect(await inPane(page)).toBe('content');

    const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'app.shortcuts'));
    const before = await sheet.evaluate(() => document.activeElement?.outerHTML ?? null);
    await sheet.keyboard.press('F6');
    expect(await sheet.evaluate(() => document.activeElement?.outerHTML ?? null)).toBe(before);
    expect(await focusedWindow(app)).toBe('sheet');
    await closeSheet(sheet, 'Escape');
  } finally {
    await app.close();
  }
});

// Task 12 polish ruling: an import holds the window but F6 / ⇧F6 only move the focus, so they keep working; a modal
// surface over the import still swallows them.
test('during an import F6 still moves between panes; the palette over an import keeps the focus', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await holdOpenDialog(app, []);
    await runMenuCommand(app, 'file.importManaged'); // the import waits on its dialog: the window is held
    await expect(page.getByTestId('import-managed')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('sidebar');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('content');
    await page.keyboard.press('Shift+F6');
    expect(await inPane(page)).toBe('sidebar');
    await releaseOpenDialog(app); // cancelled
    await expect(page.getByTestId('import-managed')).not.toHaveAttribute('aria-disabled', 'true');

    // No UI opens the palette over an import (⌘K is refused while held; a menu command or a file drag closes it first,
    // Task 11 ruling D). A drop without its dragenter, which no real drag sends, starts one under the open palette.
    await runMenuCommand(app, 'app.palette');
    await expect(page.getByTestId('palette-input')).toBeFocused();
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as { __learnReleaseImport?: () => void };
      ipcMain.removeHandler('library:import');
      ipcMain.handle('library:import', () => new Promise((resolve) => (g.__learnReleaseImport = () => resolve({ ok: true, data: [] }))));
    });
    await dropSource(page, [PDF]);
    await drag(page, 'drop', 'source', { repeat: false });
    await expect(page.getByTestId('palette-busy')).toBeVisible(); // the held palette (defensive branch, Task 11)
    await expectNoSeriousA11y(page, 'palette while an import holds the window');
    for (const key of ['F6', 'Shift+F6']) {
      await page.keyboard.press(key);
      await expect(page.getByTestId('palette-input')).toBeFocused();
    }
    await app.evaluate(() => (globalThis as { __learnReleaseImport?: () => void }).__learnReleaseImport?.());
    await expect(page.getByTestId('palette-busy')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the settings window is one pane: F6 neither throws nor moves the focus to another window', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const errors: string[] = [];
  try {
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    settings.on('pageerror', (e) => errors.push(e.message));
    page.on('pageerror', (e) => errors.push(e.message));
    // expectWindow returns once the page has rendered; the window shows (and takes the focus) after its measure and font
    // wait, 120–150 ms later here. Start from there: the question is whether F6 moves the focus away from it.
    await expect.poll(() => focusedWindow(app)).toBe('settings');
    await settings.keyboard.press('Tab');
    const before = await settings.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? null);
    expect(before).toMatch(/^theme-tile-/);
    for (const key of ['F6', 'Shift+F6']) {
      await settings.keyboard.press(key);
      expect(await settings.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? null)).toBe(before);
      expect(await focusedWindow(app)).toBe('settings');
    }
    expect(await inPane(page)).toBeNull(); // nothing moved in the main window either
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('the video reader: axe (captions arrive in M8, so video-caption is off) and F6 lands on the player', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [MP4]);
    await openItem(page, 'sample-h264-aac');
    await expect(page.getByTestId('video')).toBeVisible();
    await expectNoSeriousA11y(page, 'video reader');
    await page.keyboard.press('F6'); // sidebar
    await page.keyboard.press('F6'); // content: the player
    expect(await focusedTestId(page)).toBe('video');
  } finally {
    await app.close();
  }
});

test('fatal screen: Tab reaches 설정 열기, Enter opens the settings window; axe passes', async ({}, testInfo) => {
  const lib = testInfo.outputPath('broken');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'library.sqlite'), 'not a database');
  const { app, page } = await launch(lib, testInfo.outputPath('userdata'));
  try {
    await expect(page.getByTestId('fatal-settings')).toBeVisible();
    await expectNoSeriousA11y(page, 'fatal screen');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('fatal-settings')).toBeFocused();
    const settings = await expectWindow(app, 'settings', () => page.keyboard.press('Enter'));
    await expect(settings.getByTestId('library-choose')).toBeVisible();
  } finally {
    await app.close();
  }
});

// The rescue takes only what a fold takes away: the palette's field, gone as the palette closed, is not "rescued" by
// the next fold onto the toolbar toggle (with its keyboard tooltip) — Task 8 critique m1, evidence m3-04.
test('a menu toggle after the palette closed moves no focus and pops no tooltip', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await runMenuCommand(app, 'app.palette');
    await page.keyboard.type('ㄱㅈㅇ');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toHaveCount(0);
    for (const state of ['hidden', 'shown']) {
      await runMenuCommand(app, 'view.toggleSidebar');
      await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', state);
      await page.waitForTimeout(300);
      expect(await page.getByRole('tooltip').count()).toBe(0);
      expect(await page.evaluate(() => document.activeElement?.id ?? null)).not.toMatch(/sidebar-toggle$/);
    }
  } finally {
    await app.close();
  }
});

// F6 right after ⌃⌘S folds the sidebar: the rescue (a frame later) must not take back the focus F6 just placed (CI run
// 39703278904). The page's animation frames are held so the order is the late one every time.
test('a fold rescue that arrives after F6 leaves the focus where F6 put it', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('sidebar');
    await page.evaluate(() => {
      const held: FrameRequestCallback[] = [];
      (window as unknown as { __held: FrameRequestCallback[] }).__held = held;
      window.requestAnimationFrame = (cb) => held.push(cb);
    });
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('content');
    const released = await page.evaluate(() => {
      const held = (window as unknown as { __held: FrameRequestCallback[] }).__held;
      for (const cb of held.splice(0)) cb(performance.now());
      return held.length === 0;
    });
    expect(released).toBe(true);
    expect(await inPane(page)).toBe('content');
  } finally {
    await app.close();
  }
});

// Review minor 3: the rescue moves only a focus the fold took. A sidebar row the user had already left (a click on
// nothing) is not "rescued" onto the toggle by a later fold, even when the keyboard was used since.
test('a fold after the user left the sidebar row moves no focus', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const zoom = async (f: number) => (await mainWindow(app)).evaluate((w, f) => w.webContents.setZoomFactor(f), f);
  try {
    await page.keyboard.press('F6');
    expect(await focusedTestId(page)).toBe('nav-library');
    await page.getByTestId('content').click({ position: { x: 300, y: 300 } }); // nothing there takes the focus
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.keyboard.press('ArrowDown'); // the keyboard is in use again, on nothing
    await zoom(2);
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  } finally {
    await app.close();
  }
});

// Carried from the Task 4/5 ledger: when the sidebar folds by itself (the content column would get narrower than 520:
// 200 % zoom, design-spec 8.3; the 960 px minimum window alone never folds a 240 px sidebar), a keyboard user's focus
// inside it goes to the toolbar's toggle, never to <body>; when it comes back, to the sidebar's own toggle.
test('a sidebar that folds by itself hands a keyboard focus to the toolbar toggle, and back', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const zoom = async (f: number) => (await mainWindow(app)).evaluate((w, f) => w.webContents.setZoomFactor(f), f);
  try {
    await page.getByTestId('content').click({ position: { x: 5, y: 5 } }); // a pointer user first…
    await page.keyboard.press('F6'); // …who now navigates by keyboard: F6 counts as keyboard input
    expect(await focusedTestId(page)).toBe('nav-library');
    await zoom(2);
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await expect(page.getByTestId('toolbar-sidebar-toggle')).toBeFocused();
    await zoom(1);
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
    await expect(page.getByTestId('sidebar-toggle')).toBeFocused();
  } finally {
    await app.close();
  }
});
