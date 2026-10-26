// Collections (M5 spec 3.4–3.7): naming a row in place, renaming, deleting with the sheet and 실행 취소, the empty states,
// and imports into the collection being viewed.
import path from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { platformAccelerator } from '../../packages/domain/src/accelerator';
import { commandById, type CommandId } from '../../packages/domain/src/commands';
import { expectNoSeriousA11y } from './a11y';
import {
  FIXTURES, addToCollection, closeSheet, confirmCalls, createCollection, createCollectionTree, drag, dropSource, expandAll, expectWindow, importFiles, importPaths, launch, menuSnapshot,
  menuItemEnabled, organizeSnapshot, rowAt, runMenuCommand, runPalette, specialRow, stubConfirm, stubContextMenu, stubOpenDialog, treeRow, type MenuNode,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const NEW = '새\u00a0컬렉션';
const dirs = (testInfo: TestInfo) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;
const L = (id: CommandId) => commandById(id).label;
const title = (page: Page) => page.getByTestId('toolbar-title');
const field = (page: Page) => page.getByTestId('rename-input');
/** The collections' names in the snapshot, in creation order. */
const names = async (page: Page) => (await organizeSnapshot(page)).collections.map((c) => c.name);

test('⇧⌘N makes a row in the tree and names it in place; ↩ creates it and the view stays where it was (spec 3.4)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    await rowAt(page, 0).click();
    await runMenuCommand(app, 'collection.new');
    await expect(field(page)).toBeFocused();
    expect(await field(page).inputValue()).toBe(NEW);
    expect(await field(page).evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd])).toEqual([0, NEW.length]); // the whole name is selected
    await expectNoSeriousA11y(page, 'a collection being named');
    await page.keyboard.insertText('논문 읽기');
    await page.keyboard.press('Enter');
    await expect(field(page)).toHaveCount(0);
    await expect.poll(() => names(page)).toEqual(['논문 읽기']);
    await expect(page.getByTestId('sidebar-tree').getByText('논문 읽기')).toBeVisible();
    await expect(title(page)).toHaveText('내 라이브러리'); // Finder's new folder: the table that was there stays
    await expect(rowAt(page, 0)).toBeFocused(); // and so does the focus

    // The header button does the same through the same command; it is not a Tab stop (the keys are ⇧⌘N and the palette).
    await expect(page.getByTestId('new-collection')).toHaveAttribute('tabindex', '-1');
    await page.getByTestId('new-collection').click();
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveCount(0);
    expect(await names(page)).toEqual(['논문 읽기']);
  } finally {
    await app.close();
  }
});

test('esc creates nothing, a click elsewhere creates it, an empty name makes the default one, and over 200 characters is held back', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    await runMenuCommand(app, 'collection.new');
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveCount(0);
    expect(await names(page)).toEqual([]);

    await runMenuCommand(app, 'collection.new');
    await expect(field(page)).toBeFocused();
    await page.keyboard.insertText('가');
    await title(page).click(); // a click elsewhere finishes it
    await expect.poll(() => names(page)).toEqual(['가']);

    await runMenuCommand(app, 'collection.new');
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Delete'); // the selected default name is gone: an empty field
    await page.keyboard.press('Enter');
    await expect.poll(() => names(page)).toEqual(['가', NEW]);

    await runMenuCommand(app, 'collection.new');
    await expect(field(page)).toBeFocused();
    await page.keyboard.insertText('나'.repeat(201));
    await expect(page.getByTestId('rename-note')).toHaveText('컬렉션 이름은 200자까지 쓸 수 있습니다.');
    await page.keyboard.press('Enter');
    await expect(field(page)).toBeVisible(); // ↩ did nothing
    expect(await names(page)).toEqual(['가', NEW]);
    await field(page).fill('나'.repeat(200));
    await expect(page.getByTestId('rename-note')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await names(page)).map((n) => n.length)).toEqual([1, NEW.length, 200]);
  } finally {
    await app.close();
  }
});

