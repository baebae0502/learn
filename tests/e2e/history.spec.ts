import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, importPaths, launch, libraryTab, mainWindow, openItem, readerTab, runMenuAccelerator, runMenuCommand } from './helpers';

const PAPER = path.join(FIXTURES, 'paper-100.pdf'); // 100 pages, "See page 50." on page 1, an outline of ten chapters
const SAMPLE = path.join(FIXTURES, 'sample.pdf');

test.beforeAll(() => {
  for (const f of [PAPER, SAMPLE]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

const field = (page: Page) => page.getByTestId('pdf-page-field');
const back = (page: Page) => page.getByTestId('pdf-history-back');
const forward = (page: Page) => page.getByTestId('pdf-history-forward');
const scrollTop = (page: Page) => page.getByTestId('pdf-scroll').evaluate((el) => el.scrollTop);
const pageHeight = (page: Page) => page.locator('.page[data-page-number="1"]').evaluate((el) => (el as HTMLElement).clientHeight);

async function openPaper(page: Page) {
  await importPaths(page, [PAPER]);
  await openItem(page, 'paper-100');
  await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
  await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', '');
  await expect(back(page)).toBeDisabled();
  await expect(forward(page)).toBeDisabled();
}

/** The "See page 50." link of page 1. */
const link = (page: Page) => page.locator('.page[data-page-number="1"] .annotationLayer .linkAnnotation > a').nth(0);
const clickLink = (page: Page) => link(page).click();

test('a link, then ⌘[ and ⌘]: back to the same place of page 1, forward to page 50', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await link(page).scrollIntoViewIfNeeded(); // the click would scroll it into view, and the place to come back to is the one it is clicked from
    const start = await scrollTop(page);
    await clickLink(page);
    await expect(field(page)).toHaveValue('50');
    await expect(back(page)).toBeEnabled();
    await runMenuCommand(app, 'nav.historyBack');
    await expect(field(page)).toHaveValue('1');
    expect(Math.abs((await scrollTop(page)) - start)).toBeLessThanOrEqual((await pageHeight(page)) * 0.02);
    await expect(back(page)).toBeDisabled();
    await expect(forward(page)).toBeEnabled();
    await runMenuAccelerator(app, 'nav.historyForward');
    await expect(field(page)).toHaveValue('50');
  } finally {
    await app.close();
  }
});

test('a link to a point keeps the point', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    const pointLink = page.locator('.page[data-page-number="1"] .annotationLayer .linkAnnotation > a').nth(4);
    await pointLink.scrollIntoViewIfNeeded();
    const start = await scrollTop(page);
    const startHeight = await pageHeight(page);
    await pointLink.click();
    await expect(field(page)).toHaveValue('40');
    await expect(back(page)).toBeEnabled();
    // The point (x 56, y 600 of an A4 page of 841.89 pt) is the stage's top edge: no room is added before it, as it is before a whole page.
    const landing = async () =>
      page.getByTestId('pdf-scroll').evaluate((el) => {
        const p = el.querySelector<HTMLElement>('.page[data-page-number="40"]')!;
        return { top: el.scrollTop - (p.offsetTop + p.clientTop), left: el.scrollLeft, height: p.clientHeight };
      });
    await expect
      .poll(async () => {
        const at = await landing();
        return Math.abs(at.top - ((841.89 - 600) / 841.89) * at.height);
      })
      .toBeLessThanOrEqual(2);
    const at = await landing();
    expect(at.top).toBeGreaterThan(at.height * 0.2); // not the page's top, nor 12 px above it
    await runMenuCommand(app, 'nav.historyBack');
    await expect(field(page)).toHaveValue('1');
    expect(Math.abs((await scrollTop(page)) - start)).toBeLessThanOrEqual(startHeight * 0.02);
    await runMenuAccelerator(app, 'nav.historyForward');
    await expect(field(page)).toHaveValue('40');
    const again = await landing();
    expect(Math.abs(again.top - at.top)).toBeLessThanOrEqual(startHeight * 0.02);
  } finally {
    await app.close();
  }
});

