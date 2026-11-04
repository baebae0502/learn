import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { expectNoSeriousA11y } from './a11y';
import { FIXTURES, backFromReader, dragAlong, darkestPixel, importPaths, isCloseNoise, launch, menuItemEnabled, menuSnapshot, openExternalCalls, openItem, pdfCanvas, pixelAt, shotPixels, readClipboard, resolveColor, runMenuCommand, setPdfZoom, showItemPanel, stubOpenExternal, trashItems, type MenuNode } from './helpers';

const PAPER = path.join(FIXTURES, 'paper-100.pdf');
const SAMPLE = path.join(FIXTURES, 'sample.pdf');
const KOREAN = path.join(FIXTURES, 'korean.pdf');
const LOCKED = path.join(FIXTURES, 'locked.pdf');
const VIDEO = path.join(FIXTURES, 'sample-h264-aac.mp4');

test.beforeAll(() => {
  for (const f of [PAPER, KOREAN, LOCKED]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

const viewer = (page: Page) => page.getByTestId('pdf-viewer');
const field = (page: Page) => page.getByTestId('pdf-page-field');

async function openPaper(page: Page) {
  await importPaths(page, [PAPER]);
  await openItem(page, 'paper-100');
  await expect(viewer(page)).toHaveAttribute('data-pages', '100');
  await expect(viewer(page)).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
}

test('a 100-page paper opens on its first page with the page field and the page count', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await expect(pdfCanvas(page, 1)).toBeVisible();
    await expect(field(page)).toHaveValue('1');
    await expect(page.getByTestId('pdf-page-count')).toHaveText('/ 100');
  } finally {
    await app.close();
  }
});

test('the page field goes to a page; a value outside the document comes back as it was', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await field(page).fill('50');
    await field(page).press('Enter');
    await expect(viewer(page)).toHaveAttribute('data-page', '50');
    await expect(field(page)).toHaveValue('50');
    await field(page).fill('999');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('50');
    await expect(viewer(page)).toHaveAttribute('data-page', '50');
    await field(page).fill('abc');
    await field(page).press('Escape');
    await expect(field(page)).toHaveValue('50');
    await expect(page.getByTestId('pdf-stage')).toBeFocused();
  } finally {
    await app.close();
  }
});

test('the arrow keys turn pages and the space bar scrolls inside the page', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    // At 100 % a page is taller than any stage: the item panel narrows the stage of a 1024 px window, where the fitted page would be shorter than a screen.
    await setPdfZoom(page, 1);
    await field(page).fill('50');
    await field(page).press('Enter');
    await expect(viewer(page)).toHaveAttribute('data-page', '50');
    await page.getByTestId('pdf-stage').focus();
    await page.keyboard.press('ArrowRight');
    await expect(viewer(page)).toHaveAttribute('data-page', '51');
    const scroll = page.getByTestId('pdf-scroll');
    const before = await scroll.evaluate((el) => el.scrollTop);
    await page.keyboard.press('Space');
    await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
    await expect(viewer(page)).toHaveAttribute('data-page', '51');
    await page.keyboard.press('ArrowLeft');
    await expect(viewer(page)).toHaveAttribute('data-page', '50');
  } finally {
    await app.close();
  }
});

test('a link inside the document goes to its page', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    const links = page.locator('.page[data-page-number="1"] .annotationLayer .linkAnnotation > a');
    await expect(links).toHaveCount(4);
    await links.nth(0).click();
    await expect(viewer(page)).toHaveAttribute('data-page', '50');
  } finally {
    await app.close();
  }
});

test('outside links go to the system through the window-open guard, mailto included', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await stubOpenExternal(app);
    await openPaper(page);
    const links = page.locator('.page[data-page-number="1"] .annotationLayer .linkAnnotation > a');
    await expect(links).toHaveCount(4);
    await links.nth(2).click();
    await expect.poll(() => openExternalCalls(app)).toEqual(['https://example.org/learn']);
    await links.nth(3).click();
    await expect.poll(() => openExternalCalls(app)).toEqual(['https://example.org/learn', 'mailto:learn@example.org']);
  } finally {
    await app.close();
  }
});

test('a line dragged with the mouse is copied as its text', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    const line = page.locator('.page[data-page-number="1"] .textLayer span', { hasText: 'Attention is all you need.' }).first();
    await expect(line).toBeVisible();
    const box = (await line.boundingBox())!;
    const y = box.y + box.height / 2;
    await dragAlong(page, box.x + 1, box.x + box.width + 6, y); // to 6 px past the line's end, as a hand drags
    await page.keyboard.press('ControlOrMeta+c');
    await expect.poll(async () => (await readClipboard(app)).trim()).toBe('Attention is all you need.');
  } finally {
    await app.close();
  }
});

test('a protected PDF asks for its password; a wrong one says so, the right one opens it', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [LOCKED]);
    await openItem(page, 'locked');
    const password = page.getByTestId('pdf-password');
    await expect(password).toBeVisible();
    await expect(page.getByTestId('reader-toolbar')).toHaveCount(0);
    await password.fill('wrong');
    await password.press('Enter');
    await expect(page.getByTestId('pdf-password-error')).toHaveText('암호가 맞지 않습니다.');
    await password.fill('learn');
    await password.press('Enter');
    await expect(viewer(page)).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expect(page.getByTestId('pdf-password')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the text layer of a Korean PDF holds its text', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [KOREAN]);
    await openItem(page, 'korean');
    await expect(viewer(page)).toHaveAttribute('data-pages', '3');
    await expect.poll(() => page.locator('.textLayer').first().innerText()).toContain('주의 메커니즘');
  } finally {
    await app.close();
  }
});

// Zoom, rotation and page colour (M7a Task 6).
const zoomField = (page: Page) => page.getByTestId('pdf-zoom-field');
const menuLabel = async (app: Parameters<typeof menuSnapshot>[0], id: string): Promise<string | null> => {
  const flat = (nodes: MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flat(n.submenu ?? [])]);
  return flat(await menuSnapshot(app)).find((n) => n.id === id)?.label ?? null;
};

test('⌘+ zooms the open PDF and is named 확대 there; the library names the same key 글자 크게', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await setPdfZoom(page, 1);
    await expect(viewer(page)).toHaveAttribute('data-scale', '1');
    await expect.poll(() => menuLabel(app, 'view.textBigger')).toBe('확대');
    await expect.poll(() => menuLabel(app, 'view.textSmaller')).toBe('축소');
    await expect.poll(() => menuLabel(app, 'view.textReset')).toBe('실제 크기');
    await runMenuCommand(app, 'view.textBigger');
    await expect(viewer(page)).toHaveAttribute('data-scale', '1.1');
    await expect(zoomField(page)).toHaveValue('110%');
    await runMenuCommand(app, 'view.textSmaller');
    await runMenuCommand(app, 'view.textSmaller');
    await expect(viewer(page)).toHaveAttribute('data-scale', '0.9');
    await runMenuCommand(app, 'view.textReset');
    await expect(viewer(page)).toHaveAttribute('data-scale', '1');
    await backFromReader(page);
    await expect.poll(() => menuLabel(app, 'view.textBigger')).toBe('글자 크게');
    await expect.poll(() => menuLabel(app, 'view.textReset')).toBe('기본 글자 크기');
  } finally {
    await app.close();
  }
});

