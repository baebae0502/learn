import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, backFromReader, hardKill, importPaths, launch, libraryTab, mainWindow, openItem, readerTab, runMenuCommand, trashItems } from './helpers';

const PAPER = path.join(FIXTURES, 'paper-100.pdf'); // 100 pages
const PAGE = 7;

test.beforeAll(() => {
  if (!fs.existsSync(PAPER)) throw new Error(`fixture missing: ${PAPER} — run \`pnpm fixtures\``);
});

/** The page the reader's field shows once the restore has been applied. */
async function goToPage(page: Page, n: number) {
  await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', /.*/);
  await page.evaluate((target) => (window as unknown as { __learnReader: { getState(): { handle: { goToPage(n: number): void } } } }).__learnReader.getState().handle.goToPage(target), n);
  await expect(page.getByTestId('pdf-page-field')).toHaveValue(String(n));
}

const tabsSetting = async (page: Page) => {
  const r = await page.evaluate(() => window.learn.settings.get({ key: 'ui.tabs' }));
  return r.ok ? r.data : null;
};

/** Both the session record and the reading position are stored, as a hard kill gives no other chance. */
async function stored(page: Page, itemId: string) {
  await expect
    .poll(async () => {
      const tabs = await page.evaluate(() => window.learn.settings.get({ key: 'ui.tabs' }));
      const pos = await page.evaluate((id) => window.learn.reader.getPosition({ itemId: id }), itemId);
      const tabsOk = tabs.ok && JSON.stringify(tabs.data) === JSON.stringify({ items: [itemId], active: itemId });
      const pageIndex = pos.ok && pos.data?.locator?.kind === 'pdf' ? pos.data.locator.pageIndex : -1;
      return tabsOk && pageIndex === PAGE - 1;
    })
    .toBe(true);
}

for (const how of ['a graceful quit', 'a hard kill'] as const) {
  test(`a reader open at quit reopens on launch, at its place (${how})`, async ({}, testInfo) => {
    const lib = testInfo.outputPath('library');
    const ud = testInfo.outputPath('userdata');
    let { app, page } = await launch(lib, ud);
    let closed = false;
    try {
      const [imported] = await importPaths(page, [PAPER]);
      await openItem(page, 'paper-100');
      await goToPage(page, PAGE);
      if (how === 'a hard kill') await stored(page, imported!.id);
      if (how === 'a hard kill') await hardKill(app);
      else await app.close();
      closed = true;
      ({ app, page } = await launch(lib, ud));
      closed = false;

      // No library flash: the window opens straight on the reader, at the page it was left on.
      await expect(page.getByTestId('pdf-page-field')).toHaveValue(String(PAGE));
      await expect(page.getByTestId('library-table')).toHaveCount(0);
    } finally {
      if (!closed) await app.close().catch(() => {});
    }
  });
}

for (const gone of ['trashed', 'purged'] as const) {
  test(`an item ${gone} before quit: ${gone === 'trashed' ? 'its tab is restored and shows the trash notice' : 'its tab is gone on launch'}`, async ({}, testInfo) => {
    const lib = testInfo.outputPath('library');
    const ud = testInfo.outputPath('userdata');
    let { app, page } = await launch(lib, ud);
    let closed = false;
    try {
      const [imported] = await importPaths(page, [PAPER]);
      await openItem(page, 'paper-100');
      await expect(page.getByTestId('pdf-page-field')).toBeVisible();
      await trashItems(page, [imported!.id]);
      await expect(page.getByTestId('reader-trashed')).toBeVisible();
      if (gone === 'purged') {
        const r = await page.evaluate((id) => window.learn.library.purge({ itemIds: [id], collectionIds: [] }), imported!.id);
        expect(r.ok).toBe(true);
      }
      await expect
        .poll(async () => JSON.stringify(await tabsSetting(page)))
        .toBe(JSON.stringify({ items: [imported!.id], active: imported!.id }));
      await app.close();
      closed = true;
      ({ app, page } = await launch(lib, ud));
      closed = false;
      if (gone === 'trashed') {
        await expect(page.getByTestId('reader-trashed')).toBeVisible();
        await expect(page.getByTestId('open-failed')).toHaveCount(0);
        const r = await page.evaluate(() => window.learn.settings.get({ key: 'ui.tabs' }));
        expect(r.ok && r.data).toEqual({ items: [imported!.id], active: imported!.id });
      } else {
        // The library is empty, so it shows its empty state: what matters is that no reader is left.
        await expect
          .poll(async () => JSON.stringify(await tabsSetting(page)))
          .toBe(JSON.stringify({ items: [], active: null }));
        await expect(page.getByTestId('tab-bar')).toHaveCount(0);
      }
    } finally {
      if (!closed) await app.close().catch(() => {});
    }
  });
}