test('during a Korean composition ↩ and esc belong to the IME: nothing is created or dropped; after the commit ↩ creates (spec 3.4)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    await runMenuCommand(app, 'collection.new');
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Delete'); // the selected default name is gone: the composition starts in an empty field
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '신호', selectionStart: 2, selectionEnd: 2 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(field(page)).toBeVisible();
    expect(await names(page)).toEqual([]);
    // The macOS IME sends keyCode 229 without isComposing: the same.
    for (const key of ['Enter', 'Escape'] as const) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    }
    await page.waitForTimeout(200);
    await expect(field(page)).toBeVisible();
    await cdp.send('Input.insertText', { text: '신호' }); // commits the composition
    await expect(field(page)).toHaveValue('신호');
    await page.keyboard.press('Enter');
    await expect.poll(() => names(page)).toEqual(['신호']);
    // Renaming is the same field: arrows and Home/End inside it do not move the tree.
    await treeRow(page, (await organizeSnapshot(page)).collections[0]!.id).click();
    await page.keyboard.press('Enter');
    await expect(field(page)).toBeFocused();
    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End', 'ArrowDown', 'Space']) await page.keyboard.press(key);
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('new sub-collection from the menu and the palette: the parent opens and the child is named under it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    const bio = await createCollection(page, '분자생물학');
    await treeRow(page, bio).click();
    await stubContextMenu(app, L('collection.newChild'));
    await treeRow(page, bio).click({ button: 'right' });
    await expect(field(page)).toBeFocused();
    await expect(field(page).locator('xpath=ancestor::*[@role="row"]')).toHaveAttribute('aria-level', '2');
    await page.keyboard.insertText('6장');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await organizeSnapshot(page)).collections.find((c) => c.name === '6장')?.parentId).toBe(bio);
    const c6 = (await organizeSnapshot(page)).collections.find((c) => c.name === '6장')!.id;
    await expect(treeRow(page, c6)).toBeVisible(); // the parent is open
    await expect(treeRow(page, bio)).toHaveAttribute('aria-expanded', 'true');

    // The palette acts on the collection being viewed — and only offers the commands while one is.
    await runMenuCommand(app, 'app.palette');
    await page.getByTestId('palette-input').fill('하위');
    await expect(page.locator('[data-testid="palette-item"][data-command-id="collection.newChild"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await specialRow(page, 'all').click();
    await runMenuCommand(app, 'app.palette');
    await page.getByTestId('palette-input').fill('하위');
    await expect(page.locator('[data-testid="palette-item"][data-command-id="collection.newChild"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await treeRow(page, c6).click();
    await runPalette(page, app, '하위', 'collection.newChild');
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});

test('rename by the ↩ key, the menu and the palette keeps the tree in name order and allows equal names', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    const bio = await createCollection(page, '분자생물학');
    const c10 = await createCollection(page, '10장', bio);
    const c6 = await createCollection(page, '6장', bio);
    const c7 = await createCollection(page, '7장', bio);
    await treeRow(page, bio).locator('.disclosure').click();
    const labels = () => page.locator('[data-testid^="nav-collection-"] .label').allTextContents();
    await expect.poll(labels).toEqual(['분자생물학', '6장', '7장', '10장']); // numeric: 6 < 7 < 10

    await treeRow(page, c7).click();
    await page.keyboard.press('Enter'); // ↩ renames
    await expect(field(page)).toBeFocused();
    expect(await field(page).inputValue()).toBe('7장');
    await page.keyboard.insertText('8장');
    await page.keyboard.press('Enter');
    await expect.poll(labels).toEqual(['분자생물학', '6장', '8장', '10장']);
    await expect(treeRow(page, c7)).toBeFocused(); // the focus comes back to the row

    await stubContextMenu(app, L('collection.rename'));
    await treeRow(page, c6).click({ button: 'right' });
    await expect(field(page)).toBeFocused();
    await page.keyboard.insertText('5장');
    await page.keyboard.press('Enter');
    await expect.poll(labels).toEqual(['분자생물학', '5장', '8장', '10장']);

    // From the palette it is called by the longer name and acts on the collection being viewed (6장 → 5장).
    await runMenuCommand(app, 'app.palette');
    await page.getByTestId('palette-input').fill('컬렉션 이름');
    await expect(page.locator('[data-testid="palette-item"][data-command-id="collection.rename"] .p-title')).toHaveText('컬렉션 이름 바꾸기');
    await page.keyboard.press('Escape');
    await runPalette(page, app, '컬렉션 이름', 'collection.rename');
    await expect(field(page)).toBeFocused();
    await page.keyboard.insertText('10장'); // the same name as a sibling's: allowed
    await page.keyboard.press('Enter');
    await expect.poll(labels).toEqual(['분자생물학', '8장', '10장', '10장']);
    expect((await names(page)).filter((n) => n === '10장')).toHaveLength(2);

    // A blank name keeps the old one without a word.
    await treeRow(page, c10).click();
    await page.keyboard.press('Enter');
    await field(page).fill('   ');
    await page.keyboard.press('Enter');
    await expect(field(page)).toHaveCount(0);
    expect(await names(page)).toContain('10장');
  } finally {
    await app.close();
  }
});