test('the zoom field takes a percent; the zoom menu fits the page to the stage', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await zoomField(page).fill('150');
    await zoomField(page).press('Enter');
    await expect(viewer(page)).toHaveAttribute('data-scale', '1.5');
    await expect(viewer(page)).toHaveAttribute('data-zoom', '1.5');
    await expect(zoomField(page)).toHaveValue('150%');
    await zoomField(page).fill('9999');
    await zoomField(page).press('Enter');
    await expect(viewer(page)).toHaveAttribute('data-scale', '4');
    await zoomField(page).fill('abc');
    await zoomField(page).press('Escape');
    await expect(zoomField(page)).toHaveValue('400%');
    await expect(page.getByTestId('pdf-stage')).toBeFocused();
    await page.getByTestId('pdf-zoom-menu').click();
    await page.getByRole('menuitemradio', { name: '너비에 맞춤' }).click();
    await expect(viewer(page)).toHaveAttribute('data-zoom', 'page-width');
    await page.getByTestId('pdf-zoom-menu').click();
    await expect(page.getByRole('menuitemradio', { name: '너비에 맞춤' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('menuitemradio', { name: '한 쪽 전체 보기' }).click();
    await expect(viewer(page)).toHaveAttribute('data-zoom', 'page-fit');
    await page.getByTestId('pdf-zoom-menu').click();
    await page.getByRole('menuitemradio', { name: '125%' }).click();
    await expect(viewer(page)).toHaveAttribute('data-scale', '1.25');
  } finally {
    await app.close();
  }
});

test('the fit modes keep the mockup\'s margins: 24 of --bg-sunken round the page, the whole page in view at 한 쪽 전체 보기 (Mac critique 1)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    const scroll = page.getByTestId('pdf-scroll');
    const sunken = await resolveColor(page, 'var(--bg-sunken)');
    const geometry = () =>
      page.evaluate(() => {
        const sc = document.querySelector<HTMLElement>('[data-testid="pdf-scroll"]')!;
        const pg = document.querySelector<HTMLElement>('.pdfViewer .page[data-page-number="1"]')!.getBoundingClientRect();
        const box = sc.getBoundingClientRect();
        return { stageLeft: box.left, stageTop: box.top, client: { w: sc.clientWidth, h: sc.clientHeight }, page: { left: pg.left, top: pg.top, w: pg.width, h: pg.height } };
      });
    await expect(viewer(page)).toHaveAttribute('data-zoom', 'auto');
    const auto = await geometry();
    // The page and its margins fit beside the scroll bar too: no sideways scrolling in a fit mode.
    expect(await scroll.evaluate((el) => el.scrollWidth - el.clientWidth), '자동 맞춤 scrolls sideways').toBeLessThanOrEqual(0);
    // 자동 맞춤: the page is narrower than the stage by the two margins, and the stage's own colour shows beside it.
    expect(auto.client.w - auto.page.w).toBeGreaterThanOrEqual(46);
    expect(auto.client.w - auto.page.w).toBeLessThanOrEqual(50);
    const side = await pixelAt(page, auto.stageLeft + 4, auto.stageTop + auto.client.h / 2);
    for (let i = 0; i < 3; i++) expect(Math.abs(side[i]! - sunken[i]!), `side pixel ${side} vs --bg-sunken ${sunken}`).toBeLessThanOrEqual(2);
    // The room above the first page is on the screen when the document opens.
    expect(auto.page.top - auto.stageTop).toBeGreaterThanOrEqual(22);
    // The preset keeps its name: the number our own fit sets does not turn it into a zoom.
    await page.getByTestId('pdf-zoom-menu').click();
    await expect(page.getByRole('menuitemradio', { name: '자동 맞춤' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(viewer(page)).toHaveAttribute('data-zoom', 'auto');
    // 한 쪽 전체 보기: the whole current page, with its margin, fits the stage's height.
    await field(page).fill('3');
    await field(page).press('Enter');
    await expect(viewer(page)).toHaveAttribute('data-page', '3');
    await page.getByTestId('pdf-zoom-menu').click();
    await page.getByRole('menuitemradio', { name: '한 쪽 전체 보기' }).click();
    await expect(viewer(page)).toHaveAttribute('data-zoom', 'page-fit');
    await expect(viewer(page)).toHaveAttribute('data-page', '3');
    expect(await scroll.evaluate((el) => el.scrollWidth - el.clientWidth), '한 쪽 전체 보기 scrolls sideways').toBeLessThanOrEqual(0);
    await page.getByTestId('pdf-zoom-menu').click();
    await page.getByRole('menuitemradio', { name: '너비에 맞춤' }).click();
    await expect(viewer(page)).toHaveAttribute('data-zoom', 'page-width');
    expect(await scroll.evaluate((el) => el.scrollWidth - el.clientWidth), '너비에 맞춤 scrolls sideways').toBeLessThanOrEqual(0);
    await page.getByTestId('pdf-zoom-menu').click();
    await page.getByRole('menuitemradio', { name: '한 쪽 전체 보기' }).click();
    await expect(viewer(page)).toHaveAttribute('data-zoom', 'page-fit');
    const fit = await page.evaluate(() => {
      const sc = document.querySelector<HTMLElement>('[data-testid="pdf-scroll"]')!;
      const pg = document.querySelector<HTMLElement>('.pdfViewer .page[data-page-number="3"]')!;
      return { client: sc.clientHeight, height: pg.getBoundingClientRect().height };
    });
    expect(fit.height + 48).toBeLessThanOrEqual(fit.client + 1);
    await expect.poll(() => scroll.evaluate((el) => {
      const sc = el.getBoundingClientRect();
      const pg = document.querySelector('.pdfViewer .page[data-page-number="3"]')!.getBoundingClientRect();
      return pg.top >= sc.top - 1 && pg.bottom <= sc.bottom + 1;
    }), 'page 3 is wholly in the stage').toBe(true);
    await page.getByTestId('pdf-zoom-menu').click();
    await expect(page.getByRole('menuitemradio', { name: '한 쪽 전체 보기' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});

test('세피아 at 400 %: the detail canvas pdf.js lays over a capped page is multiplied like the page, ink is not drawn twice (review Important 2)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await setPdfZoom(page, 4);
    await expect(viewer(page)).toHaveAttribute('data-scale', '4');
    const canvases = page.locator('.pdfViewer .page[data-page-number="1"] canvas');
    // The screen area caps the page's own canvas at this zoom and pdf.js draws the visible part again over it; a few frames for it to arrive.
    await page.waitForTimeout(1500);
    const detail = await canvases.evaluateAll((all) => all.filter((c) => c.getAttribute('aria-hidden') === 'true').length);
    console.log(`[measure] detail canvases at 400 %: ${detail}`);
    const region = async () => {
      const r = await page.evaluate(() => {
        const sc = document.querySelector('[data-testid="pdf-scroll"]')!.getBoundingClientRect();
        const pg = document.querySelector('.pdfViewer .page[data-page-number="1"]')!.getBoundingClientRect();
        const left = Math.max(sc.left, pg.left) + 2;
        const top = Math.max(sc.top, pg.top) + 2;
        return { x: Math.ceil(left), y: Math.ceil(top), width: Math.floor(Math.min(sc.right - 20, pg.right) - left), height: Math.floor(Math.min(sc.bottom, pg.bottom) - top) };
      });
      return shotPixels(page, r);
    };
    const original = await region();
    await page.getByTestId('pdf-view-menu').click();
    await page.getByRole('menuitemradio', { name: '세피아' }).click();
    await expect(viewer(page)).toHaveAttribute('data-page-color', 'sepia');
    await page.waitForTimeout(500);
    const paper = await resolveColor(page, 'var(--page-sepia-bg)');
    const sepia = await region();
    expect(sepia.width).toBe(original.width);
    expect(sepia.height).toBe(original.height);
    // Every pixel is the original's times the paper colour; ink drawn twice would come out darker than that.
    let darker = 0;
    let ink = 0;
    for (let i = 0; i < original.data.length; i += 4) {
      if (original.data[i]! < 128) ink++;
      for (let c = 0; c < 3; c++) if (sepia.data[i + c]! < (original.data[i + c]! * paper[c]!) / 255 - 6) darker++;
    }
    expect(ink, 'the region shows ink').toBeGreaterThan(200);
    expect(darker, 'pixels darker than the original times the paper').toBeLessThanOrEqual(original.data.length / 4 / 500);
  } finally {
    await app.close();
  }
});

test('a quarter turn keeps the place in the page too: 40 % into page 21 stays 40 % (review Minor 5)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await setPdfZoom(page, 1);
    await expect(viewer(page)).toHaveAttribute('data-scale', '1');
    await field(page).fill('21');
    await field(page).press('Enter');
    await expect(viewer(page)).toHaveAttribute('data-page', '21');
    await page.evaluate(() => {
      const sc = document.querySelector<HTMLElement>('[data-testid="pdf-scroll"]')!;
      const pg = document.querySelector<HTMLElement>('.pdfViewer .page[data-page-number="21"]')!;
      sc.scrollTop += pg.getBoundingClientRect().top - sc.getBoundingClientRect().top + pg.getBoundingClientRect().height * 0.4;
    });
    await expect(viewer(page)).toHaveAttribute('data-page', '21');
    const share = () =>
      page.evaluate(() => {
        const sc = document.querySelector<HTMLElement>('[data-testid="pdf-scroll"]')!.getBoundingClientRect();
        const pg = document.querySelector('.pdfViewer .page[data-page-number="21"]')!.getBoundingClientRect();
        return (sc.top - pg.top) / pg.height;
      });
    await page.waitForTimeout(300);
    const before = await share();
    expect(before).toBeGreaterThan(0.35);
    expect(before).toBeLessThan(0.45);
    await runMenuCommand(app, 'reader.rotateCw');
    await expect(viewer(page)).toHaveAttribute('data-rotation', '90');
    await expect.poll(async () => Math.abs((await share()) - before)).toBeLessThanOrEqual(0.02);
    await expect(field(page)).toHaveValue('21');
    await runMenuCommand(app, 'reader.rotateCcw');
    await expect(viewer(page)).toHaveAttribute('data-rotation', '0');
    await expect.poll(async () => Math.abs((await share()) - before)).toBeLessThanOrEqual(0.02);
    await expect(field(page)).toHaveValue('21');
  } finally {
    await app.close();
  }
});

test('a one-page PDF keeps 24 on both sides of the page after any fit, bar or no bar, and does not scroll sideways (review Important 1)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).drawText('One page.', { x: 72, y: 700, size: 24 });
    const file = testInfo.outputPath('one-fit.pdf');
    fs.writeFileSync(file, await doc.save());
    await importPaths(page, [file]);
    await openItem(page, 'one-fit');
    await expect(viewer(page)).toHaveAttribute('data-pages', '1');
    await expect(viewer(page)).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    const scroll = page.getByTestId('pdf-scroll');
    const sideways = () => scroll.evaluate((el) => el.scrollWidth - el.clientWidth);
    // The room beside the page, inside what the scroll bar leaves.
    const room = () =>
      page.evaluate(() => {
        const sc = document.querySelector<HTMLElement>('[data-testid="pdf-scroll"]')!;
        const pg = document.querySelector('.pdfViewer .page')!.getBoundingClientRect();
        const box = sc.getBoundingClientRect();
        return { left: pg.left - box.left, right: box.left + sc.clientWidth - pg.right };
      });
    // 한 쪽 전체 has no bar; the width fit that follows makes the page taller than the stage, the bar comes, and the page must still have its 24 on both sides of what is left.
    for (const zoom of ['page-fit', 'page-width', 'page-fit', 'auto', 'page-width'] as const) {
      await setPdfZoom(page, zoom);
      await expect(viewer(page)).toHaveAttribute('data-zoom', zoom);
      await page.waitForTimeout(250);
      expect(await sideways(), `${zoom} scrolls sideways`).toBeLessThanOrEqual(0);
      const r = await room();
      expect(r.left, `${zoom}: room on the left`).toBeGreaterThanOrEqual(23);
      expect(r.right, `${zoom}: room on the right`).toBeGreaterThanOrEqual(23);
    }
  } finally {
    await app.close();
  }
});

