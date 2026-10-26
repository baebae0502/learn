// The library table (M4 spec 3): the selection model, opening, the native column header menu, widths and sort that
// survive a restart, density, a large virtualized library (seeded), F6 into the table, and the loading state.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { Channels } from '../../packages/domain/src/ipc-channels';
import { LIBRARY_COLUMN_IDS } from '../../packages/domain/src/library-columns';
import { expectNoSeriousA11y } from './a11y';
import { FIXTURES, importPaths, launch, mainWindow, recordedPopups, rowAt, rowByTitle, seedLibrary, selectRows, showItemPanel, stubContextMenu } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const DEFAULT_HEADERS = ['제목', '저자', '연도', '종류', '추가일'];
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
/** Titles of the selected rows, A to Z. */
const selectedTitles = (page: Page) =>
  page.locator('[data-testid="item-row"][aria-selected="true"]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-title')!).sort());
/** Titles in the table's order (data-index), whatever the DOM order. */
const order = (page: Page) =>
  page.locator('[data-testid="item-row"]').evaluateAll((rows) =>
    rows.sort((a, b) => Number(a.getAttribute('data-index')) - Number(b.getAttribute('data-index'))).map((r) => r.getAttribute('data-title')),
  );
const header = (page: Page, col: string) => page.locator(`[data-testid="column-header"][data-col="${col}"]`);
const setting = (page: Page, key: string) => page.evaluate((k) => window.learn.settings.get({ key: k }).then((r) => (r.ok ? r.data : 'failed')), key);
const frames = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
/**
 * Clicks an item of the app menu's 편집 menu for the main window, as the menu bar does (a role item acts on the window it
 * is given). On macOS a role item's click sends its Cocoa action (selectAll:) to the first responder, which is the key
 * window of the active app; a CI runner that keeps another app active gives it to nobody, so there the page-level
 * command the item stands for (webContents.selectAll) is issued on the window directly.
 */
async function clickEditMenu(app: ElectronApplication, label: string): Promise<void> {
  const win = await mainWindow(app);
  await app.evaluate(({ Menu }, [w, name, mac]) => {
    const item = Menu.getApplicationMenu()!.items.find((i) => i.label === '편집')!.submenu!.items.find((i) => i.label === name)!;
    if (mac && String(item.role).toLowerCase() === 'selectall') w.webContents.selectAll();
    else (item.click as (event: unknown, window: unknown, contents: unknown) => void)(undefined, w, w.webContents);
  }, [win, label, process.platform === 'darwin'] as const);
}