const SAMPLE = path.join(FIXTURES, 'sample.pdf');
const VIDEO = path.join(FIXTURES, 'sample-h264-aac.mp4');

/** `count` distinct PDFs under `dir` (one byte string after the end of each, so none is a duplicate of another). */
function pdfCopies(dir: string, count: number): string[] {
  fs.mkdirSync(dir, { recursive: true });
  return Array.from({ length: count }, (_, i) => {
    const file = path.join(dir, `doc-${String(i + 1).padStart(2, '0')}.pdf`);
    fs.copyFileSync(SAMPLE, file);
    fs.appendFileSync(file, `\n% copy ${i + 1}\n`);
    return file;
  });
}

const reader = (page: Page) => page.evaluate(() => (window as unknown as { __learnReader: { getState(): { pdf: { pageNumber: number; ready: boolean } | null } } }).__learnReader.getState().pdf);
const readerTabIds = (page: Page) => page.locator('[data-testid="tab"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')));
const panels = (page: Page) => page.getByTestId('tab-panel');

test('opening items makes tabs; the library tab switches back and forth', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [a, b] = await importPaths(page, pdfCopies(testInfo.outputPath('src'), 2));
    // One tab only: no strip, the window toolbar of the library.
    await expect(page.getByTestId('tab-bar')).toHaveCount(0);
    await openItem(page, 'doc-01');
    await expect(page.getByTestId('pdf-page-field')).toBeVisible();
    await libraryTab(page).click();
    await expect(page.getByTestId('library-table')).toBeVisible();
    await openItem(page, 'doc-02');
    await expect(readerTab(page, b!.id)).toHaveAttribute('aria-selected', 'true');
    expect((await readerTabIds(page))[0]).toBe('library');
    await expect(page.locator('[data-testid="tab"]')).toHaveCount(3);

    await libraryTab(page).click();
    await expect(libraryTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('library-table')).toBeVisible();
    // The library's head moves under the strip while reader tabs exist.
    await expect(page.getByTestId('library-head')).toBeVisible();
    // The search field is 240 wide there as in the toolbar.
    expect(Math.round((await page.locator('.pane-header .library-search').boundingBox())!.width)).toBe(240);

    await readerTab(page, a!.id).click();
    await expect(readerTab(page, a!.id)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('library-table')).toHaveCount(0);
    await expect(page.locator(`[data-testid="tab-panel"][data-item-id="${a!.id}"]`)).toHaveAttribute('data-active', 'true');
    await expect(page.locator(`[data-testid="tab-panel"][data-item-id="${b!.id}"]`)).toHaveAttribute('data-active', 'false');
  } finally {
    await app.close();
  }
});

test('a kept tab comes back at once, with its find bar and place', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [, b] = await importPaths(page, [PAPER, ...pdfCopies(testInfo.outputPath('src'), 1)]);
    await openItem(page, 'paper-100');
    await goToPage(page, 30);
    await runMenuCommand(app, 'library.find');
    await expect(page.getByTestId('pdf-find-bar')).toBeVisible();
    await page.keyboard.type('attention');
    const marks = () => page.locator('[data-testid="tab-panel"][data-active="true"] .textLayer .highlight').count();
    await expect.poll(marks).toBeGreaterThan(0);
    // A mark on the viewer's own element: a viewer built again would not have it.
    await page.evaluate(() => document.querySelector('[data-testid="pdf-viewer"]')!.setAttribute('data-mark', 'kept'));

    await libraryTab(page).click();
    await openItem(page, 'doc-01');
    await expect(readerTab(page, b!.id)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('pdf-page-field')).toBeVisible();
    await expect(page.locator('[data-testid="pdf-find-bar"]')).toBeHidden(); // the other tab's, kept open and hidden with it
    await expect(page.getByTestId('pdf-find-bar')).toHaveCount(0);

    await page.locator('[data-testid="tab"]:has-text("paper-100")').click();
    await expect(page.getByTestId('pdf-find-bar')).toBeVisible();
    // The matches are marked in the pages again, not only counted.
    await expect.poll(marks).toBeGreaterThan(0);
    // Closed (the marks go with the bar) and opened again with the query it kept: the marks come back with the bar.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pdf-find-bar')).toHaveCount(0);
    await expect.poll(marks).toBe(0);
    await runMenuCommand(app, 'library.find');
    await expect(page.getByTestId('pdf-find-bar')).toBeVisible();
    await expect.poll(marks).toBeGreaterThan(0);
    await expect(page.getByTestId('pdf-page-field')).toHaveValue('30');
    expect((await reader(page))!.pageNumber).toBe(30);
    await expect(page.locator('[data-testid="pdf-viewer"][data-mark="kept"]')).toHaveCount(1);
    // The scroll stood where it was: no jump back to the first page afterwards either.
    await page.waitForTimeout(600);
    await expect(page.getByTestId('pdf-page-field')).toHaveValue('30');
  } finally {
    await app.close();
  }
});

