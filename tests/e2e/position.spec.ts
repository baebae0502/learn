import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { LibraryItem } from '../../packages/domain/src/library';
import { FIXTURES, backFromReader, hardKill, importPaths, launch, mainWindow, openItem, rowByTitle, runMenuCommand, setPdfZoom } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf'); // 3 pages
const PAPER = path.join(FIXTURES, 'paper-100.pdf'); // 100 pages
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4'); // 10 s (fixtures/generate.mjs)
const RESUME_AT = 7; // seconds; 70 % of the clip, below the 95 % "finished, start over" cutoff

test.beforeAll(() => {
  for (const f of [PDF, PAPER, MP4]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
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

test('PDF reopens on the page it was left on; progress reaches library.list', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PDF]);
    await openItem(page, 'sample');
    const field = page.getByTestId('pdf-page-field');
    await expect(field).toHaveValue('1');
    await expect(page.getByTestId('pdf-page-count')).toHaveText('/ 3');
    await page.getByTestId('pdf-next').click();
    await expect(field).toHaveValue('2');
    await page.waitForTimeout(400); // the brief's scenario wait (> 300 ms debounce); the save itself is confirmed by the poll below
    // Saved by the debounce while the viewer is still open (not only by the unmount flush): (pageIndex + 1) / pageCount.
    await expect.poll(() => progressOf(page, 'sample')).toBeCloseTo(2 / 3, 5);
    await page.locator('[data-testid="tab"][data-item-id="library"]').click();
    await expect(page.getByTestId('library-table')).toBeVisible();

    // Every value the page field holds while reopening: empty until the restore is applied, never page 1 first. The sampler
    // runs on animation frames, which stop while the window counts as hidden (Mac run 41837267944 saw none): keep it awake.
    await (await mainWindow(app)).evaluate((w) => w.webContents.setBackgroundThrottling(false));
    await page.evaluate(() => {
      const seen: string[] = [];
      (window as unknown as { __indicator: string[] }).__indicator = seen;
      // The value is a property, which no mutation observer sees: sample it on every frame (a value shown for less is not seen).
      const sample = () => {
        const text = (document.querySelector('[data-testid="pdf-page-field"]') as HTMLInputElement | null)?.value;
        if (text && seen.at(-1) !== text) seen.push(text);
        requestAnimationFrame(sample);
      };
      sample();
    });
    await openItem(page, 'sample');
    await expect(field).toHaveValue('2');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    const shown = await page.evaluate(() => (window as unknown as { __indicator: string[] }).__indicator);
    console.log('[measure] pdf reopen indicator', JSON.stringify(shown));
    expect(shown.at(-1)).toBe('2');
    expect(shown).not.toContain('1');

    const item = await listed(page, 'sample');
    expect(item.progress).toBeCloseTo(2 / 3, 5);
    expect(item.openedAt).not.toBeNull();
  } finally {
    await app.close();
  }
});

