// The table selection drives the item commands (spec 3.3, 6; design-spec 7.4): 파일 › Finder에서 보기 (⇧⌘R) and
// 기본 앱으로 열기, their palette rows, the ⌘/ sheet's 자료 group, rows that leave the list, and the return from the
// reader. ⌘ shortcuts go through runMenuCommand (CDP keys never reach native accelerators on Linux); a real ⇧⌘R
// keystroke is checked on macOS by tests/evidence/library.evidence.ts.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import {
  FIXTURES, closeSheet, expectWindow, importPaths, launch, menuItemEnabled, menuSnapshot, openItem, rowAt, rowByTitle, runMenuCommand, seedLibrary, selectRows, shellCalls, stubShell,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const KO_TITLE = '한글 경로 (테스트) #1';
const IS_MAC = process.platform === 'darwin';
const REVEAL = IS_MAC ? 'Finder에서 보기' : '폴더에서 보기';
const dirs = (i: { outputPath(...p: string[]): string }) => [i.outputPath('library'), i.outputPath('userdata')] as const;

test.beforeAll(() => {
  for (const f of [PDF, KO_PDF]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

/** 파일 › Finder에서 보기 and 기본 앱으로 열기: enabled or not, in that order. */
const fileItems = (app: ElectronApplication) => Promise.all([menuItemEnabled(app, 'item.showInFolder'), menuItemEnabled(app, 'item.openExternally')]);
const selectedRows = (page: import('@playwright/test').Page) => page.locator('[data-testid="item-row"][aria-selected="true"]');

test('파일 › Finder에서 보기 (⇧⌘R) and 기본 앱으로 열기 follow the selection: one row whose file is there, never none, two, a missing file or the reader', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await stubShell(app);
    await importPaths(page, [PDF, KO_PDF]);
    // A linked copy whose file then goes: 파일 없음 once main has checked it again.
    const gone = testInfo.outputPath('gone.pdf');
    fs.copyFileSync(PDF, gone);
    const linked = await page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'linked', allowDuplicate: true }), gone);
    if (!linked.ok || linked.data[0]?.status !== 'imported') throw new Error('linked import failed');
    const goneId = linked.data[0].item.id;
    fs.rmSync(gone);
    await page.evaluate((itemId) => window.learn.library.get({ itemId }), goneId);
    await expect(page.getByTestId('item-row')).toHaveCount(3);
    await expect(page.getByTestId('missing-flag')).toHaveCount(1);

    // The menu bar carries both, with ⇧⌘R, greyed while nothing is selected.
    const file = (await menuSnapshot(app)).find((m) => m.label === '파일')!.submenu!;
    expect(file.find((n) => n.id === 'item.showInFolder')).toMatchObject({ label: REVEAL, accelerator: 'Shift+CmdOrCtrl+R', enabled: false });
    expect(file.find((n) => n.id === 'item.openExternally')).toMatchObject({ label: '기본 앱으로 열기', accelerator: null, enabled: false });

    // One row whose file is there: both run on it, each with the named copy the OS can open (design-spec 10.7).
    await rowByTitle(page, 'sample').click();
    await expect.poll(() => fileItems(app)).toEqual([true, true]);
    await runMenuCommand(app, 'item.showInFolder');
    await runMenuCommand(app, 'item.openExternally');
    await expect.poll(() => shellCalls(app)).toHaveLength(2);
    const calls = await shellCalls(app);
    expect(calls.map(([kind]) => kind)).toEqual(['reveal', 'open']);
    for (const [, p] of calls) expect(p).toMatch(/[\\/]derived[\\/]open[\\/][0-9a-f-]{36}[\\/]sample\.pdf$/);

    // Two rows: the one-item commands grey (a menu item that cannot run now is grey, the macOS way).
    await selectRows(page, ['sample', KO_TITLE], { modifier: 'Meta' });
    await expect(selectedRows(page)).toHaveCount(2);
    await expect.poll(() => fileItems(app)).toEqual([false, false]);

    // The linked row whose file went missing: nothing to show or open (다시 연결… is in its context menu).
    await rowByTitle(page, 'gone').click();
    await expect(selectedRows(page)).toHaveCount(1);
    await expect.poll(() => fileItems(app)).toEqual([false, false]);

    // In the reader the table is not on screen: the selection waits, and the menu bar's item commands grey.
    await rowByTitle(page, 'sample').click();
    await expect.poll(() => fileItems(app)).toEqual([true, true]);
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-canvas')).toBeVisible();
    await expect.poll(() => fileItems(app)).toEqual([false, false]);
    await runMenuCommand(app, 'nav.back');
    await expect(rowByTitle(page, 'sample')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => fileItems(app)).toEqual([true, true]);
    expect((await shellCalls(app)).length).toBe(2); // nothing else ran on the way
  } finally {
    await app.close();
  }
});