test('a fifth reader tab unmounts the oldest, which reopens at its saved place', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await importPaths(page, [PAPER, ...pdfCopies(testInfo.outputPath('src'), 4)]);
    await openItem(page, 'paper-100');
    await goToPage(page, 40);
    // The position is stored when the reader leaves the screen's mounted set; wait for the 300 ms save of the page change.
    await expect.poll(async () => {
      const r = await page.evaluate((id) => window.learn.reader.getPosition({ itemId: id }), items[0]!.id);
      return r.ok && r.data?.locator?.kind === 'pdf' ? r.data.locator.pageIndex : -1;
    }).toBe(39);
    for (const title of ['doc-01', 'doc-02', 'doc-03', 'doc-04']) {
      await libraryTab(page).click();
      await openItem(page, title);
      await expect(page.getByTestId('pdf-page-field')).toBeVisible();
      await expect(page.locator('[data-testid="tab-panel"][data-active="true"]')).toHaveCount(1);
    }
    await expect(page.locator('[data-testid="tab"]')).toHaveCount(6);
    await expect(panels(page)).toHaveCount(4);
    await expect(page.locator(`[data-testid="tab-panel"][data-item-id="${items[0]!.id}"]`)).toHaveCount(0);

    await readerTab(page, items[0]!.id).click();
    await expect(page.locator(`[data-testid="tab-panel"][data-item-id="${items[0]!.id}"]`)).toHaveAttribute('data-active', 'true');
    await expect(page.getByTestId('pdf-page-field')).toHaveValue('40');
    await expect(panels(page)).toHaveCount(4);
  } finally {
    await app.close();
  }
});

test('a hidden tab does not refit while the window changes size', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [a] = await importPaths(page, [PAPER, ...pdfCopies(testInfo.outputPath('src'), 1)]);
    const win = await mainWindow(app);
    await win.evaluate((w) => w.setContentSize(1024, w.getContentSize()[1]!));
    await openItem(page, 'paper-100');
    await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', /.*/);
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-zoom', 'auto');
    // Counts the scale changes of A's own bus, wherever the tab is.
    await page.evaluate(() => {
      const w = window as unknown as { __learnReader: { getState(): { handle: { eventBus(): { on(n: string, f: () => void): void } } } }; __scaled?: number };
      w.__scaled = 0;
      w.__learnReader.getState().handle.eventBus().on('scalechanging', () => void (w.__scaled = (w.__scaled ?? 0) + 1));
    });
    await libraryTab(page).click();
    await openItem(page, 'doc-01');
    await expect(page.getByTestId('pdf-page-field')).toBeVisible();
    await win.evaluate((w) => w.setContentSize(1280, w.getContentSize()[1]!));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(1200);
    await page.waitForTimeout(500);
    const scaled = () => page.evaluate(() => (window as unknown as { __scaled: number }).__scaled);
    expect(await scaled()).toBe(0);

    await readerTab(page, a!.id).click();
    await expect(readerTab(page, a!.id)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(scaled).toBe(1);
    await page.waitForTimeout(500);
    expect(await scaled()).toBe(1);
  } finally {
    await app.close();
  }
});

test('a hidden video stops', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [VIDEO, ...pdfCopies(testInfo.outputPath('src'), 1)]);
    await openItem(page, 'sample-h264-aac');
    const video = page.getByTestId('video');
    await video.evaluate((v: HTMLVideoElement) => v.play());
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
    await libraryTab(page).click();
    await openItem(page, 'doc-01');
    await expect(page.getByTestId('pdf-page-field')).toBeVisible();
    await expect.poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  } finally {
    await app.close();
  }
});

