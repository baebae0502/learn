import fs from 'node:fs';
import path from 'node:path';
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { ROOT, importQueueState, launch, mainWindow, textExtraction, textIdle, type Session } from '../helpers';

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
  tourApps.set(s.page, s.app);
  return s;
}

const tourApps = new WeakMap<Page, ElectronApplication>();

/**
 * Every PDF in this tour window's library has had its body read: the pictures show a library a little after its imports, whose
 * done index says nothing. The reading, held under E2E, runs at once from the first call (a window with no library has none).
 */
export async function bodyIndexDone(page: Page): Promise<void> {
  const app = tourApps.get(page);
  if (!app) return;
  await textExtraction(app, 'now');
  await textIdle(app);
}

/** Per tour window: how many import runs main had reported when an import that reads no bodies itself began (importStarting). */
const unread = new WeakMap<Page, number>();
const importRuns = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __learnTest: { importReports(): unknown[] } }).__learnTest.importReports().length);

/** An import that does not wait for its PDFs' bodies begins in this window (the menu's import, a drop): see readEndedImports. */
export async function importStarting(page: Page): Promise<void> {
  const app = tourApps.get(page);
  if (app && !unread.has(page)) unread.set(page, await importRuns(app));
}

/**
 * Before a picture: the PDFs of an import that has ended since importStarting have had their body read, as importPaths' have (a
 * done index says nothing). A run still going — held, asking about a duplicate, waiting for another job — is the picture's own
 * subject and is left as it is; its reading comes at the first picture after it ends.
 */
export async function readEndedImports(page: Page): Promise<void> {
  const app = tourApps.get(page);
  const since = unread.get(page);
  if (!app || since === undefined) return;
  if ((await importRuns(app)) <= since || (await importQueueState(app)).state !== 'idle') return;
  unread.delete(page);
  await bodyIndexDone(page);
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
export async function settle(page: Page, park = true): Promise<void> {
  if (park) await page.mouse.move(1439, 899);
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
export async function shoot(page: Page, name: string, opts: { mask?: Locator[]; keepPointer?: boolean; style?: string } = {}): Promise<void> {
  await readEndedImports(page);
  if (TOUR_2X) await capture2x(page, name, opts.keepPointer !== true);
  await settle(page, opts.keepPointer !== true);
  // Tight on purpose: at most 300 pixels may differ by more than the default per-pixel threshold (0.2), so a moved
  // or recoloured 2 px focus ring fails while the Debian ↔ Ubuntu font raster noise passes (verified on CI, I2).
  // `style`: a rule that is on while the picture is taken (what changes between runs, hidden where a mask would paint over
  // a surface that floats above it).
  const sheet = opts.style === undefined ? null : await page.addStyleTag({ content: opts.style });
  try {
    await expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', mask: opts.mask, maxDiffPixels: 300, threshold: 0.2 });
  } finally {
    await sheet?.evaluate((el) => (el as Element).remove());
  }
}

async function capture2x(page: Page, name: string, park: boolean): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { w, h } = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: false });
    await settle(page, park);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(TOUR_DIR, { recursive: true });
    fs.writeFileSync(path.join(TOUR_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  } finally {
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await cdp.detach().catch(() => {});
  }
}

/** Closes every reader tab (by its close mark), so each theme's pass of a scene starts from the same strip. */
export async function closeReaderTabs(page: Page): Promise<void> {
  const tabs = page.locator('[data-testid="tab"]:not([data-item-id="library"])');
  while ((await tabs.count()) > 0) {
    await tabs.first().click();
    await page.locator('.tab-item.is-active [data-testid="tab-close"]').click();
  }
}