test('delete asks in the sheet words, the view moves to the parent, and 실행 취소 brings it back without what was deleted before it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    const bio = await createCollection(page, '분자생물학');
    const c6 = await createCollection(page, '6장', bio);
    await createCollection(page, '7장', bio);
    await addToCollection(page, c6, [pdf!.id]);
    await stubConfirm(app, 'confirm');
    await stubContextMenu(app, L('collection.delete'));
    await treeRow(page, bio).locator('.disclosure').click();

    // 6장 goes first (it is deleted before its parent).
    await treeRow(page, c6).click({ button: 'right' });
    await expect.poll(async () => (await confirmCalls(app)).length).toBe(1);
    expect((await confirmCalls(app))[0]).toEqual({ type: 'none', message: '‘6장’을 삭제하겠습니까?', detail: '자료는 내 라이브러리에 남습니다.', buttons: ['삭제', '취소'], defaultId: 0, cancelId: 1 });
    await expect(treeRow(page, c6)).toHaveCount(0);
    await expect(title(page)).toHaveText('분자생물학'); // the view that was inside it moved to the parent
    await expect(page.getByTestId('undo-toast').first()).toContainText('‘6장’을 삭제했습니다');
    await specialRow(page, 'all').click();
    await expect(page.getByTestId('item-row')).toHaveCount(1); // the item stays in the library

    // The parent has one live child left; the sheet says so and the view goes to 내 라이브러리 (it was top level).
    await treeRow(page, bio).click({ button: 'right' });
    await expect.poll(async () => (await confirmCalls(app)).length).toBe(2);
    expect((await confirmCalls(app))[1]).toMatchObject({ message: '‘분자생물학’을 삭제하겠습니까?', detail: '하위 컬렉션 1개도 함께 삭제합니다.\n자료는 내 라이브러리에 남습니다.' });
    await expect.poll(() => names(page)).toEqual([]);
    await expect(title(page)).toHaveText('내 라이브러리');

    await page.getByTestId('undo-toast').first().getByTestId('undo-action').click();
    // 분자생물학 and 7장 are back; 6장 stays deleted — it was deleted by its own act, before its parent.
    await expect.poll(async () => (await names(page)).sort()).toEqual(['7장', '분자생물학']);
    await expect(treeRow(page, bio)).toBeVisible();
    await expect(treeRow(page, bio)).toHaveAttribute('aria-expanded', 'false'); // it comes back folded, though it was open

    // Cancelling the sheet changes nothing; a name ending in a vowel takes 를.
    const stats = await createCollection(page, '통계');
    await stubConfirm(app, 'cancel');
    await treeRow(page, stats).click({ button: 'right' });
    await expect.poll(async () => (await confirmCalls(app)).length).toBe(1);
    expect((await confirmCalls(app))[0]!.message).toBe('‘통계’를 삭제하겠습니까?');
    await expect(treeRow(page, stats)).toBeVisible();
    expect(await names(page)).toContain('통계');
  } finally {
    await app.close();
  }
});