test('the pages sit 12 apart, as in the mockup (Mac critique 10)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await setPdfZoom(page, 0.5);
    await expect(viewer(page)).toHaveAttribute('data-scale', '0.5');
    const gap = await page.evaluate(() => {
      const a = document.querySelector('.pdfViewer .page[data-page-number="1"]')!.getBoundingClientRect();
      const b = document.querySelector('.pdfViewer .page[data-page-number="2"]')!.getBoundingClientRect();
      return b.top - a.bottom;
    });
    expect(gap).toBeCloseTo(12, 0);
  } finally {
    await app.close();
  }
});

test('세피아 is the approved paper: the page and its thumbnail multiply to --page-sepia-bg, ink stays dark, 원본 stays white (Mac critique 2)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await expect(viewer(page)).toHaveAttribute('data-page-color', 'original');
    await expect(pdfCanvas(page, 1)).toBeVisible();
    const near = (got: number[], want: number[], tol: number, what: string) => {
      for (let i = 0; i < 3; i++) expect(Math.abs(got[i]! - want[i]!), `${what}: ${got} vs ${want}`).toBeLessThanOrEqual(tol);
    };
    /** An empty spot on the canvas's right edge, and the darkest pixel over the upper part of what shows of it (the title and the text). */
    const probe = async (selector: string) => {
      const box = await page.locator(selector).evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { left: Math.max(0, r.left), top: Math.max(0, r.top), right: Math.min(innerWidth, r.right), bottom: Math.min(innerHeight, r.bottom) };
      });
      const height = box.bottom - box.top;
      const empty = await pixelAt(page, Math.floor(box.right - 3), Math.floor(box.top + height * 0.6));
      const ink = await darkestPixel(page, { x: Math.ceil(box.left), y: Math.ceil(box.top), width: Math.floor(box.right - box.left) - 1, height: Math.floor(height * 0.4) });
      return { empty, ink };
    };
    const stageCanvas = '.pdfViewer .page[data-page-number="1"] canvas[role="presentation"]';
    const thumbCanvas = '[data-testid="pdf-thumb"][data-page="1"] canvas';
    await expect(page.locator(thumbCanvas)).toHaveAttribute('data-drawn', /.*/);
    const original = await probe(stageCanvas);
    near(original.empty, [253, 253, 253], 6, 'original paper');
    await page.getByTestId('pdf-view-menu').click();
    await page.getByRole('menuitemradio', { name: '세피아' }).click();
    await expect(viewer(page)).toHaveAttribute('data-page-color', 'sepia');
    const paper = await resolveColor(page, 'var(--page-sepia-bg)');
    const stage = await probe(stageCanvas);
    near(stage.empty, paper, 3, 'sepia page');
    expect(Math.max(...stage.ink), 'ink on the sepia page').toBeLessThan(90);
    const thumb = await probe(thumbCanvas);
    near(thumb.empty, paper, 3, 'sepia thumbnail');
    // 어둡게 is not touched: a dark page with light ink.
    await page.getByTestId('pdf-view-menu').click();
    await page.getByRole('menuitemradio', { name: '어둡게' }).click();
    await expect(viewer(page)).toHaveAttribute('data-page-color', 'dark');
    const dark = await probe(stageCanvas);
    expect(Math.max(...dark.empty), 'dark page background').toBeLessThan(90);
  } finally {
    await app.close();
  }
});

