import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  FIXTURES, backFromReader, confirmCalls, createCollection, addToCollection, hardKill, importPaths, launch, libraryTab, mainWindow, menuItemEnabled, openItem, readerTab, recordedPopupPoints, recordedPopups,
  holdOpenDialog, releaseOpenDialog, rowByTitle, runMenuCommand, runPalette, selectRows, showItemPanel, stubConfirm, stubContextMenu, trashItems, windowKinds,
} from './helpers';

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
/** The order and the shown tab of the saved session: its `known` names (R38) are checked on their own. */
const sessionOf = (value: unknown) => {
  const v = value as { items: string[]; active: string | null } | null;
  return v === null ? null : { items: v.items, active: v.active };
};

/** Both the session record and the reading position are stored, as a hard kill gives no other chance. */
async function stored(page: Page, itemId: string) {
  await expect
    .poll(async () => {
      const tabs = await page.evaluate(() => window.learn.settings.get({ key: 'ui.tabs' }));
      const pos = await page.evaluate((id) => window.learn.reader.getPosition({ itemId: id }), itemId);
      const tabsOk = tabs.ok && JSON.stringify(sessionOf(tabs.data)) === JSON.stringify({ items: [itemId], active: itemId });
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
        // Deleted for good while open: the tab goes at once, and the session record with it.
        await expect(page.getByTestId('tab-bar')).toHaveCount(0);
      }
      if (gone === 'trashed') {
        await expect
          .poll(async () => JSON.stringify(sessionOf(await tabsSetting(page))))
          .toBe(JSON.stringify({ items: [imported!.id], active: imported!.id }));
      } else {
        // Nothing to keep (the record may never have been written: the tab was gone within the 300 ms before the save).
        await expect.poll(async () => JSON.stringify(await tabsSetting(page))).toMatch(/^(null|\{"items":\[\],"active":null\})$/);
      }
      await app.close();
      closed = true;
      ({ app, page } = await launch(lib, ud));
      closed = false;
      if (gone === 'trashed') {
        await expect(page.getByTestId('reader-trashed')).toBeVisible();
        await expect(page.getByTestId('open-failed')).toHaveCount(0);
        // The trash hides the item from the library list and from library.get: the tab still names it (library.detail reads the trash).
        await expect(readerTab(page, imported!.id)).toHaveAccessibleName('paper-100');
        await expect(readerTab(page, imported!.id)).toHaveAttribute('title', 'paper-100');
        await expect(page.getByRole('tabpanel', { name: 'paper-100' })).toHaveAttribute('data-item-id', imported!.id);
        await expect.poll(() => page.title()).toBe('paper-100');
        // The record keeps the name the tab last showed (R38), the item being in the trash or not.
        await expect
          .poll(() => tabsSetting(page))
          .toEqual({ items: [imported!.id], active: imported!.id, known: { [imported!.id]: { title: 'paper-100', type: 'pdf' } } });
      } else {
        // The library is empty, so it shows its empty state: what matters is that no reader is left.
        await expect.poll(async () => JSON.stringify(await tabsSetting(page))).toMatch(/^(null|\{"items":\[\],"active":null\})$/);
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


// ---- Task 6: tab commands, the tab menu, dragging ------------------------------------------------------------------

/** The tab strip's tabs, left to right (the library tab first). */
const order = (page: Page) => readerTabIds(page);
const activeTab = (page: Page) => page.locator('[data-testid="tab"][aria-selected="true"]').getAttribute('data-item-id');
/** Opens the items as tabs behind the library with ⌘↩ (the menu item), so the library stays shown. */
async function openBehind(app: Parameters<typeof runMenuCommand>[0], page: Page, titles: readonly string[]) {
  await selectRows(page, titles);
  await runMenuCommand(app, 'item.openInBackground');
}
/** Three PDFs imported and opened as tabs, in the order doc-01, doc-02, doc-03, the last one shown. */
async function threeTabs(app: Parameters<typeof runMenuCommand>[0], page: Page, dir: string) {
  const items = await importPaths(page, pdfCopies(dir, 3));
  for (const title of ['doc-01', 'doc-02', 'doc-03']) await openBehind(app, page, [title]);
  await readerTab(page, items.find((i) => i.title === 'doc-03')!.id).click();
  await expect(page.getByTestId('pdf-page-field')).toBeVisible();
  return items;
}

test('⌘↩ opens behind: the shown tab stays, a second ⌘↩ on an open item does nothing, several go to the end in table order', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await importPaths(page, pdfCopies(testInfo.outputPath('src'), 3));
    const id = (title: string) => items.find((i) => i.title === title)!.id;
    await expect(page.getByTestId('tab-bar')).toHaveCount(0);
    await openBehind(app, page, ['doc-02']);
    await expect(page.getByTestId('tab-bar')).toBeVisible();
    await expect.poll(() => order(page)).toEqual(['library', id('doc-02')]);
    await expect.poll(() => activeTab(page)).toBe('library');
    await expect(page.getByTestId('library-table')).toBeVisible();
    // The same item again: nothing new.
    await openBehind(app, page, ['doc-02']);
    await expect.poll(() => order(page)).toEqual(['library', id('doc-02')]);
    // Two at once, to the end, in the order the table shows them (newest first).
    await selectRows(page, ['doc-01', 'doc-03']);
    await runMenuCommand(app, 'item.openInBackground');
    await expect.poll(() => order(page)).toEqual(['library', id('doc-02'), id('doc-03'), id('doc-01')]);
    await expect.poll(() => activeTab(page)).toBe('library');
    // The reader's menu has no table selection: off there.
    await readerTab(page, id('doc-02')).click();
    await expect.poll(() => menuItemEnabled(app, 'item.openInBackground')).toBe(false);
  } finally {
    await app.close();
  }
});

test('↩ on several selected rows opens a tab each and shows the first one; the item menu names the number', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await importPaths(page, pdfCopies(testInfo.outputPath('src'), 4));
    const id = (title: string) => items.find((i) => i.title === title)!.id;
    await selectRows(page, ['doc-01', 'doc-03', 'doc-04']);
    // The item menu (right-click inside the selection acts on all three): "탭 3개로 열기", "새 탭 3개로 열기".
    await stubContextMenu(app, null);
    await rowByTitle(page, 'doc-03').click({ button: 'right' });
    await expect.poll(async () => (await recordedPopups(app)).length).toBe(1);
    const labels = (await recordedPopups(app))[0]!.map((i) => i.label);
    expect(labels.slice(0, 2)).toEqual(['탭 3개로 열기', '새\u00a0탭 3개로 열기']);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="tab"]')).toHaveCount(4);
    // Table order is newest first: doc-04, doc-03, doc-01; the first of them is shown.
    await expect.poll(() => order(page)).toEqual(['library', id('doc-04'), id('doc-03'), id('doc-01')]);
    await expect.poll(() => activeTab(page)).toBe(id('doc-04'));
    await expect(page.getByTestId('pdf-page-field')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('eleven items ask first; cancelling opens nothing, confirming opens them all', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, pdfCopies(testInfo.outputPath('src'), 11));
    await rowByTitle(page, 'doc-01').click();
    await page.keyboard.press('ControlOrMeta+a');
    await stubConfirm(app, 'cancel');
    await runMenuCommand(app, 'item.openInBackground');
    await expect.poll(async () => (await confirmCalls(app)).length).toBe(1);
    expect((await confirmCalls(app))[0]).toMatchObject({ message: '자료 11개를 탭으로 열겠습니까?', buttons: ['열기', '취소'] });
    await page.waitForTimeout(300);
    await expect(page.getByTestId('tab-bar')).toHaveCount(0);

    await stubConfirm(app, 'confirm');
    await expect.poll(() => page.evaluate(() => window.learn.ui.windowState().then((r) => (r.ok ? r.data.sheetOpen : null)))).toBe(false);
    await runMenuCommand(app, 'item.openInBackground');
    await expect(page.locator('[data-testid="tab"]')).toHaveCount(12);
    await expect.poll(() => activeTab(page)).toBe('library');
    // Ten do not ask.
    expect((await confirmCalls(app)).length).toBe(1);
  } finally {
    await app.close();
  }
});