test('opening a PDF records openedAt even when the page never changes', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [imported] = await importPaths(page, [PDF]);
    expect((await listed(page, 'sample')).openedAt).toBeNull();
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-page-field')).toHaveValue('1');
    await page.locator('[data-testid="tab"][data-item-id="library"]').click();
    await expect(page.getByTestId('library-table')).toBeVisible();

    await expect.poll(async () => (await listed(page, 'sample')).openedAt).not.toBeNull();
    const item = await listed(page, 'sample');
    expect(item.progress).toBeNull(); // opening alone saves no position
    // The row reader.open created starts at the first page; reading it back has no side effect.
    const read = () => page.evaluate((itemId) => window.learn.reader.getPosition({ itemId }), imported!.id);
    const first = await read();
    expect(first).toMatchObject({ ok: true, data: { locator: { kind: 'pdf', pageIndex: 0 }, progress: null, openedAt: item.openedAt } });
    expect(await read()).toEqual(first);
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
    await backFromReader(page); // the session reopened the reader; the reopen below is the one measured

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

/** Where the scroll sits in the page it is on, as a share of the page's height: independent of what is above it. */
const placeInPage = (page: Page, pageNumber: number) =>
  page.evaluate((n) => {
    const scroll = document.querySelector<HTMLElement>('[data-testid="pdf-scroll"]')!;
    const el = document.querySelector<HTMLElement>(`[data-testid="pdf-viewer"] .page[data-page-number="${n}"]`)!;
    return (scroll.getBoundingClientRect().top - el.getBoundingClientRect().top) / el.getBoundingClientRect().height;
  }, pageNumber);

const storedPosition = async (page: Page, itemId: string) => {
  const r = await page.evaluate((id) => window.learn.reader.getPosition({ itemId: id }), itemId);
  if (!r.ok) throw new Error(`reader.getPosition failed: ${r.code}`);
  return r.data;
};

test('a PDF reopens on the page, the place in it, the zoom and the rotation it was left with, after a SIGKILL', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);
  let killed = false;
  try {
    const [imported] = await importPaths(page, [PAPER]);
    await openItem(page, 'paper-100');
    const viewer = page.getByTestId('pdf-viewer');
    await expect(viewer).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    // The saved place (none yet) is applied once the stage has settled and it sets the rotation: a turn made before would be undone by it.
    await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', /.*/);
    await runMenuCommand(app, 'reader.rotateCw');
    await expect(viewer).toHaveAttribute('data-rotation', '90');
    await setPdfZoom(page, 1.5);
    await expect(viewer).toHaveAttribute('data-scale', '1.5');
    const field = page.getByTestId('pdf-page-field');
    await field.fill('37');
    await field.press('Enter');
    await expect(viewer).toHaveAttribute('data-page', '37');
    // Into the middle of the page: a share of its height, so the place in the page is not the page's top.
    await page.evaluate(() => {
      const scroll = document.querySelector<HTMLElement>('[data-testid="pdf-scroll"]')!;
      const el = document.querySelector<HTMLElement>('[data-testid="pdf-viewer"] .page[data-page-number="37"]')!;
      scroll.scrollTop += el.getBoundingClientRect().top - scroll.getBoundingClientRect().top + el.getBoundingClientRect().height * 0.4;
    });
    await expect(viewer).toHaveAttribute('data-page', '37');
    const before = await placeInPage(page, 37);
    expect(before).toBeGreaterThan(0.3);
    expect(before).toBeLessThan(0.5);
    // The save is on disk before the kill: wait for the stored row to carry all of it (the debounce is 300 ms).
    await expect
      .poll(async () => {
        const p = await storedPosition(page, imported!.id);
        const l = p?.locator;
        return l?.kind === 'pdf' && l.pageIndex === 36 && l.rotation === 90 && l.zoom === 1.5 && typeof l.top === 'number';
      })
      .toBe(true);
    await page.waitForTimeout(450); // and the last scroll's save after it
    const saved = await storedPosition(page, imported!.id);

    await hardKill(app);
    killed = true;
    ({ app, page } = await launch(lib, ud));
    killed = false;
    // The session reopens the reader at launch. Every page the thumbnail list rings or lists while the document comes up
    // from a cold renderer: the restored page only, never page 1 first. The sampler is an init script of a fresh load
    // of the window, so it runs from the first frame of the restore.
    await page.addInitScript(() => {
      const seen = new Set<string>();
      (window as unknown as { __thumbs: Set<string> }).__thumbs = seen;
      const sample = () => {
        for (const t of document.querySelectorAll<HTMLElement>('[data-testid="pdf-thumb"]')) seen.add(`${t.dataset['page']}${t.dataset['current'] ? '*' : ''}`);
        requestAnimationFrame(sample);
      };
      sample();
    });
    await page.reload();
    const reopened = page.getByTestId('pdf-viewer');
    await expect(reopened).toHaveAttribute('data-page', '37');
    await expect(reopened).toHaveAttribute('data-scale', '1.5');
    await expect(reopened).toHaveAttribute('data-rotation', '90');
    await expect(reopened).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    const after = await placeInPage(page, 37);
    console.log('[measure] position place in page', JSON.stringify({ before, after }));
    expect(Math.abs(after - before)).toBeLessThanOrEqual(0.05);
    await expect(page.locator('[data-testid="pdf-thumb"][data-current="true"]')).toHaveAttribute('data-page', '37');
    const thumbs = await page.evaluate(() => [...(window as unknown as { __thumbs: Set<string> }).__thumbs]);
    expect(thumbs).toContain('37*');
    expect(thumbs).not.toContain('1');
    expect(thumbs).not.toContain('1*');
    // Opening and restoring saved nothing over what was stored.
    await page.waitForTimeout(600);
    expect((await storedPosition(page, imported!.id))?.locator).toEqual(saved?.locator);
  } finally {
    if (!killed) await app.close().catch(() => {});
  }
});

