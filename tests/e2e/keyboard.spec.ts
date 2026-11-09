// Keyboard only (AC18, design-spec 8.3). In-page keys are real key presses; ⌘ shortcuts go through the menu items
// (runMenuCommand) because CDP keys never reach native accelerators on Linux — the macOS lane presses them for real.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import { beginDrag, cancelDrag, hover } from './dnd-helpers';
import {
  FIXTURES, addToCollection, closeSheet, createCollection, distinctPdfs, drag, dropSource, enabledMenuCommands, expectWindow, holdCopies, holdOpenDialog, holdSaveDialog, importFiles, importPause, importPaths, importResume, importWaiting, launch, libraryTab, mainWindow, readerTab, runMenuAccelerator,
  makeTags, menuItemEnabled, openItem, organizeSnapshot, releaseCopies, releaseOpenDialog, releaseSaveDialog, rowAt, rowByTitle, runMenuCommand, selectRows, sheetReleased, showItemPanel,
  specialRow, stubContextMenu, stubFolderPicker, stubFolderPicks, stubOpenDialog, tagChip, trashItems, translationFake, treeRow, waitImportIdle,
  selectInPage, textExtraction, textIdle,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
/** The Korean fixture's title (titleFromFile): the one 초성 ㅎㄱ finds. */
const KO = '한글 경로 (테스트) #1';

/** The data-pane the focus is in (sidebar, content, toasts), or null. */
const inPane = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') ?? null);
/** The test id of the element with the focus (or of its nearest ancestor that has one). */
const focusedTestId = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? null);
/** The `?window=` kind of the focused BrowserWindow. */
const focusedWindow = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => /[?&]window=(\w+)/.exec(BrowserWindow.getFocusedWindow()?.webContents.getURL() ?? '')?.[1] ?? null);

/** Tab, at most `max` times, until the focused element's nearest test id is `testId`. */
async function tabTo(page: Page, testId: string, max = 12): Promise<void> {
  for (let i = 0; i < max && (await focusedTestId(page)) !== testId; i++) await page.keyboard.press('Tab');
  expect(await focusedTestId(page)).toBe(testId);
}
/** Tab, at most `max` times, until the focus is in the item panel editor's field `field` (its control or inside it). */
async function tabToField(page: Page, field: string, max = 20): Promise<void> {
  const there = () => page.evaluate((f) => (document.activeElement?.closest(`[data-testid="editor-field"][data-field="${f}"]`) ?? null) !== null, field);
  for (let i = 0; i < max && !(await there()); i++) await page.keyboard.press('Tab');
  expect(await there()).toBe(true);
}
/** F6, at most once round the four panes (sidebar → content → inspector → toasts), until the focus is in `pane`. */
async function f6To(page: Page, pane: string): Promise<void> {
  for (let i = 0; i < 4 && (await inPane(page)) !== pane; i++) await page.keyboard.press('F6');
  expect(await inPane(page)).toBe(pane);
}
test('import → open → page → back → palette → settings → shortcuts, with axe at every stop', async ({}, testInfo) => {
  // No colour-scheme emulation: the theme the settings window picks reaches prefers-color-scheme (axe in both themes).
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: null });
  try {
    await expectNoSeriousA11y(page, 'empty library');
    await stubOpenDialog(app, [MP4, PDF]); // newest first: the PDF heads the list
    await page.keyboard.press('F6'); // sidebar
    expect(await focusedTestId(page)).toBe('nav-scope-all');
    await page.keyboard.press('F6'); // content: first control of the first-run screen
    expect(await focusedTestId(page)).toBe('import-managed');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    // The first-run screen took the focus along: the table's first row has it now (MainWindow's handover), selected.
    await expect(rowAt(page, 0)).toBeFocused();
    await expectNoSeriousA11y(page, 'library list');

    await page.keyboard.press('Shift+F6'); // sidebar (whether or not the success toast is still up)
    expect(await focusedTestId(page)).toBe('nav-scope-all');
    await page.keyboard.press('F6'); // content: the table's cursor row
    expect(await focusedTestId(page)).toBe('item-row');
    await expect(rowAt(page, 0)).toHaveAttribute('data-focus-visible', 'true'); // keyboard cursor ring
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', ''); // the page field is on from here
    await expectNoSeriousA11y(page, 'PDF reader');

    await page.keyboard.press('F6'); // sidebar
    await page.keyboard.press('F6'); // content: the toolbar's first control, the page field
    expect(await focusedTestId(page)).toBe('pdf-page-field');
    await page.keyboard.press('Tab'); // 이전 쪽: disabled on page 1, still focusable
    expect(await focusedTestId(page)).toBe('pdf-prev');
    await page.keyboard.press('Tab'); // 다음 쪽
    expect(await focusedTestId(page)).toBe('pdf-next');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pdf-page-field')).toHaveValue('2');
    await page.keyboard.press('Shift+Tab'); // 이전 쪽
    await page.keyboard.press('Shift+Tab'); // 쪽 번호
    await page.keyboard.press('Shift+Tab'); // 앞으로: off with nothing to go forward to, still focusable
    expect(await focusedTestId(page)).toBe('pdf-history-forward');
    await page.keyboard.press('Shift+Tab'); // 뒤로
    expect(await focusedTestId(page)).toBe('pdf-history-back');
    await page.keyboard.press('Shift+Tab'); // the tab strip: the reader's own tab
    expect(await focusedTestId(page)).toBe('tab');
    await page.keyboard.press('ArrowLeft'); // the library tab (an arrow moves the focus, ↩ chooses)
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('library-table')).toBeVisible();

    await runMenuCommand(app, 'app.palette'); // ⌘K
    await expect(page.getByTestId('palette-input')).toBeFocused(); // the keys go to the field that has the focus when they arrive
    await expectNoSeriousA11y(page, 'palette');
    await page.keyboard.type('ㅅㅇㄷㅂ');
    await expectNoSeriousA11y(page, 'palette, 초성 results');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await runMenuCommand(app, 'view.toggleSidebar'); // ⌃⌘S

    await runMenuCommand(app, 'app.palette');
    await expect(page.getByTestId('palette-input')).toBeFocused(); // the keys go to the field that has the focus when they arrive
    await page.keyboard.type('효소 억제제');
    await expect(page.getByTestId('palette-empty')).toBeVisible();
    // The library has items: the hand-off to the quick search stays, the one row, under the cursor (spec §4.4).
    await expect(page.getByTestId('palette-search-library')).toHaveAttribute('data-focused', 'true');
    await expectNoSeriousA11y(page, 'palette, no results');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toHaveCount(0);

    const settings = await expectWindow(app, 'settings', async () => {
      await runMenuCommand(app, 'app.palette');
      await expect(page.getByTestId('palette-input')).toBeFocused(); // the keys go to the field that has the focus when they arrive
      await page.keyboard.type('설정');
      await page.keyboard.press('Enter');
    });
    // Light, then dark, each picked by keyboard and checked on the page itself. (Not colorScheme: 'light' at launch:
    // that emulation would hold the page light through the dark pick.)
    await settings.keyboard.press('Tab'); // the theme radio group
    await settings.keyboard.press('ArrowRight'); // 시스템 설정 → 라이트
    await expect.poll(() => app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('light');
    await expect.poll(() => settings.evaluate(() => matchMedia('(prefers-color-scheme: light)').matches)).toBe(true);
    await expectNoSeriousA11y(settings, 'settings window, light');
    await settings.keyboard.press('ArrowRight'); // 다크
    await expect.poll(() => settings.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    await expectNoSeriousA11y(settings, 'settings window, dark');
    await settings.close();

    const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'app.shortcuts')); // ⌘/
    await expectNoSeriousA11y(sheet, 'shortcut sheet');
    await closeSheet(sheet, 'Enter');
  } finally {
    await app.close();
  }
});