test('⌘W closes the shown reader tab and goes to the one seen before; on the library tab it closes the window; ⇧⌘T reopens', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await threeTabs(app, page, testInfo.outputPath('src'));
    const [a, b, c] = ['doc-01', 'doc-02', 'doc-03'].map((t) => items.find((i) => i.title === t)!.id) as [string, string, string];
    // Nothing closed yet: ⇧⌘T is off.
    await expect.poll(() => menuItemEnabled(app, 'tab.reopenClosed')).toBe(false);
    // Seen in the order a (never shown), b, c; c is shown. Choose b, then c again: closing c goes back to b.
    await readerTab(page, b).click();
    await readerTab(page, c).click();
    await runMenuCommand(app, 'tab.close');
    await expect.poll(() => order(page)).toEqual(['library', a, b]);
    await expect.poll(() => activeTab(page)).toBe(b);
    await expect.poll(() => menuItemEnabled(app, 'tab.reopenClosed')).toBe(true);
    // ⇧⌘T puts it back, shown, right of the shown tab.
    await runMenuCommand(app, 'tab.reopenClosed');
    await expect.poll(() => order(page)).toEqual(['library', a, b, c]);
    await expect.poll(() => activeTab(page)).toBe(c);
    await expect.poll(() => menuItemEnabled(app, 'tab.reopenClosed')).toBe(false);
    // Nothing seen before c and b but those: closing c, then b, leaves the library (a was never shown, it stays).
    await runMenuCommand(app, 'tab.close');
    await expect.poll(() => activeTab(page)).toBe(b);
    await runMenuCommand(app, 'tab.close');
    await expect.poll(() => activeTab(page)).toBe('library');
    await expect.poll(() => order(page)).toEqual(['library', a]);
    // The last reader tab closed: the strip goes with it.
    await readerTab(page, a).click();
    await runMenuCommand(app, 'tab.close');
    await expect(page.getByTestId('tab-bar')).toHaveCount(0);
    await expect(page.getByTestId('library-table')).toBeVisible();
    // Reopened newest closed first: a, then b.
    await runMenuCommand(app, 'tab.reopenClosed');
    await expect.poll(() => activeTab(page)).toBe(a);
    // On the library tab ⌘W closes the window.
    await libraryTab(page).click();
    await runMenuCommand(app, 'tab.close');
    await expect.poll(() => page.isClosed()).toBe(true);
  } finally {
    await app.close().catch(() => {});
  }
});