test('a click selects one row, ⇧-click a range, ⌘/Ctrl-click toggles, ⌘A and 모두 선택 all; arrows move, ⇧ extends; Home, End, PageUp, PageDown; esc clears; no type-ahead', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importInOrder(page, testInfo.outputPath('src'), ['alpha', 'beta', 'gamma', 'delta', 'epsilon']);
    expect(await order(page)).toEqual(['epsilon', 'delta', 'gamma', 'beta', 'alpha']); // 추가일, newest first
    await rowByTitle(page, 'delta').click();
    expect(await selectedTitles(page)).toEqual(['delta']);
    await rowByTitle(page, 'beta').click({ modifiers: ['Shift'] });
    expect(await selectedTitles(page)).toEqual(['beta', 'delta', 'gamma']);
    await rowByTitle(page, 'gamma').click({ modifiers: [MOD] });
    expect(await selectedTitles(page)).toEqual(['beta', 'delta']);
    await expectNoSeriousA11y(page, 'library table, two rows selected');
    await rowByTitle(page, 'epsilon').click();
    expect(await selectedTitles(page)).toEqual(['epsilon']);
    await page.keyboard.press('ArrowDown');
    expect(await selectedTitles(page)).toEqual(['delta']);
    await expect(rowByTitle(page, 'delta')).toBeFocused();
    await page.keyboard.press('Shift+ArrowDown');
    expect(await selectedTitles(page)).toEqual(['delta', 'gamma']);
    await page.keyboard.press('End');
    expect(await selectedTitles(page)).toEqual(['alpha']);
    await expect(rowByTitle(page, 'alpha')).toBeFocused();
    await page.keyboard.press('Home');
    expect(await selectedTitles(page)).toEqual(['epsilon']);
    await page.keyboard.press('PageDown'); // all five rows fit in a page: it goes to the last
    expect(await selectedTitles(page)).toEqual(['alpha']);
    await page.keyboard.press('Shift+PageUp');
    expect(await selectedTitles(page)).toHaveLength(5);
    await page.keyboard.press('Escape'); // esc clears the selection; the cursor stays on its row
    expect(await selectedTitles(page)).toEqual([]);
    await expect(rowByTitle(page, 'epsilon')).toBeFocused();
    await page.keyboard.press('ControlOrMeta+a');
    expect(await selectedTitles(page)).toHaveLength(5);
    // The edit menu's 모두 선택 while the table has the focus: every row, and none of the page's text.
    await rowByTitle(page, 'gamma').click();
    await clickEditMenu(app, '모두 선택');
    await expect.poll(() => selectedTitles(page)).toHaveLength(5);
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('');
    // No type-ahead (design-spec 7.1): a letter moves neither the cursor nor the selection; Space pages nothing; ← / →
    // stay on the row.
    await rowByTitle(page, 'epsilon').click();
    for (const key of ['g', 'Space', 'ArrowRight', 'ArrowLeft']) {
      await page.keyboard.press(key);
      await expect(rowByTitle(page, 'epsilon')).toBeFocused();
    }
    expect(await selectedTitles(page)).toEqual(['epsilon']);
  } finally {
    await app.close();
  }
});

test('right-click selects the row first, or keeps the selection it is in; the menu judges the whole selection', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importInOrder(page, testInfo.outputPath('src'), ['alpha', 'beta', 'gamma', 'delta']);
    await stubContextMenu(app, null);
    await rowByTitle(page, 'gamma').click({ button: 'right' });
    expect(await selectedTitles(page)).toEqual(['gamma']);
    await expect(rowByTitle(page, 'gamma')).toBeFocused();
    await selectRows(page, ['beta', 'delta']);
    await rowByTitle(page, 'delta').click({ button: 'right' }); // inside the selection: kept
    expect(await selectedTitles(page)).toEqual(['beta', 'delta']);
    await rowByTitle(page, 'alpha').click({ button: 'right' }); // outside it: alpha alone
    expect(await selectedTitles(page)).toEqual(['alpha']);
    await expect.poll(async () => (await recordedPopups(app)).length).toBe(3);
    // 열기 needs exactly one item (the item.open rule): enabled for one row, disabled for the kept pair.
    const open = (await recordedPopups(app)).map((items) => items.find((i) => i.label === '열기')?.enabled);
    expect(open).toEqual([true, false, true]);
  } finally {
    await app.close();
  }
});

test('a single click only selects; double-click or ↩ opens the one selected row; ↩ with several selected opens nothing', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importInOrder(page, testInfo.outputPath('src'), ['alpha', 'beta']);
    await rowByTitle(page, 'alpha').click();
    await frames(page);
    await expect(page.getByTestId('viewer-title')).toHaveCount(0);
    await rowByTitle(page, 'alpha').dblclick();
    await expect(page.getByTestId('viewer-title')).toHaveText('alpha');
    await page.getByTestId('viewer-back').click();
    await rowByTitle(page, 'beta').click();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('viewer-title')).toHaveText('beta');
    await page.getByTestId('viewer-back').click();
    await selectRows(page, ['alpha', 'beta']);
    await page.keyboard.press('Enter');
    await frames(page);
    await expect(page.getByTestId('viewer-title')).toHaveCount(0);
    await expect(page.getByTestId('library-table')).toBeVisible();
  } finally {
    await app.close();
  }
});

