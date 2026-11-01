// M6 Task 6: the trash on screen (spec 4.1–4.6, 11; P-7, P-9–P-11, P-25). The data under it is trash-data.spec.ts (Task 5).
// ⌘ shortcuts go through the menu (runMenuCommand / runMenuAccelerator): CDP keys never reach native accelerators on Linux.
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {
  addToCollection, assignTag, clickToCloseSheet, closeSheet, createCollection, createTag, distinctPdfs, expectWindow, importPaths, launch, mainWindow, menuSnapshot,
  organizeSnapshot, recordedPopups, rowByTitle, runMenuAccelerator, runMenuCommand, specialRow, stubContextMenu, stubOpenDialog, tagChip, trashItems, treeRow,
  type MenuNode,
} from './helpers';
import { beginDrag, dragTo, hover, marked, release } from './dnd-helpers';

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const flat = (nodes: MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flat(n.submenu ?? [])]);
const menuLabel = async (app: ElectronApplication, id: string) => flat(await menuSnapshot(app)).find((n) => n.id === id)?.label ?? null;
const liveIds = (page: Page) => page.evaluate(async () => {
  const r = await window.learn.library.list();
  return r.ok ? r.data.map((i) => i.id).sort() : [];
});
const trashed = (page: Page) => page.evaluate(async () => {
  const r = await window.learn.library.trashView();
  return r.ok ? { items: r.data.items.map((i) => i.title).sort(), collections: r.data.collections.map((c) => c.name).sort() } : null;
});
const collectionRow = (page: Page, name: string) => page.locator(`[data-testid="trash-collection-row"][data-title=${JSON.stringify(name)}]`);
const title = (page: Page) => page.getByTestId('toolbar-title');
const toTrash = (page: Page, collectionId: string) => page.evaluate((id) => window.learn.collections.remove({ collectionId: id }), collectionId);

/**
 * Three items; 학회 준비 › 발표 holding distinct-03 (which stays in the library: the collection row says 자료 1개); the tag
 * 시험 범위 on distinct-02 and 기말 on distinct-03. The tests move distinct-01 and distinct-02 to the trash.
 */
async function seed(page: Page, dir: string) {
  const items = await importPaths(page, distinctPdfs(dir, 3));
  const conf = await createCollection(page, '학회 준비');
  const talk = await createCollection(page, '발표', conf);
  await addToCollection(page, conf, [items[2]!.id]);
  const exam = await createTag(page, '시험 범위');
  const finals = await createTag(page, '기말');
  await assignTag(page, exam, [items[1]!.id]);
  await assignTag(page, finals, [items[2]!.id]);
  return { items, conf, talk, exam, finals };
}