test('⌃⇥ and ⌃⇧⇥ go round through the library tab; ⌘2…⌘8 pick by place and ⌘9 the last', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await threeTabs(app, page, testInfo.outputPath('src'));
    const [a, b, c] = ['doc-01', 'doc-02', 'doc-03'].map((t) => items.find((i) => i.title === t)!.id) as [string, string, string];
    await expect.poll(() => order(page)).toEqual(['library', a, b, c]);
    await expect.poll(() => activeTab(page)).toBe(c);
    await runMenuCommand(app, 'tab.next');
    await expect.poll(() => activeTab(page)).toBe('library');
    await runMenuCommand(app, 'tab.next');
    await expect.poll(() => activeTab(page)).toBe(a);
    await runMenuCommand(app, 'tab.previous');
    await expect.poll(() => activeTab(page)).toBe('library');
    await runMenuCommand(app, 'tab.previous');
    await expect.poll(() => activeTab(page)).toBe(c);
    await runMenuCommand(app, 'tab.goTo2');
    await expect.poll(() => activeTab(page)).toBe(a);
    await runMenuCommand(app, 'tab.goTo3');
    await expect.poll(() => activeTab(page)).toBe(b);
    await runMenuCommand(app, 'tab.last');
    await expect.poll(() => activeTab(page)).toBe(c);
    // ⌘1 is the library's; a place nobody holds is off.
    await runMenuCommand(app, 'nav.back');
    await expect.poll(() => activeTab(page)).toBe('library');
    await expect.poll(() => menuItemEnabled(app, 'tab.goTo5', { hidden: true })).toBe(false);
    await expect.poll(() => menuItemEnabled(app, 'tab.goTo4', { hidden: true })).toBe(true);
    // Next and previous work from the library tab too.
    await runMenuCommand(app, 'tab.next');
    await expect.poll(() => activeTab(page)).toBe(a);
  } finally {
    await app.close();
  }
});