test('a fit mode is computed again when the stage changes size; a number stays as it is (final review I-1)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await field(page).fill('5');
    await field(page).press('Enter');
    await expect(viewer(page)).toHaveAttribute('data-page', '5');
    await expect(viewer(page)).toHaveAttribute('data-zoom', 'auto');
    await showItemPanel(app, page);
    const scale = async () => Number(await viewer(page).getAttribute('data-scale'));
    const stageWidth = () => page.getByTestId('pdf-scroll').evaluate((el) => el.clientWidth);
    const shown = await scale();
    const withPanel = await stageWidth();
    // The item panel folded (⌥⌘I): the stage is wider and the fitted page follows it, on the page it was.
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(() => page.getByTestId('shell').getAttribute('data-inspector')).not.toBe('shown');
    await expect.poll(stageWidth).toBeGreaterThan(withPanel);
    await expect.poll(scale).toBeGreaterThan(shown);
    await expect(viewer(page)).toHaveAttribute('data-zoom', 'auto');
    await expect(viewer(page)).toHaveAttribute('data-page', '5');
    await page.getByTestId('pdf-zoom-menu').click();
    await expect(page.getByRole('menuitemradio', { name: '자동 맞춤' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    // Shown again: back to the narrower fit.
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(() => page.getByTestId('shell').getAttribute('data-inspector')).toBe('shown');
    await expect.poll(scale).toBeCloseTo(shown, 2);
    await expect(viewer(page)).toHaveAttribute('data-page', '5');
    // A number is left alone.
    await setPdfZoom(page, 1.5);
    await expect(viewer(page)).toHaveAttribute('data-scale', '1.5');
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(stageWidth).toBeGreaterThan(withPanel);
    await page.waitForTimeout(300);
    await expect(viewer(page)).toHaveAttribute('data-scale', '1.5');
    await expect(viewer(page)).toHaveAttribute('data-zoom', '1.5');
  } finally {
    await app.close();
  }
});

test('the stage\'s own scroll bar appearing and going away does not re-fit again and again (final re-review N-1)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    // A one-page document at 자동 맞춤: its fitted height can sit within a scroll-bar width of the stage's height.
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]).drawText('One page.', { x: 72, y: 700, size: 24 });
    const file = testInfo.outputPath('onepage.pdf');
    fs.writeFileSync(file, await doc.save());
    await importPaths(page, [file]);
    await openItem(page, 'onepage');
    await expect(viewer(page)).toHaveAttribute('data-pages', '1');
    await expect(viewer(page)).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expect(viewer(page)).toHaveAttribute('data-zoom', 'auto');
    await page.waitForTimeout(500); // the first fit has settled
    await page.evaluate(() => {
      const store = (window as unknown as { __learnReader: { getState(): { handle: { eventBus(): { on(n: string, f: () => void): void } } } } }).__learnReader;
      const seen: number[] = [];
      (window as unknown as { __scaleChanges: number[] }).__scaleChanges = seen;
      store.getState().handle.eventBus().on('scalechanging', () => seen.push(performance.now()));
      // The stage a few px taller than the page fitted beside a scroll bar, and shorter than the page fitted without one: the bar appears, which narrows the stage, which shrinks the page, which takes the bar away.
      const scroll = document.querySelector<HTMLElement>('[data-testid="pdf-scroll"]')!;
      scroll.style.height = `${scroll.scrollHeight + 5}px`;
      scroll.style.flex = 'none';
    });
    await page.waitForTimeout(1500);
    const changes = await page.evaluate(() => (window as unknown as { __scaleChanges: number[] }).__scaleChanges.length);
    // The fit and, because the bar came or went with it, one more for the size the stage has then (fitTo's single retry): never a run of them.
    expect(changes).toBeLessThanOrEqual(2);
  } finally {
    await app.close();
  }
});