test('the column header menu shows and hides columns (제목 stays) and resets them; a dragged edge trades width with its neighbour, saved on release; all survive a restart', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let s = await launch(lib, ud);
  try {
    await importInOrder(s.page, testInfo.outputPath('src'), ['alpha', 'beta']);
    await expect(s.page.getByTestId('column-header')).toHaveText(DEFAULT_HEADERS);
    await stubContextMenu(s.app, '크기');
    await header(s.page, 'year').click({ button: 'right' });
    await expect(s.page.getByTestId('column-header')).toHaveText([...DEFAULT_HEADERS, '크기']);
    const [menu] = await recordedPopups(s.app);
    expect(menu!.map((i) => [i.type === 'separator' ? '-' : i.label, i.checked, i.enabled])).toEqual([
      ['제목', true, false], ['저자', true, true], ['연도', true, true], ['종류', true, true], ['추가일', true, true],
      ['수정일', false, true], ['보관', false, true], ['크기', false, true], ['원래 이름', false, true],
      ['-', false, true], ['열 구성 되돌리기', false, true],
    ]);
    const size = rowAt(s.page, 0).locator('[data-col="size"]');
    await expect(size).toHaveText(/^\d+(\.\d)? KB$/);
    expect(await size.evaluate((e) => getComputedStyle(e).justifyContent)).toBe('flex-end'); // numbers end-aligned
    expect(await setting(s.page, 'library.columns')).toEqual({ visible: ['title', 'creators', 'year', 'type', 'createdAt', 'size'], order: [...LIBRARY_COLUMN_IDS], widths: {} });

    // Drag 저자's right edge 40 px left: 저자 140, 연도 64 + 40 = 104; the boundary after 연도 and the title stay.
    const creators = header(s.page, 'creators');
    const typeX = (await header(s.page, 'type').boundingBox())!.x;
    const titleW = (await header(s.page, 'title').boundingBox())!.width;
    const edge = (await s.page.locator('[data-testid="column-resizer"][data-col="creators"]').boundingBox())!;
    const y = edge.y + edge.height / 2;
    await s.page.mouse.move(edge.x + edge.width / 2, y);
    await s.page.mouse.down();
    await s.page.mouse.move(edge.x + edge.width / 2 - 40, y, { steps: 4 });
    await expect.poll(async () => (await creators.boundingBox())?.width).toBe(140);
    expect(((await setting(s.page, 'library.columns')) as { widths: object }).widths).toEqual({}); // nothing saved while dragging
    await s.page.mouse.up();
    await expect.poll(async () => ((await setting(s.page, 'library.columns')) as { widths: object }).widths).toEqual({ creators: 140, year: 104 }); // the two that changed
    expect((await header(s.page, 'year').boundingBox())!.width).toBe(104);
    expect((await header(s.page, 'type').boundingBox())!.x).toBe(typeX);
    expect((await header(s.page, 'title').boundingBox())!.width).toBe(titleW);
    await expect(s.page.locator('[data-testid="column-resizer"][data-col="size"]')).toHaveCount(0); // the last column has no handle
    await s.app.close();

    s = await launch(lib, ud);
    await expect(s.page.getByTestId('column-header')).toHaveText([...DEFAULT_HEADERS, '크기']);
    await expect.poll(async () => (await header(s.page, 'creators').boundingBox())?.width).toBe(140);
    // An edge also takes ← / → (8 px, saved at once) and a double-click (back to the column's default width), both
    // trading with the next column like a drag.
    const creatorsEdge = s.page.locator('[data-testid="column-resizer"][data-col="creators"]');
    await expect(creatorsEdge).toHaveAttribute('aria-valuenow', '140');
    await creatorsEdge.focus();
    await s.page.keyboard.press('ArrowRight');
    await expect(creatorsEdge).toHaveAttribute('aria-valuenow', '148');
    await expect.poll(async () => ((await setting(s.page, 'library.columns')) as { widths: object }).widths).toEqual({ creators: 148, year: 96 });
    await creatorsEdge.dblclick();
    await expect(creatorsEdge).toHaveAttribute('aria-valuenow', '180');
    await expect.poll(async () => ((await setting(s.page, 'library.columns')) as { widths: object }).widths).toEqual({ creators: 180, year: 64 });
    await stubContextMenu(s.app, '열 구성 되돌리기');
    await header(s.page, 'title').click({ button: 'right' });
    await expect(s.page.getByTestId('column-header')).toHaveText(DEFAULT_HEADERS);
    await expect.poll(async () => (await header(s.page, 'creators').boundingBox())?.width).toBe(180);
    expect(await setting(s.page, 'library.columns')).toEqual({ visible: ['title', 'creators', 'year', 'type', 'createdAt'], order: [...LIBRARY_COLUMN_IDS], widths: {} });
  } finally {
    await s.app.close();
  }
});