test('a tab menu opens at the pointer without choosing the tab; 다른 탭 닫기 keeps one, 라이브러리에서 보기 selects its row', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await threeTabs(app, page, testInfo.outputPath('src'));
    const [a, b, c] = ['doc-01', 'doc-02', 'doc-03'].map((t) => items.find((i) => i.title === t)!.id) as [string, string, string];
    // Dismissed: the menu's rows, with 탭 닫기 and the others; the shown tab is still c.
    await stubContextMenu(app, null);
    await readerTab(page, a).click({ button: 'right' });
    await expect.poll(async () => (await recordedPopups(app)).length).toBe(1);
    const rows = (await recordedPopups(app))[0]!;
    expect(rows.map((r) => r.label)).toEqual(['탭 닫기', '다른\u00a0탭 닫기', '', '라이브러리에서 보기', process.platform === 'darwin' ? 'Finder에서 보기' : '폴더에서 보기']);
    expect(rows.filter((r) => r.type !== 'separator').every((r) => r.enabled)).toBe(true);
    const at = (await recordedPopupPoints(app))[0]!;
    const box = (await readerTab(page, a).boundingBox())!;
    expect(at.x).toBeGreaterThanOrEqual(box.x);
    expect(at.x).toBeLessThanOrEqual(box.x + box.width);
    await expect.poll(() => activeTab(page)).toBe(c);
    // The library tab has no menu.
    await libraryTab(page).click({ button: 'right' });
    await page.waitForTimeout(200);
    expect((await recordedPopups(app)).length).toBe(1);

    // 탭 닫기 on a tab that is not shown closes that one.
    await stubContextMenu(app, '탭 닫기');
    await readerTab(page, a).click({ button: 'right' });
    await expect(readerTab(page, a)).toHaveCount(0);
    await expect.poll(() => activeTab(page)).toBe(c);
    // 다른 탭 닫기 keeps the tab it was opened on, and shows it.
    await stubContextMenu(app, '다른\u00a0탭 닫기');
    await readerTab(page, b).click({ button: 'right' });
    await expect.poll(() => order(page)).toEqual(['library', b]);
    await expect.poll(() => activeTab(page)).toBe(b);

    // 라이브러리에서 보기: the library tab, the row selected.
    await stubContextMenu(app, '라이브러리에서 보기');
    await readerTab(page, b).click({ button: 'right' });
    await expect(libraryTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(rowByTitle(page, 'doc-02')).toHaveAttribute('aria-selected', 'true');
    await expect(rowByTitle(page, 'doc-02')).toBeInViewport();
    void c;
  } finally {
    await app.close();
  }
});

test('라이브러리에서 보기 leaves a collection that hides the item, and the trash has none to show', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await importPaths(page, pdfCopies(testInfo.outputPath('src'), 2));
    const id = (title: string) => items.find((i) => i.title === title)!.id;
    const folder = await createCollection(page, '묶음');
    await addToCollection(page, folder, [id('doc-01')]);
    await openBehind(app, page, ['doc-02']);
    await page.getByTestId(`nav-collection-${folder}`).click();
    await expect(rowByTitle(page, 'doc-02')).toHaveCount(0);
    await stubContextMenu(app, '라이브러리에서 보기');
    await readerTab(page, id('doc-02')).click({ button: 'right' });
    await expect(rowByTitle(page, 'doc-02')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('nav-scope-all')).toHaveAttribute('aria-selected', 'true');

    // In the trash the item has no row to show: the entry is off (the tab stays).
    await trashItems(page, [id('doc-02')]);
    await stubContextMenu(app, null);
    await readerTab(page, id('doc-02')).click({ button: 'right' });
    await expect.poll(async () => (await recordedPopups(app)).length).toBe(1);
    const popup = (await recordedPopups(app))[0]!;
    expect(popup.find((r) => r.label === '라이브러리에서 보기')).toMatchObject({ enabled: false });
    expect(popup.find((r) => r.label === '탭 닫기')).toMatchObject({ enabled: true });
  } finally {
    await app.close();
  }
});