test('forward returns to where you last were, not to the link target', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await clickLink(page);
    await expect(field(page)).toHaveValue('50');
    const scroll = page.getByTestId('pdf-scroll');
    await scroll.evaluate((el) => {
      const p52 = el.querySelector<HTMLElement>('.page[data-page-number="52"]')!;
      el.scrollTop = p52.offsetTop + p52.clientTop + p52.clientHeight * 0.3;
    });
    await expect(field(page)).toHaveValue('52');
    const there = await scrollTop(page);
    const height = await pageHeight(page);
    await runMenuCommand(app, 'nav.historyBack');
    await expect(field(page)).toHaveValue('1');
    await runMenuCommand(app, 'nav.historyForward');
    await expect(field(page)).toHaveValue('52');
    expect(Math.abs((await scrollTop(page)) - there)).toBeLessThanOrEqual(height * 0.02);
  } finally {
    await app.close();
  }
});

test('going back before the link target\'s text layer is drawn stays back: pdf.js\'s late focus of that page does not pull the view to it', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await link(page).scrollIntoViewIfNeeded();
    const start = await scrollTop(page);
    // Text layers are held back: their render events are kept and let through when released.
    await page.evaluate(() => {
      const bus = (window as unknown as { __learnReader: { getState(): { handle: { eventBus(): { dispatch(name: string, data: unknown): void } } } } }).__learnReader.getState().handle.eventBus();
      const dispatch = bus.dispatch.bind(bus);
      const held: Array<[string, unknown]> = [];
      let holding = true;
      bus.dispatch = (name, data) => {
        if (holding && name === 'textlayerrendered') held.push([name, data]);
        else dispatch(name, data);
      };
      (window as unknown as { releaseTextLayers: () => void }).releaseTextLayers = () => {
        holding = false;
        for (const [name, data] of held.splice(0)) dispatch(name, data);
      };
    });
    await clickLink(page);
    await expect(field(page)).toHaveValue('50');
    await runMenuCommand(app, 'nav.historyBack');
    await expect(field(page)).toHaveValue('1');
    await page.evaluate(() => (window as unknown as { releaseTextLayers: () => void }).releaseTextLayers());
    await page.waitForTimeout(500);
    await expect(field(page)).toHaveValue('1');
    expect(Math.abs((await scrollTop(page)) - start)).toBeLessThanOrEqual((await pageHeight(page)) * 0.02);
  } finally {
    await app.close();
  }
});

test('a page turn right after a link, before its text layer is drawn, stays on the turned page', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await page.evaluate(() => {
      const bus = (window as unknown as { __learnReader: { getState(): { handle: { eventBus(): { dispatch(name: string, data: unknown): void } } } } }).__learnReader.getState().handle.eventBus();
      const dispatch = bus.dispatch.bind(bus);
      const held: Array<[string, unknown]> = [];
      let holding = true;
      bus.dispatch = (name, data) => {
        if (holding && name === 'textlayerrendered') held.push([name, data]);
        else dispatch(name, data);
      };
      (window as unknown as { releaseTextLayers: () => void }).releaseTextLayers = () => {
        holding = false;
        for (const [name, data] of held.splice(0)) dispatch(name, data);
      };
    });
    await clickLink(page);
    await expect(field(page)).toHaveValue('50');
    await page.getByTestId('pdf-next').click();
    await expect(field(page)).toHaveValue('51');
    const at = await scrollTop(page);
    await page.evaluate(() => (window as unknown as { releaseTextLayers: () => void }).releaseTextLayers());
    await page.waitForTimeout(500);
    await expect(field(page)).toHaveValue('51');
    expect(Math.abs((await scrollTop(page)) - at)).toBeLessThanOrEqual((await pageHeight(page)) * 0.02);
  } finally {
    await app.close();
  }
});