// Spec 1 condition 4: the way through the library by keyboard only. ⌘ shortcuts go through their menu items
// (runMenuCommand) because CDP keys never reach native accelerators on Linux; every other key is a real key press.
test('M4 keyboard only: import → find (⌘F) → select → edit the info → open → back to the library, with axe at every new stop', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: null });
  const row = rowByTitle(page, KO);
  const searchInput = page.getByTestId('search-field').getByRole('searchbox');
  try {
    // Import from the first-run screen.
    await stubOpenDialog(app, [MP4, KO_PDF, PDF]);
    await page.keyboard.press('F6'); // sidebar
    await page.keyboard.press('F6'); // content: the first-run screen's first button
    expect(await focusedTestId(page)).toBe('import-managed');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('item-row')).toHaveCount(3);
    await expect(page.getByTestId('toolbar-count')).toHaveText('3개');
    // The first-run screen hands the focus to the table's first row (by data-index: rows are placed absolutely).
    await expect(rowAt(page, 0)).toBeFocused();
    await expectNoSeriousA11y(page, 'library table');

    // Find: ⌘F puts the focus in the quick search; 초성 ㅎㄱ leaves the Korean title, "1개 / 3개" (spec 4.1). The rows it
    // hides leave the selection.
    await runMenuCommand(app, 'library.find');
    await expect(searchInput).toBeFocused();
    await page.keyboard.type('ㅎㄱ');
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expect(row).toBeVisible();
    await expect(page.getByTestId('toolbar-count')).toHaveText('1개 / 3개');
    await expectNoSeriousA11y(page, 'library, quick search results');

    // Select: ↓ takes the focus to the table's first result and selects it alone (spec 4.1, as an arrow selects in the
    // table); Home, a table key, keeps it (Finder-style: the cursor's row is the selection).
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => inPane(page)).toBe('content');
    await expect(row).toBeFocused();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await showItemPanel(app, page); // ⌥⌘I where the window is too narrow for the panel beside the table (the 1024 px macOS runner)
    await expect(page.getByTestId('inspector-head')).toContainText(KO);
    await expectNoSeriousA11y(page, 'item panel, one item');

    // Edit the info: F6 to the item panel, Tab to the pencil, ↩ opens the form with the focus kept in the panel, Tab to
    // 날짜, and ↩ in that one-line field saves (spec 5.3).
    await page.keyboard.press('F6');
    await expect.poll(() => inPane(page)).toBe('inspector');
    await tabTo(page, 'info-edit');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('info-editor')).toBeVisible();
    await expect.poll(() => inPane(page)).toBe('inspector'); // never <body>
    await expectNoSeriousA11y(page, 'item panel, editing');
    await tabToField(page, 'date');
    await page.keyboard.type('2024');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
    await expect(page.locator('[data-testid="info-row"][data-field="date"]')).toContainText('2024');
    await expect(row.locator('[data-col="year"]')).toHaveText('2024');
    await expectNoSeriousA11y(page, 'item panel, after saving');

    // Open: F6 back to the table, whose cursor is still on the row; ↩ opens the one selected item.
    await f6To(page, 'content');
    await expect.poll(() => focusedTestId(page)).toBe('item-row');
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    // The page field is off until the saved place is applied, and F6 passes over it until then (Mac run 42439011165: pdf-find).
    await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', '');

    // Back to the library the first journey's way: F6 to the reader's controls, a page on, ⇧⇥ ×2 to 라이브러리로 돌아가기.
    await page.keyboard.press('F6'); // sidebar
    await page.keyboard.press('F6'); // content: the page field
    expect(await focusedTestId(page)).toBe('pdf-page-field');
    await page.keyboard.press('Tab'); // 이전 쪽: disabled on page 1, still focusable
    expect(await focusedTestId(page)).toBe('pdf-prev');
    await page.keyboard.press('Tab'); // 다음 쪽
    expect(await focusedTestId(page)).toBe('pdf-next');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pdf-page-field')).toHaveValue('2');
    await page.keyboard.press('Shift+Tab'); // 이전 쪽
    await page.keyboard.press('Shift+Tab'); // 쪽 번호
    await page.keyboard.press('Shift+Tab'); // 앞으로: off with nothing to go forward to, still focusable
    expect(await focusedTestId(page)).toBe('pdf-history-forward');
    await page.keyboard.press('Shift+Tab'); // 뒤로
    expect(await focusedTestId(page)).toBe('pdf-history-back');
    await page.keyboard.press('Shift+Tab'); // the tab strip: the reader's own tab
    expect(await focusedTestId(page)).toBe('tab');
    await page.keyboard.press('ArrowLeft'); // the library tab (an arrow moves the focus, ↩ chooses)
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('library-table')).toBeVisible();

    // The selection and the quick search are as they were, the row in view (spec 3.3, 4.1).
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expect(row).toBeInViewport();
    await expect(page.getByTestId('toolbar-count')).toHaveText('1개 / 3개');
    // The search ends by keyboard: ⌘F, esc clears it, esc again hands the focus back to the table — both escapes are the
    // field's own, so the selection stays (the table's esc clears it only when the table has the focus).
    await runMenuCommand(app, 'library.find');
    await expect(searchInput).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(searchInput).toHaveValue('');
    await expect(page.getByTestId('item-row')).toHaveCount(3);
    await page.keyboard.press('Escape');
    await expect.poll(() => inPane(page)).toBe('content');
    await expect(row).toBeFocused();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expectNoSeriousA11y(page, 'library, back from the reader');
    // On the table esc clears the selection; the cursor stays on its row.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="item-row"][aria-selected="true"]')).toHaveCount(0);
    await expect(row).toBeFocused();
  } finally {
    await app.close();
  }
});

// Spec 10 "axe (no serious violation)": every screen state the library adds beyond the keyboard journey's stops, in one library.
test('axe at every M4 library state: nothing selected, several, a missing file, no search results, palette items, unsaved changes, busy and saved toasts, loading', async ({}, testInfo) => {
  // About fourteen axe scans, four imports, an export with held copies and a reload: more than the suite's 120 s on a loaded run.
  test.setTimeout(240_000);
  const src = testInfo.outputPath('src');
  fs.mkdirSync(src, { recursive: true });
  const gone = path.join(src, 'gone.pdf');
  fs.copyFileSync(PDF, gone);
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: null });
  try {
    await importPaths(page, [PDF, KO_PDF, MP4]);
    // A linked file that went missing; library.get notices it (as the visual tour does).
    await importPaths(page, [gone], { mode: 'linked', allowDuplicate: true });
    fs.rmSync(gone);
    await page.evaluate(async () => {
      const list = await window.learn.library.list();
      if (list.ok) for (const i of list.data) await window.learn.library.get({ itemId: i.id });
    });
    await expect(page.getByTestId('item-row')).toHaveCount(4);

    await showItemPanel(app, page); // a window too narrow for the panel beside the table shows it on demand
    await expect(page.getByTestId('inspector-none')).toBeVisible();
    await expectNoSeriousA11y(page, 'item panel, nothing selected');

    await selectRows(page, ['sample', KO], { modifier: 'Meta' });
    await expect(page.getByTestId('inspector-multi')).toBeVisible();
    await expectNoSeriousA11y(page, 'item panel, several items');

    // A linked item whose file is gone heads the panel with 다시 연결….
    await rowByTitle(page, 'gone').click();
    await expect(page.getByTestId('inspector-relink')).toBeVisible();
    await expectNoSeriousA11y(page, 'item panel, a linked file that is missing');

    await runMenuCommand(app, 'library.find');
    await expect(page.getByTestId('search-field').getByRole('searchbox')).toBeFocused();
    await page.keyboard.type('효소 억제제');
    await expect(page.getByTestId('search-empty')).toBeVisible();
    await expectNoSeriousA11y(page, 'library, no search results');
    await page.keyboard.press('Escape'); // clears the query
    await expect(page.getByTestId('item-row')).toHaveCount(4);

    await runMenuCommand(app, 'app.palette');
    await expect(page.getByTestId('palette-input')).toBeFocused(); // the keys go to the field that has the focus when they arrive
    await page.keyboard.type('sample');
    await expect(page.getByTestId('palette-result').first()).toBeVisible();
    await expectNoSeriousA11y(page, 'palette, item results');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toHaveCount(0);

    // Unsaved changes (spec 5.3): an invalid date, then another row; the selection goes back and the form says why.
    await rowByTitle(page, 'sample').click();
    await page.getByTestId('info-edit').click();
    const dateInput = page.locator('[data-testid="editor-field"][data-field="date"]').locator('xpath=descendant-or-self::input').first();
    await dateInput.fill('2024년');
    await expect(dateInput).toHaveValue('2024년');
    await rowByTitle(page, KO).click();
    await expect(page.getByTestId('editor-unsaved')).toBeVisible();
    await expect(rowByTitle(page, 'sample')).toHaveAttribute('aria-selected', 'true');
    await expectNoSeriousA11y(page, 'item panel, unsaved changes');
    await page.getByTestId('editor-discard').click();
    await expect(page.getByTestId('info-editor')).toHaveCount(0);

    // A copy that takes long: the busy toast past 300 ms, then the saved toast with its action. The export counts its
    // 300 ms from the save panel's close, so the panel is a stubbed one that closes, and main's copy is what is held.
    const exportDir = testInfo.outputPath('exports');
    fs.mkdirSync(exportDir, { recursive: true });
    await holdSaveDialog(app, path.join(exportDir, 'sample.pdf'));
    await rowByTitle(page, 'sample').click();
    await runMenuCommand(app, 'item.exportCopy'); // waits until main's menu has the selection (one item, its file there)
    await holdCopies(app);
    await releaseSaveDialog(app);
    await expect(page.getByTestId('file-busy')).toContainText('내보내는 중…');
    await expectNoSeriousA11y(page, 'busy toast');
    await releaseCopies(app);
    await expect(page.getByTestId('file-busy')).toHaveCount(0);
    await expect(page.getByTestId('export-done')).toBeVisible();
    await expect(page.getByTestId('export-reveal')).toBeVisible();
    await expectNoSeriousA11y(page, 'saved toast with its action');

    // Loading (spec 3.5): a fresh renderer whose first list read is held past 300 ms; the table head stays. Last,
    // because the reload resets the page's state. The handler is swapped in main directly, as table.spec does: the
    // window-kind check guards createHandle's handlers, not this test stand-in.
    const listed = await page.evaluate(() => window.learn.library.list());
    await app.evaluate(({ ipcMain }, reply) => {
      const g = globalThis as { __learnReleaseList?: Array<() => void> };
      g.__learnReleaseList = [];
      ipcMain.removeHandler('library:list');
      ipcMain.handle('library:list', () => new Promise((resolve) => g.__learnReleaseList!.push(() => resolve(reply))));
    }, listed);
    await page.reload();
    await expect(page.getByTestId('table-loading')).toBeVisible();
    await expectNoSeriousA11y(page, 'library, loading');
    await app.evaluate(() => {
      for (const release of (globalThis as { __learnReleaseList?: Array<() => void> }).__learnReleaseList ?? []) release();
    });
    await expect(page.getByTestId('item-row')).toHaveCount(4);
  } finally {
    await app.close();
  }
});