/** Presses at the middle of a tab and drags to `x` in steps, as a hand does; `release: false` leaves the button down. */
async function dragTab(page: Page, itemId: string, toX: number, opts: { release?: boolean } = {}) {
  const box = (await readerTab(page, itemId).locator('xpath=..').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + (toX < box.x ? -8 : 8), y, { steps: 2 });
  await page.mouse.move(toX, y, { steps: 12 });
  if (opts.release !== false) await page.mouse.up();
}

test('dragging a reader tab reorders it; the library tab cannot be passed; esc puts it back; the release does not choose the tab', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await threeTabs(app, page, testInfo.outputPath('src'));
    const [a, b, c] = ['doc-01', 'doc-02', 'doc-03'].map((t) => items.find((i) => i.title === t)!.id) as [string, string, string];
    await expect.poll(() => activeTab(page)).toBe(c);
    // The third tab onto the first reader slot.
    const first = (await readerTab(page, a).locator('xpath=..').boundingBox())!;
    await dragTab(page, c, first.x + 8);
    await expect.poll(() => order(page)).toEqual(['library', c, a, b]);
    // Dragging does not choose: c was shown and still is; dragging b (not shown) leaves c shown.
    await expect.poll(() => activeTab(page)).toBe(c);
    const lib = (await libraryTab(page).locator('xpath=..').boundingBox())!;
    await dragTab(page, b, lib.x - 40);
    await expect.poll(() => order(page)).toEqual(['library', b, c, a]);
    await expect.poll(() => activeTab(page)).toBe(c);

    // esc while dragging: nothing moves.
    const last = (await readerTab(page, a).locator('xpath=..').boundingBox())!;
    await dragTab(page, b, last.x + last.width - 4, { release: false });
    await expect(page.locator('.tab-item.is-dragging')).toHaveCount(1);
    await page.keyboard.press('Escape');
    // The button is still down: the release over the dragged tab's own spot is no click on it.
    const own = (await readerTab(page, b).locator('xpath=..').boundingBox())!;
    await page.mouse.move(own.x + own.width / 2, own.y + own.height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.tab-item.is-dragging')).toHaveCount(0);
    await page.waitForTimeout(100);
    await expect.poll(() => activeTab(page)).toBe(c);
    await expect.poll(() => order(page)).toEqual(['library', b, c, a]);
    expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.tab-item')].every((e) => e.style.transform === ''))).toBe(true);
    // A click without a drag still chooses.
    await readerTab(page, a).click();
    await expect.poll(() => activeTab(page)).toBe(a);
  } finally {
    await app.close();
  }
});

test('while a tab is dragged its neighbours step aside', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await threeTabs(app, page, testInfo.outputPath('src'));
    const [a, , c] = ['doc-01', 'doc-02', 'doc-03'].map((t) => items.find((i) => i.title === t)!.id) as [string, string, string];
    const first = (await readerTab(page, a).locator('xpath=..').boundingBox())!;
    await dragTab(page, c, first.x + 8, { release: false });
    const shifted = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.tabs-scroll > .tab-item')].map((e) => e.style.transform !== ''));
    expect(shifted).toEqual([true, true, true]); // the dragged one moves with the pointer, a and b make room
    await page.mouse.up();
    await expect.poll(() => order(page)).toEqual(['library', c, a, expect.any(String)]);
  } finally {
    await app.close();
  }
});

test('⌥⇧← and ⌥⇧→ move the tab that has the focus, which keeps it; the palette moves the shown tab; Delete and Backspace close the focused tab', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await threeTabs(app, page, testInfo.outputPath('src'));
    const [a, b, c] = ['doc-01', 'doc-02', 'doc-03'].map((t) => items.find((i) => i.title === t)!.id) as [string, string, string];
    await readerTab(page, b).focus();
    await page.keyboard.press('Alt+Shift+ArrowLeft');
    await expect.poll(() => order(page)).toEqual(['library', b, a, c]);
    await expect(readerTab(page, b)).toBeFocused();
    await page.keyboard.press('Alt+Shift+ArrowLeft'); // at the start of the readers: nothing, the library tab is not passed
    await page.keyboard.press('Alt+Shift+ArrowRight');
    await expect.poll(() => order(page)).toEqual(['library', a, b, c]);
    await expect(readerTab(page, b)).toBeFocused();

    // The palette moves the shown tab (c).
    await runPalette(page, app, '탭을 왼쪽으로', 'tab.moveLeft');
    await expect.poll(() => order(page)).toEqual(['library', a, c, b]);
    await expect.poll(() => activeTab(page)).toBe(c);

    // Delete closes the focused tab and hands the focus to its neighbour; Backspace does the same.
    await readerTab(page, a).focus();
    await page.keyboard.press('Delete');
    await expect.poll(() => order(page)).toEqual(['library', c, b]);
    await expect(readerTab(page, c)).toBeFocused();
    await page.keyboard.press('Backspace');
    await expect.poll(() => order(page)).toEqual(['library', b]);
    await expect(readerTab(page, b)).toBeFocused();
    // The library tab has no key to close it.
    await libraryTab(page).focus();
    await page.keyboard.press('Delete');
    await expect.poll(() => order(page)).toEqual(['library', b]);
  } finally {
    await app.close();
  }
});