test('the tab strip scrolls to keep the active tab in view', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await importPaths(page, pdfCopies(testInfo.outputPath('src'), 12));
    for (let i = 1; i <= 12; i++) {
      if (i > 1) await libraryTab(page).click();
      await openItem(page, `doc-${String(i).padStart(2, '0')}`);
      await expect(page.locator('[data-testid="tab"]')).toHaveCount(i + 1);
    }
    const last = readerTab(page, items.find((x) => x.title === 'doc-12')!.id);
    await expect(last).toHaveAttribute('aria-selected', 'true');
    const inside = async (tab: typeof last) => {
      const t = (await tab.boundingBox())!;
      const s = (await page.getByTestId('tab-scroll').boundingBox())!;
      return t.x >= s.x - 1 && t.x + t.width <= s.x + s.width + 1;
    };
    await expect.poll(() => inside(last)).toBe(true);
    // The library tab stays at the strip's start, outside the scrolling part.
    const lib = (await libraryTab(page).boundingBox())!;
    const strip = (await page.getByTestId('tab-bar').boundingBox())!;
    expect(lib.x - strip.x).toBeLessThan(40);
    // The scroll box is as tall as the strip's tabs' row (a ring and a shadow are not clipped).
    const box = (await page.getByTestId('tab-scroll').boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(strip.height - 1);
    // The hairline between two inactive tabs is 16 high (a 28 px tab, 6 above and below).
    const hairline = await page.evaluate(() => {
      const items = [...document.querySelectorAll<HTMLElement>('.tabs-scroll > .tab-item')];
      const el = items[5]!;
      return getComputedStyle(el, '::before').height;
    });
    expect(hairline).toBe('16px');
    // Back to the first: it scrolls into view too.
    const first = readerTab(page, items.find((x) => x.title === 'doc-01')!.id);
    await first.scrollIntoViewIfNeeded();
    await first.click();
    await expect.poll(() => inside(first)).toBe(true);
  } finally {
    await app.close();
  }
});

test("the window's title is the active tab's", async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, pdfCopies(testInfo.outputPath('src'), 2));
    const title = async () => (await mainWindow(app)).evaluate((w) => w.getTitle());
    await openItem(page, 'doc-01');
    await expect.poll(title).toBe('doc-01');
    await libraryTab(page).click();
    await openItem(page, 'doc-02');
    await expect.poll(title).toBe('doc-02');
    await page.locator('[data-testid="tab"]:has-text("doc-01")').click();
    await expect.poll(title).toBe('doc-01');
    await backFromReader(page);
    await expect.poll(title).not.toMatch(/^doc-0/);
  } finally {
    await app.close();
  }
});


test('a kept locked tab shown again has its password field focused; a kept reader takes the focus back to its stage', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [path.join(FIXTURES, 'locked.pdf'), ...pdfCopies(testInfo.outputPath('src'), 1)]);
    await openItem(page, 'locked');
    await expect(page.getByTestId('pdf-password')).toBeFocused();
    await libraryTab(page).click();
    await openItem(page, 'doc-01');
    await expect(page.getByTestId('pdf-page-field')).toBeVisible();
    // By the pointer, from the strip: the content takes the focus as a browser tab does.
    await page.locator('[data-testid="tab"]:has-text("locked")').click();
    await expect(page.getByTestId('pdf-password')).toBeFocused();
    await page.locator('[data-testid="tab"]:has-text("doc-01")').click();
    await expect(page.getByTestId('pdf-stage')).toBeFocused();
  } finally {
    await app.close();
  }
});

test('the empty part of the tab strip drags the window; the tabs do not', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, pdfCopies(testInfo.outputPath('src'), 1));
    await openItem(page, 'doc-01');
    await expect(page.getByTestId('tab-bar')).toBeVisible();
    const regions = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>('[data-testid="tab-bar"]')!;
      const tabs = document.querySelector<HTMLElement>('.tabs')!;
      const last = [...document.querySelectorAll<HTMLElement>('.tab-item')].at(-1)!.getBoundingClientRect();
      const at = document.elementFromPoint(last.right + 100, last.top + last.height / 2)!;
      return {
        empty: (getComputedStyle(at) as CSSStyleDeclaration & { webkitAppRegion: string }).webkitAppRegion,
        emptyIsStrip: bar.contains(at),
        tab: (getComputedStyle(document.querySelector('.tab-item')!) as CSSStyleDeclaration & { webkitAppRegion: string }).webkitAppRegion,
        list: (getComputedStyle(tabs) as CSSStyleDeclaration & { webkitAppRegion: string }).webkitAppRegion,
      };
    });
    expect(regions).toEqual({ empty: 'drag', emptyIsStrip: true, tab: 'no-drag', list: 'drag' });
  } finally {
    await app.close();
  }
});