// Spec 1 condition 5 and spec 13 (AC18): from a new collection to a tag filter by keyboard only. ⌘ shortcuts go through their
// menu items (runMenuCommand) because CDP keys never reach native accelerators on Linux; every other key is a real key press.
// The colour tag at slot 1 is made through the page's API first: tags are made in the item panel (organize-inspector.spec
// walks that keyboard path), and this journey is about filing and filtering.
test('M5 keyboard only: ⇧⌘N → name → table → select → 컬렉션에 추가 ▸ → 1 → sidebar → the collection → tag chip → Space filters, with axe at every new stop', async ({}, testInfo) => {
  const NAME = '분자생물학';
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: null });
  const selected = page.locator('[data-testid="item-row"][aria-selected="true"]');
  try {
    await importPaths(page, [PDF, KO_PDF, MP4]);
    await expect(page.getByTestId('item-row')).toHaveCount(3);
    const [important] = await makeTags(page, [{ name: '중요', slot: 1 }]);

    // New collection: ⇧⌘N puts a named-in-place row at the top of the tree, with the name selected and the focus in the field.
    // The view does not move (a Finder new folder does not either).
    await runMenuCommand(app, 'collection.new');
    const field = page.getByTestId('rename-input');
    await expect(field).toBeFocused();
    await expectNoSeriousA11y(page, 'sidebar, a collection being named');
    await page.keyboard.type(NAME);
    await page.keyboard.press('Enter');
    await expect(field).toHaveCount(0);
    const collection = (await organizeSnapshot(page)).collections.find((c) => c.name === NAME);
    expect(collection, 'the collection exists in main').toBeDefined();
    expect(collection!.parentId).toBeNull();
    await expect(treeRow(page, collection!.id)).toBeVisible();
    await expect(page.getByTestId('toolbar-title')).not.toHaveText(NAME);
    await expect(page.getByTestId('item-row')).toHaveCount(3);

    // Table: F6 comes down on the table (its first row is chosen when the focus arrives without a cursor), ↓ chooses the next.
    await f6To(page, 'content');
    await expect.poll(() => focusedTestId(page)).toBe('item-row');
    await expect(selected).toHaveCount(1);
    const first = await selected.getAttribute('data-item-id');
    await page.keyboard.press('ArrowDown');
    await expect(selected).toHaveCount(1);
    const second = (await selected.getAttribute('data-item-id'))!;
    expect(second).not.toBe(first);

    // Menu command: 파일 › 컬렉션에 추가 ▸ › the collection. The menu bar is rebuilt a moment after the collection exists, so the
    // submenu row is waited for.
    await expect.poll(() => menuItemEnabled(app, `collection.addItems?collectionId=${collection!.id}`)).toBe(true);
    await runMenuCommand(app, 'collection.addItems', { collectionId: collection!.id });
    await expect.poll(async () => (await organizeSnapshot(page)).members[collection!.id] ?? []).toEqual([second]);

    // 1 puts the slot-1 tag on the chosen row; its dot shows in the title cell. Focus is still on the table.
    await page.keyboard.press('1');
    await expect.poll(async () => (await organizeSnapshot(page)).tagged[important!] ?? []).toEqual([second]);
    await expect(page.locator(`[data-testid="item-row"][data-item-id="${second}"] [data-testid="tag-dots"]`)).toBeVisible();
    await expectNoSeriousA11y(page, 'table, a row with a colour dot');

    // One more row into the collection, without the tag: the filter below must have something to leave out.
    await page.keyboard.press('ArrowDown');
    await expect(selected).toHaveCount(1);
    const third = (await selected.getAttribute('data-item-id'))!;
    expect([first, second]).not.toContain(third);
    await runMenuCommand(app, 'collection.addItems', { collectionId: collection!.id });
    await expect.poll(async () => [...((await organizeSnapshot(page)).members[collection!.id] ?? [])].sort()).toEqual([second, third].sort());

    // Sidebar: F6 lands on the current view's row; ↓ moves the view with the cursor, through the special views to the collection.
    await f6To(page, 'sidebar');
    expect(await focusedTestId(page)).toBe('nav-scope-all');
    const row = `nav-collection-${collection!.id}`;
    for (let i = 0; i < 6 && (await focusedTestId(page)) !== row; i++) await page.keyboard.press('ArrowDown');
    expect(await focusedTestId(page)).toBe(row);
    await expect(page.getByTestId('toolbar-title')).toHaveText(NAME);
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    await expectNoSeriousA11y(page, 'sidebar, the collection viewed from the keyboard');

    // Tag selector: Tab reaches the chip (one rolling stop), Space puts it in the filter; only the tagged row stays.
    await tabTo(page, `tag-chip-${important}`, 6);
    await expectNoSeriousA11y(page, 'tag selector, a chip with the focus');
    await page.keyboard.press('Space');
    await expect(tagChip(page, important!)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expect(page.locator(`[data-testid="item-row"][data-item-id="${second}"]`)).toBeVisible();
    await expect(page.getByTestId('toolbar-count')).toHaveText('1개 / 2개');
    await expectNoSeriousA11y(page, 'a tag filter on');

    // Space again takes it out: the keyboard path back is as short as the way in.
    await page.keyboard.press('Space');
    await expect(tagChip(page, important!)).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('item-row')).toHaveCount(2);
  } finally {
    await app.close();
  }
});

test('M6 keyboard only: ⌘O → toast ends → F6 table → ↓ → ⌘⌫ → undo → ⌘⌫ → sidebar 휴지통 → 복원 → 백업 만들기 → 결과 시트 완료, with axe at every new stop', async ({}, testInfo) => {
  const backups = testInfo.outputPath('backups');
  fs.mkdirSync(backups, { recursive: true });
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: null });
  const selected = page.locator('[data-testid="item-row"][aria-selected="true"]');
  const rows = page.getByTestId('item-row');
  /** Tab, at most `max` times, until the focus is on the control `testId` (a toast's button). */
  const tabToControl = async (testId: string, max = 6) => {
    for (let i = 0; i < max && (await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)) !== testId; i++) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)).toBe(testId);
  };
  try {
    // 1. ⌘O (파일 가져오기…, through its menu item): the run ends, the result toast names the count, the table has both rows.
    await stubOpenDialog(app, [PDF, KO_PDF]);
    await runMenuCommand(app, 'file.importManaged');
    await expect(page.getByTestId('import-done')).toHaveText('자료 2개를 가져왔습니다');
    await waitImportIdle(page);
    await expect(rows).toHaveCount(2);
    // A result toast closes by itself after 5 s; F6 below must find only what this journey puts up next.
    await expect(page.getByTestId('import-done')).toHaveCount(0, { timeout: 15_000 });

    // 2. F6 comes down on the table with its first row chosen; ⌘⌫ (휴지통으로 이동) leaves one row and offers 실행 취소.
    await f6To(page, 'content');
    await expect.poll(() => focusedTestId(page)).toBe('item-row');
    await expect(selected).toHaveCount(1);
    await runMenuCommand(app, 'item.trash');
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId('trash-undo')).toContainText('휴지통으로 옮겼습니다');
    await expectNoSeriousA11y(page, 'm6-undo-toast');

    // 3. 실행 취소 by the keyboard: F6 reaches the toast, Tab the button, Enter presses it.
    await f6To(page, 'toasts');
    await tabToControl('undo-action');
    await expectNoSeriousA11y(page, 'm6-undo-toast, the button focused');
    await page.keyboard.press('Enter');
    await expect(rows).toHaveCount(2);
    await expect(page.getByTestId('trash-undo')).toHaveCount(0);

    // 4. F6 pins the toast order (oldest first): with an import's progress toast up and then an undo toast, F6 lands on the import.
    await f6To(page, 'content');
    await expect(selected).toHaveCount(1);
    await importPause(app, 'beforeCommit');
    await stubOpenDialog(app, [MP4]);
    await runMenuCommand(app, 'file.importManaged');
    await expect.poll(() => importWaiting(app)).toBe('beforeCommit');
    await expect(page.getByTestId('import-progress')).toBeVisible();
    await runMenuCommand(app, 'item.trash');
    await expect(page.getByTestId('trash-undo')).toBeVisible();
    await page.locator('[data-pane="content"] [data-testid="item-row"]').first().focus();
    await f6To(page, 'toasts');
    expect(await focusedTestId(page), 'F6 lands on the oldest toast, the running import').toBe('import-progress');
    await importResume(app);
    await waitImportIdle(page);
    await expect(page.getByTestId('import-done')).toHaveText('자료 1개를 가져왔습니다');
    await expect(rows).toHaveCount(2); // three imported, one in the trash
    await expect(specialRow(page, 'trash').locator('.count')).toHaveText('1');

    // 5. The sidebar: F6 lands on the current view's row, ↓ walks the special views to 휴지통, ↩ shows it. Its one row is the trashed one.
    await f6To(page, 'sidebar');
    for (let i = 0; i < 6 && (await focusedTestId(page)) !== 'nav-scope-trash'; i++) await page.keyboard.press('ArrowDown');
    expect(await focusedTestId(page)).toBe('nav-scope-trash');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('toolbar-title')).toHaveText('휴지통');
    await expect(rows).toHaveCount(1);
    await expectNoSeriousA11y(page, 'm6-trash-view');

    // 6. F6 → the table → its row → ⇧F10 opens the row's menu (stubbed: 복원 is picked): the trash empties, the view is the library again.
    await f6To(page, 'content');
    await expect.poll(() => focusedTestId(page)).toBe('item-row');
    await stubContextMenu(app, '복원');
    await page.keyboard.press('Shift+F10');
    await expect(specialRow(page, 'trash')).toHaveCount(0);
    await expect(page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
    await expect(rows).toHaveCount(3);

    // 7. 백업 만들기… (the menu bar cannot be opened by key, as in M5): the folder panel is stubbed; the result sheet's default button is 완료.
    await stubFolderPicker(app, backups);
    const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'file.backup'));
    await expect(sheet.getByTestId('backup-title')).toHaveText('백업을 만들었습니다');
    await expect(sheet.getByTestId('backup-done')).toBeFocused();
    await expectNoSeriousA11y(sheet, 'm6-backup-sheet');
    await closeSheet(sheet, 'Enter');
    expect(fs.readdirSync(backups)).toHaveLength(1);
  } finally {
    await app.close();
  }
});