test('⌘⌫ moves the selection at once with 실행 취소, the trash row shows with its count, one item is named, and 파일 names the line by the view', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await importPaths(page, distinctPdfs(testInfo.outputPath('in'), 4));
    await expect(specialRow(page, 'trash')).toHaveCount(0); // an empty trash has no row (spec 4.3)
    // R-2: an item trashed earlier (distinct-04) must stay in the trash through the undo below.
    await trashItems(page, [items[3]!.id]);
    await expect(specialRow(page, 'trash').locator('.count')).toHaveText('1');
    await rowByTitle(page, 'distinct-01').click();
    await rowByTitle(page, 'distinct-02').click({ modifiers: [MOD] });
    expect(await menuLabel(app, 'item.trash')).toBe('휴지통으로 이동');
    await runMenuCommand(app, 'item.trash');
    await expect(page.getByTestId('trash-undo')).toContainText('자료 2개를 휴지통으로 옮겼습니다');
    await expect(rowByTitle(page, 'distinct-01')).toHaveCount(0);
    await expect(specialRow(page, 'trash').locator('.count')).toHaveText('3');
    expect(await liveIds(page)).toEqual([items[2]!.id]);
    // 실행 취소 brings back exactly those two: the older distinct-04 stays in the trash.
    await page.getByTestId('trash-undo').getByTestId('undo-action').click();
    await expect(rowByTitle(page, 'distinct-02')).toBeVisible();
    await expect(specialRow(page, 'trash').locator('.count')).toHaveText('1');
    expect(await liveIds(page)).toEqual(items.slice(0, 3).map((i) => i.id).sort());
    expect(await trashed(page)).toEqual({ items: ['distinct-04'], collections: [] });
    // One item is named.
    await rowByTitle(page, 'distinct-03').click();
    await runMenuCommand(app, 'item.trash');
    await expect(page.getByTestId('trash-undo')).toContainText('‘distinct-03’⁠을 휴지통으로 옮겼습니다');
    // C-1: 영구 삭제 of that very item closes its toast at once (a success toast closes by itself after 5 s, so this comes first).
    await specialRow(page, 'trash').click();
    await rowByTitle(page, 'distinct-03').click();
    await expect(page.getByTestId('trash-undo')).toBeVisible();
    const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'item.trash'));
    await expect(page.getByTestId('trash-undo')).toBeVisible(); // still offered while the sheet asks
    await clickToCloseSheet(sheet, sheet.getByTestId('purge-confirm'));
    await expect(page.getByTestId('purge-done')).toHaveText('자료 1개를 영구히 삭제했습니다');
    await expect(page.getByTestId('trash-undo')).toHaveCount(0, { timeout: 1000 }); // closed with the purge, not by its own 5 s
    await expect.poll(async () => (await trashed(page))?.items).toEqual(['distinct-04']);
    await rowByTitle(page, 'distinct-04').click();
    // In the trash view the same line is 영구 삭제… (P-11).
    await expect(title(page)).toHaveText('휴지통');
    await expect.poll(() => menuLabel(app, 'item.trash')).toBe('영구 삭제…');
    await specialRow(page, 'all').click();
    await expect.poll(() => menuLabel(app, 'item.trash')).toBe('휴지통으로 이동');
  } finally {
    await app.close();
  }
});

test('the trash view: collection rows on top, 삭제한 날짜 last and newest first, 휴지통 비우기… and no 가져오기; opening is off; the panel is read-only with 복원; the tags filter the trash', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { items, conf, exam, finals } = await seed(page, testInfo.outputPath('in'));
    await trashItems(page, [items[0]!.id, items[1]!.id]);
    await toTrash(page, conf); // 발표 goes with it: one row
    await expect(specialRow(page, 'trash').locator('.count')).toHaveText('3');
    await specialRow(page, 'trash').click();
    await expect(title(page)).toHaveText('휴지통');
    await expect(page.getByTestId('toolbar-count')).toHaveText('3개');
    // Rows: the collection first, then the items; the last column is 삭제한 날짜, sorting newest first.
    const rows = page.locator('[role="row"][data-row-id]');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveAttribute('data-testid', 'trash-collection-row');
    await expect(collectionRow(page, '학회 준비').locator('[data-col="creators"]')).toHaveText('자료 1개');
    await expect(collectionRow(page, '발표')).toHaveCount(0); // trashed with its parent: inside the parent's row
    const lastHeader = page.getByTestId('column-header').last();
    await expect(lastHeader).toHaveAttribute('data-col', 'deletedAt');
    await expect(lastHeader).toHaveAttribute('aria-sort', 'descending');
    await expect(page.getByTestId('import-menu')).toHaveCount(0);
    await expect(page.getByTestId('trash-empty')).toHaveText('휴지통 비우기…');
    // Opening does nothing (spec 4.3): a double-click and ↩ stay in the library.
    await rowByTitle(page, 'distinct-01').dblclick();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('viewer-title')).toHaveCount(0);
    // The panel: 복원 and the trash line; no pencil, no tag +, no × on a chip; the tags still read.
    await rowByTitle(page, 'distinct-02').click();
    const panel = page.getByTestId('inspector');
    await expect(panel.getByTestId('inspector-restore')).toHaveText('복원');
    await expect(panel.getByTestId('trash-note')).toContainText(/^휴지통에 있습니다 · 오늘 /);
    await expect(panel.getByTestId('info-section')).toBeVisible();
    await expect(panel.getByTestId('info-empty')).toHaveCount(0); // C-3: no hint to write what cannot be written here
    await expect(panel.getByTestId('info-edit')).toHaveCount(0);
    await expect(panel.getByTestId('tags-add')).toHaveCount(0);
    await expect(panel.getByTestId('tag-add-chip')).toHaveCount(0);
    await expect(panel.getByTestId(`tag-chip-${exam}`)).toBeVisible();
    await expect(panel.getByTestId('tag-chip-remove')).toHaveCount(0);
    await expect(panel.getByTestId('inspector-open')).toHaveCount(0);
    // A collection row's panel: its kind, its name, 복원.
    await collectionRow(page, '학회 준비').click();
    await expect(page.getByTestId('inspector-trash').locator('h2')).toHaveText('학회 준비');
    await expect(page.getByTestId('inspector-kind')).toHaveText('컬렉션 · 자료 1개');
    // The tag selector reads the trash: 시험 범위 is in this view, 기말 (on a live item) is not; filtering leaves the collection out.
    await expect(tagChip(page, exam)).toBeVisible();
    await expect(tagChip(page, finals)).toHaveCount(0);
    await tagChip(page, exam).click();
    await expect(rows).toHaveCount(1);
    await expect(rowByTitle(page, 'distinct-02')).toBeVisible();
    await expect(page.getByTestId('toolbar-count')).toHaveText('1개 / 3개');
    await tagChip(page, exam).click();
    // The quick search filters the trash too, collection rows by name.
    await page.getByTestId('search-field').getByRole('searchbox').fill('학회');
    await expect(rows).toHaveCount(1);
    await expect(collectionRow(page, '학회 준비')).toBeVisible();
    await page.getByTestId('search-field').getByRole('searchbox').fill('');
    // Nothing but the trash commands acts on a trash row.
    await rowByTitle(page, 'distinct-01').click();
    expect(await menuLabel(app, 'item.trash')).toBe('영구 삭제…');
    for (const id of ['item.showInFolder', 'item.exportCopy', 'item.openExternally'] as const) {
      expect((flat(await menuSnapshot(app)).find((n) => n.id === id))?.enabled, id).toBe(false);
    }
  } finally {
    await app.close();
  }
});

