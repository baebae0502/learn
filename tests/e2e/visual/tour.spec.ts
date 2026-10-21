// Visual tour: Linux baseline screenshots of every shell state, light and dark (quality spec M3).
// Baselines: tests/e2e/visual/tour.spec.ts-snapshots/*-linux.png. Update with
//   pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts --update-snapshots
// @2x captures for the design critic: LEARN_TOUR_2X=1 pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts → test-results/tour/
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, importPaths, runMenuCommand } from '../helpers';
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

/**
 * The pre-M3 list (until Task 5) sizes its columns from their text, so the import time's minutes move every column
 * even under the mask: pin the text of its date cells. No-op once the fixed-grid table of Task 5 replaces it.
 */
const pinOldListDates = (page: Page) =>
  page.locator('table.items td:last-child').evaluateAll((cells) => {
    for (const cell of cells) cell.textContent = '2026. 10. 21. 오전 09:24';
  });

test('shell frame: library and collapsed sidebar', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const dates = () => [s.page.locator('[data-col="added"], table.items td:last-child')];
  try {
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf'), path.join(FIXTURES, '한글 경로 (테스트) #1.pdf'), path.join(FIXTURES, 'sample-h264-aac.mp4')]);
    await expect(s.page.getByTestId('item-row')).toHaveCount(3);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await pinOldListDates(s.page);
      await shoot(s.page, `shell-${theme}`, { mask: dates() });
      await runMenuCommand(s.app, 'view.toggleSidebar');
      await pinOldListDates(s.page);
      await shoot(s.page, `shell-collapsed-${theme}`, { mask: dates() });
      await runMenuCommand(s.app, 'view.toggleSidebar');
    }
  } finally {
    await s.app.close();
  }
});