test('a pinch (ctrl + wheel) zooms around the pointer without scrolling the page away, and stops at 400 %', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await setPdfZoom(page, 1);
    await expect(viewer(page)).toHaveAttribute('data-scale', '1');
    const scroll = page.getByTestId('pdf-scroll');
    const wheel = (deltaY: number) =>
      scroll.evaluate((el, dy) => {
        const box = el.getBoundingClientRect();
        const e = new WheelEvent('wheel', { deltaY: dy, ctrlKey: true, clientX: box.left + box.width / 2, clientY: box.top + 200, cancelable: true, bubbles: true });
        el.dispatchEvent(e);
        return e.defaultPrevented;
      }, deltaY);
    expect(await wheel(-20)).toBe(true); // the browser's own zoom is cancelled
    await expect.poll(async () => Number(await viewer(page).getAttribute('data-scale'))).toBeGreaterThan(1);
    for (let i = 0; i < 12; i++) await wheel(-60);
    await expect(viewer(page)).toHaveAttribute('data-scale', '4');
    await expect(zoomField(page)).toHaveValue('400%');
    // A plain wheel is not a pinch: the scale stays.
    await scroll.evaluate((el) => el.dispatchEvent(new WheelEvent('wheel', { deltaY: 40, cancelable: true, bubbles: true })));
    await expect(viewer(page)).toHaveAttribute('data-scale', '4');
  } finally {
    await app.close();
  }
});

test('rotation turns every page by a quarter, clockwise and back', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await expect(viewer(page)).toHaveAttribute('data-rotation', '0');
    await runMenuCommand(app, 'reader.rotateCw');
    await expect(viewer(page)).toHaveAttribute('data-rotation', '90');
    await runMenuCommand(app, 'reader.rotateCcw');
    await runMenuCommand(app, 'reader.rotateCcw');
    await expect(viewer(page)).toHaveAttribute('data-rotation', '270');
  } finally {
    await app.close();
  }
});

test('⌘R and ⌘L keep the page in view: page 21 stays page 21, and so does the saved place (Mac critique 3)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [imported] = await importPaths(page, [PAPER]);
    await openItem(page, 'paper-100');
    await expect(viewer(page)).toHaveAttribute('data-pages', '100');
    await expect(viewer(page)).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    // At 100 % a turned page is a different height, so the scroll position in pixels names another page.
    await setPdfZoom(page, 1);
    await expect(viewer(page)).toHaveAttribute('data-scale', '1');
    await field(page).fill('21');
    await field(page).press('Enter');
    await expect(viewer(page)).toHaveAttribute('data-page', '21');
    const pageInView = (n: number) =>
      page.evaluate((num) => {
        const sc = document.querySelector('[data-testid="pdf-scroll"]')!.getBoundingClientRect();
        const pg = document.querySelector(`.pdfViewer .page[data-page-number="${num}"]`)!.getBoundingClientRect();
        return pg.bottom > sc.top && pg.top < sc.bottom;
      }, n);
    const stored = async () => {
      const r = await page.evaluate((id) => window.learn.reader.getPosition({ itemId: id }), imported!.id);
      return r.ok && r.data?.locator.kind === 'pdf' ? { pageIndex: r.data.locator.pageIndex, rotation: r.data.locator.rotation } : null;
    };
    await runMenuCommand(app, 'reader.rotateCw');
    await expect(viewer(page)).toHaveAttribute('data-rotation', '90');
    await expect(field(page)).toHaveValue('21');
    await expect(viewer(page)).toHaveAttribute('data-page', '21');
    expect(await pageInView(21)).toBe(true);
    await expect.poll(stored).toEqual({ pageIndex: 20, rotation: 90 });
    await runMenuCommand(app, 'reader.rotateCcw');
    await expect(viewer(page)).toHaveAttribute('data-rotation', '0');
    await expect(field(page)).toHaveValue('21');
    expect(await pageInView(21)).toBe(true);
    await expect.poll(stored).toEqual({ pageIndex: 20, rotation: 0 });
    // A fit mode is sized again for the turned page, on the same page, and keeps its name.
    await setPdfZoom(page, 'page-width');
    await expect(viewer(page)).toHaveAttribute('data-zoom', 'page-width');
    await field(page).fill('21');
    await field(page).press('Enter');
    await runMenuCommand(app, 'reader.rotateCw');
    await expect(viewer(page)).toHaveAttribute('data-rotation', '90');
    await expect(viewer(page)).toHaveAttribute('data-zoom', 'page-width');
    await expect(field(page)).toHaveValue('21');
    expect(await pageInView(21)).toBe(true);
  } finally {
    await app.close();
  }
});

test('the page colour is chosen in the 보기 menu and kept for the next start', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);
  try {
    await openPaper(page);
    await expect(viewer(page)).toHaveAttribute('data-page-color', 'original'); // 앱 테마 따르기 in the light theme
    await page.getByTestId('pdf-view-menu').click();
    await expect(page.getByRole('menuitemradio', { name: '앱 테마 따르기' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('menuitemradio', { name: '세피아' }).click();
    await expect(viewer(page)).toHaveAttribute('data-page-color', 'sepia');
    await expect
      .poll(() => page.evaluate(async () => { const r = await window.learn.settings.get({ key: 'reader.pageColor' }); return r.ok ? r.data : null; }))
      .toBe('sepia');
    await app.close();
    ({ app, page } = await launch(lib, ud));
    await openItem(page, 'paper-100');
    await expect(viewer(page)).toHaveAttribute('data-page-color', 'sepia');
    await page.getByTestId('pdf-view-menu').click();
    await expect(page.getByRole('menuitemradio', { name: '세피아' })).toHaveAttribute('aria-checked', 'true');
  } finally {
    await app.close();
  }
});

test('a video has no page to turn: the rotation is off there and on again in a PDF', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [PAPER, VIDEO]);
    await openItem(page, 'paper-100');
    await expect(viewer(page)).toHaveAttribute('data-pages', '100');
    await expect.poll(() => menuItemEnabled(app, 'reader.rotateCw')).toBe(true);
    await backFromReader(page);
    await expect.poll(() => menuItemEnabled(app, 'reader.rotateCw')).toBe(false);
    await openItem(page, 'sample-h264-aac');
    await expect(page.getByTestId('viewer-title')).toBeVisible();
    await expect.poll(() => menuItemEnabled(app, 'nav.back')).toBe(true);
    await expect.poll(() => menuItemEnabled(app, 'reader.rotateCw')).toBe(false);
    await expect.poll(() => menuItemEnabled(app, 'view.textBigger')).toBe(false);
  } finally {
    await app.close();
  }
});

// Find, and the reader's sidebar (M7a Task 8).
const findBar = (page: Page) => page.getByTestId('pdf-find-bar');
const findInput = (page: Page) => page.getByTestId('pdf-find-field').getByRole('searchbox');
const findCount = (page: Page) => page.getByTestId('pdf-find-count');

