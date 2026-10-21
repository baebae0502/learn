// Visual tour: Linux baseline screenshots of every shell state, light and dark (quality spec M3).
// Baselines: tests/e2e/visual/tour.spec.ts-snapshots/*-linux.png. Update with
//   pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts --update-snapshots
// @2x captures for the design critic: LEARN_TOUR_2X=1 pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts → test-results/tour/
import { test } from '@playwright/test';
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
