// The video stage's full screen (spec 6.6, 9.1): main changes the window's full screen one step at a time, the last wish
// winning, and reports the stage in the window state. No screen draws it yet: the page's window.learn.ui.stage, main's
// stageState hook, and <html data-video-stage>.
import { expect, test, type Page } from '@playwright/test';
import { launch, mainWindow, stageState } from './helpers';

const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;
const askStage = (page: Page, action: 'toggle' | 'exit') => page.evaluate((action) => window.learn.ui.stage({ action }), action);
/** What the page reads of the stage when it asks main (ui.windowState). */
const pageStage = (page: Page) => page.evaluate(() => window.learn.ui.windowState().then((r) => (r.ok ? r.data.stage : null)));
const OFF = { stage: false, fullScreen: false, pending: false };
const ON = { stage: true, fullScreen: true, pending: false };

test('a toggle puts the window in full screen and the stage on; the page hears it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    expect(await stageState(app)).toEqual(OFF);
    await expect(page.locator('html')).not.toHaveAttribute('data-video-stage');
    expect(await askStage(page, 'toggle')).toEqual({ ok: true, data: undefined });
    await expect.poll(() => stageState(app)).toEqual(ON);
    await expect(page.locator('html')).toHaveAttribute('data-video-stage', '');
    await expect(page.locator('html')).toHaveAttribute('data-fullscreen', '');
    expect(await pageStage(page)).toBe(true);
  } finally {
    await app.close();
  }
});

test('five toggles 50 ms apart settle on the last wish: the stage and the full screen agree', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    expect(await askStage(page, 'toggle')).toEqual({ ok: true, data: undefined });
    // The first toggle took: its change is in flight or has landed, before "nothing in flight" is waited for below.
    await expect.poll(() => stageState(app).then((s) => s.pending || s.stage)).toBe(true);
    // Four more as quick key presses: the 50 ms gaps are the input itself, not a wait for the app.
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const r = await window.learn.ui.stage({ action: 'toggle' });
        if (!r.ok) throw new Error(`ui.stage failed: ${r.code}`);
      }
    });
    await expect.poll(() => stageState(app).then((s) => s.pending)).toBe(false);
    const settled = await stageState(app);
    expect(settled.stage).toBe(settled.fullScreen);
    expect(settled).toEqual(ON); // five toggles from a window: on
    await expect(page.locator('html')).toHaveAttribute('data-video-stage', '');
    expect(await pageStage(page)).toBe(true);
  } finally {
    await app.close();
  }
});

test('exit ends the stage and the full screen it brought; with no stage it does nothing', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await askStage(page, 'toggle');
    await expect.poll(() => stageState(app)).toEqual(ON);
    await expect(page.locator('html')).toHaveAttribute('data-video-stage', '');
    expect(await askStage(page, 'exit')).toEqual({ ok: true, data: undefined });
    await expect.poll(() => stageState(app)).toEqual(OFF);
    await expect(page.locator('html')).not.toHaveAttribute('data-video-stage');
    expect(await pageStage(page)).toBe(false);
    // A second exit has nothing to end: main asks no change of the window (it would be in flight at once).
    expect(await askStage(page, 'exit')).toEqual({ ok: true, data: undefined });
    expect(await stageState(app)).toEqual(OFF);
  } finally {
    await app.close();
  }
});

test('the window leaving full screen by itself (the traffic light) ends the stage', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await askStage(page, 'toggle');
    await expect.poll(() => stageState(app)).toEqual(ON);
    await expect(page.locator('html')).toHaveAttribute('data-video-stage', '');
    await (await mainWindow(app)).evaluate((w) => w.setFullScreen(false));
    await expect.poll(() => stageState(app)).toEqual(OFF);
    await expect(page.locator('html')).not.toHaveAttribute('data-video-stage');
    await expect(page.locator('html')).not.toHaveAttribute('data-fullscreen');
    expect(await pageStage(page)).toBe(false);
  } finally {
    await app.close();
  }
});
