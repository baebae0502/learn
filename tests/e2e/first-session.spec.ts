import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, launch, openItem, stubOpenDialog } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const BAD = path.join(FIXTURES, 'sample-mpeg4part2.mp4');

test.beforeAll(() => {
  for (const f of [PDF, KO_PDF, MP4, BAD]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

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
  await page.screenshot({ path: testInfo.outputPath('03-video.png') });
  await page.getByTestId('viewer-back').click();

  // Unsupported codec → explained, not silent
  await openItem(page, 'sample-mpeg4part2');
  await expect(page.getByTestId('video-error')).toContainText('코덱');
  await page.screenshot({ path: testInfo.outputPath('04-unsupported.png') });
  await page.getByTestId('viewer-back').click();

  // Crash and restart (AC06 partial: saved state survives a hard kill)
  app.process().kill('SIGKILL');
  ({ app, page } = await launch(lib, ud));
  await expect(page.getByTestId('item-row')).toHaveCount(4);
  await openItem(page, 'sample');
  await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  await app.close();
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