// Spec 13 "axe(심각 이상 0)": the screens M6 adds beyond the keyboard journey's stops. The duplicates view, the library check
// sheet (automatic and nothing wrong) and the item panel with an edited copy have their stops in duplicates, recovery and
// edited-copy.spec.ts; the undo toast, the trash view and the backup sheet are the journey's.
test('axe at every M6 state: the import toast running and waiting for the answer, the duplicate question, the permanent-delete and empty-trash sheets, the restore sheet (clean and with problems), the reader\'s trash notice, the settings window\'s last backup', async ({}, testInfo) => {
  const backups = testInfo.outputPath('backups');
  const restores = testInfo.outputPath('restores');
  for (const dir of [backups, restores]) fs.mkdirSync(dir, { recursive: true });
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: null });
  const { app, page } = s;
  try {
    const [a, b, c] = distinctPdfs(testInfo.outputPath('src'), 3);
    const [first, second] = await importPaths(page, [a!, b!]);

    // The import toast, running: held before its commit past the 1 s the toast waits for.
    await importPause(app, 'beforeCommit');
    await importFiles(s, [c!]);
    await expect.poll(() => importWaiting(app)).toBe('beforeCommit');
    await expect(page.getByTestId('import-progress')).toHaveAttribute('data-state', 'running');
    await expectNoSeriousA11y(page, 'the import toast, running');
    await importResume(app);
    await waitImportIdle(page);

    // The same files again: the duplicate question holds the window, the toast waits for the answer.
    const question = await expectWindow(app, 'sheet', () => importFiles(s, [a!, b!]));
    await expect(page.getByTestId('import-progress')).toHaveAttribute('data-state', 'waiting-choice');
    await expectNoSeriousA11y(page, 'the import toast, waiting for the answer');
    await expect(question.getByTestId('dup-card')).toBeVisible();
    await expectNoSeriousA11y(question, 'the duplicate question');
    await closeSheet(question, 'Escape');
    await waitImportIdle(page);

    // Both sheets of the trash view: 영구 삭제… of one item, 휴지통 비우기….
    await trashItems(page, [first!.id, second!.id]);
    await specialRow(page, 'trash').click();
    await rowByTitle(page, 'distinct-01').click();
    const purge = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'item.trash'));
    await expect(purge.getByTestId('purge-cancel')).toBeFocused();
    await expectNoSeriousA11y(purge, 'the permanent-delete sheet');
    await closeSheet(purge, 'Escape');
    const empty = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'trash.empty'));
    await expect(empty.getByTestId('purge-title')).toHaveText('휴지통을 비우겠습니까?');
    await expectNoSeriousA11y(empty, 'the empty-trash sheet');
    await closeSheet(empty, 'Escape');
    await sheetReleased(page); // a row picked from the menu while the window is still held (macOS: up to 250 ms) is refused
    await stubContextMenu(app, '복원');
    await rowByTitle(page, 'distinct-01').click({ button: 'right' });
    await expect(rowByTitle(page, 'distinct-01')).toHaveCount(0);
    await rowByTitle(page, 'distinct-02').click({ button: 'right' });
    await expect(specialRow(page, 'trash')).toHaveCount(0);

    // The reader, its item moved to the trash.
    await rowByTitle(page, 'distinct-03').dblclick();
    await expect(page.locator('[data-testid="tab"][aria-selected="true"]')).toBeVisible();
    const open = (await page.evaluate(async () => {
      const r = await window.learn.library.list();
      return r.ok ? r.data.find((i) => i.title === 'distinct-03')?.id : null;
    }))!;
    await trashItems(page, [open]);
    await expect(page.getByTestId('reader-trashed')).toBeVisible();
    await expectNoSeriousA11y(page, 'the reader\'s trash notice');
    await page.getByTestId('reader-trashed-restore').click();
    await expect(page.getByTestId('reader-trashed')).toHaveCount(0);
    await runMenuCommand(app, 'nav.back');

    // A backup, the settings window's 마지막 백업, and the restore sheet: clean, then with a file lost and another changed.
    await stubFolderPicker(app, backups);
    await closeSheet(await expectWindow(app, 'sheet', () => runMenuCommand(app, 'file.backup')), 'Enter');
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    await expect(settings.getByTestId('last-backup-date')).toBeVisible();
    await expectNoSeriousA11y(settings, 'the settings window, 마지막 백업');
    const [name] = fs.readdirSync(backups);
    const backup = path.join(backups, name!);
    await stubFolderPicks(app, [backup, restores]);
    await expect.poll(() => enabledMenuCommands(app)).toContain('file.restore');
    const clean = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'file.restore'));
    await expect(clean.getByTestId('restore-badge')).toHaveAttribute('data-tone', 'success');
    await expectNoSeriousA11y(clean, 'the restore sheet, nothing wrong');
    await closeSheet(clean, 'Escape');
    const manifest = JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8')) as { assets: Array<{ included: boolean; relativePath: string | null }> };
    const [lost, changed] = manifest.assets.filter((x) => x.included);
    fs.rmSync(path.join(backup, ...lost!.relativePath!.split('/')));
    fs.appendFileSync(path.join(backup, ...changed!.relativePath!.split('/')), 'changed on the way');
    await stubFolderPicks(app, [backup, restores]);
    const problems = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'file.restore'));
    await expect(problems.getByTestId('restore-badge')).toHaveAttribute('data-tone', 'warning');
    await expectNoSeriousA11y(problems, 'the restore sheet, with problems');
    await closeSheet(problems, 'Escape');
  } finally {
    await app.close();
  }
});

