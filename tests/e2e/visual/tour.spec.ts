// Visual tour: Linux baseline screenshots of every shell state, light and dark (quality spec M3).
// Baselines: tests/e2e/visual/tour.spec.ts-snapshots/*-linux.png. Update with
//   pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts --update-snapshots
// @2x captures for the design critic: LEARN_TOUR_2X=1 pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts → test-results/tour/
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES, closeSheet, expectWindow, importFiles, importPaths, mainWindow, menuItemEnabled, openItem, runMenuCommand, type Session } from '../helpers';
import { THEMES, launchTour, setTheme, shoot } from './tour';

test.skip(process.platform !== 'linux', 'Linux baselines only; macOS chrome is captured by tests/evidence/shell.evidence.ts');

test('component state board (gallery parts 1–2)', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  try {
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      for (const part of [1, 2]) {
        await s.page.goto(`learn://app/index.html?window=gallery&part=${part}&platform=linux&det=1`);
        await s.page.getByTestId('gallery').waitFor();
        await shoot(s.page, `gallery${part}-${theme}`);
      }
    }
  } finally {
    await s.app.close();
  }
});

const LIBRARY = ['sample.pdf', '한글 경로 (테스트) #1.pdf', 'sample-h264-aac.mp4', 'sample-mpeg4part2.mp4'].map((f) => path.join(FIXTURES, f));

test('library: empty, list, collapsed sidebar, failure toasts', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const dates = () => [s.page.locator('[data-col="added"]')];
  try {
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `empty-${theme}`);
    }
    await importPaths(s.page, LIBRARY);
    // A linked file that went missing: the row shows the link mark and the 파일 없음 flag.
    const gone = testInfo.outputPath('gone.pdf');
    fs.copyFileSync(LIBRARY[0]!, gone);
    await s.page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'linked', allowDuplicate: true }), gone);
    fs.rmSync(gone);
    await s.page.evaluate(async () => {
      const list = await window.learn.library.list();
      if (list.ok) for (const i of list.data) await window.learn.library.get({ itemId: i.id });
    });
    await expect(s.page.getByTestId('missing-flag')).toHaveCount(1);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `library-${theme}`, { mask: dates() });
      await runMenuCommand(s.app, 'view.toggleSidebar');
      await shoot(s.page, `library-collapsed-${theme}`, { mask: dates() });
      await runMenuCommand(s.app, 'view.toggleSidebar');
    }
    await setTheme(s.page, 'light');
    // A duplicate opens the duplicate sheet (shot in its own test below): close it, which skips.
    const dup = await expectWindow(s.app, 'sheet', () => importFiles(s, [path.join(FIXTURES, 'sample.pdf')]));
    await closeSheet(dup, 'Escape');
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged')).toBe(true);
    const txt = testInfo.outputPath('notes.txt');
    fs.writeFileSync(txt, 'x');
    await importFiles(s, [txt]);
    await expect(s.page.getByTestId('import-failures')).toBeVisible();
    await shoot(s.page, 'toast-failure-light', { mask: dates() });
    // Several files with one cause: three one-line rows (a long name is cut, its cause stays), "외 2개", the advice once.
    await s.page.getByTestId('import-failures').getByTestId('toast-close').click();
    await expect(s.page.getByTestId('import-failures')).toHaveCount(0);
    await setTheme(s.page, 'dark');
    const names = ['세포 신호 전달 강의 녹음 메모 — 3주차 정리본 (최종).txt', 'notes.txt', 'slides.key', 'draft.docx', 'archive.zip'];
    const files = names.map((n) => {
      const f = testInfo.outputPath(n);
      fs.writeFileSync(f, 'x');
      return f;
    });
    await importFiles(s, files);
    await expect(s.page.getByTestId('import-failures').locator('.t-line')).toHaveCount(4);
    // The long name is what gets cut; its cause stays whole.
    const long = s.page.getByTestId('import-failures').locator('.t-line').first();
    expect(await long.locator('.t-name').evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    expect(await long.locator('.t-cause').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await shoot(s.page, 'toast-failure-multi-dark', { mask: dates() });
  } finally {
    await s.app.close();
  }
});

