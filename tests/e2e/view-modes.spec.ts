import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, closeReaderTab, importPaths, launch, menuItemEnabled, openItem, rowByTitle, runMenuCommand, setPdfZoom } from './helpers';

const PAPER = path.join(FIXTURES, 'paper-100.pdf'); // 100 pages, "See page 50." on page 1
const SAMPLE = path.join(FIXTURES, 'sample.pdf'); // 3 pages

test.beforeAll(() => {
  for (const f of [PAPER, SAMPLE]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

const viewer = (page: Page) => page.getByTestId('pdf-viewer');
const scroller = (page: Page) => page.getByTestId('pdf-scroll');
const field = (page: Page) => page.getByTestId('pdf-page-field');
const back = (page: Page) => page.getByTestId('pdf-history-back');

async function ready(page: Page) {
  await expect(viewer(page)).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  await expect(scroller(page)).toHaveAttribute('data-restored', '');
}
async function openPaper(page: Page) {
  await importPaths(page, [PAPER]);
  await openItem(page, 'paper-100');
  await ready(page);
}

/** Chooses a row of one of 보기 ▾'s submenus the way a reader does: open the menu, open the submenu, pick the row. */
async function choose(page: Page, submenu: 'scroll' | 'spread', name: string) {
  await page.getByTestId('pdf-view-menu').click();
  await page.getByTestId(`pdf-${submenu}-menu`).click();
  await page.getByRole('menuitemradio', { name }).click();
}

/** A page's box in the stage's scroll box (offset plus border, the numbers placement.ts works in). */
const box = (page: Page, n: number) =>
  page.locator(`.page[data-page-number="${n}"]`).evaluate((el) => {
    const d = el as HTMLElement;
    return { top: d.offsetTop + d.clientTop, left: d.offsetLeft + d.clientLeft, width: d.clientWidth, height: d.clientHeight };
  });
const scrollLeft = (page: Page) => scroller(page).evaluate((el) => el.scrollLeft);

test('horizontal: the pages stand in a row, → turns a page, the spread submenu is off and the left room is 24 for the first page and 12 for the others', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await choose(page, 'scroll', '가로로 이어서');
    await expect(viewer(page)).toHaveClass(/scrollHorizontal/);
    await expect(viewer(page)).toHaveAttribute('data-scroll', 'horizontal');
    const [p1, p2] = [await box(page, 1), await box(page, 2)];
    expect(p2.top).toBe(p1.top);
    expect(p2.left).toBeGreaterThan(p1.left + p1.width);
    expect(Math.round(p2.left - (p1.left + p1.width))).toBe(12);
    // 12 above and below the page: the page is fitted to the stage's height.
    const stage = await scroller(page).evaluate((el) => el.clientHeight);
    expect(Math.round(p1.top)).toBe(12);
    expect(Math.round(stage - (p1.top + p1.height))).toBe(12);

    // The spread rows are off while the scroll is horizontal.
    await page.getByTestId('pdf-view-menu').click();
    await expect(page.getByTestId('pdf-spread-menu')).toHaveAttribute('data-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect.poll(() => menuItemEnabled(app, 'reader.spreadOdd')).toBe(false);
    await expect.poll(() => menuItemEnabled(app, 'reader.scrollVertical')).toBe(true);

    // The side arrows still turn a page.
    await page.getByTestId('pdf-stage').focus();
    await page.keyboard.press('ArrowRight');
    await expect(field(page)).toHaveValue('2');
    await page.keyboard.press('ArrowLeft');
    await expect(field(page)).toHaveValue('1');

    // The left room of a page put by the page field: 24 for the first page, 12 for the rest.
    await field(page).fill('3');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('3');
    await expect.poll(async () => Math.round((await box(page, 3)).left - (await scrollLeft(page)))).toBe(12);
    await field(page).fill('1');
    await field(page).press('Enter');
    await expect.poll(async () => Math.round((await box(page, 1)).left - (await scrollLeft(page)))).toBe(24);

    // Space and PageDown scroll a stage width sideways.
    await page.getByTestId('pdf-stage').focus();
    const before = await scrollLeft(page);
    await page.keyboard.press('PageDown');
    await expect.poll(async () => (await scrollLeft(page)) - before).toBeGreaterThan(0);
    // Back to a vertical scroll: the page in view stays in view.
    await choose(page, 'scroll', '세로로 이어서');
    await expect(viewer(page)).not.toHaveClass(/scrollHorizontal/);
    await expect(viewer(page)).toHaveAttribute('data-scroll', 'vertical');
    await expect.poll(() => menuItemEnabled(app, 'reader.spreadOdd')).toBe(true);
  } finally {
    await app.close();
  }
});

test('spread: odd pairs 1·2 and 3·4, even leaves page 1 alone and pairs 2·3; next and previous turn a spread', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await choose(page, 'spread', '홀수 쪽부터');
    await expect(viewer(page)).toHaveAttribute('data-spread', 'odd');
    await expect(page.locator('.spread')).not.toHaveCount(0);
    const [a, b, c, d] = [await box(page, 1), await box(page, 2), await box(page, 3), await box(page, 4)];
    expect(b.top).toBe(a.top);
    expect(Math.round(b.left - (a.left + a.width))).toBe(12);
    expect(d.top).toBe(c.top);
    expect(c.top).toBeGreaterThan(a.top);
    // A step is a spread: 1·2 → 3·4 → back.
    await page.getByTestId('pdf-next').click();
    await expect(field(page)).toHaveValue('3');
    await page.getByTestId('pdf-prev').click();
    await expect(field(page)).toHaveValue('1');
    await expect(page.getByTestId('pdf-prev')).toBeDisabled();

    await choose(page, 'spread', '짝수 쪽부터');
    await expect(viewer(page)).toHaveAttribute('data-spread', 'even');
    const [e1, e2, e3] = [await box(page, 1), await box(page, 2), await box(page, 3)];
    expect(e2.top).toBeGreaterThan(e1.top); // page 1 stands alone
    expect(e3.top).toBe(e2.top);
    await choose(page, 'spread', '펼치지 않음');
    await expect(page.locator('.spread')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('a page at a time: one page in the stage, PageDown at its end turns the page, and the wheel does not (pdf.js 6.4.299)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await setPdfZoom(page, 1.5); // a page taller than the stage at any window size: PageDown scrolls inside it first
    await choose(page, 'scroll', '한 쪽씩');
    await expect(viewer(page)).toHaveAttribute('data-scroll', 'page');
    await expect(page.locator('.pdfViewer .page')).toHaveCount(1);
    await page.getByTestId('pdf-stage').focus();
    // The page is taller than the stage: PageDown scrolls inside it first, then turns.
    let guard = 0;
    while ((await field(page).inputValue()) === '1' && guard++ < 12) {
      await page.keyboard.press('PageDown');
      await page.waitForTimeout(60);
    }
    await expect(field(page)).toHaveValue('2');
    expect(guard).toBeGreaterThan(1);
    await expect(page.locator('.pdfViewer .page')).toHaveCount(1);
    // Backwards from the top of the page: ↑ turns to the previous page.
    await scroller(page).evaluate((el) => (el.scrollTop = 0));
    await page.keyboard.press('PageUp');
    await expect(field(page)).toHaveValue('1');

    // The wheel at the end of the page only scrolls the page: it never turns it.
    await scroller(page).evaluate((el) => (el.scrollTop = el.scrollHeight));
    await scroller(page).hover();
    await page.mouse.wheel(0, 600);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    await expect(field(page)).toHaveValue('1');
  } finally {
    await app.close();
  }
});

test('a mode change is no jump: it records nothing and leaves back and forward as they were', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await choose(page, 'scroll', '가로로 이어서');
    await expect(viewer(page)).toHaveAttribute('data-scroll', 'horizontal');
    await expect(back(page)).toBeDisabled();
    await field(page).fill('5');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('5');
    await expect(back(page)).toBeEnabled();
    await choose(page, 'scroll', '한 쪽씩');
    await expect(viewer(page)).toHaveAttribute('data-scroll', 'page');
    await choose(page, 'spread', '홀수 쪽부터');
    await choose(page, 'scroll', '세로로 이어서');
    await expect(field(page)).toHaveValue('5'); // still where it was
    // One entry only (page 1), from the one jump: back goes there, then there is nothing more.
    await back(page).click();
    await expect(field(page)).toHaveValue('1');
    await expect(back(page)).toBeDisabled();
    await expect(page.getByTestId('pdf-history-forward')).toBeEnabled();
    await page.getByTestId('pdf-history-forward').click();
    await expect(field(page)).toHaveValue('5');
  } finally {
    await app.close();
  }
});

