import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { FIXTURES, launch, openItem, stubOpenDialog } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const BAD = path.join(FIXTURES, 'sample-mpeg4part2.mp4');

test.beforeAll(() => {
  for (const f of [PDF, KO_PDF, MP4, BAD]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

const IS_MAC = process.platform === 'darwin';

const windowIsFullScreen = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.isFullScreen());

/** Arm a main-process flag that flips when the window's 'enter-full-screen' fires (end of the macOS transition). */
async function armEnterFullScreen(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const g = globalThis as { __learnEnteredFullScreen?: boolean };
    g.__learnEnteredFullScreen = false;
    BrowserWindow.getAllWindows()[0]!.once('enter-full-screen', () => {
      g.__learnEnteredFullScreen = true;
    });
  });
}

const enteredFullScreen = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { __learnEnteredFullScreen?: boolean }).__learnEnteredFullScreen === true);

/**
 * Enter and leave HTML fullscreen on `video`. On macOS the window animates into its own Space; exiting
 * during that transition never settles (see the darwin-only test below), so wait for it to finish first.
 */
async function toggleFullscreen(app: ElectronApplication, page: Page, video: Locator): Promise<void> {
  await armEnterFullScreen(app);
  await video.evaluate((v: HTMLVideoElement) => v.requestFullscreen());
  await expect.poll(() => windowIsFullScreen(app)).toBe(true);
  expect(await video.evaluate((v: HTMLVideoElement) => document.fullscreenElement === v)).toBe(true);
  if (IS_MAC) {
    const settled = await expect
      .poll(() => enteredFullScreen(app), { timeout: 5_000 })
      .toBe(true)
      .then(() => true, () => false);
    // 'enter-full-screen' marks the end of the transition; without it fall back to a bounded wait.
    await page.waitForTimeout(settled ? 250 : 1_500);
  }
  const exiting = page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => windowIsFullScreen(app)).toBe(false);
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await exiting;
}

async function inkedPixels(page: Page): Promise<{ dark: number; white: number }> {
  return page.getByTestId('pdf-canvas').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    let white = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 255) continue;
      if (d[i]! < 100 && d[i + 1]! < 100 && d[i + 2]! < 100) dark++;
      else if (d[i]! > 245 && d[i + 1]! > 245 && d[i + 2]! > 245) white++;
    }
    return { dark, white };
  });
}

test('import → open PDF and video → unsupported codec notice → survive SIGKILL', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);

  await stubOpenDialog(app, [PDF, KO_PDF, MP4, BAD]);
  await page.getByTestId('import-managed').click();
  await expect(page.getByTestId('item-row')).toHaveCount(4);
  await page.screenshot({ path: testInfo.outputPath('01-library.png') });

  // PDF
  await openItem(page, 'sample');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  const ink = await inkedPixels(page);
  console.log('[measure] pdf page1 ink', JSON.stringify(ink));
  expect(ink.dark).toBeGreaterThan(300);
  expect(ink.white).toBeGreaterThan(10000);
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText('1 / 3쪽');
  await page.getByTestId('pdf-next').click();
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText('2 / 3쪽');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[2-9]\d*$/);
  const rotated = await page.getByTestId('pdf-canvas').evaluate((c: HTMLCanvasElement) => c.width > c.height);
  expect(rotated).toBe(true); // page 2 is rotated 90°
  await page.screenshot({ path: testInfo.outputPath('02-pdf.png') });
  await page.getByTestId('viewer-back').click();

  // Korean path PDF
  await openItem(page, '한글 경로 (테스트) #1');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  await page.getByTestId('viewer-back').click();

  // Video: play + seek accuracy (AC05 target ≤ 500 ms)
  await openItem(page, 'sample-h264-aac');
  const video = page.getByTestId('video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  const seek = await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
    const target = 7.3;
    const t0 = performance.now();
    v.currentTime = target;
    await new Promise((resolve) => v.addEventListener('seeked', resolve, { once: true }));
    v.pause();
    return { errorMs: Math.abs(v.currentTime - target) * 1000, seekMs: performance.now() - t0, width: v.videoWidth, height: v.videoHeight };
  });
  testInfo.annotations.push({ type: 'seek', description: JSON.stringify(seek) });
  console.log('[measure] video seek', JSON.stringify(seek));
  expect(seek.width).toBe(1280);
  expect(seek.errorMs).toBeLessThanOrEqual(500);
  // Fullscreen must be permitted for our own pages (enter, then leave cleanly)
  await toggleFullscreen(app, page, video);
  await page.screenshot({ path: testInfo.outputPath('03-video.png') });
  await page.getByTestId('viewer-back').click();

  // Unsupported codec → explained, not silent
  await openItem(page, 'sample-mpeg4part2');
  await expect(page.getByTestId('video-error')).toContainText('코덱');
  await page.screenshot({ path: testInfo.outputPath('04-unsupported.png') });
  await page.getByTestId('viewer-back').click();

  // Crash and restart (AC06 partial: saved state survives a hard kill)
  const proc = app.process();
  const exited = new Promise((r) => proc.once('exit', r));
  proc.kill('SIGKILL');
  await exited;
  ({ app, page } = await launch(lib, ud));
  await expect(page.getByTestId('item-row')).toHaveCount(4);
  await openItem(page, 'sample');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  await app.close();
});