test('a header press sorts by its column (arrow, aria-sort), a second one reverses; dates start newest first; the sort survives a restart', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let s = await launch(lib, ud);
  try {
    await importInOrder(s.page, testInfo.outputPath('src'), ['beta', 'delta', 'alpha', 'gamma']);
    await expect(header(s.page, 'createdAt')).toHaveAttribute('aria-sort', 'descending');
    await expect(header(s.page, 'createdAt').locator('.icon')).toHaveCount(1);
    expect(await order(s.page)).toEqual(['gamma', 'alpha', 'delta', 'beta']);
    await header(s.page, 'title').click();
    await expect(header(s.page, 'title')).toHaveAttribute('aria-sort', 'ascending');
    await expect(header(s.page, 'title').locator('.icon')).toHaveCount(1);
    await expect(header(s.page, 'createdAt')).toHaveAttribute('aria-sort', 'none');
    await expect(header(s.page, 'createdAt').locator('.icon')).toHaveCount(0);
    expect(await order(s.page)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    await header(s.page, 'title').click();
    await expect(header(s.page, 'title')).toHaveAttribute('aria-sort', 'descending');
    expect(await order(s.page)).toEqual(['gamma', 'delta', 'beta', 'alpha']);
    await expect.poll(() => setting(s.page, 'library.sort')).toEqual({ column: 'title', direction: 'desc' });
    await s.app.close();

    s = await launch(lib, ud);
    await expect(header(s.page, 'title')).toHaveAttribute('aria-sort', 'descending');
    expect(await order(s.page)).toEqual(['gamma', 'delta', 'beta', 'alpha']);
    await header(s.page, 'createdAt').click(); // a date column starts newest first
    await expect(header(s.page, 'createdAt')).toHaveAttribute('aria-sort', 'descending');
    expect(await order(s.page)).toEqual(['gamma', 'alpha', 'delta', 'beta']);
  } finally {
    await s.app.close();
  }
});

test('rows follow the density (24 / 32 / 28) under a 28 px header, the first row 4 px below it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importInOrder(page, testInfo.outputPath('src'), ['alpha', 'beta']);
    const head = page.locator('.table-head');
    for (const [density, height] of [['compact', 24], ['comfortable', 32], ['regular', 28]] as const) {
      await page.evaluate((d) => window.learn.prefs.set({ density: d }), density);
      await expect.poll(async () => (await rowAt(page, 0).boundingBox())?.height).toBe(height);
      const [a, b] = [(await rowAt(page, 0).boundingBox())!, (await rowAt(page, 1).boundingBox())!];
      expect(b.y - a.y).toBe(height);
      const h = (await head.boundingBox())!;
      expect(h.height).toBe(28);
      expect(a.y - (h.y + h.height)).toBe(4);
    }
  } finally {
    await app.close();
  }
});