// Spec 13 "axe(심각 이상 0)": every screen state M5 adds beyond the keyboard journey's stops, in one library.
test('axe at every M5 state: the sidebar and its special views, a collection being named, an empty collection, the tag selector and its filter, coloured dots, the item panel\'s tags and collections, several items, the search and palette collections, an undo toast, a row dragged over a collection, a header being moved, the drop overlay', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: null });
  try {
    // No collection yet: the sidebar says how to make one.
    await expect(page.getByTestId('sidebar-hint')).toBeVisible();
    await expectNoSeriousA11y(page, 'sidebar, no collections yet');

    const [sample, ko, mp4] = await importPaths(page, [PDF, KO_PDF, MP4]);
    // The same PDF again: a duplicate group; and one opened item: the recent view.
    await importPaths(page, [PDF], { allowDuplicate: true });
    await expect(page.getByTestId('item-row')).toHaveCount(4);
    // Two rows carry the title now: the first import is opened by its id.
    await page.locator(`[data-testid="item-row"][data-item-id="${sample!.id}"]`).dblclick();
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await runMenuCommand(app, 'nav.back');
    const bio = await createCollection(page, '분자생물학');
    const ch6 = await createCollection(page, '6장 · 신호 전달', bio);
    const conf = await createCollection(page, '학회 준비');
    await addToCollection(page, bio, [sample!.id, ko!.id, mp4!.id]);
    await addToCollection(page, ch6, [sample!.id]);
    const [important, exam] = await makeTags(page, [
      { name: '중요', slot: 1, items: [sample!.id, ko!.id] },
      { name: '시험 범위', slot: 2, items: [mp4!.id] },
    ]);

    // The sidebar: special views (all three have content), the tree with a child open, the tag selector below.
    await treeRow(page, bio).locator('.disclosure').click();
    await expect(treeRow(page, ch6)).toBeVisible();
    await expectNoSeriousA11y(page, 'sidebar, special views, the tree open, the tag selector');
    for (const kind of ['recent', 'unfiled', 'duplicates'] as const) {
      await specialRow(page, kind).click();
      await expect(specialRow(page, kind)).toHaveAttribute('aria-selected', 'true');
      await expectNoSeriousA11y(page, `special view ${kind}`);
    }

    // A collection with coloured dots, one row selected (a dot on the accent fill), and the file-drop overlay in a collection.
    await treeRow(page, bio).click();
    await selectRows(page, [KO]);
    await expect(page.locator('[data-testid="item-row"][aria-selected="true"] [data-testid="tag-dots"]')).toBeVisible();
    await expectNoSeriousA11y(page, 'collection view, coloured dots on a selected row');
    await dropSource(page, [PDF]);
    await drag(page, 'dragenter', 'source');
    await expect(page.getByTestId('drop-overlay')).toBeVisible();
    await expectNoSeriousA11y(page, 'the drop overlay beside the sidebar, naming the collection');
    await drag(page, 'dragleave', 'source');
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0);

    // A collection being renamed in its row: Enter on the viewed row turns it into the field.
    await treeRow(page, bio).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('rename-input')).toBeFocused();
    await expectNoSeriousA11y(page, 'a collection being renamed');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('rename-input')).toHaveCount(0);

    // The tag selector: its "…" menu, a filter on, and a filter that leaves nothing.
    await page.getByTestId('tag-selector-more').click();
    await expect(page.getByTestId('tag-menu-all')).toBeVisible();
    await expectNoSeriousA11y(page, 'tag selector menu');
    await page.keyboard.press('Escape');
    await tagChip(page, important!).click();
    await expect(tagChip(page, important!)).toHaveAttribute('aria-pressed', 'true');
    await expectNoSeriousA11y(page, 'a tag filter on');
    await tagChip(page, exam!).click(); // no item has both
    await expect(page.getByTestId('tag-filter-empty')).toBeVisible();
    await expectNoSeriousA11y(page, 'a tag filter that leaves nothing');
    await page.getByTestId('tag-filter-empty-clear').click();
    await expect(page.getByTestId('item-row')).toHaveCount(3);

    // An empty collection: the table body and the item panel say so.
    await treeRow(page, conf).click();
    await expect(page.getByTestId('collection-empty')).toBeVisible();
    await expectNoSeriousA11y(page, 'an empty collection');

    // The item panel: one item with tags and two collection paths, the add field with a suggestion, several items, the menu.
    await treeRow(page, bio).click();
    await selectRows(page, ['sample']);
    // The 1024 px macOS runner folds the panel beside the table; folded, its controls cannot be reached.
    const panelFolded = (await page.getByTestId('shell').getAttribute('data-inspector')) !== 'shown';
    await showItemPanel(app, page);
    await expect(page.getByTestId('tags-section')).toBeVisible();
    await expect(page.getByTestId('collection-path')).toHaveCount(2);
    await expectNoSeriousA11y(page, 'item panel with tags and collections');
    await page.getByTestId('tag-add-chip').click();
    await page.getByTestId('tag-input').fill('시');
    await expect(page.getByTestId('tag-suggestion')).toHaveCount(1);
    await expectNoSeriousA11y(page, 'tag add field with a suggestion');
    await page.keyboard.press('Escape');
    await selectRows(page, ['sample', KO, 'sample-h264-aac'], { modifier: 'Meta' });
    await expect(page.getByTestId('inspector-multi')).toBeVisible();
    await expectNoSeriousA11y(page, 'several items, common tags and collections');
    await page.getByTestId('add-to-collection').click();
    await expect(page.getByTestId(`add-to-collection-${ch6}`)).toBeVisible();
    await expectNoSeriousA11y(page, 'the 컬렉션에 추가 menu open');
    await page.keyboard.press('Escape');
    // Shown on demand, the panel leaves the table narrower than its columns: the header cells moved below would be under it.
    if (panelFolded) {
      await runMenuCommand(app, 'view.toggleInspector');
      await expect(page.getByTestId('shell')).toHaveAttribute('data-inspector', 'hidden');
    }

    // The search of a collection with no result offers the whole library; ⌘K lists the collection between 자료 and 명령.
    await runMenuCommand(app, 'library.find');
    await expect(page.getByTestId('search-field').getByRole('searchbox')).toBeFocused(); // keys go where the focus is when they arrive
    await page.keyboard.type('효소 억제제');
    await expect(page.getByTestId('search-empty-everywhere')).toBeVisible();
    await expectNoSeriousA11y(page, 'quick search, no result in a collection');
    await page.keyboard.press('Escape');
    await runMenuCommand(app, 'app.palette');
    await expect(page.getByTestId('palette-input')).toBeFocused();
    await page.keyboard.type('신호');
    await expect(page.getByTestId('palette-collection')).toHaveCount(1);
    await expectNoSeriousA11y(page, 'palette, the 컬렉션 group');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toHaveCount(0);

    // An undo toast: 이 컬렉션에서 빼기 inside a collection.
    await treeRow(page, ch6).click();
    await selectRows(page, ['sample']);
    await runMenuCommand(app, 'collection.removeItems');
    await expect(page.getByTestId('undo-toast')).toBeVisible();
    await expectNoSeriousA11y(page, 'an undo toast');
    await page.getByTestId('undo-action').click();
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);

    // Mid-drag states: a table row over a collection row (its drop marker), a header cell being moved (the insertion line).
    await specialRow(page, 'all').click();
    await selectRows(page, [KO]);
    await beginDrag(page, rowByTitle(page, KO), 'items');
    await hover(page, treeRow(page, conf));
    await expect(treeRow(page, conf)).toHaveAttribute('data-drop-target', /.*/);
    await expectNoSeriousA11y(page, 'a table row dragged over a collection');
    await cancelDrag(page);
    await expect(treeRow(page, conf)).not.toHaveAttribute('data-drop-target', /.*/);
    // A cancelled drag files nothing.
    expect((await organizeSnapshot(page)).members[conf] ?? []).toEqual([]);
    const header = (col: string) => page.locator(`[data-testid="column-header"][data-col="${col}"]`);
    const [from, to] = [(await header('createdAt').boundingBox())!, (await header('creators').boundingBox())!];
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 6, from.y + from.height / 2, { steps: 8 });
    await expect(page.getByTestId('column-drop-line')).toBeVisible();
    await expectNoSeriousA11y(page, 'a header cell being moved');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.getByTestId('column-drop-line')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('F6 / ⇧F6 cycle sidebar ↔ content, also out of a text field; a folded sidebar is skipped', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    // After a click, F6 is keyboard navigation again: the row it reaches shows its keyboard ring (react-aria's
    // focus-visible never saw the key, which the keymap stopped on window capture).
    await page.getByTestId('content').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('sidebar');
    await expect(page.getByTestId('nav-scope-all')).toHaveAttribute('data-focus-visible', 'true');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('content');
    await page.keyboard.press('Shift+F6');
    expect(await inPane(page)).toBe('sidebar');
    await page.keyboard.press('Shift+F6'); // wraps
    expect(await inPane(page)).toBe('content');

    // Out of a text field (the page field, where letters would type): F6 is marked inText.
    await importPaths(page, [PDF]);
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    // The reader has its item panel now (a PDF is open): sidebar → content → item panel.
    await page.getByTestId('pdf-page-field').focus();
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('inspector');
    await page.getByTestId('pdf-page-field').focus();
    await page.keyboard.press('Shift+F6');
    expect(await inPane(page)).toBe('sidebar');

    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('content');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('inspector');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('content'); // the folded sidebar is skipped
  } finally {
    await app.close();
  }
});

/**
 * R-1: react-aria's LandmarkManager listens for F6 on document capture and swallows it while it has a landmark — a
 * toast region would be one. RAC 1.22.1 never registers ours (the region mounts empty and its label is fixed, so the
 * registering effect does not run again when a toast appears), so its listener is stood in for here: the keymap, on
 * window capture, must get F6 before it.
 */