test('sheets: duplicate and shortcuts', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  try {
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf')]);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      const dup = await expectWindow(s.app, 'sheet', () => importFiles(s, [path.join(FIXTURES, 'sample.pdf')]));
      await shoot(dup, `sheet-duplicate-${theme}`, { mask: [dup.getByTestId('dup-card').locator('.t-footnote')] });
      await closeSheet(dup, 'Escape');
      await expect.poll(() => menuItemEnabled(s.app, 'app.shortcuts')).toBe(true);
      const keys = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'app.shortcuts'));
      await shoot(keys, `sheet-shortcuts-${theme}`);
      await closeSheet(keys, 'Escape');
      await expect.poll(() => menuItemEnabled(s.app, 'app.shortcuts')).toBe(true);
    }
  } finally {
    await s.app.close();
  }
});

test('palette: empty query, 초성 results, several rows, no results, and the cursor row when the window is not key', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const dates = () => [s.page.locator('[data-col="added"]')];
  const input = s.page.getByTestId('palette-input');
  const cursor = s.page.locator('[data-testid="palette-item"][data-focused]');
  try {
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf')]);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await runMenuCommand(s.app, 'app.palette');
      // Every available command, the cursor on the first (critic T9-M1, T9-n4).
      await expect(cursor).toHaveAttribute('data-command-id', 'file.importManaged');
      await shoot(s.page, `palette-empty-${theme}`, { mask: dates() });
      await input.fill('ㄱㅈㅇ'); // one row: 가져오기 (ㄱㅈ alone also finds 글자 크게 / 작게, Task 10)
      await expect(cursor).toHaveAttribute('data-command-id', 'file.importManaged');
      await shoot(s.page, `palette-${theme}`, { mask: dates() });
      if (theme === 'light') {
        // ㄱ: six rows, the <mark> in accent text on the rows the cursor is not on (설정… by its keyword 글자 크기: no mark).
        await input.fill('ㄱ');
        await expect(s.page.getByTestId('palette-item')).toHaveCount(6);
        await shoot(s.page, 'palette-multi-light', { mask: dates() });
      }
      await input.fill('효소 억제제');
      await expect(s.page.getByTestId('palette-empty')).toBeVisible();
      await shoot(s.page, `palette-none-${theme}`, { mask: dates() });
      await s.page.keyboard.press('Escape');
      await expect(s.page.getByTestId('palette')).toBeHidden();
    }
    // Another window takes the key: the palette stays, its cursor row is the neutral selection (design-spec 3.1).
    await setTheme(s.page, 'light');
    await runMenuCommand(s.app, 'app.palette');
    await input.fill('ㄱ');
    await expect(cursor).toHaveAttribute('data-command-id', 'view.textBigger');
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = new BrowserWindow({ width: 300, height: 200, show: true });
      void w.loadURL('about:blank');
      w.focus();
      (globalThis as { __probeWindow?: unknown }).__probeWindow = w;
    });
    await expect(s.page.locator('html')).toHaveAttribute('data-window-inactive', '');
    await shoot(s.page, 'palette-inactive-light', { mask: dates() });
    await s.app.evaluate(() => (globalThis as { __probeWindow?: { close(): void } }).__probeWindow?.close());
    await (await mainWindow(s.app)).evaluate((w) => w.focus());
    await expect(s.page.locator('html')).not.toHaveAttribute('data-window-inactive', '');
  } finally {
    await s.app.close();
  }
});

