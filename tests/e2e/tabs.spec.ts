import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, hardKill, importPaths, launch, openItem, trashItems } from './helpers';

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
        await expect(page.getByTestId('viewer-back')).toHaveCount(0);
      }
    } finally {
      if (!closed) await app.close().catch(() => {});
    }
  });
}