test('⌘F is named 찾기 in the reader and opens the find bar; ⌘G goes on, a word that is not there says so', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await expect.poll(() => menuLabel(app, 'library.find')).toBe('찾기');
    await expect(findBar(page)).toHaveCount(0);
    await runMenuCommand(app, 'library.find');
    await expect(findBar(page)).toBeVisible();
    await expect(findInput(page)).toBeFocused();
    await findInput(page).fill('attention');
    await expect(findCount(page)).toHaveText(/^1 \/ \d+$/);
    await runMenuCommand(app, 'reader.findNext');
    await expect(findCount(page)).toHaveText(/^2 \/ \d+$/);
    await runMenuCommand(app, 'reader.findPrevious');
    await expect(findCount(page)).toHaveText(/^1 \/ \d+$/);
    await findInput(page).fill('zzqxv');
    await expect(findCount(page)).toHaveText('찾을 수 없음');
    await findInput(page).press('Escape');
    await expect(findBar(page)).toHaveCount(0);
    await expect(page.getByTestId('pdf-stage')).toBeFocused();
    await backFromReader(page);
    await expect.poll(() => menuLabel(app, 'library.find')).toBe('빠른 검색');
  } finally {
    await app.close();
  }
});

test('a Korean word is found on a page written in NFC and on one written in NFD', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [KOREAN]);
    await openItem(page, 'korean');
    await expect(viewer(page)).toHaveAttribute('data-pages', '3');
    await runMenuCommand(app, 'library.find');
    await findInput(page).fill('메커니즘');
    await expect.poll(async () => Number(((await findCount(page).textContent()) ?? '').split('/')[1])).toBeGreaterThanOrEqual(2);
    // The match on page 2 is reached by going on from page 1's.
    await runMenuCommand(app, 'reader.findNext');
    await expect(viewer(page)).toHaveAttribute('data-page', '2');
  } finally {
    await app.close();
  }
});

test('⌘E takes the selected word into the find bar', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await expect(page.locator('.page[data-page-number="1"] .textLayer span', { hasText: /attention/i }).first()).toBeAttached(); // the text layer is drawn after the canvas
    const word = await page.evaluate(() => {
      const span = [...document.querySelectorAll('.page[data-page-number="1"] .textLayer span')].find((s) => /attention/i.test(s.textContent ?? ''))!;
      const text = span.firstChild as Text;
      const at = text.data.toLowerCase().indexOf('attention');
      const range = document.createRange();
      range.setStart(text, at);
      range.setEnd(text, at + 'attention'.length);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return text.data.slice(at, at + 'attention'.length);
    });
    await runMenuCommand(app, 'reader.findSelection');
    await expect(findBar(page)).toBeVisible();
    await expect(findInput(page)).toHaveValue(word);
    await expect(findCount(page)).toHaveText(/^1 \/ \d+$/);
  } finally {
    await app.close();
  }
});

test('the thumbnail of page 50 goes to page 50; the outline goes to a chapter and is searched', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await expect(page.getByTestId('reader-sidebar')).toBeVisible();
    await expect(page.getByTestId('pdf-thumbnails')).toBeVisible();
    await expect(page.getByTestId('pdf-thumb').first()).toHaveAttribute('data-current', 'true');
    // Virtualised: far fewer thumbnails are in the page than the document has.
    expect(await page.getByTestId('pdf-thumb').count()).toBeLessThan(40);
    await page.getByTestId('pdf-thumbnails').evaluate((el) => {
      el.scrollTop = (el.scrollHeight / 100) * 49 - 40;
    });
    const fiftieth = page.locator('[data-testid="pdf-thumb"][data-page="50"]');
    await expect(fiftieth).toBeVisible();
    await fiftieth.click();
    await expect(viewer(page)).toHaveAttribute('data-page', '50');
    await expect(page.locator('[data-testid="pdf-thumb"][data-current="true"]')).toHaveAttribute('data-page', '50');
    // The thumbnail is drawn: its canvas holds ink.
    await expect.poll(() =>
      fiftieth.locator('canvas').evaluate((c: HTMLCanvasElement) => {
        const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        for (let i = 0; i < px.length; i += 4) if (px[i]! < 200) return true;
        return false;
      }),
    ).toBe(true);

    await page.getByTestId('reader-nav').getByText('목차', { exact: true }).click();
    await expect(page.getByTestId('pdf-outline')).toBeVisible();
    await page.getByTestId('pdf-outline').getByRole('row', { name: /Chapter 3/ }).first().click();
    // paper-100's outline puts chapter n on page 10 n − 9 (fixtures/generate.mjs).
    await expect(viewer(page)).toHaveAttribute('data-page', '21');
    // The mark is on the last entry that starts on or before the page: Chapter 3 or the first of its sections, never another chapter.
    await expect(page.locator('[data-testid="pdf-outline-row"][data-current-page="true"]')).toHaveCount(1);
    await expect(page.locator('[data-testid="pdf-outline-row"][data-current-page="true"]')).toHaveAttribute('aria-label', /^(Chapter 3|3\.\d)/);

    await page.getByTestId('pdf-outline-search').getByRole('searchbox').fill('3.2');
    await expect(page.getByTestId('pdf-outline').getByRole('row', { name: /^3\.2 / }).first()).toBeVisible();
    await expect(page.getByTestId('pdf-outline').getByRole('row', { name: /^1\.1 / })).toHaveCount(0);
    // The setting is one: the menu changes it both ways.
    await runMenuCommand(app, 'reader.showThumbnails');
    await expect(page.getByTestId('pdf-thumbnails')).toBeVisible();
    await runMenuCommand(app, 'reader.showOutline');
    await expect(page.getByTestId('pdf-outline')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the list the sidebar shows is kept for the next start', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);
  try {
    await openPaper(page);
    await expect(page.getByTestId('pdf-thumbnails')).toBeVisible();
    await runMenuCommand(app, 'reader.showOutline');
    await expect(page.getByTestId('pdf-outline')).toBeVisible();
    await expect
      .poll(() => page.evaluate(async () => { const r = await window.learn.settings.get({ key: 'reader.nav' }); return r.ok ? r.data : null; }))
      .toBe('outline');
    await app.close();
    ({ app, page } = await launch(lib, ud));
    await openItem(page, 'paper-100');
    await expect(page.getByTestId('pdf-outline')).toBeVisible();
    await expect(page.getByTestId('pdf-thumbnails')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('typing in the find field keeps Space and the arrows: the page does not turn or scroll', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await runMenuCommand(app, 'library.find');
    await expect(findInput(page)).toBeFocused();
    const scroll = page.getByTestId('pdf-scroll');
    const top = await scroll.evaluate((el) => el.scrollTop);
    await page.keyboard.type('self attention');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('End');
    await page.keyboard.type(' ');
    await expect(findInput(page)).toHaveValue('self attention ');
    await expect(viewer(page)).toHaveAttribute('data-page', '1');
    expect(await scroll.evaluate((el) => el.scrollTop)).toBe(top);
    // esc on the stage closes the bar too (focus moved there while it is open).
    await page.getByTestId('pdf-stage').focus();
    await page.keyboard.press('Escape');
    await expect(findBar(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('going round past the first match says so for a moment and speaks it; ⌘G with the bar open leaves the focus where it is', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await runMenuCommand(app, 'library.find');
    await findInput(page).fill('attention');
    await expect(findCount(page)).toHaveText(/^1 \/ \d+$/);
    await page.getByTestId('pdf-stage').focus();
    await runMenuCommand(app, 'reader.findNext');
    await expect(findCount(page)).toHaveText(/^2 \/ \d+$/);
    await expect(page.getByTestId('pdf-stage')).toBeFocused();
    await runMenuCommand(app, 'reader.findPrevious');
    await runMenuCommand(app, 'reader.findPrevious');
    await expect(findCount(page)).toHaveText(/^처음부터\s· \d+ \/ \d+$/);
    await expect(findBar(page).locator('[aria-live="polite"]')).toHaveText('처음부터 다시 찾았습니다');
    await expect(findCount(page)).toHaveText(/^\d+ \/ \d+$/, { timeout: 5_000 });
  } finally {
    await app.close();
  }
});

test('↑ and ↓ on the thumbnail list move the page; a quarter turn turns the thumbnails', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    const list = page.getByTestId('pdf-thumbnails');
    await list.focus();
    await page.keyboard.press('ArrowDown');
    await expect(viewer(page)).toHaveAttribute('data-page', '2');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await expect(viewer(page)).toHaveAttribute('data-page', '2');
    await expect(page.locator('[data-testid="pdf-thumb"][data-current="true"]')).toHaveAttribute('data-page', '2');
    const box = () => page.locator('[data-testid="pdf-thumb"][data-page="2"] .nav-thumb-page').evaluate((el) => ({ w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }));
    const upright = await box();
    expect(upright.h).toBeGreaterThan(upright.w);
    expect(Math.round(upright.w)).toBe(104);
    await runMenuCommand(app, 'reader.rotateCw');
    await expect(viewer(page)).toHaveAttribute('data-rotation', '90');
    await expect.poll(async () => (await box()).w > (await box()).h).toBe(true);
    // The turned picture is drawn again, not the upright one stretched.
    await expect.poll(() =>
      page.locator('[data-testid="pdf-thumb"][data-page="2"] canvas').evaluate((c: HTMLCanvasElement) => c.hasAttribute('data-drawn') && c.width > c.height),
    ).toBe(true);
  } finally {
    await app.close();
  }
});

test('a PDF without an outline says so in the sidebar', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [SAMPLE]);
    await openItem(page, 'sample');
    await expect(viewer(page)).toHaveAttribute('data-pages', /^[1-9]/);
    await runMenuCommand(app, 'reader.showOutline');
    await expect(page.getByTestId('reader-sidebar-empty')).toContainText('이 PDF에는 목차가 없습니다');
    await expect(page.getByTestId('pdf-outline')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a PDF moved to the trash while it is read leaves the sidebar without pages', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    const id = await page.evaluate(async () => {
      const r = await window.learn.library.list();
      return r.ok ? (r.data.find((i) => i.title === 'paper-100')?.id ?? null) : null;
    });
    await trashItems(page, [id!]);
    await expect(page.getByTestId('reader-sidebar-empty')).toContainText('복원하면 쪽이 보입니다');
    await expect(page.getByTestId('pdf-thumbnails')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a protected PDF shows no pages in the sidebar until it is opened', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [LOCKED]);
    await openItem(page, 'locked');
    await expect(page.getByTestId('reader-sidebar-empty')).toContainText('암호를 입력하면 쪽이 보입니다');
    await page.getByTestId('pdf-password').fill('learn');
    await page.getByTestId('pdf-password').press('Enter');
    await expect(page.getByTestId('pdf-thumbnails')).toBeVisible();
    await expect(page.getByTestId('reader-sidebar-empty')).toHaveCount(0);
  } finally {
    await app.close();
  }
});


