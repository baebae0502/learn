import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { LibraryItem } from '../../packages/domain/src/library';
import { FIXTURES, importPaths, launch, openItem } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf'); // 3 pages
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4'); // 10 s (fixtures/generate.mjs)
const RESUME_AT = 7; // seconds; 70 % of the clip, below the 95 % "finished, start over" cutoff

test.beforeAll(() => {
  for (const f of [PDF, MP4]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

/** The item as `library.list` reports it (progress and openedAt come from the stored reading position). */
async function listed(page: Page, title: string): Promise<LibraryItem> {
  const r = await page.evaluate(() => window.learn.library.list());
  if (!r.ok) throw new Error(`library.list failed: ${r.code}`);
  const item = r.data.find((i) => i.title === title);
  if (!item) throw new Error(`no library item titled ${title}`);
  return item;
}

const progressOf = async (page: Page, title: string) => (await listed(page, title)).progress;

/** Hard kill of the Electron main process (no quit handlers, no beforeunload); waits at most `timeoutMs` for the exit. */
async function hardKill(app: ElectronApplication, timeoutMs = 10_000): Promise<void> {
  const proc = app.process();
  const pid = proc.pid!;
  const exited = new Promise<void>((resolve) => proc.once('exit', () => resolve()));
  process.kill(pid, 'SIGKILL');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Electron main process ${pid} did not exit within ${timeoutMs} ms of SIGKILL`)), timeoutMs);
  });
  try {
    await Promise.race([exited, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

test('PDF reopens on the page it was left on; progress reaches library.list', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PDF]);
    await openItem(page, 'sample');
    const indicator = page.getByTestId('pdf-page-indicator');
    await expect(indicator).toHaveText('1 / 3쪽');
    await page.getByTestId('pdf-next').click();
    await expect(indicator).toHaveText('2 / 3쪽');
    await page.waitForTimeout(400); // the brief's scenario wait (> 300 ms debounce); the save itself is confirmed by the poll below
    // Saved by the debounce while the viewer is still open (not only by the unmount flush): (pageIndex + 1) / pageCount.
    await expect.poll(() => progressOf(page, 'sample')).toBeCloseTo(2 / 3, 5);
    await page.getByTestId('viewer-back').click();
    await expect(page.getByTestId('library-table')).toBeVisible();

    // Every text the page indicator shows while reopening: '…' until the restore is applied, never page 1 first.
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __indicator: string[] }).__indicator = seen;
      new MutationObserver(() => {
        const text = document.querySelector('[data-testid="pdf-page-indicator"]')?.textContent;
        if (text && seen.at(-1) !== text) seen.push(text);
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    await openItem(page, 'sample');
    await expect(indicator).toHaveText('2 / 3쪽');
    await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    const shown = await page.evaluate(() => (window as unknown as { __indicator: string[] }).__indicator);
    console.log('[measure] pdf reopen indicator', JSON.stringify(shown));
    expect(shown.at(-1)).toBe('2 / 3쪽');
    expect(shown).not.toContain('1 / 3쪽');

    const item = await listed(page, 'sample');
    expect(item.progress).toBeCloseTo(2 / 3, 5);
    expect(item.openedAt).not.toBeNull();
  } finally {
    await app.close();
  }
});

test('video resumes at the paused time after a SIGKILL and relaunch; progress reaches library.list', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);
  let killed = false;
  try {
    await importPaths(page, [MP4]);
    await openItem(page, 'sample-h264-aac');
    let video = page.getByTestId('video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
    const duration = await video.evaluate((v: HTMLVideoElement) => v.duration);
    expect(duration).toBeGreaterThan(RESUME_AT / 0.95);

    // The viewer ignores positions until it has applied the (empty) restore, which the DOM doesn't show. While the video
    // plays, the first timeupdate after that is saved at once (throttle starts open), so progress > 0 marks "restored".
    await video.evaluate((v: HTMLVideoElement) => {
      v.muted = true;
      return v.play();
    });
    await expect.poll(() => progressOf(page, 'sample-h264-aac')).toBeGreaterThan(0);

    // Seek to 7 s and pause: both are immediate saves.
    const pausedAt = await video.evaluate(async (v: HTMLVideoElement, target) => {
      const seeked = new Promise((resolve) => v.addEventListener('seeked', resolve, { once: true }));
      v.currentTime = target;
      await seeked;
      v.pause();
      return v.currentTime;
    }, RESUME_AT);
    expect(Math.abs(pausedAt - RESUME_AT)).toBeLessThanOrEqual(0.5);
    await expect.poll(() => progressOf(page, 'sample-h264-aac')).toBeCloseTo(pausedAt / duration, 2);
    await page.waitForTimeout(400); // the brief's ≥ 400 ms after the last save trigger; the save is already confirmed by the poll above

    await hardKill(app);
    killed = true;
    ({ app, page } = await launch(lib, ud));
    killed = false;

    // The stored position survived the kill (it was never flushed by a quit or unload).
    expect((await listed(page, 'sample-h264-aac')).progress).toBeCloseTo(pausedAt / duration, 2);
    await openItem(page, 'sample-h264-aac');
    video = page.getByTestId('video');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeCloseTo(RESUME_AT, 0); // |Δ| < 0.5 s
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    const resumedAt = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
    testInfo.annotations.push({ type: 'resume', description: JSON.stringify({ pausedAt, resumedAt, duration }) });
    console.log('[measure] video resume', JSON.stringify({ pausedAt, resumedAt, duration }));
    expect((await listed(page, 'sample-h264-aac')).progress).toBeCloseTo(pausedAt / duration, 2);
  } finally {
    if (!killed) await app.close().catch(() => {}); // never mask a failed relaunch's own error
  }
});
