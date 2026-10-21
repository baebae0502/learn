// Visual tour: Linux baseline screenshots of every shell state, light and dark (quality spec M3).
// Baselines: tests/e2e/visual/tour.spec.ts-snapshots/*-linux.png. Update with
//   pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts --update-snapshots
// @2x captures for the design critic: LEARN_TOUR_2X=1 pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts → test-results/tour/
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES, closeSheet, expectWindow, importFiles, importPaths, menuItemEnabled, openItem, runMenuCommand } from '../helpers';
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

test('readers: PDF, unplayable video, PDF that cannot be opened, missing original', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  try {
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf'), path.join(FIXTURES, 'sample-mpeg4part2.mp4')]);
    const broken = testInfo.outputPath('broken.pdf');
    fs.writeFileSync(broken, '%PDF-1.4\n% not a real document\n%%EOF\n'); // passes the import's type check, pdf.js rejects it
    await importPaths(s.page, [broken]);
    const gone = testInfo.outputPath('gone.pdf');
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
      await expect(s.page.getByTestId('video-error')).toBeVisible();
      await shoot(s.page, `reader-codec-${theme}`);
      await s.page.getByTestId('viewer-back').click();
      await openItem(s.page, 'broken');
      await expect(s.page.getByTestId('pdf-error')).toBeVisible();
      await shoot(s.page, `reader-error-${theme}`);
      await s.page.getByTestId('viewer-back').click();
      await openItem(s.page, 'gone');
      await expect(s.page.getByTestId('missing-notice')).toBeVisible();
      // The path line differs per test folder.
      await shoot(s.page, `reader-missing-${theme}`, { mask: [s.page.getByTestId('missing-notice').locator('.file')] });
      await s.page.getByTestId('missing-back').click();
      await expect(s.page.getByTestId('library-table')).toBeVisible();
    }
  } finally {
    await s.app.close();
  }
});

test('fatal: the library cannot be opened', async ({}, testInfo) => {
  // launchTour opens <dir>/library: an unreadable database there gives the fatal screen at the tour's window size.
  const lib = testInfo.outputPath('library');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'library.sqlite'), 'not a database');
  const s = await launchTour(testInfo.outputPath());
  try {
    await expect(s.page.getByTestId('fatal-notice')).toBeVisible();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      // The file line holds the test folder's path.
      await shoot(s.page, `fatal-${theme}`, { mask: [s.page.getByTestId('fatal-notice').locator('.file')] });
    }
  } finally {
    await s.app.close();
  }
});