test('leaving a PDF the moment its pages exist leaves no page error and no console error', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ''}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !isCloseNoise(m.text())) errors.push(m.text());
    // A thumbnail that was being drawn when the document went away is not worth a line in the log.
    if (m.type() === 'warning' && /thumbnail/i.test(m.text())) errors.push(`warning: ${m.text()}`);
  });
  try {
    await importPaths(page, [PAPER]);
    for (let i = 0; i < 8; i++) {
      await openItem(page, 'paper-100');
      await viewer(page).waitFor({ state: 'attached' });
      // Back is clicked in the very task that sees the page count, while the viewer is still asking for its first pages.
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            const el = document.querySelector('[data-testid="pdf-viewer"]')!;
            const go = () => (document.querySelector('[data-testid="viewer-back"]') as HTMLElement).click();
            if (el.getAttribute('data-pages') === '100') go();
            else new MutationObserver((_m, o) => { if (el.getAttribute('data-pages') === '100') { o.disconnect(); go(); } }).observe(el, { attributes: true });
            resolve();
          }),
      );
      await expect(viewer(page)).toHaveCount(0);
    }
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('leaving a PDF while its thumbnails are being drawn leaves no page error, no console error and no thumbnail warning', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${e.stack ?? ''}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !isCloseNoise(m.text())) errors.push(m.text());
    // A thumbnail that was being drawn when the document went away is not worth a line in the log.
    if (m.type() === 'warning' && /thumbnail/i.test(m.text())) errors.push(`warning: ${m.text()}`);
  });
  try {
    await importPaths(page, [PAPER]);
    for (let i = 0; i < 5; i++) {
      await openItem(page, 'paper-100');
      await viewer(page).waitFor({ state: 'attached' });
      // The first picture is on screen, the others are still on their way.
      await expect(page.locator('[data-testid="pdf-thumb"] canvas[data-drawn]').first()).toBeAttached();
      await page.getByTestId('viewer-back').click();
      await expect(viewer(page)).toHaveCount(0);
    }
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

const rectOf = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
  });

test('the toolbar groups as the mockup has them: "/ 100" takes its own width with the page chevrons 4 after it, and a 16 px separator stands before the panel toggle (Mac critique 5)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    const count = await page.getByTestId('pdf-page-count').evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return { box: el.getBoundingClientRect().width, text: range.getBoundingClientRect().width, nums: getComputedStyle(el).fontVariantNumeric };
    });
    expect(Math.abs(count.box - count.text)).toBeLessThanOrEqual(1);
    expect(count.nums).toContain('tabular-nums');
    const c = await rectOf(page, 'pdf-page-count');
    const prev = await rectOf(page, 'pdf-prev');
    expect(prev.left - c.right).toBeCloseTo(4, 0);
    // The mockup's .toolbar-sep: 1 × 16 in --separator, 8 from the 보기 menu and 8 from the toggle.
    const sep = page.locator('.reader-toolbar [role="separator"]');
    await expect(sep).toHaveCount(1);
    const s = await sep.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const probe = document.createElement('div');
      probe.style.background = 'var(--separator)';
      document.body.append(probe);
      const token = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { left: r.left, right: r.right, width: r.width, height: r.height, isSeparator: getComputedStyle(el).backgroundColor === token, orientation: el.getAttribute('aria-orientation') };
    });
    expect([s.width, s.height]).toEqual([1, 16]);
    expect(s.orientation).toBe('vertical');
    expect(s.isSeparator).toBe(true);
    const view = await rectOf(page, 'pdf-view-menu');
    const toggle = await page.locator('.reader-toolbar [aria-controls="inspector"]').evaluate((el) => el.getBoundingClientRect().left);
    expect(s.left - view.right).toBeCloseTo(8, 0);
    expect(toggle - s.right).toBeCloseTo(8, 0);
  } finally {
    await app.close();
  }
});

