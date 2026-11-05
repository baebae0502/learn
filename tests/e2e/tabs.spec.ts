import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, hardKill, importPaths, launch, openItem } from './helpers';

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
