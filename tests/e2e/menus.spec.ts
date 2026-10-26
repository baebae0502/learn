// The menu machinery of M5 (spec 9.1) end to end: 보기 › 정렬 기준 ▸ in the real menu bar (the keyboard-only sort), the
// menu bar's rebuild that waits for an open menu, the row menu opened from the keyboard, and the kinds of context menu
// that have no commands yet.
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURES, importPaths, launch, menuSnapshot, recordedPopupPoints, recordedPopups, rowByTitle, runMenuCommand, selectRows, stubContextMenu, type MenuNode } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const dirs = (i: { outputPath(...p: string[]): string }) => [i.outputPath('library'), i.outputPath('userdata')] as const;

/** Copies of the sample PDF with distinct content, imported one by one: 추가일 orders them, the last newest. */
async function importInOrder(page: Page, dir: string, names: readonly string[]): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  for (const [i, name] of names.entries()) {
    const file = path.join(dir, `${name}.pdf`);
    fs.writeFileSync(file, Buffer.concat([fs.readFileSync(PDF), Buffer.from(`\n% ${name}\n`)]));
    await importPaths(page, [file]);
    await expect(page.getByTestId('item-row')).toHaveCount(i + 1);
  }
}
const header = (page: Page, col: string) => page.locator(`[data-testid="column-header"][data-col="${col}"]`);
/** Titles in the table's order (data-index), whatever the DOM order. */
const order = (page: Page) =>
  page.locator('[data-testid="item-row"]').evaluateAll((rows) =>
    rows.sort((a, b) => Number(a.getAttribute('data-index')) - Number(b.getAttribute('data-index'))).map((r) => r.getAttribute('data-title')),
  );
const setting = (page: Page, key: string) => page.evaluate((k) => window.learn.settings.get({ key: k }).then((r) => (r.ok ? r.data : 'failed')), key);
const flatten = (nodes: readonly MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flatten(n.submenu ?? [])]);
/** The rows of 보기 › 정렬 기준 ▸ as "라벨" ("○" when on), separators as "-". */
const radios = async (app: ElectronApplication): Promise<string[]> => {
  const head = flatten(await menuSnapshot(app)).find((n) => n.id === 'library.sortBy');
  return (head?.submenu ?? []).map((n) => (n.type === 'separator' ? '-' : `${n.label}${n.checked ? ' ○' : ''}`));
};
const DEFAULT_RADIOS = ['제목', '저자', '연도', '종류', '추가일 ○', '-', '오름차순', '내림차순 ○'];

test('보기 › 정렬 기준 ▸ sorts the table by a shown column and a direction; its radios follow the sort and the columns, whoever changed them', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importInOrder(page, testInfo.outputPath('src'), ['beta', 'delta', 'alpha', 'gamma']);
    await expect.poll(() => radios(app)).toEqual(DEFAULT_RADIOS);
    expect(await order(page)).toEqual(['gamma', 'alpha', 'delta', 'beta']); // 추가일, newest first

    // A column row keeps the direction (a header press would start A→Z): 제목, still 내림차순.
    await runMenuCommand(app, 'library.sortBy', { column: 'title' });
    await expect(header(page, 'title')).toHaveAttribute('aria-sort', 'descending');
    expect(await order(page)).toEqual(['gamma', 'delta', 'beta', 'alpha']);
    await expect.poll(() => radios(app)).toEqual(['제목 ○', '저자', '연도', '종류', '추가일', '-', '오름차순', '내림차순 ○']);

    await runMenuCommand(app, 'library.sortBy', { direction: 'asc' });
    await expect(header(page, 'title')).toHaveAttribute('aria-sort', 'ascending');
    expect(await order(page)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    await expect.poll(() => radios(app)).toEqual(['제목 ○', '저자', '연도', '종류', '추가일', '-', '오름차순 ○', '내림차순']);
    await expect.poll(() => setting(page, 'library.sort')).toEqual({ column: 'title', direction: 'asc' });

    // The header sorts too (dates start newest first): the radios follow it.
    await header(page, 'createdAt').click();
    await expect(header(page, 'createdAt')).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => radios(app)).toEqual(DEFAULT_RADIOS);

    // A column shown through the header menu becomes a row, in catalogue order; sorted by it, and then hidden again, its row stays (on).
    await stubContextMenu(app, '크기');
    await header(page, 'year').click({ button: 'right' });
    await expect(header(page, 'size')).toBeVisible();
    await expect.poll(() => radios(app)).toEqual(['제목', '저자', '연도', '종류', '추가일 ○', '크기', '-', '오름차순', '내림차순 ○']);
    await runMenuCommand(app, 'library.sortBy', { column: 'size' });
    await expect(header(page, 'size')).toHaveAttribute('aria-sort', 'descending');
    await header(page, 'year').click({ button: 'right' });
    await expect(header(page, 'size')).toHaveCount(0);
    await expect.poll(() => radios(app)).toEqual(['제목', '저자', '연도', '종류', '추가일', '크기 ○', '-', '오름차순', '내림차순 ○']);
  } finally {
    await app.close();
  }
});