const standInForLandmarkManager = (page: Page) =>
  page.evaluate(() =>
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'F6') return;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    ),
  );

// R-1: the keymap keeps F6 while a toast is up and puts the toast region last in the cycle instead.
test('F6 reaches a visible toast and keeps cycling: sidebar → content → toasts → sidebar', async ({}, testInfo) => {
  const notes = testInfo.outputPath('src', 'notes.txt');
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.writeFileSync(notes, 'plain text');
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await stubOpenDialog(app, [notes]);
    await runMenuCommand(app, 'file.importManaged');
    await expect(page.getByTestId('import-failures')).toBeVisible(); // an error toast stays until closed
    await standInForLandmarkManager(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (const pane of ['sidebar', 'content', 'toasts', 'sidebar']) {
      await page.keyboard.press('F6');
      expect(await inPane(page)).toBe(pane);
    }
    await page.keyboard.press('Shift+F6');
    expect(await inPane(page)).toBe('toasts');
    await expectNoSeriousA11y(page, 'error toast');
    // From the toast, Escape closes it (C-6) and the focus goes back where ⇧F6 came from; with no toast left, F6
    // cycles the two panes again.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('import-failures')).toHaveCount(0);
    expect(await inPane(page)).toBe('sidebar');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('content');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('sidebar');
  } finally {
    await app.close();
  }
});

// Task 12 ruling: modal surfaces swallow F6 — the focus stays inside them, also with a toast up (the landmark manager
// would otherwise move it to the toast).
test('the palette, the drop overlay and the ⌘/ sheet keep the focus on F6 / ⇧F6', async ({}, testInfo) => {
  const notes = testInfo.outputPath('src', 'notes.txt');
  fs.mkdirSync(path.dirname(notes), { recursive: true });
  fs.writeFileSync(notes, 'plain text');
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await stubOpenDialog(app, [notes]);
    await runMenuCommand(app, 'file.importManaged');
    await expect(page.getByTestId('import-failures')).toBeVisible();

    await runMenuCommand(app, 'app.palette');
    await expect(page.getByTestId('palette-input')).toBeFocused();
    for (const key of ['F6', 'Shift+F6']) {
      await page.keyboard.press(key);
      await expect(page.getByTestId('palette-input')).toBeFocused();
    }
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toHaveCount(0);

    await page.keyboard.press('F6');
    expect(await focusedTestId(page)).toBe('nav-scope-all');
    await drag(page, 'dragenter', [['a.pdf', 'application/pdf']]);
    await expect(page.getByTestId('drop-overlay')).toBeVisible();
    await expectNoSeriousA11y(page, 'drop overlay');
    for (const key of ['F6', 'Shift+F6']) {
      await page.keyboard.press(key);
      expect(await focusedTestId(page)).toBe('nav-scope-all');
    }
    await drag(page, 'dragleave', [['a.pdf', 'application/pdf']]);
    await expect(page.getByTestId('drop-overlay')).toHaveCount(0);
    await page.keyboard.press('F6'); // the keymap is back
    expect(await inPane(page)).toBe('content');

    const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'app.shortcuts'));
    const before = await sheet.evaluate(() => document.activeElement?.outerHTML ?? null);
    await sheet.keyboard.press('F6');
    expect(await sheet.evaluate(() => document.activeElement?.outerHTML ?? null)).toBe(before);
    expect(await focusedWindow(app)).toBe('sheet');
    await closeSheet(sheet, 'Escape');
  } finally {
    await app.close();
  }
});

// Task 12 polish ruling: a held window (here 파일 가져오기…'s open panel) still takes F6 / ⇧F6, which only move the focus.
// The palette held under a duplicate question is import-queue.spec.ts (its real path, with the axe station).
test('under 파일 가져오기…\'s open panel F6 still moves between panes', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await holdOpenDialog(app, []);
    await runMenuCommand(app, 'file.importManaged'); // the panel is up: the window is held
    await expect(page.getByTestId('import-managed')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('sidebar');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('content');
    await page.keyboard.press('Shift+F6');
    expect(await inPane(page)).toBe('sidebar');
    await releaseOpenDialog(app); // cancelled
    await expect(page.getByTestId('import-managed')).not.toHaveAttribute('aria-disabled', 'true');
  } finally {
    await app.close();
  }
});

test('the settings window is one pane: F6 neither throws nor moves the focus to another window', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const errors: string[] = [];
  try {
    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    settings.on('pageerror', (e) => errors.push(e.message));
    page.on('pageerror', (e) => errors.push(e.message));
    // expectWindow returns the settings window shown and focused: F6 must keep the focus there.
    await settings.keyboard.press('Tab');
    const before = await settings.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? null);
    expect(before).toMatch(/^theme-tile-/);
    for (const key of ['F6', 'Shift+F6']) {
      await settings.keyboard.press(key);
      expect(await settings.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? null)).toBe(before);
      expect(await focusedWindow(app)).toBe('settings');
    }
    expect(await inPane(page)).toBeNull(); // nothing moved in the main window either
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('the video reader: axe (captions arrive in M8, so video-caption is off) and F6 lands on the player', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [MP4]);
    await openItem(page, 'sample-h264-aac');
    await expect(page.getByTestId('video')).toBeVisible();
    await expectNoSeriousA11y(page, 'video reader');
    await page.keyboard.press('F6'); // sidebar
    await page.keyboard.press('F6'); // content: the player
    expect(await focusedTestId(page)).toBe('video');
  } finally {
    await app.close();
  }
});

test('fatal screen: Tab reaches 설정 열기, Enter opens the settings window; axe passes', async ({}, testInfo) => {
  const lib = testInfo.outputPath('broken');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'library.sqlite'), 'not a database');
  const { app, page } = await launch(lib, testInfo.outputPath('userdata'));
  try {
    await expect(page.getByTestId('fatal-settings')).toBeVisible();
    await expectNoSeriousA11y(page, 'fatal screen');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('fatal-settings')).toBeFocused();
    const settings = await expectWindow(app, 'settings', () => page.keyboard.press('Enter'));
    await expect(settings.getByTestId('library-choose')).toBeVisible();
  } finally {
    await app.close();
  }
});

// The rescue takes only what a fold takes away: the palette's field, gone as the palette closed, is not "rescued" by
// the next fold onto the toolbar toggle (with its keyboard tooltip) — Task 8 critique m1, evidence m3-04.
test('a menu toggle after the palette closed moves no focus and pops no tooltip', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await runMenuCommand(app, 'app.palette');
    await expect(page.getByTestId('palette-input')).toBeFocused(); // the keys go to the field that has the focus when they arrive
    await page.keyboard.type('ㄱㅈㅇ');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toHaveCount(0);
    for (const state of ['hidden', 'shown']) {
      await runMenuCommand(app, 'view.toggleSidebar');
      await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', state);
      await page.waitForTimeout(300);
      expect(await page.getByRole('tooltip').count()).toBe(0);
      expect(await page.evaluate(() => document.activeElement?.id ?? null)).not.toMatch(/sidebar-toggle$/);
    }
  } finally {
    await app.close();
  }
});

// F6 right after ⌃⌘S folds the sidebar: the rescue (a frame later) must not take back the focus F6 just placed (CI run
// 39703278904). The page's animation frames are held so the order is the late one every time.
test('a fold rescue that arrives after F6 leaves the focus where F6 put it', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('sidebar');
    await page.evaluate(() => {
      const held: FrameRequestCallback[] = [];
      (window as unknown as { __held: FrameRequestCallback[] }).__held = held;
      window.requestAnimationFrame = (cb) => held.push(cb);
    });
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await page.keyboard.press('F6');
    expect(await inPane(page)).toBe('content');
    const released = await page.evaluate(() => {
      const held = (window as unknown as { __held: FrameRequestCallback[] }).__held;
      for (const cb of held.splice(0)) cb(performance.now());
      return held.length === 0;
    });
    expect(released).toBe(true);
    expect(await inPane(page)).toBe('content');
  } finally {
    await app.close();
  }
});

// Review minor 3: the rescue moves only a focus the fold took. A sidebar row the user had already left (a click on
// nothing) is not "rescued" onto the toggle by a later fold, even when the keyboard was used since.
test('a fold after the user left the sidebar row moves no focus', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const zoom = async (f: number) => (await mainWindow(app)).evaluate((w, f) => w.webContents.setZoomFactor(f), f);
  try {
    await page.keyboard.press('F6');
    expect(await focusedTestId(page)).toBe('nav-scope-all');
    await page.getByTestId('content').click({ position: { x: 300, y: 300 } }); // nothing there takes the focus
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
    await page.keyboard.press('ArrowDown'); // the keyboard is in use again, on nothing
    await zoom(2);
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  } finally {
    await app.close();
  }
});