test('drop overlay: copy and ⌥ link, and in a window that is neither key nor main', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const files: Array<[string, string]> = [
    ['a.pdf', 'application/pdf'],
    ['b.pdf', 'application/pdf'],
    ['c.mp4', 'video/mp4'],
  ];
  const fire = (type: 'dragenter' | 'dragover' | 'dragleave', altKey: boolean) =>
    s.page.evaluate(
      ({ type, files, altKey }) => {
        const dt = new DataTransfer();
        for (const [n, m] of files) dt.items.add(new File(['x'], n, { type: m }));
        document.body.dispatchEvent(new DragEvent(type, { dataTransfer: dt, altKey, bubbles: true, cancelable: true }));
      },
      { type, files, altKey },
    );
  const overlay = s.page.getByTestId('drop-overlay');
  try {
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await fire('dragenter', false);
      await expect(overlay).toHaveAttribute('data-mode', 'copy');
      await shoot(s.page, `drop-${theme}`);
      if (theme === 'light') {
        await fire('dragover', true);
        await expect(overlay).toHaveAttribute('data-mode', 'link');
        await shoot(s.page, 'drop-link-light');
        // A drag from Finder arrives while Finder is the active app: the window is neither key nor main (forced, as
        // main sets them). The chrome above recedes; the overlay's ring, tile and current card do not.
        await fire('dragover', false);
        await s.page.evaluate(() => {
          document.documentElement.setAttribute('data-window-inactive', '');
          document.documentElement.setAttribute('data-window-not-main', '');
        });
        await expect(overlay).toHaveAttribute('data-mode', 'copy');
        await shoot(s.page, 'drop-inactive-light');
        await s.page.evaluate(() => {
          document.documentElement.removeAttribute('data-window-inactive');
          document.documentElement.removeAttribute('data-window-not-main');
        });
      }
      await fire('dragleave', false);
      await expect(overlay).toHaveCount(0);
    }
  } finally {
    await s.app.close();
  }
});

/** The settings window's BrowserWindow, evaluated in main. */
const settingsWindow = (app: Session['app']) =>
  app.evaluateHandle(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('window=settings'))!);

test('settings window (light, dark, focus, not key, a refused folder), compact density, 15 pt text', async ({}, testInfo) => {
  // The library as deep as the default macOS one, under a HOME in the test folder: the path reads the same everywhere.
  const home = tourHome(testInfo.outputPath());
  const s = await launchTour(path.join(home, 'Library', 'Application Support', 'Learn'), { HOME: home });
  const dates = () => [s.page.locator('[data-col="added"]')];
  try {
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf'), path.join(FIXTURES, 'sample-h264-aac.mp4')]);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      const settings = await expectWindow(s.app, 'settings', () => runMenuCommand(s.app, 'app.settings'));
      await expect(settings.getByTestId('library-path')).toHaveText('~/Library/Application Support/Learn/library');
      await shoot(settings, `settings-${theme}`);
      if (theme === 'light') {
        // Keyboard focus on the selected tile: the focus ring 2 px outside the selection ring (critic T10-n5).
        await settings.keyboard.press('Tab');
        await expect(settings.getByTestId('theme-tile-light')).toHaveAttribute('data-focus-visible', 'true');
        await shoot(settings, 'settings-focus-light');
        // Not the key window: no focus ring, and the selection ring turns neutral (design-spec 2.1, 3.1).
        await (await mainWindow(s.app)).evaluate((w) => w.focus());
        await expect(settings.locator('html')).toHaveAttribute('data-window-inactive', '');
        await shoot(settings, 'settings-inactive-light');
        await (await settingsWindow(s.app)).evaluate((w) => w.focus());
        await expect(settings.locator('html')).not.toHaveAttribute('data-window-inactive', '');
        // A folder the user cannot write to: the cause and the next step under the buttons.
        const ro = testInfo.outputPath('read-only');
        fs.mkdirSync(ro, { recursive: true, mode: 0o555 });
        await s.app.evaluate(({ dialog }, dir) => {
          dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
        }, ro);
        await settings.getByTestId('library-choose').click();
        await expect(settings.getByTestId('library-error')).toBeVisible();
        await shoot(settings, 'settings-error-light');
        fs.chmodSync(ro, 0o755);
      }
      await settings.close(); // Playwright's Page.close closes the BrowserWindow
    }
    // The main window is key again (Xvfb has no window manager to hand it back).
    await (await mainWindow(s.app)).evaluate((w) => w.focus());
    await expect(s.page.locator('html')).not.toHaveAttribute('data-window-inactive', '');
    await setTheme(s.page, 'light');
    await s.page.evaluate(() => window.learn.prefs.set({ density: 'compact' }));
    await expect(s.page.locator('html')).toHaveAttribute('data-density', 'compact');
    await shoot(s.page, 'density-compact-light', { mask: dates() });
    await s.page.evaluate(() => window.learn.prefs.set({ density: 'regular', fontSize: 15 }));
    await expect(s.page.locator('html')).toHaveAttribute('data-font-size', '15');
    await shoot(s.page, 'font-15-light', { mask: dates() });
  } finally {
    await s.app.close();
  }
});