test('a tab chosen by a command while the focus is in the strip takes the focus; the library tab by the pointer hands it to the table; the close mark names its key', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await threeTabs(app, page, testInfo.outputPath('src'));
    const [a, b, c] = ['doc-01', 'doc-02', 'doc-03'].map((t) => items.find((i) => i.title === t)!.id) as [string, string, string];
    await expect(page.locator(`[data-item-id="${c}"] ~ [data-testid="tab-close"]`)).toHaveAttribute('title', /^탭 닫기 (⌘|Ctrl\+)W$/);
    await readerTab(page, c).focus();
    await page.keyboard.press('ArrowLeft'); // the focus on b, which is not chosen
    await expect(readerTab(page, b)).toBeFocused();
    await runMenuCommand(app, 'tab.goTo2');
    await expect.poll(() => activeTab(page)).toBe(a);
    await expect(readerTab(page, a)).toBeFocused();
    await runMenuCommand(app, 'tab.next');
    await expect(readerTab(page, b)).toBeFocused();

    await libraryTab(page).click();
    await expect(page.getByTestId('library-table')).toBeVisible();
    await expect(page.locator('[data-testid="library-table"]:focus-within')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('an item moved to the trash keeps its tab with the trash notice; one deleted for good loses it, and ⇧⌘T skips it', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await threeTabs(app, page, testInfo.outputPath('src'));
    const [a, b, c] = ['doc-01', 'doc-02', 'doc-03'].map((t) => items.find((i) => i.title === t)!.id) as [string, string, string];
    await expect.poll(() => activeTab(page)).toBe(c);
    await trashItems(page, [b]);
    await expect.poll(() => order(page)).toEqual(['library', a, b, c]);
    await readerTab(page, b).click();
    await expect(page.getByTestId('reader-trashed')).toBeVisible();
    // A trashed item cannot be reopened after its tab is closed.
    await runMenuCommand(app, 'tab.close');
    await expect.poll(() => menuItemEnabled(app, 'tab.reopenClosed')).toBe(false);
    await readerTab(page, a).click();
    // Deleted for good (a tab that is not shown too): the tab goes without a place among the closed.
    await trashItems(page, [c]);
    await expect.poll(() => order(page)).toEqual(['library', a, c]); // in the trash it keeps its tab
    const gone = await page.evaluate((id) => window.learn.library.purge({ itemIds: [id], collectionIds: [] }), c);
    expect(gone.ok).toBe(true);
    await expect.poll(() => order(page)).toEqual(['library', a]);
    await runMenuCommand(app, 'tab.close');
    await expect.poll(() => menuItemEnabled(app, 'tab.reopenClosed')).toBe(true);
  } finally {
    await app.close();
  }
});

test("a title edited in the item panel renames the item's tab at once", async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await importPaths(page, pdfCopies(testInfo.outputPath('src'), 2));
    const a = items.find((i) => i.title === 'doc-01')!.id;
    await openBehind(app, page, ['doc-01']);
    await expect(readerTab(page, a)).toContainText('doc-01');
    const r = await page.evaluate((id) => window.learn.library.updateMetadata({ itemId: id, title: '새 이름의 논문' }), a);
    expect(r.ok).toBe(true);
    await expect(readerTab(page, a)).toContainText('새 이름의 논문');
  } finally {
    await app.close();
  }
});

