import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import { ROOT, launch, mainWindow, type Session } from '../helpers';

/** @2x captures for the design critic (same size as docs/design/renders, 2880×1800). Not committed. */
export const TOUR_DIR = path.join(ROOT, 'test-results', 'tour');
const TOUR_2X = process.env['LEARN_TOUR_2X'] === '1';

export type TourTheme = 'light' | 'dark';
export const THEMES: readonly TourTheme[] = ['light', 'dark'];

/**
 * Fresh profile, deterministic rendering, a 1440×900 content area at the screen origin. No colour-scheme emulation:
 * the theme pref (setTheme) drives prefers-color-scheme through nativeTheme, the path users take.
 */
export async function launchTour(dir: string, env: Record<string, string> = {}): Promise<Session> {
  const s = await launch(path.join(dir, 'library'), path.join(dir, 'userdata'), { env: { LEARN_DETERMINISTIC: '1', TZ: 'Asia/Seoul', ...env }, colorScheme: null });
  await (await mainWindow(s.app)).evaluate((w) => {
    w.setContentSize(1440, 900);
    w.setPosition(0, 0);
  });
  await expect.poll(() => s.page.evaluate(() => [innerWidth, innerHeight].join('x'))).toBe('1440x900');
  return s;
}

/**
 * A video fixture zero-extended to a fixed size, kept under its own name (the title comes from it). The fixtures are
 * encoded by the machine's ffmpeg, whose output size differs between this server's Debian and CI's Ubuntu, and the
 * table shows sizes in decimal units (critic T14-n8), where a few hundred bytes can change the figure. The header is
 * intact, so it imports as the same kind (and the MPEG-4 Part 2 file is still refused by the player).
 */
export function fixedSizeCopy(src: string, dir: string, bytes: number): string {
  fs.mkdirSync(dir, { recursive: true });
  const copy = path.join(dir, path.basename(src));
  fs.copyFileSync(src, copy);
  if (fs.statSync(copy).size > bytes) throw new Error(`${path.basename(src)} outgrew its tour size (${bytes} B)`);
  fs.truncateSync(copy, bytes);
  return copy;
}

/** The tour's video sizes: 4.2 MB and 300 KB wherever they are shown. */
export const TOUR_VIDEO_BYTES = { h264: 4_200_000, mpeg4: 300_000 } as const;

export async function setTheme(page: Page, theme: TourTheme): Promise<void> {
  await page.evaluate((t) => window.learn.prefs.set({ theme: t }), theme);
  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark');
}

/** Fonts loaded, two frames painted, pointer parked in a corner that hovers nothing. */
export async function settle(page: Page): Promise<void> {
  await page.mouse.move(1439, 899);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });
}

/**
 * Optional @2x capture for the critic (LEARN_TOUR_2X=1) + committed 1x baseline (Linux). The @2x shot comes first:
 * a state that differs from its baseline still reaches the critic (R-2). Critic captures run without updating; the
 * baselines are updated by the 1x run only (README).
 */
export async function shoot(page: Page, name: string, opts: { mask?: Locator[] } = {}): Promise<void> {
  if (TOUR_2X) await capture2x(page, name);
  await settle(page);
  // Tight on purpose: at most 300 pixels may differ by more than the default per-pixel threshold (0.2), so a moved
  // or recoloured 2 px focus ring fails while the Debian ↔ Ubuntu font raster noise passes (verified on CI, I2).
  await expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', mask: opts.mask, maxDiffPixels: 300, threshold: 0.2 });
}

async function capture2x(page: Page, name: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
    await settle(page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(TOUR_DIR, { recursive: true });
    fs.writeFileSync(path.join(TOUR_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await cdp.detach().catch(() => {});
  }
}