test('a large library is virtualized: rows near the viewport only, End and PageUp reach their rows, stripes by place; ⌘A and a right-click name every item (P-22)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    await seedLibrary(app, { count: 5999, from: pdf! });
    await expect(page.getByTestId('toolbar-count')).toHaveText('6000개');
    expect(await page.getByTestId('item-row').count()).toBeLessThan(120);
    await rowAt(page, 0).click();
    await page.keyboard.press('End');
    await expect(rowAt(page, 5999)).toBeFocused();
    await expect(rowAt(page, 5999)).toBeInViewport();
    expect(await page.getByTestId('item-row').count()).toBeLessThan(120);
    // PageUp moves the cursor by the rows the view shows, and the row it lands on is drawn and in view.
    const pageRows = await page.getByTestId('library-table').evaluate((g) => Math.floor((g.clientHeight - 28 - 4) / 28));
    await page.keyboard.press('PageUp');
    await expect(rowAt(page, 5999 - pageRows)).toBeFocused();
    await expect(rowAt(page, 5999 - pageRows)).toBeInViewport({ ratio: 1 });
    await page.keyboard.press('End');
    await page.mouse.move(5, 5); // no hovered row
    const bg = (i: number) => rowAt(page, i).evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await bg(5991)).toBe(await bg(5993));
    expect(await bg(5990)).toBe(await bg(5992));
    expect(await bg(5991)).not.toBe(await bg(5990));
    // ⌘A, then a right-click inside the selection: every id goes to the menu (more than the old 5000 bound)
    // and none of M4's item commands applies to 6000 items.
    await page.keyboard.press('ControlOrMeta+a');
    await expect(rowAt(page, 5999)).toHaveAttribute('aria-selected', 'true');
    await stubContextMenu(app, null);
    await rowAt(page, 5999).click({ button: 'right' });
    await expect.poll(async () => (await recordedPopups(app)).length).toBe(1);
    const items = (await recordedPopups(app))[0]!.filter((i) => i.type !== 'separator');
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => !i.enabled)).toBe(true);
    await expect(page.getByTestId('action-error')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('F6 lands on the table\'s cursor row (never a header button or a column edge), and so does Tab; with no cursor yet F6 takes the first row', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importInOrder(page, testInfo.outputPath('src'), ['alpha', 'beta']);
    await page.keyboard.press('F6'); // sidebar
    await page.keyboard.press('F6'); // content: the first row (no cursor yet) takes the focus, and the selection (none yet)
    await expect(rowAt(page, 0)).toBeFocused();
    await expect(rowAt(page, 0)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Shift+F6'); // sidebar
    await page.keyboard.press('F6'); // back to the cursor row
    await expect(rowAt(page, 1)).toBeFocused();
    await expect(rowAt(page, 1)).toHaveAttribute('data-focus-visible', 'true');
    // Tab leaves the table and comes back to the cursor row, never through the header's buttons or column edges.
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => !document.activeElement?.closest('[data-testid="library-table"]'))).toBe(true);
    await page.keyboard.press('Tab');
    await expect(rowAt(page, 1)).toBeFocused();
  } finally {
    await app.close();
  }
});

