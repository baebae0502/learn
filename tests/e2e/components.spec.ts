// UI primitives in the real renderer (component state board, ?window=gallery).
import { expect, test } from '@playwright/test';
import { launch } from './helpers';

test('a disabled control explains itself through the native tooltip of its box-less wrapper (M-2)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await page.goto('learn://app/index.html?window=gallery&part=1&platform=linux');
    for (const id of ['g-secondary-disabled', 'g-icon-disabled']) {
      const control = page.getByTestId(id);
      const wrapper = page.getByTestId(`${id}-reason`);
      await expect(control).toBeDisabled();
      await expect(wrapper).toHaveAttribute('title', '열린 자료가 없습니다.');
      await expect(wrapper).toHaveCSS('display', 'contents');
      // Chromium's title tooltip comes from the nearest ancestor with a title of the node under the pointer.
      const box = (await control.boundingBox())!;
      const title = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x!, y!)?.closest('[title]')?.getAttribute('title') ?? null,
        [box.x + box.width / 2, box.y + box.height / 2],
      );
      expect(title).toBe('열린 자료가 없습니다.');
    }
    // Enabled samples get no wrapper and no title.
    await expect(page.locator('.disabled-reason')).toHaveCount(6);
    await expect(page.locator('.btn:not([disabled])[title], .disabled-reason:not([title])')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