/** Reopens the reader of `title` once the app has started again (a session may bring its tab back). */
async function reader(page: Page, title: string) {
  // The saved tabs come back with the window, a moment after it opens: wait until either that reader or the library's row
  // is shown before choosing (deciding at once raced the restore on a slower runner, CI 42387386687).
  await expect(viewer(page).or(rowByTitle(page, title)).first()).toBeVisible();
  if (!(await viewer(page).isVisible())) await openItem(page, title);
  await ready(page);
}

test('the modes are remembered for each item: the same mode and page after a restart, and another item stays vertical', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);
  try {
    await importPaths(page, [PAPER, SAMPLE]);
    await openItem(page, 'paper-100');
    await ready(page);
    await choose(page, 'scroll', '가로로 이어서');
    await field(page).fill('4');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('4');
    await page.waitForTimeout(600); // past the 300 ms save debounce
    await closeReaderTab(page);
    await openItem(page, 'sample');
    await ready(page);
    await expect(viewer(page)).toHaveAttribute('data-scroll', 'vertical'); // another item has its own
    await choose(page, 'spread', '홀수 쪽부터');
    await expect(viewer(page)).toHaveAttribute('data-spread', 'odd');
    await page.waitForTimeout(600);
    await app.close();

    ({ app, page } = await launch(lib, ud));
    await reader(page, 'sample');
    await expect(viewer(page)).toHaveAttribute('data-scroll', 'vertical');
    await expect(viewer(page)).toHaveAttribute('data-spread', 'odd');
    await expect(page.getByTestId('pdf-page-count')).toHaveText('/ 3');
    await closeReaderTab(page);
    await openItem(page, 'paper-100');
    await ready(page);
    await expect(viewer(page)).toHaveAttribute('data-scroll', 'horizontal');
    await expect(viewer(page)).toHaveClass(/scrollHorizontal/);
    await expect(field(page)).toHaveValue('4');
    await expect(page.getByTestId('pdf-page-count')).toHaveText('/ 100'); // the page count rides along with the locator
  } finally {
    await app.close();
  }
});