test('a first list read past 300 ms shows the header and 불러오는 중… in the body, not before; the rows replace it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    const listed = await page.evaluate(() => window.learn.library.list());
    await app.evaluate(({ ipcMain }, [channel, reply]) => {
      const g = globalThis as { __learnReleaseList?: () => void };
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => new Promise((resolve) => (g.__learnReleaseList = () => resolve(reply))));
    }, [Channels.library.list, listed] as const);
    // When the shell and the loading line first appear, from the document's first node on.
    await page.addInitScript(() => {
      const g = globalThis as { __learnSeen?: Record<string, number> };
      g.__learnSeen = {};
      new MutationObserver(() => {
        for (const id of ['shell', 'table-loading', 'empty-state']) if (!(id in g.__learnSeen!) && document.querySelector(`[data-testid="${id}"]`)) g.__learnSeen![id] = performance.now();
      }).observe(document, { childList: true, subtree: true });
    });
    await page.reload();
    await expect(page.getByTestId('table-loading')).toHaveText('불러오는 중…');
    await expect(page.getByTestId('column-header')).toHaveText(DEFAULT_HEADERS);
    await expect(page.getByTestId('item-row')).toHaveCount(0);
    // The toolbar's right group and the item panel keep their places while the list is on its way (disabled, no stats):
    // 가져오기 and the columns do not jump when the rows arrive.
    const places = () =>
      page.evaluate(() =>
        Object.fromEntries(
          ['import-menu', 'search-field', 'inspector-toggle', 'inspector-panel'].map((id) => {
            const r = document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect();
            return [id, r ? [r.x, r.y, r.width, r.height].map(Math.round) : null];
          }),
        ),
      );
    const loadingPlaces = await places();
    expect(loadingPlaces['search-field'], 'the search field is drawn while loading').not.toBeNull();
    expect(loadingPlaces['inspector-toggle'], 'the panel toggle is drawn while loading').not.toBeNull();
    await expect(page.getByTestId('search-field').locator('input')).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('inspector-toggle')).toHaveAttribute('aria-disabled', 'true');
    if ((await page.getByTestId('shell').getAttribute('data-inspector')) === 'shown') {
      await expect(page.getByTestId('inspector-none')).toBeVisible();
      await expect(page.getByTestId('inspector-stats')).toHaveCount(0);
    }
    const seen = await page.evaluate(() => (globalThis as { __learnSeen?: Record<string, number> }).__learnSeen ?? {});
    expect(seen['table-loading']! - seen['shell']!).toBeGreaterThanOrEqual(290); // design-spec 6: nothing for 300 ms
    expect(seen['empty-state']).toBeUndefined();
    await app.evaluate(() => (globalThis as { __learnReleaseList?: () => void }).__learnReleaseList?.());
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expect(page.getByTestId('table-loading')).toHaveCount(0);
    await expect(page.getByTestId('search-field').locator('input')).not.toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('inspector-toggle')).not.toHaveAttribute('aria-disabled', 'true');
    expect(await places(), 'the right group and the panel sit where they sat while loading').toEqual(loadingPlaces);
  } finally {
    await app.close();
  }
});

test('showing the row you came back to scrolls the table vertically only, even where the columns are wider than the table', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    await seedLibrary(app, { count: 150, from: pdf! });
    await expect(page.getByTestId('toolbar-count')).toHaveText('151개');
    // 1024 px with the sidebar and the item panel: the table's 464 px are narrower than its columns (the Mac runner's width).
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1024, w.getContentSize()[1]!));
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(1100);
    await showItemPanel(app, page);
    const table = page.getByTestId('library-table');
    await expect.poll(() => table.evaluate((g) => g.scrollWidth - g.clientWidth), { message: 'the columns must overflow the table here' }).toBeGreaterThan(0);
    await rowAt(page, 0).click();
    await page.keyboard.press('End');
    await expect(rowAt(page, 150)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('viewer-title')).toBeVisible();
    await page.getByTestId('viewer-back').click();
    // Shown vertically (the row is wider than the table, so the viewport ratio says nothing): inside the view's top and bottom.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const g = document.querySelector('[data-testid="library-table"]')!.getBoundingClientRect();
          const r = document.querySelector('[data-testid="item-row"][data-index="150"]')?.getBoundingClientRect();
          return r !== undefined && r.top >= g.top && r.bottom <= g.bottom;
        }),
      )
      .toBe(true);
    expect(await table.evaluate((g) => g.scrollTop)).toBeGreaterThan(0);
    expect(await table.evaluate((g) => g.scrollWidth - g.clientWidth)).toBeGreaterThan(0);
    expect(await table.evaluate((g) => g.scrollLeft)).toBe(0);
  } finally {
    await app.close();
  }
});