test('the order of the tabs and the shown one come back after a restart', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let { app, page } = await launch(lib, ud);
  let closed = false;
  try {
    const items = await threeTabs(app, page, testInfo.outputPath('src'));
    const [a, b, c] = ['doc-01', 'doc-02', 'doc-03'].map((t) => items.find((i) => i.title === t)!.id) as [string, string, string];
    const first = (await readerTab(page, a).locator('xpath=..').boundingBox())!;
    await dragTab(page, c, first.x + 8);
    await expect.poll(() => order(page)).toEqual(['library', c, a, b]);
    await readerTab(page, a).click();
    await expect
      .poll(async () => JSON.stringify(sessionOf(await tabsSetting(page))))
      .toBe(JSON.stringify({ items: [c, a, b], active: a }));
    await app.close();
    closed = true;
    ({ app, page } = await launch(lib, ud));
    closed = false;
    await expect.poll(() => order(page)).toEqual(['library', c, a, b]);
    await expect.poll(() => activeTab(page)).toBe(a);
  } finally {
    if (!closed) await app.close().catch(() => {});
  }
});

test('the library head dims its panel toggle in a window that is not main', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, pdfCopies(testInfo.outputPath('src'), 1));
    await openBehind(app, page, ['doc-01']);
    const toggle = page.locator('.pane-header .icon-btn > .icon').last();
    await expect(toggle).toBeVisible();
    const lit = await toggle.evaluate((e) => getComputedStyle(e).opacity);
    expect(lit).toBe('1');
    await page.evaluate(() => document.documentElement.setAttribute('data-window-not-main', ''));
    expect(Number(await toggle.evaluate((e) => getComputedStyle(e).opacity))).toBeLessThan(1);
  } finally {
    await app.close();
  }
});

test('⌘W still closes the shown reader tab while the window is held by a file panel', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await threeTabs(app, page, testInfo.outputPath('src'));
    const c = items.find((i) => i.title === 'doc-03')!.id;
    // 파일 가져오기…'s panel stays open: the window is held and the other tab commands are off.
    await libraryTab(page).click();
    await holdOpenDialog(app, []);
    await runMenuCommand(app, 'file.importManaged');
    await readerTab(page, c).click();
    await expect.poll(() => menuItemEnabled(app, 'tab.next')).toBe(false);
    await expect.poll(() => menuItemEnabled(app, 'tab.close')).toBe(true);
    await runMenuCommand(app, 'tab.close');
    await expect(readerTab(page, c)).toHaveCount(0);
    await releaseOpenDialog(app);
  } finally {
    await app.close();
  }
});

test('⌘W with the settings window focused closes that window and leaves the main window\'s tabs alone', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await threeTabs(app, page, testInfo.outputPath('src'));
    const before = await order(page);
    await runMenuCommand(app, 'app.settings');
    await expect.poll(() => windowKinds(app)).toContain('settings');
    await runMenuCommand(app, 'tab.close');
    await expect.poll(() => windowKinds(app)).not.toContain('settings');
    expect(await order(page)).toEqual(before);
    await expect.poll(() => activeTab(page)).toBe(items.find((i) => i.title === 'doc-03')!.id);
  } finally {
    await app.close();
  }
});

const field = (page: Page, name: string) => page.locator(`[data-testid="editor-field"][data-field="${name}"] :is(input, textarea)`);