test('a page wider than the stage reopens with its 24 on the left, as it was left (R-25; CI 41866507324 caught the tour without it)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [imported] = await importPaths(page, [PAPER]);
    await openItem(page, 'paper-100');
    const viewer = page.getByTestId('pdf-viewer');
    await expect(viewer).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await setPdfZoom(page, 2);
    await expect(viewer).toHaveAttribute('data-scale', '2');
    const scroll = page.getByTestId('pdf-scroll');
    // The room left of the page and how far the stage scrolls sideways: at 200 % the page is wider than the stage.
    const left = () =>
      page.evaluate(() => {
        const sc = document.querySelector<HTMLElement>('[data-testid="pdf-scroll"]')!;
        const pg = document.querySelector('[data-testid="pdf-viewer"] .page[data-page-number="1"]')!.getBoundingClientRect();
        return { room: pg.left - sc.getBoundingClientRect().left, overflow: sc.scrollWidth - sc.clientWidth };
      });
    await scroll.evaluate((el) => void (el.scrollLeft = 0));
    expect((await left()).overflow).toBeGreaterThan(24);
    expect((await left()).room).toBeCloseTo(24, 0);
    // The place saved with the room showing: pdf.js's left is then inside the margin, below 0.
    await expect
      .poll(async () => {
        const l = (await storedPosition(page, imported!.id))?.locator;
        return l?.kind === 'pdf' && l.pageIndex === 0 && l.zoom === 2 && typeof l.left === 'number' && l.left < 0;
      })
      .toBe(true);
    await backFromReader(page);
    await openItem(page, 'paper-100');
    await expect(scroll).toHaveAttribute('data-restored', '');
    await expect(viewer).toHaveAttribute('data-scale', '2');
    // pdf.js scrolls a place to the page's left edge (it drops a left inside the margin): the room beside the page comes back,
    // as the room above it does.
    expect((await left()).room).toBeCloseTo(24, 0);
  } finally {
    await app.close();
  }
});

/** The room between the stage's top edge and a page's top edge, in px. */
const roomAbove = (page: Page, pageNumber: number) =>
  page.evaluate((n) => {
    const scroll = document.querySelector<HTMLElement>('[data-testid="pdf-scroll"]')!;
    const el = document.querySelector<HTMLElement>(`[data-testid="pdf-viewer"] .page[data-page-number="${n}"]`)!;
    return el.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
  }, pageNumber);

test('a page jump keeps 12 above the page (24 for the first)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PAPER]);
    await openItem(page, 'paper-100');
    const viewer = page.getByTestId('pdf-viewer');
    await expect(viewer).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', '');
    const jumped = async (n: number) => {
      await expect(viewer).toHaveAttribute('data-page', String(n));
      // The viewer settles (pages above it take their size) before the room is read.
      await expect.poll(() => roomAbove(page, n).then(Math.round)).toBeGreaterThanOrEqual(0);
    };
    const field = page.getByTestId('pdf-page-field');
    await field.fill('7');
    await field.press('Enter');
    await jumped(7);
    expect(await roomAbove(page, 7)).toBeCloseTo(12, 0);

    await runMenuCommand(app, 'reader.showThumbnails');
    // The list draws the thumbnails near the page in view only: at a small window page 1 is not drawn until the list is scrolled up.
    await page.getByTestId('pdf-thumbnails').evaluate((el) => {
      for (let e: Element | null = el; e; e = e.parentElement) e.scrollTop = 0;
    });
    await page.locator('[data-testid="pdf-thumb"][data-page="1"]').click();
    await jumped(1);
    expect(await roomAbove(page, 1)).toBeCloseTo(24, 0);

    // A link to a page without a point (XYZ with no top).
    await page.locator('.page[data-page-number="1"] .annotationLayer .linkAnnotation > a').nth(0).click();
    await jumped(50);
    expect(await roomAbove(page, 50)).toBeCloseTo(12, 0);

    await runMenuCommand(app, 'reader.showOutline');
    await page.getByTestId('pdf-outline').getByRole('row', { name: /Chapter 3/ }).first().click();
    await jumped(21);
    expect(await roomAbove(page, 21)).toBeCloseTo(12, 0);
  } finally {
    await app.close();
  }
});

test('a page wider than the stage keeps its 24 on the left after a page jump (R-25)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PAPER]);
    await openItem(page, 'paper-100');
    const viewer = page.getByTestId('pdf-viewer');
    await expect(viewer).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await setPdfZoom(page, 2);
    await expect(viewer).toHaveAttribute('data-scale', '2');
    const field = page.getByTestId('pdf-page-field');
    await field.fill('2');
    await field.press('Enter');
    await expect(viewer).toHaveAttribute('data-page', '2');
    const left = () =>
      page.evaluate(() => {
        const sc = document.querySelector<HTMLElement>('[data-testid="pdf-scroll"]')!;
        const pg = document.querySelector('[data-testid="pdf-viewer"] .page[data-page-number="2"]')!.getBoundingClientRect();
        return { room: pg.left - sc.getBoundingClientRect().left, overflow: sc.scrollWidth - sc.clientWidth };
      });
    expect((await left()).overflow).toBeGreaterThan(24);
    await expect.poll(async () => Math.round((await left()).room)).toBe(24);
  } finally {
    await app.close();
  }
});