test('progress is not 100 % just because a page at a time fits the stage', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await choose(page, 'scroll', '한 쪽씩');
    await runMenuCommand(app, 'reader.zoomPageFit');
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => window.learn.library.list());
    if (!r.ok) throw new Error('list failed');
    expect(r.data.find((i) => i.title === 'paper-100')!.progress).toBeLessThan(0.1);
  } finally {
    await app.close();
  }
});

test('a page at a time fits the whole page with 12 above and below, and a page and an even spread are restored', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);
  try {
    await openPaper(page);
    await choose(page, 'scroll', '한 쪽씩');
    await expect(viewer(page)).toHaveAttribute('data-scroll', 'page');
    await field(page).fill('3');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('3');
    await expect(page.locator('.pdfViewer .page')).toHaveCount(1);
    const stage = await scroller(page).evaluate((el) => ({ height: el.clientHeight, scrollHeight: el.scrollHeight }));
    const p = await box(page, 3);
    expect(p.top).toBe(12);
    expect(p.height).toBeLessThanOrEqual(stage.height - 24);
    expect(stage.scrollHeight).toBe(stage.height); // nothing to scroll: the whole page is in the stage
    await choose(page, 'spread', '짝수 쪽부터');
    await expect(viewer(page)).toHaveAttribute('data-spread', 'even');
    await page.waitForTimeout(600);
    await app.close();
    ({ app, page } = await launch(lib, ud));
    await reader(page, 'paper-100');
    await expect(viewer(page)).toHaveAttribute('data-scroll', 'page');
    await expect(viewer(page)).toHaveAttribute('data-spread', 'even');
    await expect(field(page)).toHaveValue('2'); // page 3 is the second of the even spread 2·3, and the field shows the spread's first page
    await expect(page.locator('.pdfViewer .spread .page')).toHaveCount(2);
  } finally {
    await app.close();
  }
});

test('a page at a time with an odd spread, the item panel closed (the fit is limited by the height): nothing scrolls, the pairs keep no margin below', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(() => page.getByTestId('inspector-panel').evaluate((el) => el.getBoundingClientRect().width)).toBe(0);
    await choose(page, 'scroll', '한 쪽씩');
    await expect(viewer(page)).toHaveAttribute('data-scroll', 'page');
    await choose(page, 'spread', '홀수 쪽부터');
    await expect(viewer(page)).toHaveAttribute('data-spread', 'odd');
    await field(page).fill('3');
    await field(page).press('Enter');
    await expect(page.locator('.pdfViewer .spread .page')).toHaveCount(2);
    await expect.poll(() => scroller(page).evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
    expect(await page.locator('.pdfViewer .spread .page').first().evaluate((el) => getComputedStyle(el).marginBottom)).toBe('0px');
  } finally {
    await app.close();
  }
});