test('the trash table at 1024 with the panel closed: no sideways scroll, and 삭제한 날짜 holding the longest values does not clip (T7 critique C-1)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await importPaths(page, distinctPdfs(testInfo.outputPath('in'), 2));
    await trashItems(page, [items[0]!.id]);
    await specialRow(page, 'trash').click();
    await expect(title(page)).toHaveText('휴지통');
    await (await mainWindow(app)).evaluate((w) => w.setContentSize(1024, w.getContentSize()[1]!));
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1024);
    await page.waitForTimeout(400); // the narrow window folds the panel on its own; let that settle before reading it
    if ((await page.getByTestId('shell').getAttribute('data-inspector')) === 'shown') await runMenuCommand(app, 'view.toggleInspector');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-inspector', 'hidden');
    const cell = page.locator('[data-testid="item-row"] [data-col="deletedAt"] .ellipsis').first();
    await expect(cell).toBeVisible();
    // The longest a date can read in this font: the latest clock time of today, and the widest absolute date.
    for (const text of ['오늘 오후 12:59', '2026. 12. 31.', '어제 오후 12:59']) {
      await cell.evaluate((e, t) => void (e.textContent = t), text);
      const fit = await cell.evaluate((e) => ({ scrollWidth: e.scrollWidth, clientWidth: e.clientWidth }));
      expect(fit.scrollWidth, text).toBeLessThanOrEqual(fit.clientWidth);
    }
    const table = await page.getByTestId('library-scroller').evaluate((e) => ({ scrollWidth: e.scrollWidth, clientWidth: e.clientWidth }));
    expect(table.scrollWidth).toBeLessThanOrEqual(table.clientWidth);
  } finally {
    await app.close();
  }
});

