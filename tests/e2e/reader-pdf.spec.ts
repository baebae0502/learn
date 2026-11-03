import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, importPaths, launch, openExternalCalls, openItem, pdfCanvas, readClipboard, stubOpenExternal } from './helpers';

const PAPER = path.join(FIXTURES, 'paper-100.pdf');
const KOREAN = path.join(FIXTURES, 'korean.pdf');
const LOCKED = path.join(FIXTURES, 'locked.pdf');

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