test('a mixed-size document fits its widest page (R-21)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PDF]);
    await openItem(page, 'sample');
    const viewer = page.getByTestId('pdf-viewer');
    await expect(viewer).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expect(viewer).toHaveAttribute('data-zoom', 'auto');
    // Page 2 is turned a quarter: at the first page's fit it would be wider than the stage.
    await expect
      .poll(() => page.getByTestId('pdf-scroll').evaluate((el) => el.scrollWidth <= el.clientWidth))
      .toBe(true);
  } finally {
    await app.close();
  }
});

test('scrolled to the end with several pages on screen, the progress is 100 % and the column says 완료 (final review I-3)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [imported] = await importPaths(page, [PAPER]);
    await openItem(page, 'paper-100');
    const viewer = page.getByTestId('pdf-viewer');
    await expect(viewer).toHaveAttribute('data-pages', '100');
    // 25 %: several pages fit the stage, so the page at its top is not the last one when the end of the document is reached.
    const scroll = page.getByTestId('pdf-scroll');
    await expect(scroll).toHaveAttribute('data-restored', ''); // the saved place is applied first; a zoom set before it would be overwritten by it
    await setPdfZoom(page, 0.25);
    await expect(viewer).toHaveAttribute('data-scale', '0.25');
    await scroll.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true);
    // The reading place stays the top page (the restore needs it); the progress counts what was seen.
    await expect.poll(async () => (await storedPosition(page, imported!.id))?.progress).toBe(1);
    expect((await storedPosition(page, imported!.id))?.locator).toMatchObject({ kind: 'pdf' }); // the place is the top page's (unit-tested); where that is depends on the screen
    await backFromReader(page);
    const cell = rowByTitle(page, 'paper-100').locator('[data-col="progress"]');
    await expect(cell).toHaveText('완료');
    await expect(cell.getByTestId('progress-done')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the progress column shows the furthest page read and does not drop when the reader goes back', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [imported] = await importPaths(page, [PAPER]);
    const cell = () => rowByTitle(page, 'paper-100').locator('[data-col="progress"]');
    await expect(cell()).toHaveText(''); // never read: an empty cell
    await expect(cell().getByTestId('progress-cell')).toHaveCount(0);
    await openItem(page, 'paper-100');
    const viewer = page.getByTestId('pdf-viewer');
    const field = page.getByTestId('pdf-page-field');
    await field.fill('37');
    await field.press('Enter');
    await expect(viewer).toHaveAttribute('data-page', '37');
    await expect.poll(async () => (await storedPosition(page, imported!.id))?.progress).toBeCloseTo(0.37, 5); // read for longer than the debounce
    await field.fill('1');
    await field.press('Enter');
    await expect(viewer).toHaveAttribute('data-page', '1');
    await expect.poll(async () => (await storedPosition(page, imported!.id))?.locator).toMatchObject({ pageIndex: 0 }); // saved at page 1, progress kept
    expect((await storedPosition(page, imported!.id))?.progress).toBeCloseTo(0.37, 5);
    await backFromReader(page);
    await expect(page.getByTestId('library-table')).toBeVisible();
    await expect(cell()).toHaveText('37%');
    await expect(cell().getByTestId('progress-cell')).toHaveAttribute('aria-valuenow', '37');

    // Reading on raises it (the list may refetch on the way back; the position notice itself is covered by the unit tests).
    await openItem(page, 'paper-100');
    await field.fill('50');
    await field.press('Enter');
    await expect(viewer).toHaveAttribute('data-page', '50');
    await expect.poll(async () => (await storedPosition(page, imported!.id))?.progress).toBeCloseTo(0.5, 5);
    await backFromReader(page);
    await expect(cell()).toHaveText('50%');

    // The last page: the check and 완료 in place of the bar and "100%".
    await openItem(page, 'paper-100');
    await field.fill('100');
    await field.press('Enter');
    await expect(viewer).toHaveAttribute('data-page', '100');
    await expect.poll(async () => (await storedPosition(page, imported!.id))?.progress).toBe(1);
    await backFromReader(page);
    await expect(cell()).toHaveText('완료');
    await expect(cell().getByTestId('progress-done')).toBeVisible();
    await expect(cell().getByTestId('progress-cell')).toHaveCount(0);
    // It fits the column at its default width.
    expect(await cell().evaluate((td) => td.scrollWidth <= td.clientWidth)).toBe(true);
  } finally {
    await app.close();
  }
});