test('the trash rows’ menu (also by ⇧F10): 복원 · — · 영구 삭제…; 복원 brings a collection back with its child; an emptied trash closes its view', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { items, conf, talk } = await seed(page, testInfo.outputPath('in'));
    await trashItems(page, [items[0]!.id, items[1]!.id]);
    await toTrash(page, conf);
    await specialRow(page, 'trash').click();
    await stubContextMenu(app, '복원');
    await collectionRow(page, '학회 준비').click({ button: 'right' });
    await expect(page.getByTestId('restore-done')).toHaveText('1개를 복원했습니다');
    const popup = (await recordedPopups(app))[0]!;
    expect(popup.map((i) => (i.type === 'separator' ? '-' : i.label))).toEqual(['복원', '-', '영구 삭제…']);
    await expect.poll(async () => (await organizeSnapshot(page)).collections.map((c) => c.id).sort()).toEqual([conf, talk].sort());
    await expect(treeRow(page, conf)).toBeVisible();
    // The keyboard: the row's menu by ⇧F10, 복원 picked.
    await rowByTitle(page, 'distinct-01').click();
    await page.keyboard.press('Shift+F10');
    await expect.poll(async () => (await trashed(page))?.items).toEqual(['distinct-02']);
    // The panel's 복원 on the last row: the trash empties and its view goes to 내 라이브러리.
    await rowByTitle(page, 'distinct-02').click();
    await page.getByTestId('inspector-restore').click();
    await expect(title(page)).toHaveText('내 라이브러리');
    await expect(specialRow(page, 'trash')).toHaveCount(0);
    expect(await liveIds(page)).toEqual(items.map((i) => i.id).sort());
  } finally {
    await app.close();
  }
});

test('영구 삭제… asks in the app sheet — ↩ and esc keep, the danger button on the left deletes; 휴지통 비우기… (⇧⌘⌫) empties and the view goes to 내 라이브러리', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { items, conf } = await seed(page, testInfo.outputPath('in'));
    await trashItems(page, [items[0]!.id, items[1]!.id]);
    await toTrash(page, conf);
    await specialRow(page, 'trash').click();
    await rowByTitle(page, 'distinct-01').click();
    for (const key of ['Enter', 'Escape'] as const) {
      const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'item.trash'));
      await expect(sheet.getByTestId('purge-title')).toHaveText('자료 1개를 영구히 삭제하겠습니까?');
      await expect(sheet.getByTestId('purge-text')).toHaveText('되돌릴 수 없습니다. 라이브러리 안의 사본도 지웁니다. 외부 연결 원본은 지우지 않습니다.');
      await expect(sheet.getByTestId('purge-cancel')).toBeFocused();
      const [danger, cancel] = await Promise.all([sheet.getByTestId('purge-confirm').boundingBox(), sheet.getByTestId('purge-cancel').boundingBox()]);
      expect(danger!.x).toBeLessThan(cancel!.x);
      await closeSheet(sheet, key);
      await expect(rowByTitle(page, 'distinct-01')).toBeVisible();
    }
    const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'item.trash'));
    await clickToCloseSheet(sheet, sheet.getByTestId('purge-confirm'));
    await expect(page.getByTestId('purge-done')).toHaveText('자료 1개를 영구히 삭제했습니다');
    await expect(rowByTitle(page, 'distinct-01')).toHaveCount(0);
    expect(await trashed(page)).toEqual({ items: ['distinct-02'], collections: ['학회 준비'] });
    // A collection row and an item together: the mixed question (esc keeps them).
    await collectionRow(page, '학회 준비').click();
    await rowByTitle(page, 'distinct-02').click({ modifiers: [MOD] });
    const mixed = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'item.trash'));
    await expect(mixed.getByTestId('purge-title')).toHaveText('자료 1개와 컬렉션 1개를 영구히 삭제하겠습니까?');
    await closeSheet(mixed, 'Escape');
    // 휴지통 비우기…: the whole trash, counted; then no trash, and 내 라이브러리.
    const empty = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'trash.empty'));
    await expect(empty.getByTestId('purge-title')).toHaveText('휴지통을 비우겠습니까?');
    await expect(empty.getByTestId('purge-text')).toHaveText('자료 1개와 컬렉션 1개를 영구히 지웁니다. 되돌릴 수 없습니다. 외부 연결 원본은 지우지 않습니다.');
    await expect(empty.getByTestId('purge-confirm')).toHaveText('휴지통 비우기');
    await clickToCloseSheet(empty, empty.getByTestId('purge-confirm'));
    await expect(page.getByTestId('purge-done').last()).toHaveText('휴지통을 비웠습니다'); // the newest toast is the last one (oldest on top)
    await expect(title(page)).toHaveText('내 라이브러리');
    await expect(specialRow(page, 'trash')).toHaveCount(0);
    expect(await trashed(page)).toEqual({ items: [], collections: [] });
    expect(await liveIds(page)).toEqual([items[2]!.id]);
  } finally {
    await app.close();
  }
});