test('an open 정보 편집 is asked before the shown tab changes or closes: valid changes are saved first, invalid ones keep the tab', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await importPaths(page, pdfCopies(testInfo.outputPath('src'), 2));
    const [a, b] = ['doc-01', 'doc-02'].map((t) => items.find((i) => i.title === t)!.id) as [string, string];
    await openBehind(app, page, ['doc-01']);
    await openBehind(app, page, ['doc-02']);
    await showItemPanel(app, page);
    await selectRows(page, ['doc-01']);
    const titleOf = async (id: string) => {
      const r = await page.evaluate((x) => window.learn.library.detail({ itemId: x }), id);
      return r.ok ? r.data.item.title : null;
    };
    // Valid: a click on another tab saves the title, then the tab changes.
    await page.getByTestId('info-edit').click();
    await field(page, 'title').fill('doc-01 edited');
    await readerTab(page, b).click();
    await expect(readerTab(page, b)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
    expect(await titleOf(a)).toBe('doc-01 edited');

    // Invalid: the tab does not change, and the editor says why.
    await libraryTab(page).click();
    await selectRows(page, ['doc-02']);
    await page.getByTestId('info-edit').click();
    await field(page, 'date').fill('어제');
    await readerTab(page, a).click();
    await expect(page.getByTestId('editor-unsaved')).toBeVisible();
    await expect(libraryTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(readerTab(page, a)).toHaveAttribute('aria-selected', 'false');
    // The same for the keyboard's way (⌃⇥) and for closing the shown tab with the strip's mark: a tab behind the shown one closes freely.
    await runMenuCommand(app, 'tab.next');
    await page.waitForTimeout(300);
    await expect(libraryTab(page)).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('editor-discard').click();
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('the outline\'s search and opened rows stay with their tab', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const dir = testInfo.outputPath('src');
    fs.mkdirSync(dir, { recursive: true });
    const second = path.join(dir, 'paper-b.pdf');
    fs.copyFileSync(PAPER, second);
    fs.appendFileSync(second, '\n% copy b\n');
    const items = await importPaths(page, [PAPER, second]);
    const [a, b] = ['paper-100', 'paper-b'].map((t) => items.find((i) => i.title === t)!.id) as [string, string];
    await openBehind(app, page, ['paper-100']);
    await openBehind(app, page, ['paper-b']);
    // Reader to reader, with no library between: the sidebar is the same place in the page unless it is keyed by its tab.
    await readerTab(page, a).click();
    await page.getByTestId('reader-nav').getByText('목차', { exact: true }).click();
    const search = page.getByTestId('pdf-outline-search').getByRole('searchbox');
    await search.fill('3.2');
    await expect(page.getByTestId('pdf-outline').getByRole('row', { name: /^1\.1 / })).toHaveCount(0);
    await readerTab(page, b).click();
    await expect(readerTab(page, b)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('pdf-outline')).toBeVisible();
    await expect(search).toHaveValue('');
    await expect(page.getByTestId('pdf-outline').getByRole('row', { name: /^1\.1 / }).first()).toBeVisible();
    await readerTab(page, a).click();
    await expect(readerTab(page, a)).toHaveAttribute('aria-selected', 'true');
    await expect(search).toHaveValue('');
  } finally {
    await app.close();
  }
});

test('closing a tab never mounts an evicted reader: it is not opened again and keeps its opened date', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await importPaths(page, pdfCopies(testInfo.outputPath('src'), 5));
    const id = (t: string) => items.find((i) => i.title === t)!.id;
    for (const title of ['doc-01', 'doc-02', 'doc-03', 'doc-04', 'doc-05']) {
      if (title !== 'doc-01') await libraryTab(page).click();
      await openItem(page, title);
      await expect(readerTab(page, id(title))).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByTestId('pdf-page-field')).toBeVisible();
    }
    await expect(panels(page)).toHaveCount(4);
    await expect(page.locator(`[data-testid="tab-panel"][data-item-id="${id('doc-01')}"]`)).toHaveCount(0);
    const openedAt = async () => {
      const r = await page.evaluate((x) => window.learn.library.detail({ itemId: x }), id('doc-01'));
      return r.ok ? r.data.item.openedAt : null;
    };
    const before = await openedAt();
    await page.waitForTimeout(50);
    await runMenuCommand(app, 'tab.close'); // the shown doc-05
    await expect(readerTab(page, id('doc-05'))).toHaveCount(0);
    await expect(panels(page)).toHaveCount(3);
    await expect(page.locator(`[data-testid="tab-panel"][data-item-id="${id('doc-01')}"]`)).toHaveCount(0);
    await page.waitForTimeout(600);
    expect(await openedAt()).toBe(before);
    // Shown, it is mounted again, as now.
    await readerTab(page, id('doc-01')).click();
    await expect(page.locator(`[data-testid="tab-panel"][data-item-id="${id('doc-01')}"]`)).toHaveAttribute('data-active', 'true');
  } finally {
    await app.close();
  }
});