test('the submenu stands level with its row and 2 px over the parent menu (to the right and, with the item panel closed, to the left); → opens, ← closes, esc closes the menu', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    const geometry = async () => {
      const row = await page.getByTestId('pdf-scroll-menu').boundingBox();
      const parent = await page.getByTestId('pdf-scroll-menu').locator('xpath=ancestor::*[@role="menu"][1]').boundingBox();
      const first = page.getByRole('menuitemradio', { name: '세로로 이어서' });
      const sub = await first.locator('xpath=ancestor::*[@role="menu"][1]').boundingBox();
      const item = await first.boundingBox();
      if (!row || !parent || !sub || !item) throw new Error('no box');
      const right = sub.x > parent.x;
      return { top: Math.abs(item.y - row.y), overlap: right ? parent.x + parent.width - sub.x : sub.x + sub.width - parent.x, right };
    };
    for (const panel of [true, false]) {
      if (!panel) await runMenuCommand(app, 'view.toggleInspector');
      await page.getByTestId('pdf-view-menu').click();
      await page.getByTestId('pdf-scroll-menu').click();
      await expect(page.getByRole('menuitemradio', { name: '세로로 이어서' })).toBeVisible();
      const g = await geometry();
      expect(g.right, panel ? 'opens to the right' : 'flips to the left').toBe(panel);
      // Level with its row: within 2 px (text metrics put the rows a fraction of a pixel apart on some runners, 1.18 on CI).
      expect(g.top).toBeLessThanOrEqual(2);
      expect(g.overlap).toBeGreaterThanOrEqual(0);
      expect(g.overlap).toBeLessThanOrEqual(2);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    }
    // The keys: the row is entered with the arrow, → opens its submenu, ← closes only that, esc closes the menu.
    await page.getByTestId('pdf-view-menu').click();
    await page.getByRole('menuitemradio', { name: '앱 테마 따르기' }).focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('pdf-scroll-menu')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('menuitemradio', { name: '가로로 이어서' })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('menuitemradio', { name: '가로로 이어서' })).toHaveCount(0);
    await expect(page.getByTestId('pdf-scroll-menu')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(viewer(page)).toHaveAttribute('data-scroll', 'horizontal');
    await page.getByTestId('pdf-view-menu').click();
    await page.getByTestId('pdf-scroll-menu').click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pdf-scroll-menu')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('leaving a page at a time keeps the page: page 50 comes back as page 50 with 12 above it, and at 150 % the page stands 12 below the stage top', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await choose(page, 'scroll', '한 쪽씩');
    await field(page).fill('50');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('50');
    await choose(page, 'scroll', '세로로 이어서');
    await expect(viewer(page)).toHaveAttribute('data-scroll', 'vertical');
    await expect(field(page)).toHaveValue('50');
    await expect.poll(async () => Math.round((await box(page, 50)).top - (await scroller(page).evaluate((el) => el.scrollTop)))).toBe(12);
    await page.waitForTimeout(600);
    const listed = await page.evaluate(() => window.learn.library.list());
    if (!listed.ok) throw new Error('list failed');
    const item = listed.data.find((i) => i.title === 'paper-100')!;
    const pos = await page.evaluate((id) => window.learn.reader.getPosition({ itemId: id }), item.id);
    expect(JSON.stringify(pos)).toContain('"pageIndex":49');

    // At 150 % a page taller than the stage: switching into a page at a time puts the page 12 below the stage top, not 24.
    await setPdfZoom(page, 1.5);
    await field(page).fill('4');
    await field(page).press('Enter');
    await choose(page, 'scroll', '한 쪽씩');
    await expect(viewer(page)).toHaveClass(/scrollPage/);
    await expect.poll(async () => Math.round((await box(page, 4)).top - (await scroller(page).evaluate((el) => el.scrollTop)))).toBe(12);
    await choose(page, 'scroll', '세로로 이어서');
    await expect(viewer(page)).not.toHaveClass(/scrollPage/);
    await expect(field(page)).toHaveValue('4');
    await expect.poll(async () => Math.round((await box(page, 4)).top - (await scroller(page).evaluate((el) => el.scrollTop)))).toBe(12);
  } finally {
    await app.close();
  }
});