test('table rows and a collection row dropped on 휴지통 go to the trash, with 실행 취소', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { items, conf } = await seed(page, testInfo.outputPath('in'));
    await trashItems(page, [items[2]!.id]); // the row is drawn only while the trash has something (spec 4.3)
    await beginDrag(page, rowByTitle(page, 'distinct-02'), 'items');
    await hover(page, specialRow(page, 'trash'));
    expect(await marked(page)).toContain('nav-scope-trash');
    await release(page);
    await expect(page.getByTestId('trash-undo')).toContainText('‘distinct-02’⁠를 휴지통으로 옮겼습니다');
    await expect(rowByTitle(page, 'distinct-02')).toHaveCount(0);
    await dragTo(page, treeRow(page, conf), 'collection', specialRow(page, 'trash'));
    await expect(page.getByTestId('undo-toast')).toContainText('‘학회 준비’ 컬렉션을 휴지통으로 옮겼습니다');
    await expect(treeRow(page, conf)).toHaveCount(0);
    expect(await trashed(page)).toEqual({ items: ['distinct-02', 'distinct-03'], collections: ['학회 준비'] });
  } finally {
    await app.close();
  }
});

test('the reader: its item moved to the trash shows the notice; 복원 reopens it in place; 라이브러리로 돌아가기 leaves', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [pdf] = await importPaths(page, distinctPdfs(testInfo.outputPath('in'), 1));
    await rowByTitle(page, 'distinct-01').dblclick();
    await expect(page.getByTestId('viewer-title')).toBeVisible();
    await trashItems(page, [pdf!.id]);
    const notice = page.getByTestId('reader-trashed');
    await expect(notice).toContainText('이 자료는 휴지통에 있습니다');
    await expect(notice).toContainText('복원하면 이 자리에서 다시 엽니다.');
    await expect(page.getByTestId('open-failed')).toHaveCount(0);
    await notice.getByTestId('reader-trashed-restore').click();
    await expect(notice).toHaveCount(0);
    await expect(page.locator('.pdf-stage')).toBeVisible();
    await expect(page.getByTestId('open-failed')).toHaveCount(0);
    expect(await liveIds(page)).toEqual([pdf!.id]);
    await trashItems(page, [pdf!.id]);
    await page.getByTestId('reader-trashed-back').click();
    await expect(title(page)).toHaveText('내 라이브러리');
  } finally {
    await app.close();
  }
});

test('⌘⌫ typed in the quick search stays the field\'s; the menu item clicked still moves the selection; an import from the trash view shows 내 라이브러리', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await importPaths(page, distinctPdfs(testInfo.outputPath('in'), 3));
    await rowByTitle(page, 'distinct-01').click();
    const field = page.getByTestId('search-field').getByRole('searchbox');
    await field.fill('distinct');
    await expect(field).toBeFocused();
    await runMenuAccelerator(app, 'item.trash');
    await page.waitForTimeout(300);
    expect(await liveIds(page)).toEqual(items.map((i) => i.id).sort());
    // The same item clicked in the menu bar is the user's choice.
    await runMenuCommand(app, 'item.trash');
    await expect(page.getByTestId('trash-undo')).toContainText('‘distinct-01’');
    // From the table the key is the trash's.
    await rowByTitle(page, 'distinct-02').click();
    await runMenuAccelerator(app, 'item.trash');
    await expect(rowByTitle(page, 'distinct-02')).toHaveCount(0);
    // ⌘O in the trash view goes to 내 라이브러리, where the files land (Q-6i).
    await field.fill('');
    await specialRow(page, 'trash').click();
    await stubOpenDialog(app, []);
    await runMenuCommand(app, 'file.importManaged');
    await expect(title(page)).toHaveText('내 라이브러리');
  } finally {
    await app.close();
  }
});