test('the page group does not move when forward turns on or off, and the pair sits 2 apart', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    const left = (id: string) => page.getByTestId(id).evaluate((el) => el.getBoundingClientRect().left);
    const zoom = () => page.locator('.reader-toolbar .zoom-field').evaluate((el) => el.getBoundingClientRect().left);
    const off = { field: await left('pdf-page-field'), zoom: await zoom(), forward: await left('pdf-history-forward'), back: await left('pdf-history-back') };
    expect(off.forward - off.back).toBe(30); // 28 and 2
    expect(off.field - off.back).toBe(64); // the mockup: 252 and 316
    await field(page).fill('9');
    await field(page).press('Enter');
    await expect(back(page)).toBeEnabled(); // back on, forward off
    expect({ field: await left('pdf-page-field'), zoom: await zoom() }).toEqual({ field: off.field, zoom: off.zoom });
    await back(page).click();
    await expect(forward(page)).toBeEnabled(); // both on
    await expect(back(page)).toBeDisabled();
    expect({ field: await left('pdf-page-field'), zoom: await zoom() }).toEqual({ field: off.field, zoom: off.zoom });
    await field(page).fill('4');
    await field(page).press('Enter');
    await expect(back(page)).toBeEnabled();
    await expect(forward(page)).toBeDisabled();
    expect({ field: await left('pdf-page-field'), zoom: await zoom() }).toEqual({ field: off.field, zoom: off.zoom });
  } finally {
    await app.close();
  }
});

test('a jump to the page already shown leaves nothing to go back to', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await field(page).fill('1');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('1');
    await expect(back(page)).toBeDisabled();
  } finally {
    await app.close();
  }
});

test('the outline, a thumbnail and the page field are jumps; the page turns and scrolling are not', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    // Not jumps: the chevrons, the keys and the scroll leave nothing to go back to.
    await page.getByTestId('pdf-next').click();
    await expect(field(page)).toHaveValue('2');
    await page.getByTestId('pdf-prev').click();
    await expect(field(page)).toHaveValue('1');
    await page.getByTestId('pdf-scroll').evaluate((el) => (el.scrollTop = 4000));
    await expect(field(page)).not.toHaveValue('1');
    await expect(back(page)).toBeDisabled();
    await page.getByTestId('pdf-scroll').evaluate((el) => (el.scrollTop = 0));
    await expect(field(page)).toHaveValue('1');

    // The outline.
    await runMenuCommand(app, 'reader.showOutline');
    await page.getByTestId('pdf-outline').getByRole('row', { name: /Chapter 3/ }).first().click();
    await expect(field(page)).toHaveValue('21');
    await runMenuCommand(app, 'nav.historyBack');
    await expect(field(page)).toHaveValue('1');

    // A thumbnail (a jump to a new place: what was ahead is gone).
    await runMenuCommand(app, 'reader.showThumbnails');
    await page.getByTestId('pdf-thumbnails').evaluate((el) => {
      for (let e: Element | null = el; e; e = e.parentElement) e.scrollTop = 0;
    });
    await page.locator('[data-testid="pdf-thumb"][data-page="3"]').click();
    await expect(field(page)).toHaveValue('3');
    await expect(forward(page)).toBeDisabled();
    await runMenuCommand(app, 'nav.historyBack');
    await expect(field(page)).toHaveValue('1');

    // The page field.
    await field(page).fill('7');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('7');
    await runMenuCommand(app, 'nav.historyBack');
    await expect(field(page)).toHaveValue('1');
  } finally {
    await app.close();
  }
});

test('a new jump after going back drops what was ahead; the toolbar buttons follow the list', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await field(page).fill('10');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('10');
    await field(page).fill('20');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('20');
    await back(page).click();
    await expect(field(page)).toHaveValue('10');
    await expect(forward(page)).toBeEnabled();
    await expect(back(page)).toBeEnabled();
    await field(page).fill('30');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('30');
    await expect(forward(page)).toBeDisabled();
    await back(page).click();
    await expect(field(page)).toHaveValue('10');
    await back(page).click();
    await expect(field(page)).toHaveValue('1');
    await expect(back(page)).toBeDisabled();
    await forward(page).click();
    await expect(field(page)).toHaveValue('10');
    // The toolbar names the keys.
    await expect(back(page)).toHaveAttribute('aria-label', '뒤로');
  } finally {
    await app.close();
  }
});