test('an empty collection says so in the table and the item panel, and its button brings files into it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    const conf = await createCollection(page, '학회 준비');
    await treeRow(page, conf).click();
    const empty = page.getByTestId('collection-empty');
    await expect(empty).toContainText('이\u00a0컬렉션은 비어 있습니다');
    await expect(empty).toContainText('다른\u00a0컬렉션의 자료를 사이드바의 ‘학회 준비’로 끌어\u00a0놓거나, 파일을 바로 이\u00a0컬렉션으로 가져오세요.');
    await expect(page.getByTestId('collection-empty-import')).toHaveText('이\u00a0컬렉션으로 가져오기…');
    await expect(page.getByTestId('inspector-collection').locator('.pe-title')).toHaveText('학회 준비');
    await expect(page.getByTestId('collection-empty-meta')).toHaveText(/^자료 0개 · 오늘\s(오전|오후)\s\d{1,2}:\d{2} 만듦$/);
    await expect(page.getByTestId('toolbar-count')).toHaveText('0개');
    await expectNoSeriousA11y(page, 'an empty collection');

    // A collection whose items are all in a sub-collection is not empty.
    const parent = await createCollection(page, '논문');
    const sub = await createCollection(page, '2024', parent);
    await addToCollection(page, sub, [pdf!.id]);
    await treeRow(page, parent).click();
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expect(page.getByTestId('collection-empty')).toHaveCount(0);

    // The button files the open panel's pick into this collection.
    await treeRow(page, conf).click();
    await stubOpenDialog(app, [KO_PDF]);
    await page.getByTestId('collection-empty-import').click();
    await expect(page.getByTestId('import-done')).toHaveText('‘학회 준비’에 자료 1개를 가져왔습니다');
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expect(treeRow(page, conf).locator('.count')).toHaveText('1');
    await specialRow(page, 'all').click();
    await expect(page.getByTestId('item-row')).toHaveCount(2);
  } finally {
    await app.close();
  }
});

test('imports go into the collection being viewed: ⌘O, a window drop with the overlay naming it, and a duplicate left out is filed there too (spec 3.7)', async ({}, testInfo) => {
  const s = await launch(...dirs(testInfo));
  const { app, page } = s;
  try {
    const a = await createCollection(page, '논문');
    await treeRow(page, a).click();
    await stubOpenDialog(app, [PDF]);
    await runMenuCommand(app, 'file.importManaged');
    await expect(page.getByTestId('import-done')).toHaveText('‘논문’에 자료 1개를 가져왔습니다');
    await expect.poll(async () => (await organizeSnapshot(page)).members[a]?.length).toBe(1);

    // In 내 라이브러리 nothing is filed.
    await specialRow(page, 'all').click();
    await stubOpenDialog(app, [KO_PDF]);
    await runMenuCommand(app, 'file.importManaged');
    await expect(page.getByTestId('import-done').filter({ hasText: /^자료 1개를 가져왔습니다$/ })).toBeVisible();
    expect((await organizeSnapshot(page)).members[a]).toHaveLength(1);

    // A window drop: the overlay names the collection, and the file goes into it.
    await treeRow(page, a).click();
    await dropSource(page, [MP4]);
    await drag(page, 'dragenter', 'source');
    await expect(page.getByTestId('drop-overlay').getByRole('heading')).toHaveText('‘논문’으로 가져오기');
    await drag(page, 'dragover', 'source');
    await drag(page, 'drop', 'source');
    await expect(page.getByTestId('import-done').filter({ hasText: '‘논문’에 자료 1개를 가져왔습니다' }).first()).toBeVisible(); // newest first
    await expect.poll(async () => (await organizeSnapshot(page)).members[a]?.length).toBe(2);

    // 가져오지 않음 for a duplicate files the item that is already in the library into this collection.
    const b = await createCollection(page, '발표');
    await treeRow(page, b).click();
    const sheet = await expectWindow(app, 'sheet', () => importFiles(s, [PDF]));
    await closeSheet(sheet, 'Escape'); // esc = leave it out
    await expect(page.getByTestId('import-done').filter({ hasText: '이미 있는 자료 1개를 ‘발표’에 넣었습니다' })).toBeVisible();
    await expect.poll(async () => (await organizeSnapshot(page)).members[b]?.length).toBe(1);
    // A second time there is nothing new to file: no such sentence.
    const again = await expectWindow(app, 'sheet', () => importFiles(s, [PDF]));
    await closeSheet(again, 'Escape');
    await page.waitForTimeout(500);
    await expect(page.getByTestId('import-done').filter({ hasText: '이미 있는 자료 1개를 ‘발표’에 넣었습니다' })).toHaveCount(1);
    expect((await organizeSnapshot(page)).members[b]).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test('the menu bar has 새 컬렉션 in 파일; the collection commands are offered by the palette only while a collection is viewed', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    const flat = (nodes: MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flat(n.submenu ?? [])]);
    const item = flat(await menuSnapshot(app)).find((n) => n.id === 'collection.new')!;
    expect(item).toMatchObject({ label: '새\u00a0컬렉션', accelerator: platformAccelerator('Shift+CmdOrCtrl+N', process.platform), enabled: true });
    for (const id of ['collection.newChild', 'collection.rename', 'collection.importInto', 'collection.delete'] as const) expect(flat(await menuSnapshot(app)).some((n) => n.id === id), id).toBe(false);

    const listed = async (query: string) => {
      await runMenuCommand(app, 'app.palette');
      await page.getByTestId('palette-input').fill(query);
      const ids = await page.getByTestId('palette-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-command-id')));
      await page.keyboard.press('Escape');
      return ids;
    };
    expect(await listed('컬렉션')).toEqual(['collection.new']);
    const a = await createCollection(page, '논문');
    await treeRow(page, a).click();
    expect((await listed('컬렉션')).sort()).toEqual(['collection.delete', 'collection.importInto', 'collection.new', 'collection.newChild', 'collection.rename']);
    await runMenuCommand(app, 'view.toggleSidebar'); // hidden: ⇧⌘N shows it and names the row in it
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await runMenuCommand(app, 'collection.new');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Escape');
    expect(await menuItemEnabled(app, 'collection.new')).toBe(true);
  } finally {
    await app.close();
  }
});