// Carried from the Task 4/5 ledger: when the sidebar folds by itself (the content column would get narrower than 520:
// 200 % zoom, design-spec 8.3; the 960 px minimum window alone never folds a 240 px sidebar), a keyboard user's focus
// inside it goes to the toolbar's toggle, never to <body>; when it comes back, to the sidebar's own toggle.
test('a sidebar that folds by itself hands a keyboard focus to the toolbar toggle, and back', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const zoom = async (f: number) => (await mainWindow(app)).evaluate((w, f) => w.webContents.setZoomFactor(f), f);
  try {
    await page.getByTestId('content').click({ position: { x: 5, y: 5 } }); // a pointer user first…
    await page.keyboard.press('F6'); // …who now navigates by keyboard: F6 counts as keyboard input
    expect(await focusedTestId(page)).toBe('nav-scope-all');
    await zoom(2);
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await expect(page.getByTestId('toolbar-sidebar-toggle')).toBeFocused();
    await zoom(1);
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
    await expect(page.getByTestId('sidebar-toggle')).toBeFocused();
  } finally {
    await app.close();
  }
});

// M7a: the reader v2 and the translation by keyboard alone, with axe at the stops the milestone added (AC18). ⌘F is the menu item's
// accelerator (runMenuCommand), as everywhere in this file; every other step is a real key press, and nothing is clicked.
test('the reader v2 and its translation by keyboard: toolbar → page field → ⌘F → next result → esc → sidebar segment → thumbnails ↓ → the 번역 section, with axe', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [path.join(FIXTURES, 'paper-100.pdf')]);
    await page.evaluate(async () => {
      const r = await window.learn.prefs.get();
      if (!r.ok) throw new Error(r.code);
      await window.learn.prefs.set({ translation: { ...r.data.translation, enabled: true, autoOnSelect: true } });
    });
    await f6To(page, 'content'); // the table's cursor row
    expect(await focusedTestId(page)).toBe('item-row');
    await page.keyboard.press('Enter');
    const viewer = page.getByTestId('pdf-viewer');
    await expect(viewer).toHaveAttribute('data-pages', '100');
    await expect(viewer).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    // The page field is disabled until the saved place has been applied: F6 lands on it only after that.
    await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', /.*/);

    // The toolbar: F6 from the sidebar reaches the content pane, whose first control is the page field.
    await f6To(page, 'content');
    await tabTo(page, 'pdf-page-field', 6);
    const pageField = page.getByTestId('pdf-page-field');
    await page.keyboard.type('7');
    await page.keyboard.press('Enter');
    await expect(viewer).toHaveAttribute('data-page', '7');
    await expect(pageField).toHaveValue('7');

    // ⌘F: the find bar takes the focus in its field; a word, then the next result.
    await runMenuCommand(app, 'library.find');
    const findField = page.getByTestId('pdf-find-field').getByRole('searchbox');
    await expect(findField).toBeFocused();
    await page.keyboard.type('page');
    const count = page.getByTestId('pdf-find-count');
    await expect(count).toHaveText(/^\d+ \/ \d+$/);
    const first = Number((await count.textContent())!.split(' / ')[0]); // the search starts from the page in view (7)
    await expectNoSeriousA11y(page, 'the reader with the find bar open');
    await page.keyboard.press('Enter'); // next result
    await expect(count).toHaveText(new RegExp(`^${first + 1} / \\d+$`));
    await page.keyboard.press('Escape'); // the bar closes
    await expect(page.getByTestId('pdf-find-bar')).toHaveCount(0);
    await expect.poll(() => inPane(page)).toBe('content');

    // The sidebar segment: F6 round to the sidebar (the reader's own), the segment 목차 and back to 썸네일 with the arrow keys.
    await f6To(page, 'sidebar');
    expect(await focusedTestId(page)).toBe('reader-nav-thumbnails'); // F6 lands on the checked segment
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('pdf-outline')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('pdf-thumbnails')).toBeVisible();

    // ↓ on the thumbnails goes to the next one; Enter takes the reader to that page (the focus goes to the stage, where the arrows turn pages).
    await page.keyboard.press('Tab'); // out of the segment into the list
    expect(await focusedTestId(page)).toBe('pdf-thumbnails');
    const current = Number(await viewer.getAttribute('data-page'));
    await page.keyboard.press('ArrowDown');
    await expect(viewer).toHaveAttribute('data-page', String(current + 1));
    await page.keyboard.press('Enter');
    await expect(viewer).toHaveAttribute('data-page', String(current + 1));
    await expect.poll(() => focusedTestId(page)).toBe('pdf-stage');
    await page.keyboard.press('ArrowRight');
    await expect(viewer).toHaveAttribute('data-page', String(current + 2));
    await page.keyboard.press('ArrowLeft');
    await expect(viewer).toHaveAttribute('data-page', String(current + 1));

    // The reader's panel: its 번역 section, in the order Tab takes it: the original box, 선택하면 번역, 이어 붙이기, 지우기, 복사 ▾, 번역.
    await f6To(page, 'inspector');
    await expect(page.getByTestId('translation-section')).toBeVisible();
    await tabTo(page, 'translation-source', 8);
    await page.keyboard.type('Attention is all you need.');
    await page.keyboard.press('Tab');
    expect(await focusedTestId(page)).toBe('translation-auto');
    await page.keyboard.press('Tab');
    expect(await focusedTestId(page)).toBe('translation-concat');
    await page.keyboard.press('Space');
    await expect(page.getByTestId('translation-concat').locator('input')).toBeChecked();
    await page.keyboard.press('Tab');
    expect(await focusedTestId(page)).toBe('translation-clear');
    await page.keyboard.press('Tab');
    expect(await focusedTestId(page)).toBe('translation-copy');
    await page.keyboard.press('Enter'); // 복사 ▾ opens: the original can be copied now, the translation not yet
    await expect(page.getByTestId('translation-copy-source')).toBeVisible();
    await expect(page.getByTestId('translation-copy-result')).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('translation-copy')).toBeFocused();
    await page.keyboard.press('Tab');
    expect(await focusedTestId(page)).toBe('translation-run');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('translation-result')).toHaveText('주의가 필요한 전부입니다.');
    await expectNoSeriousA11y(page, 'the reader with the 번역 section translated');
  } finally {
    await app.close();
  }
});

test('axe: the reader with the selection pop-up open, and the settings window at the translation group', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(page, [path.join(FIXTURES, 'paper-100.pdf')]);
    await openItem(page, 'paper-100');
    await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expect(page.locator('.page[data-page-number="1"] .textLayer span').first()).toBeAttached();
    // Asking for the consent, then the answer: both are the pop-up.
    await selectInPage(page, 'Attention is all you need.');
    await expect(page.getByTestId('selection-popup')).toHaveAttribute('data-state', 'consent');
    await expectNoSeriousA11y(page, 'the reader with the selection pop-up asking for the consent');
    await page.getByTestId('consent-enable').first().click();
    await expect(page.getByTestId('selection-popup')).toHaveAttribute('data-state', 'done');
    await expectNoSeriousA11y(page, 'the reader with the selection pop-up open, translated');
    await translationFake(app, 'offline');
    await page.evaluate(() => getSelection()!.removeAllRanges());
    await selectInPage(page, 'It is based solely on attention mechanisms.');
    await expect(page.getByTestId('selection-popup')).toHaveAttribute('data-state', 'error');
    await expectNoSeriousA11y(page, 'the reader with the selection pop-up showing an error');

    const settings = await expectWindow(app, 'settings', () => runMenuCommand(app, 'app.settings'));
    await settings.getByTestId('settings-translation-enabled').scrollIntoViewIfNeeded();
    await expectNoSeriousA11y(settings, 'the settings window at the translation group');
  } finally {
    await app.close();
  }
});

/** The ids of every tab in the strip, in order ('library' first), and the shown one. */
const tabOrder = (page: Page) => page.locator('[data-testid="tab"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id')));
const shownTab = (page: Page) => page.locator('[data-testid="tab"][aria-selected="true"]').getAttribute('data-item-id');

test('axe at every M7b state: the reader with a tab strip of three, 보기 ▾ open and its 스크롤 submenu, the library item panel\'s 읽기 section', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const items = await importPaths(page, [path.join(FIXTURES, 'paper-100.pdf'), ...distinctPdfs(testInfo.outputPath('more'), 2)]);
    const paper = items.find((i) => i.title === 'paper-100')!;
    await page.evaluate(async (a) => {
      const r = await window.learn.reader.savePosition({ itemId: a.id, revisionId: a.revisionId, locator: { kind: 'pdf', pageIndex: 41, pages: 100 }, progress: 0.62 });
      if (!r.ok) throw new Error(r.code);
    }, { id: paper.id, revisionId: paper.revisionId });
    await selectRows(page, items.map((i) => i.title));
    await runMenuCommand(app, 'item.openInBackground');
    await expect(page.getByTestId('tab')).toHaveCount(4);
    await expectNoSeriousA11y(page, 'm7b-library with a strip of three readers');

    await readerTab(page, paper.id).click();
    const viewer = page.getByTestId('pdf-viewer');
    await expect(viewer).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', /.*/);
    await expectNoSeriousA11y(page, 'm7b-reader with a tab strip of three');

    await page.getByTestId('pdf-view-menu').click();
    await expect(page.getByTestId('pdf-scroll-menu')).toBeVisible();
    await expectNoSeriousA11y(page, 'm7b-reader, 보기 ▾ open');
    await page.getByTestId('pdf-scroll-menu').click();
    await expect(page.getByRole('menuitemradio', { name: '가로로 이어서' })).toBeVisible();
    await expectNoSeriousA11y(page, 'm7b-reader, 보기 ▾ with 스크롤 open');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitemradio', { name: '가로로 이어서' })).toHaveCount(0);

    await libraryTab(page).click();
    await rowByTitle(page, 'paper-100').click();
    await expect(page.getByTestId('reading-section')).toBeVisible();
    await expect(page.getByTestId('reading-line')).toContainText('42 / 100쪽에서');
    await expectNoSeriousA11y(page, 'm7b-library item panel, 읽기 section');
  } finally {
    await app.close();
  }
});