test("the mouse's side buttons: 3 goes back and 4 forward, on the stage", async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await openPaper(page);
    await field(page).fill('12');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('12');
    const press = (button: number) =>
      page.getByTestId('pdf-stage').evaluate((el, button) => {
        const down = new MouseEvent('mousedown', { button, bubbles: true, cancelable: true });
        el.dispatchEvent(down);
        el.dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true, cancelable: true }));
        return down.defaultPrevented;
      }, button);
    expect(await press(3)).toBe(true); // the browser's own history is kept from taking the window back
    await expect(field(page)).toHaveValue('1');
    expect(await press(4)).toBe(true);
    await expect(field(page)).toHaveValue('12');
    expect(await press(0)).toBe(false); // the main button is untouched
  } finally {
    await app.close();
  }
});

test('each tab has its own history, which stays when the tab is pushed out of the four kept ones', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const dir = testInfo.outputPath('src');
    fs.mkdirSync(dir, { recursive: true });
    const copies = Array.from({ length: 4 }, (_, i) => {
      const file = path.join(dir, `doc-${i + 1}.pdf`);
      fs.copyFileSync(SAMPLE, file);
      fs.appendFileSync(file, `\n% copy ${i + 1}\n`);
      return file;
    });
    const [paper] = await importPaths(page, [PAPER, ...copies]);
    await openItem(page, 'paper-100');
    await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', '');
    await field(page).fill('9');
    await field(page).press('Enter');
    await expect(field(page)).toHaveValue('9');
    await expect(back(page)).toBeEnabled();

    // A second tab starts with none.
    await libraryTab(page).click();
    await openItem(page, 'doc-1');
    await expect(page.locator('[data-testid="tab-panel"][data-active="true"] [data-testid="pdf-scroll"]')).toHaveAttribute('data-restored', '');
    await expect(back(page)).toBeDisabled();

    // Four more readers push the first out of the kept ones; it comes back with its list.
    for (const title of ['doc-2', 'doc-3', 'doc-4']) {
      await libraryTab(page).click();
      await openItem(page, title);
      await expect(page.locator('[data-testid="tab-panel"][data-active="true"] [data-testid="pdf-page-field"]')).toBeVisible();
    }
    await expect(page.locator(`[data-testid="tab-panel"][data-item-id="${paper!.id}"]`)).toHaveCount(0);
    await readerTab(page, paper!.id).click();
    await expect(page.locator(`[data-testid="tab-panel"][data-item-id="${paper!.id}"]`)).toHaveAttribute('data-active', 'true');
    await expect(back(page)).toBeEnabled();
    await back(page).click();
    await expect(field(page)).toHaveValue('1');
  } finally {
    await app.close();
  }
});

test('with the item panel open at the narrowest window the reader is 440 wide: the page count gives way and the toolbar fits at 15 pt', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    expect(await page.evaluate(() => window.learn.prefs.set({ fontSize: 15 }))).toMatchObject({ ok: true });
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1000, w.getContentSize()[1]!));
    await openPaper(page);
    await expect(page.getByTestId('inspector-panel')).toBeVisible();
    const toolbar = page.getByTestId('reader-toolbar');
    const reader = await page.locator('.reader').first().boundingBox();
    expect(reader!.width).toBeLessThan(480);
    await expect(page.getByTestId('pdf-page-count')).toBeHidden();
    const overflow = await toolbar.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, right: Math.max(...[...el.children].map((c) => c.getBoundingClientRect().right)), box: el.getBoundingClientRect().right }));
    expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
    expect(overflow.right).toBeLessThanOrEqual(overflow.box + 0.5);
    // Wider, the count is back.
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1280, w.getContentSize()[1]!));
    await expect(page.getByTestId('pdf-page-count')).toBeVisible();
  } finally {
    await app.close();
  }
});

