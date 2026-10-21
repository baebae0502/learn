import { expect, test } from '@playwright/test';
import { launch } from './helpers';

test('app boots with a sandboxed renderer on learn://app and migrates the library', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  expect(page.url()).toBe('learn://app/index.html');
  const isolated = await page.evaluate(() => typeof (globalThis as { require?: unknown }).require === 'undefined' && typeof window.learn === 'object');
  expect(isolated).toBe(true);
  const info = await page.evaluate(() => window.learn.app.info());
  expect(info).toMatchObject({ ok: true, data: { version: '0.1.0', schemaVersion: 2, libraryError: null } });
  await page.screenshot({ path: testInfo.outputPath('smoke.png') });
  await app.close();
});

test('bundled Pretendard loads through the app protocol (font MIME)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const faces = await page.evaluate(async () => (await document.fonts.load('13px "Pretendard Variable"', '가')).length);
  expect(faces).toBeGreaterThan(0);
  await app.close();
});