test('the find bar as the mockup draws it: the count sits inside the field on the right in the tertiary colour, there is no clear button, and the bar is about 304 wide (Mac critique 7)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await runMenuCommand(app, 'library.find');
    await findInput(page).fill('attention');
    await expect(findCount(page)).toHaveText(/^1 \/ \d+$/);
    const geometry = () =>
      page.evaluate(() => {
        const box = (id: string) => document.querySelector(`[data-testid="${id}"]`)!.getBoundingClientRect();
        const count = document.querySelector('[data-testid="pdf-find-count"]')!;
        const cs = getComputedStyle(count);
        return { field: box('pdf-find-field'), count: box('pdf-find-count'), bar: box('pdf-find-bar'), input: document.querySelector('[data-testid="pdf-find-field"] input')!.getBoundingClientRect(), nums: cs.fontVariantNumeric };
      });
    const g = await geometry();
    expect(g.count.left).toBeGreaterThanOrEqual(g.field.left);
    expect(g.count.right).toBeLessThanOrEqual(g.field.right);
    expect(g.field.right - g.count.right).toBeLessThanOrEqual(12);
    expect(g.count.left).toBeGreaterThanOrEqual(g.input.right - 1); // after the text box, not over it
    expect(g.nums).toContain('tabular-nums');
    expect(g.bar.width).toBeGreaterThanOrEqual(300);
    expect(g.bar.width).toBeLessThanOrEqual(308);
    await expect(page.getByTestId('pdf-find-field-clear')).toHaveCount(0);
    // The colour is --text-tertiary (the probe's `background` is that token resolved the same way).
    const sameColour = await findCount(page).evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--text-tertiary)';
      document.body.append(probe);
      const want = getComputedStyle(probe).color;
      probe.remove();
      return getComputedStyle(el).color === want;
    });
    expect(sameColour).toBe(true);
    // Every text the count has keeps that place: a miss, and a wrap past the last match (R-8).
    await findInput(page).fill('zzqxv');
    await expect(findCount(page)).toHaveText('찾을 수 없음');
    let n = await geometry();
    expect(n.count.left).toBeGreaterThanOrEqual(n.field.left);
    expect(n.count.right).toBeLessThanOrEqual(n.field.right + 0.5);
    expect(n.bar.width).toBeCloseTo(g.bar.width, 0);
    await findInput(page).fill('attention');
    await expect(findCount(page)).toHaveText(/^1 \/ \d+$/);
    await runMenuCommand(app, 'reader.findPrevious');
    await expect(findCount(page)).toHaveText(/^처음부터\s· \d+ \/ \d+$/);
    n = await geometry();
    expect(n.count.right).toBeLessThanOrEqual(n.field.right + 0.5);
    expect(n.count.left).toBeGreaterThanOrEqual(n.input.right - 1);
    expect(n.bar.width).toBeCloseTo(g.bar.width, 0);
    // Still read out: a wrap and a miss are spoken by the bar's one live region, the count itself stays out of the reading order.
    await expect(findBar(page).locator('[aria-live="polite"]')).toHaveText('처음부터 다시 찾았습니다');
    await expect(findCount(page)).toHaveAttribute('aria-hidden', 'true');
    await expectNoSeriousA11y(page, 'the reader with the find bar open');
  } finally {
    await app.close();
  }
});

test('the stage\'s focus ring is an overlay of four sides, not the half a scrolled page leaves; a return after the mouse stays ringless (Mac critique 8)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    const stage = page.getByTestId('pdf-stage');
    const focus = await resolveColor(page, 'var(--focus)');
    /** The pixel one inside each side's middle, and what the stage says about its ring. */
    const sides = async () => {
      const b = (await stage.boundingBox())!;
      const at = async (x: number, y: number) => (await pixelAt(page, x, y)).map((c, i) => Math.abs(c - focus[i]!));
      return {
        top: await at(b.x + b.width / 2, b.y + 1),
        bottom: await at(b.x + b.width / 2, b.y + b.height - 2),
        left: await at(b.x + 1, b.y + b.height / 2),
        right: await at(b.x + b.width - 2, b.y + b.height / 2),
      };
    };
    const ring = () =>
      stage.evaluate((el) => {
        const after = getComputedStyle(el, '::after');
        return { visible: el.matches(':focus-visible'), outline: getComputedStyle(el).outlineStyle, shadow: after.boxShadow, events: after.pointerEvents, position: after.position, scrolls: el.scrollHeight > el.clientHeight || el.scrollTop !== 0 };
      });
    // The way back from the find bar by the keyboard: esc.
    await runMenuCommand(app, 'library.find');
    await findInput(page).press('Escape');
    await expect(stage).toBeFocused();
    const keyboard = await ring();
    expect(keyboard.visible).toBe(true);
    expect(keyboard.outline).toBe('none'); // no outline on the stage: the pages (positioned) would cover most of it
    expect(keyboard.shadow).toMatch(/inset/);
    expect(keyboard.events).toBe('none');
    expect(keyboard.position).toBe('absolute');
    expect(keyboard.scrolls).toBe(false); // the overlay's box is the stage's, which does not scroll
    for (const [side, diff] of Object.entries(await sides())) expect(Math.max(...diff), `the ${side} side`).toBeLessThanOrEqual(3);
    // Scrolled, the ring stays where it is: the same four sides.
    await page.getByTestId('pdf-scroll').evaluate((el) => el.scrollBy(0, 700));
    for (const [side, diff] of Object.entries(await sides())) expect(Math.max(...diff), `the ${side} side, scrolled`).toBeLessThanOrEqual(3);
    // After a mouse action the stage takes the focus back without a ring (the find button, pressed twice).
    await page.getByTestId('pdf-find').click();
    await expect(findBar(page)).toBeVisible();
    await page.getByTestId('pdf-find').click();
    await expect(findBar(page)).toHaveCount(0);
    await expect(stage).toBeFocused();
    const mouse = await ring();
    expect(mouse.visible).toBe(false);
    expect(mouse.shadow).toBe('none');
  } finally {
    await app.close();
  }
});