/**
 * A home folder inside the test folder (HOME for the app): paths on screen read "~/…" the same on every machine, so
 * the path lines need no mask. Returns its path.
 */
function tourHome(dir: string): string {
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  return home;
}

test('readers: PDF, unplayable video, PDF that cannot be opened, missing original', async ({}, testInfo) => {
  const home = tourHome(testInfo.outputPath());
  const s = await launchTour(home, { HOME: home });
  try {
    // The unplayable fixture is encoded by the machine's ffmpeg (its size differs between Debian and CI's Ubuntu):
    // a copy zero-extended to a fixed size shows the same "293 KB" everywhere and is still refused as MPEG-4 Part 2.
    const unplayable = path.join(home, 'sample-mpeg4part2.mp4');
    fs.copyFileSync(path.join(FIXTURES, 'sample-mpeg4part2.mp4'), unplayable);
    if (fs.statSync(unplayable).size >= 300_000) throw new Error('the MPEG-4 fixture outgrew the tour size');
    fs.truncateSync(unplayable, 300_000);
    const broken = path.join(home, 'broken.pdf');
    fs.writeFileSync(broken, '%PDF-1.4\n% not a real document\n%%EOF\n'); // passes the import's type check, pdf.js rejects it
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf'), unplayable, broken]);
    const gone = path.join(home, 'Downloads', 'gone.pdf');
    fs.mkdirSync(path.dirname(gone), { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, 'sample.pdf'), gone);
    await s.page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'linked', allowDuplicate: true }), gone);
    fs.rmSync(gone);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await openItem(s.page, 'sample');
      await expect(s.page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
      // The page's own text: the sample's non-embedded standard font is drawn with the system's fallback font, which
      // differs between Debian and Ubuntu (CI). The page box, its shadow, the stage and both toolbars stay compared.
      await shoot(s.page, `reader-pdf-${theme}`, { mask: [s.page.getByTestId('pdf-canvas')] });
      await s.page.getByTestId('viewer-back').click();
      await openItem(s.page, 'sample-mpeg4part2');
      await expect(s.page.getByTestId('video-error')).toContainText('이 동영상은 재생할 수 없습니다');
      await shoot(s.page, `reader-codec-${theme}`);
      await s.page.getByTestId('viewer-back').click();
      await openItem(s.page, 'broken');
      await expect(s.page.getByTestId('pdf-error')).toBeVisible();
      await shoot(s.page, `reader-error-${theme}`);
      await s.page.getByTestId('viewer-back').click();
      await openItem(s.page, 'gone');
      await expect(s.page.getByTestId('missing-notice').locator('.file')).toHaveText('~/Downloads/gone.pdf');
      await shoot(s.page, `reader-missing-${theme}`);
      await s.page.getByTestId('missing-back').click();
      await expect(s.page.getByTestId('library-table')).toBeVisible();
    }
  } finally {
    await s.app.close();
  }
});

/** An unreadable database (and one pre-update backup) in `<dir>/library`, which launchTour opens. */
function brokenLibrary(dir: string): void {
  const lib = path.join(dir, 'library');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'library.sqlite'), 'not a database');
  fs.writeFileSync(path.join(lib, 'library.sqlite.pre-v2.bak'), '');
}

test('fatal: the library cannot be opened (a short and a deep library folder)', async ({}, testInfo) => {
  const home = tourHome(testInfo.outputPath());
  // "~/library/library.sqlite.pre-v2.bak" fits one line; a folder as deep as the default macOS library
  // (~/Library/Application Support/Learn/…) wraps after a separator (design-spec 4: no middle elision).
  const cases = [
    { name: 'fatal', dir: home, shown: '~/library/library.sqlite.pre-v2.bak' },
    { name: 'fatal-longpath', dir: path.join(home, 'Library', 'Application Support', 'Learn'), shown: '~/Library/Application Support/Learn/library/library.sqlite.pre-v2.bak' },
  ];
  for (const c of cases) {
    brokenLibrary(c.dir);
    const s = await launchTour(c.dir, { HOME: home });
    try {
      await expect(s.page.getByTestId('fatal-notice').locator('.file')).toHaveText(c.shown);
      for (const theme of THEMES) {
        await setTheme(s.page, theme);
        await shoot(s.page, `${c.name}-${theme}`);
      }
    } finally {
      await s.app.close();
    }
  }
});