test('M7b keyboard only: ↩ opens → ⌘1 → ⌘↩ opens behind → Tab into the strip → ←/→ → ↩ → ⌥⇧→ → page field ↩ → ⌘[ → ⌘] → 보기 ▾ 펼침 › 홀수 → esc, with axe at every new stop', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const viewer = page.getByTestId('pdf-viewer');
  const field = page.getByTestId('pdf-page-field');
  /** ↓ from the first row until the cursor row is `title` (the table's order is its own). */
  const cursorOn = async (title: string) => {
    await page.keyboard.press('Home');
    for (let i = 0; i < 4; i++) {
      // Each key is waited for: the cursor row is settled before it is read.
      if (await expect.poll(() => rowByTitle(page, title).getAttribute('aria-selected'), { timeout: 1_000 }).toBe('true').then(() => true, () => false)) break;
      await page.keyboard.press('ArrowDown');
    }
    await expect(rowByTitle(page, title)).toHaveAttribute('aria-selected', 'true');
  };
  /** Shift+Tab, at most `max` times, until the focus is on a tab of the strip. */
  const intoStrip = async (max = 14) => {
    for (let i = 0; i < max && (await focusedTestId(page)) !== 'tab'; i++) await page.keyboard.press('Shift+Tab');
    expect(await focusedTestId(page)).toBe('tab');
  };
  try {
    const items = await importPaths(page, [path.join(FIXTURES, 'paper-100.pdf'), ...distinctPdfs(testInfo.outputPath('more'), 1)]);
    const paper = items.find((i) => i.title === 'paper-100')!;
    const other = items.find((i) => i.title === 'distinct-01')!;

    // 1. The table's cursor on paper-100, ↩: it opens and is shown.
    await f6To(page, 'content');
    await cursorOn('paper-100');
    await page.keyboard.press('Enter');
    await expect(viewer).toHaveAttribute('data-pages', '100');
    await expect(viewer).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', /.*/);
    expect(await shownTab(page)).toBe(paper.id);
    await expectNoSeriousA11y(page, 'm7b-journey: the first reader opened with ↩');

    // 2. ⌘1 (the library): back, the table has its rows.
    await runMenuAccelerator(app, 'nav.back');
    await expect.poll(() => shownTab(page)).toBe('library');
    await expect(page.getByTestId('library-table')).toBeVisible();
    await f6To(page, 'content');

    // 3. ⌘↩ on another row opens it behind: the library stays shown, the strip has both readers.
    await cursorOn('distinct-01');
    await runMenuAccelerator(app, 'item.openInBackground');
    await expect.poll(() => tabOrder(page)).toEqual(['library', paper.id, other.id]);
    expect(await shownTab(page)).toBe('library');
    await expectNoSeriousA11y(page, 'm7b-journey: a second reader behind the library');

    // 4. Shift+Tab into the strip: the shown tab (the library's) has the focus; → moves it to paper-100 without choosing it; ← and → go round.
    await intoStrip();
    await expect(libraryTab(page)).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(readerTab(page, paper.id)).toBeFocused();
    expect(await shownTab(page)).toBe('library');
    await page.keyboard.press('ArrowRight');
    await expect(readerTab(page, other.id)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(readerTab(page, paper.id)).toBeFocused();
    await expectNoSeriousA11y(page, 'm7b-journey: the strip with a tab focused');

    // 5. ↩ chooses it; ⌥⇧→ (the strip's key) moves it behind distinct-01 and it keeps the focus.
    await page.keyboard.press('Enter');
    await expect.poll(() => shownTab(page)).toBe(paper.id);
    await expect(viewer).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await page.keyboard.press('Alt+Shift+ArrowRight');
    await expect.poll(() => tabOrder(page)).toEqual(['library', other.id, paper.id]);
    await expect(readerTab(page, paper.id)).toBeFocused();
    expect(await shownTab(page)).toBe(paper.id);
    await expectNoSeriousA11y(page, 'm7b-journey: the tab moved');

    // 6. The page field: 7 ↩ is a jump (something to go back to); ⌘[ returns to page 1, ⌘] to 7.
    await tabTo(page, 'pdf-page-field', 12);
    await page.keyboard.type('7');
    await page.keyboard.press('Enter');
    await expect(viewer).toHaveAttribute('data-page', '7');
    await expect(field).toHaveValue('7');
    await runMenuAccelerator(app, 'nav.historyBack');
    await expect(field).toHaveValue('1');
    await expect(page.getByTestId('pdf-history-back')).toBeDisabled();
    await runMenuAccelerator(app, 'nav.historyForward');
    await expect(field).toHaveValue('7');
    await expectNoSeriousA11y(page, 'm7b-journey: the reader after a jump, back and forward');

    // 7. 보기 ▾ by keyboard: ↩ opens it, ↓ to 펼침, → opens it, ↓ to 홀수 쪽부터, ↩ chooses; esc leaves nothing open.
    await tabTo(page, 'pdf-view-menu', 12);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('pdf-spread-menu')).toBeVisible();
    for (let i = 0; i < 6 && (await focusedTestId(page)) !== 'pdf-spread-menu'; i++) await page.keyboard.press('ArrowDown');
    expect(await focusedTestId(page)).toBe('pdf-spread-menu');
    await page.keyboard.press('ArrowRight');
    const odd = page.getByRole('menuitemradio', { name: '홀수 쪽부터' });
    await expect(odd).toBeVisible();
    await expectNoSeriousA11y(page, 'm7b-journey: 보기 ▾ with 펼침 open');
    for (let i = 0; i < 4 && !(await odd.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('ArrowDown');
    await expect(odd).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(viewer).toHaveAttribute('data-spread', 'odd');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pdf-spread-menu')).toHaveCount(0);
    await expect(odd).toHaveCount(0);
    await expect(viewer).toHaveAttribute('data-spread', 'odd'); // esc does not undo the choice
    await expectNoSeriousA11y(page, 'm7b-journey: odd spreads, the menu closed');
  } finally {
    await app.close();
  }
});

test('M7c keyboard only: ⌘F → ⇧Tab to 검색 범위 → ↓ ↓ ↩ picks 정보와 본문 → Tab back to the field → a word only a PDF body has → ↓ to the row it found, with axe at every new stop', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const field = page.getByTestId('search-field').getByRole('searchbox');
  try {
    const [search30] = await importPaths(page, [path.join(FIXTURES, 'search-30.pdf'), PDF]);
    await textExtraction(app, 'now');
    await textIdle(app);
    await runMenuCommand(app, 'library.find');
    await expect(field).toBeFocused();
    // The scope button is the stop right before the field.
    await page.keyboard.press('Shift+Tab');
    expect(await focusedTestId(page)).toBe('search-scope');
    await expectNoSeriousA11y(page, 'm7c-journey: the scope button focused');
    // ↓ opens the menu on the checked row (정보), ↓ moves to 정보와 본문, ↩ chooses it and the focus returns to the button.
    await page.keyboard.press('ArrowDown');
    const menu = page.getByRole('menu', { name: '검색 범위' });
    await expect(menu.getByRole('menuitemradio', { name: '정보', exact: true })).toBeFocused();
    await expectNoSeriousA11y(page, 'm7c-journey: the scope menu open');
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitemradio', { name: '정보와 본문', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(menu).toHaveCount(0);
    expect(await focusedTestId(page)).toBe('search-scope');
    await page.keyboard.press('Tab');
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('placeholder', '제목, 저자, 태그, 본문 검색');
    // 형광 is in search-30's pages, not in any title: the body match is the one row, and ↓ goes to it, selected.
    await page.keyboard.type('형광');
    const row = rowByTitle(page, search30!.title);
    await expect(row).toBeVisible();
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expect(page.getByTestId('toolbar-count')).toHaveText('1개 / 2개');
    await page.keyboard.press('ArrowDown');
    await expect(row).toBeFocused();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await expectNoSeriousA11y(page, 'm7c-journey: the body match selected in the table');
  } finally {
    await app.close();
  }
});