test('a name being typed survives a small scroll and is saved when its row scrolls out of the virtual window', async ({}, testInfo) => {
  test.setTimeout(240_000);
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    const tree = await createCollectionTree(page, 60);
    await expandAll(page, tree);
    const first = tree.ids[0]!;
    await treeRow(page, first).click();
    await page.keyboard.press('Enter');
    await expect(field(page)).toBeFocused();
    await page.keyboard.insertText('첫째');
    const scroller = page.getByTestId('sidebar-tree');
    await scroller.evaluate((e) => void (e.scrollTop = 20));
    await expect(field(page)).toBeFocused(); // still mounted: a small scroll changes nothing
    await scroller.evaluate((e) => void (e.scrollTop = e.scrollHeight));
    await expect(field(page)).toHaveCount(0); // the row left the window; the edit ended
    await expect.poll(async () => (await organizeSnapshot(page)).collections.find((c) => c.id === first)?.name).toBe('첫째');
  } finally {
    await app.close();
  }
});

test('the palette renames or adds under the viewed collection from a tree folded in the stored list: the field is focused and the parents are open', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    const bio = await createCollection(page, '분자생물학');
    const c6 = await createCollection(page, '6장', bio);
    await addToCollection(page, c6, [pdf!.id]); // a row in the table to take the focus from the tree
    await treeRow(page, bio).locator('.disclosure').click();
    await treeRow(page, c6).click();
    // Folding by the chevron moves the view to the parent, and a restored view opens its ancestors, so the row cannot be hidden
    // from the UI; the stored list is emptied and the page reloaded to start from the folded tree.
    const foldAll = async () => {
      await page.evaluate(() => window.learn.settings.set({ key: 'sidebar.expanded', value: [] }));
      await page.reload();
      await page.getByTestId('app-ready').waitFor({ state: 'attached' });
      await expect(title(page)).toHaveText('6장');
    };
    await foldAll();

    await runPalette(page, app, '컬렉션 이름', 'collection.rename');
    await expect(field(page)).toBeFocused();
    await expect(treeRow(page, bio)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(field(page)).toHaveCount(0);

    await foldAll();
    await runPalette(page, app, '하위', 'collection.newChild');
    await expect(field(page)).toBeFocused();
    await expect(treeRow(page, bio)).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});
