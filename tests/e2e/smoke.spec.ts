import { expect, test } from '@playwright/test';
import { launch, tutorProcesses } from './helpers';
import { LATEST_SCHEMA_VERSION } from '../../packages/db/src/migrations/index';

test('app boots with a sandboxed renderer on learn://app and migrates the library', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const url = new URL(page.url());
  expect(`${url.protocol}//${url.host}${url.pathname}`).toBe('learn://app/index.html');
  expect(url.searchParams.get('window')).toBe('main');
  expect(['linux', 'darwin', 'win32']).toContain(url.searchParams.get('platform'));
  const isolated = await page.evaluate(() => typeof (globalThis as { require?: unknown }).require === 'undefined' && typeof window.learn === 'object');
  expect(isolated).toBe(true);
  const info = await page.evaluate(() => window.learn.app.info());
  expect(info).toMatchObject({ ok: true, data: { version: '0.1.0', schemaVersion: LATEST_SCHEMA_VERSION, libraryError: null } });
  await page.screenshot({ path: testInfo.outputPath('smoke.png') });
  await app.close();
});

test('bundled Pretendard loads through the app protocol (font MIME)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const faces = await page.evaluate(async () => (await document.fonts.load('13px "Pretendard Variable"', '가')).length);
  expect(faces).toBeGreaterThan(0);
  await app.close();
});

test('the tutor starts nothing before consent: no agent process, and its report asks for consent first (AC20)', async ({}, testInfo) => {
  // The positive control for a count of 0 is tutor-scope.spec's 'one process' (1 once warmed).
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    expect(await tutorProcesses(app)).toEqual({ count: 0, max: 0, conversationIds: [] });
    expect(await page.evaluate(() => window.learn.tutor.agents({ mode: 'cached' }))).toMatchObject({ ok: false, code: 'TUTOR_CONSENT_REQUIRED' });
    expect(await page.evaluate(() => window.learn.tutor.ask({
      itemId: '3f2b8c1e-5d4a-4b6f-8a9e-1c2d3e4f5a6b', conversationId: null, text: '안녕하세요', selection: null,
      reader: { pageIndex: 0, pageCount: 1, outline: [], outlineComplete: true, outlineTotal: 0 },
    }))).toMatchObject({ ok: false, code: 'TUTOR_CONSENT_REQUIRED' });
    expect(await tutorProcesses(app)).toEqual({ count: 0, max: 0, conversationIds: [] });
  } finally {
    await app.close();
  }
});
