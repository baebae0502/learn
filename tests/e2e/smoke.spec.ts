import { expect, test } from '@playwright/test';
import { launch } from './helpers';

test('app boots with a sandboxed renderer on learn://app and migrates the library', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  expect(page.url()).toBe('learn://app/index.html');
  const isolated = await page.evaluate(() => typeof (globalThis as { require?: unknown }).require === 'undefined' && typeof window.learn === 'object');
  expect(isolated).toBe(true);
  const info = await page.evaluate(() => window.learn.appInfo());
  expect(info).toMatchObject({ ok: true, data: { schemaVersion: 1, libraryError: null } });
  await page.screenshot({ path: testInfo.outputPath('smoke.png') });
  await app.close();
});