// Characterisation, not the user journey: on macOS, exiting while the native fullscreen transition is still
// running leaves document.exitFullscreen() unsettled and the page stuck in fullscreen (M0 runs 39442173392,
// 39443865113, 39444862608). Expected to fail; when Electron fixes it this reports an unexpected pass.
test('macOS: exiting fullscreen during the enter transition settles', async ({}, testInfo) => {
  test.skip(!IS_MAC, 'native macOS fullscreen transition only');
  test.fail(true, 'known Electron 44 / macOS race: exitFullscreen() during the enter transition never settles');
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await stubOpenDialog(app, [MP4]);
    await page.getByTestId('import-managed').click();
    await openItem(page, 'sample-h264-aac');
    const video = page.getByTestId('video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
    await video.evaluate((v: HTMLVideoElement) => v.requestFullscreen());
    const outcome = await Promise.race([
      page.evaluate(() => document.exitFullscreen()).then(() => 'settled'),
      new Promise<string>((r) => setTimeout(() => r('unsettled after 10 s'), 10_000)),
    ]);
    expect(outcome).toBe('settled');
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null), { timeout: 5_000 }).toBe(true);
  } finally {
    await app.close().catch(() => {});
  }
});

test('PDF zoom levels keep rendering', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  await stubOpenDialog(app, [PDF]);
  await page.getByTestId('import-managed').click();
  await openItem(page, 'sample');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  const width100 = await page.getByTestId('pdf-canvas').evaluate((c: HTMLCanvasElement) => c.clientWidth);
  await page.getByTestId('pdf-zoom').selectOption('2');
  await expect.poll(() => page.getByTestId('pdf-canvas').evaluate((c: HTMLCanvasElement) => c.clientWidth)).toBeGreaterThan(width100 * 1.9);
  await page.getByTestId('pdf-zoom').selectOption('0.5');
  await expect.poll(() => page.getByTestId('pdf-canvas').evaluate((c: HTMLCanvasElement) => c.clientWidth)).toBeLessThan(width100 * 0.6);
  await app.close();
});

test('rapid page and zoom changes never surface a render error', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  await stubOpenDialog(app, [PDF]);
  await page.getByTestId('import-managed').click();
  await openItem(page, 'sample');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  await page.getByTestId('pdf-next').click({ noWaitAfter: true });
  await page.getByTestId('pdf-next').click({ noWaitAfter: true });
  await page.getByTestId('pdf-prev').click({ noWaitAfter: true });
  await page.getByTestId('pdf-zoom').selectOption('2');
  await page.getByTestId('pdf-zoom').selectOption('0.5');
  await page.getByTestId('pdf-zoom').selectOption('1');
  await expect(page.getByTestId('pdf-page-indicator')).toHaveText('2 / 3쪽');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  await expect(page.getByTestId('pdf-error')).toHaveCount(0);
  await expect.poll(async () => (await inkedPixels(page)).dark).toBeGreaterThan(300);
  await expect(page.getByTestId('pdf-error')).toHaveCount(0);
  await app.close();
});
