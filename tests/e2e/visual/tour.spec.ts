// Visual tour: Linux baseline screenshots of every shell state, light and dark (quality spec M3).
// Baselines: tests/e2e/visual/tour.spec.ts-snapshots/*-linux.png. Update with
//   pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts --update-snapshots
// @2x captures for the design critic: LEARN_TOUR_2X=1 pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts → test-results/tour/
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES, importFiles, importPaths, runMenuCommand } from '../helpers';
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

test('library: empty, list, collapsed sidebar, failure toast', async ({}, testInfo) => {
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
    await importFiles(s, [path.join(FIXTURES, 'sample.pdf')]); // duplicate → the pre-M3 dialog, skip it
    await s.page.getByTestId('dup-cancel').click();
    const txt = testInfo.outputPath('notes.txt');
    fs.writeFileSync(txt, 'x');
    await importFiles(s, [txt]);
    await expect(s.page.getByTestId('import-failures')).toBeVisible();
    await shoot(s.page, 'toast-failure-light', { mask: dates() });
  } finally {
    await s.app.close();
  }
});