test('the palette lists 폴더에서 보기 and 기본 앱으로 열기 for one selected row and runs them on it; never 열기 or 다시 연결…', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const ids = () => page.getByTestId('palette-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-command-id')));
  try {
    await stubShell(app);
    await importPaths(page, [PDF, KO_PDF]);
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    // Nothing selected: no item rows.
    await runMenuCommand(app, 'app.palette');
    await expect(page.getByTestId('palette-item').first()).toBeVisible();
    expect(await ids()).not.toContain('item.showInFolder');
    expect(await ids()).not.toContain('item.openExternally');
    await page.keyboard.press('Escape');
    // Two selected: still none (each needs exactly one row).
    await selectRows(page, ['sample', KO_TITLE], { modifier: 'Meta' });
    await runMenuCommand(app, 'app.palette');
    await expect(page.getByTestId('palette-item').first()).toBeVisible();
    expect(await ids()).not.toContain('item.showInFolder');
    await page.keyboard.press('Escape');
    // One selected: both rows; 열기 and 다시 연결… belong to the table and the notices.
    await rowByTitle(page, KO_TITLE).click();
    await expect(selectedRows(page)).toHaveCount(1);
    await runMenuCommand(app, 'app.palette');
    await expect.poll(ids).toContain('item.showInFolder');
    const listed = await ids();
    expect(listed).toContain('item.openExternally');
    expect(listed).not.toContain('item.open');
    expect(listed).not.toContain('item.relink');
    // ㄱㅂ: 기본 앱으로 열기 by its 초성, run on the selected row.
    await page.getByTestId('palette-input').fill('ㄱㅂ');
    await expect(page.getByTestId('palette-item').first()).toHaveAttribute('data-command-id', 'item.openExternally');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect.poll(() => shellCalls(app)).toHaveLength(1);
    const [[kind, p]] = (await shellCalls(app)) as [[string, string]];
    expect(kind).toBe('open');
    expect(p).toMatch(/[\\/]한글 경로 \(테스트\) #1\.pdf$/);
  } finally {
    await app.close();
  }
});

test('the ⌘/ sheet lists the selected row’s shortcut under 자료 (design-spec 7.4)', async ({}, testInfo) => {
  const { app } = await launch(...dirs(testInfo));
  try {
    const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'app.shortcuts'));
    const group = sheet.locator('section[aria-label="자료"]');
    await expect(group.getByTestId('shortcut-row')).toHaveText([new RegExp(`^${REVEAL}`)]);
    await expect(group.locator('.visually-hidden')).toHaveText(IS_MAC ? '⇧⌘R' : 'Ctrl+Shift+R');
    // 자료 follows 라이브러리 (design-spec 7.4 lists ⇧⌘R with the library keys).
    const titles = await sheet.locator('section[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(titles).toEqual(['앱', '라이브러리', '자료', '리더', '팔레트·대화상자']);
    await closeSheet(sheet, 'Escape');
  } finally {
    await app.close();
  }
});

test('rows that leave the list leave the selection: nothing then targets them, and a row that comes back is not selected (spec 3.3)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [sample] = await importPaths(page, [PDF, KO_PDF]);
    await rowByTitle(page, 'sample').click();
    await expect.poll(() => menuItemEnabled(app, 'item.showInFolder')).toBe(true);
    // Main moves it to the trash (the command comes with M6; the channel is there): the list is read again without it.
    expect(await page.evaluate((itemId) => window.learn.library.trash({ itemIds: [itemId] }), sample!.id)).toMatchObject({ ok: true, data: 1 });
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expect(selectedRows(page)).toHaveCount(0);
    await expect.poll(() => menuItemEnabled(app, 'item.showInFolder')).toBe(false);
    expect(await menuItemEnabled(app, 'item.openExternally')).toBe(false);
    expect(await page.evaluate((itemId) => window.learn.library.restore({ itemIds: [itemId] }), sample!.id)).toMatchObject({ ok: true, data: 1 });
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    await expect(selectedRows(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('back from the reader the selection stays and the last opened row is scrolled into view (spec 3.3)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [first] = await importPaths(page, [PDF]);
    await seedLibrary(app, { count: 300, from: first! });
    await expect(page.getByTestId('toolbar-count')).toHaveText(/^3\d\d개$/);
    // The last row, by keyboard: End moves the cursor and the selection there (spec 3.3), ↩ opens it.
    await rowAt(page, 0).click(); // by data-index: the DOM order of a virtual table is not the screen order
    await page.keyboard.press('End');
    await expect(selectedRows(page)).toHaveCount(1);
    await expect(selectedRows(page)).toHaveAttribute('data-index', /^3\d\d$/);
    const id = (await selectedRows(page).getAttribute('data-item-id'))!;
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pdf-canvas')).toBeVisible();
    await runMenuCommand(app, 'nav.back');
    // The table mounted again at its top, where that row is not even drawn: it is brought back into view.
    const row = page.locator(`[data-testid="item-row"][data-item-id="${id}"]`);
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(row).toBeInViewport({ ratio: 1 });
  } finally {
    await app.close();
  }
});