test('the menu bar is not rebuilt under an open menu: the radios wait for it to close, and a row clicked meanwhile still lands', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importInOrder(page, testInfo.outputPath('src'), ['alpha', 'beta']);
    await expect.poll(() => radios(app)).toEqual(DEFAULT_RADIOS);
    // A menu-bar menu opens (macOS and Linux both announce it on the menu): main marks it open until it closes. The menu
    // object is tagged, so a rebuild (a new object) is told from Electron checking the clicked radio in place.
    await app.evaluate(({ Menu }) => {
      (Menu.getApplicationMenu() as unknown as { __open?: true }).__open = true;
      Menu.getApplicationMenu()!.emit('menu-will-show');
    });
    const rebuilt = () => app.evaluate(({ Menu }) => !(Menu.getApplicationMenu() as unknown as { __open?: true }).__open);
    await runMenuCommand(app, 'library.sortBy', { column: 'title' });
    await expect(header(page, 'title')).toHaveAttribute('aria-sort', 'descending'); // the click landed at once
    // Electron flips a clicked radio in place, in the open menu too: that is why the test tells a rebuild by the object.
    expect(await radios(app)).toEqual(['제목 ○', '저자', '연도', '종류', '추가일', '-', '오름차순', '내림차순 ○']);
    // Main has the new context (the rebuild is asked for) before the wait starts, so the wait really covers the guard.
    await expect.poll(() => app.evaluate(() => (globalThis as { __learnMenuContext?: { sortColumn: string } }).__learnMenuContext?.sortColumn)).toBe('title');
    await page.waitForTimeout(500); // five rebuild delays
    expect(await rebuilt()).toBe(false); // the open menu was not replaced
    await app.evaluate(({ Menu }) => void Menu.getApplicationMenu()!.emit('menu-will-close'));
    await expect.poll(rebuilt).toBe(true);
    await expect.poll(() => radios(app)).toEqual(['제목 ○', '저자', '연도', '종류', '추가일', '-', '오름차순', '내림차순 ○']);
  } finally {
    await app.close();
  }
});

test('⇧F10 and the menu key open the focused row\'s menu under it, once, for the whole selection', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importInOrder(page, testInfo.outputPath('src'), ['alpha', 'beta', 'gamma']);
    await stubContextMenu(app, null);
    const opened = async (count: number) => {
      await expect.poll(async () => (await recordedPopups(app)).length).toBe(count);
      await page.waitForTimeout(600); // longer than the browser's echo of the key would take: a second menu would be here by now
      expect((await recordedPopups(app)).length).toBe(count);
    };

    await rowByTitle(page, 'beta').click();
    await page.keyboard.press('Shift+F10');
    await opened(1);
    const labels = (items: Awaited<ReturnType<typeof recordedPopups>>[number]) => items.filter((i) => i.type !== 'separator').map((i) => [i.label, i.enabled]);
    expect(labels((await recordedPopups(app))[0]!)).toEqual([['열기', true], [process.platform === 'darwin' ? 'Finder에서 보기' : '폴더에서 보기', true], ['사본 내보내기…', true]]);
    // Under the row, a little in from its left edge.
    const box = (await rowByTitle(page, 'beta').boundingBox())!;
    const [at] = await recordedPopupPoints(app);
    expect(Math.abs(at!.y - (box.y + box.height))).toBeLessThanOrEqual(1);
    expect(at!.x).toBeGreaterThan(box.x);
    expect(at!.x).toBeLessThan(box.x + box.width);

    await page.keyboard.press('ContextMenu');
    await opened(2);

    // Two rows selected: the menu judges both (열기 needs exactly one).
    await selectRows(page, ['alpha', 'gamma']);
    await page.keyboard.press('Shift+F10');
    await opened(3);
    expect((await recordedPopups(app))[2]!.find((i) => i.label === '열기')?.enabled).toBe(false);

    // A pick runs on the row: 열기 opens the one that had the key.
    await stubContextMenu(app, '열기');
    await rowByTitle(page, 'gamma').click();
    await page.keyboard.press('Shift+F10');
    await expect(page.getByTestId('viewer-title')).toHaveText('gamma');
  } finally {
    await app.close();
  }
});

test('a collection or tag context menu has no entries until a command lists its kind: null, no popup, no error', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await stubContextMenu(app, null);
    const id = randomUUID();
    const answers = await page.evaluate(
      (id) => Promise.all([window.learn.ui.showContextMenu({ kind: 'collection', collectionIds: [id], x: 1, y: 1 }), window.learn.ui.showContextMenu({ kind: 'tag', tagIds: [id], x: 1, y: 1 })]),
      id,
    );
    expect(answers).toEqual([{ ok: true, data: null }, { ok: true, data: null }]);
    expect(await recordedPopups(app)).toEqual([]);
    await expect(page.getByTestId('action-error')).toHaveCount(0);
  } finally {
    await app.close();
  }
});
