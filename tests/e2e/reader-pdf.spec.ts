import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, backFromReader, importPaths, launch, menuItemEnabled, menuSnapshot, openExternalCalls, openItem, pdfCanvas, readClipboard, runMenuCommand, setPdfZoom, stubOpenExternal, type MenuNode } from './helpers';

const PAPER = path.join(FIXTURES, 'paper-100.pdf');
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
    await page.mouse.move(box.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, y, { steps: 8 });
    await page.mouse.up();
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

/** The one line pdf.js logs for a getPage it had in flight when its document was closed on purpose. */
const isCloseNoise = (text: string) => /^Unable to get page .*Transport destroyed/s.test(text);

test('leaving a PDF the moment its pages exist leaves no page error and no console error', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !isCloseNoise(m.text())) errors.push(m.text());
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
