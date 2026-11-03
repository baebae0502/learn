// No fake controls (quality spec): every registry command that is enabled in the library — with one item selected, so
// that the 파일 menu's item commands are on — and in the reader runs through its real menu item without a page
// error; the item context-menu commands run through the native menu path, 정보 편집 through the palette (its only
// place), 기본 앱으로 열기 also through its notice button. The rest of the registry is accounted for in COVERED_ELSEWHERE.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { COMMANDS, commandById, type CommandArgs, type CommandId } from '../../packages/domain/src/commands';
import {
  FIXTURES, assignTag, clickToCloseSheet, closeSheet, confirmCalls, createCollection, enabledMenuCommands, expectWindow, importPause, importPaths, importResume, importWaiting, launch, makeTags,
  menuItemEnabled, menuSnapshot, openDialogCalls, openItem, organizeSnapshot, recordedPopups, rowByTitle, runMenuCommand, runPalette, saveDialogCalls, sheetReleased, shellCalls, specialRow, stubConfirm,
  stubContextMenu, stubFolderPicker, stubFolderPicks, stubOpenDialog, stubSaveDialog, stubShell, tagChip, trashItems, treeRow, waitImportIdle,
  type MenuNode,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const MPEG4 = path.join(FIXTURES, 'sample-mpeg4part2.mp4');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
/** The Korean fixture's title (titleFromFile). */
const KO = '한글 경로 (테스트) #1';
const REVEAL = process.platform === 'darwin' ? 'Finder에서 보기' : '폴더에서 보기';

/** Closes what a command opened: sheets by Escape once they rendered, other windows directly, then the palette. */
async function closeTransient(app: ElectronApplication, main: Page): Promise<void> {
  await main.waitForTimeout(250);
  // The settings window main keeps prepared, hidden, is not something a command opened: it stays.
  const shown = new Set(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible()).map((w) => w.webContents.getURL())),
  );
  for (const w of app.windows()) {
    if (w === main || w.isClosed() || (w.url().includes('window=settings') && !shown.has(w.url()))) continue;
    await w.waitForLoadState('domcontentloaded').catch(() => {});
    if (w.url().includes('window=sheet')) {
      // The sheet handles Escape only after its payload arrived and rendered; wait for it, then for the close.
      await w.locator('[data-sheet-root]').waitFor({ timeout: 5_000 });
      const closed = w.waitForEvent('close');
      await w.keyboard.press('Escape').catch(() => {}); // the window can be gone before the key-up
      await closed;
    } else await w.close().catch(() => {});
  }
  if (await main.getByTestId('palette').count()) await main.keyboard.press('Escape');
  await main.waitForTimeout(150);
}

/** The `?window=` kinds of the windows on screen other than the main one (a prepared settings window is hidden). */
const otherWindows = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && w.isVisible())
      .map((w) => /[?&]window=(\w+)/.exec(w.webContents.getURL())?.[1] ?? '')
      .filter((kind) => kind !== 'main'),
  );
const fontSize = (page: Page) =>
  page.evaluate(async () => {
    const r = await window.learn.prefs.get();
    if (!r.ok) throw new Error(`prefs.get failed: ${r.code}`);
    return r.data.fontSize;
  });
/** The application menu's label for a registry command now (main relabels a toggle with its state). */
async function menuLabel(app: ElectronApplication, id: CommandId): Promise<string | null> {
  const flat = (nodes: MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flat(n.submenu ?? [])]);
  return flat(await menuSnapshot(app)).find((n) => n.id === id)?.label ?? null;
}
/** The id of the live item titled `title`. */
const organizeIdOf = (page: Page, title: string) =>
  page.evaluate(async (t) => {
    const r = await window.learn.library.list();
    return r.ok ? (r.data.find((i) => i.title === t)?.id ?? null) : null;
  }, title);
const escaped = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A value submenu's command runs from one of its rows: this value; the other rows are the menu unit tests'. */
const REPRESENTATIVE_ARGS: Partial<Record<CommandId, CommandArgs>> = { 'library.sortBy': { column: 'year' } };

/** Every command the organise milestone put in the registry: this test runs each of them itself (none is left to another test). */
const M5_COMMANDS: readonly CommandId[] = [
  'collection.new', 'collection.newChild', 'collection.rename', 'collection.importInto', 'collection.delete', 'collection.addItems', 'collection.removeItems',
  'tag.color1', 'tag.color2', 'tag.color3', 'tag.color4', 'tag.color5', 'tag.color6', 'tag.color7', 'tag.color8',
  'tag.rename', 'tag.setColor', 'tag.clearColor', 'tag.delete', 'tags.clearFilter', 'library.findEverywhere', 'library.sortBy',
] as CommandId[];

/** Every command the trash, duplicates, library check, backup and import queue put in the registry (M6): each runs here, none is left to another test. */
const M6_COMMANDS: readonly CommandId[] = [
  'item.trash', 'item.restore', 'trash.empty', 'duplicates.keepOne', 'duplicates.keepOneAll', 'file.checkLibrary', 'file.backup', 'file.restore', 'file.cancelImport',
] as CommandId[];

/**
 * Enabled in the library with one row selected, but running them here would trash the one sample the rest of the loop
 * (and the reader pass) needs: ⌘⌫ is 휴지통으로 이동. Their test is the COVERED_ELSEWHERE entry of the same id.
 */
const DESTRUCTIVE: ReadonlySet<CommandId> = new Set<CommandId>(['item.trash']);

/**
 * Commands this test does not run, each with the test that does (`<spec file> › <test title>`): F6 / ⇧F6 are keys of
 * the renderer keymap, with no menu item to click.
 */
const COVERED_ELSEWHERE: Partial<Record<CommandId, string>> = {
  'view.nextPane': 'keyboard.spec.ts › F6 / ⇧F6 cycle sidebar ↔ content, also out of a text field; a folded sidebar is skipped',
  'view.previousPane': 'keyboard.spec.ts › F6 / ⇧F6 cycle sidebar ↔ content, also out of a text field; a folded sidebar is skipped',
};

test('every registry command runs without a page error (library and reader menus with a selection, item menu, palette, notice buttons)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const errors: string[] = [];
  const watch = (p: Page) => {
    p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${p.url()}: ${m.text()}`);
    });
  };
  watch(page);
  for (const p of app.windows()) if (p !== page) watch(p); // the prepared settings window
  app.on('window', watch);
  const sidebar = () => page.getByTestId('shell').getAttribute('data-sidebar');
  const inspector = () => page.getByTestId('shell').getAttribute('data-inspector');
  const searchInput = page.getByTestId('search-field').getByRole('searchbox');
  /** The reader shows a PDF now: the shared keys act on it, not on the text size. */
  const scale = async () => Number(await page.getByTestId('pdf-viewer').getAttribute('data-scale'));
  let scaleBefore = 0;
  const readerOpen = async () => (await page.getByTestId('pdf-viewer').count()) > 0;
  /** Named copies under derived/open/<uuid>/ with the type's extension. */
  const openDir = path.join(testInfo.outputPath('library'), 'derived', 'open');
  const namedCopy = (file: string) => expect.stringMatching(new RegExp(`^${escaped(openDir)}[\\\\/][0-9a-f-]{36}[\\\\/]${escaped(file)}$`));
  const lastShell = async () => (await shellCalls(app)).at(-1) ?? null;
  const exported = testInfo.outputPath('exported');
  fs.mkdirSync(exported, { recursive: true });
  const exportFromMenu = path.join(exported, 'from-menu.pdf');
  const exportFromItemMenu = path.join(exported, 'from-item-menu.pdf');
  let filedId = '';
  let filing = '';
  /** What each command must visibly have done, beyond running without an error. */
  const effects: Partial<Record<CommandId, () => Promise<void>>> = {
    'app.settings': () => expect.poll(() => otherWindows(app)).toContain('settings'),
    'app.shortcuts': () => expect.poll(() => otherWindows(app)).toContain('sheet'),
    // 라이브러리 점검… (spec 7.1): a fresh check in its sheet (문제가 없습니다 here); closeTransient closes it with esc.
    'file.checkLibrary': () => expect.poll(() => otherWindows(app)).toContain('sheet'),
    'app.palette': () => expect(page.getByTestId('palette')).toBeVisible(),
    // 새 컬렉션 starts the row in the tree and names it in place; esc drops it (collections.spec creates one for real).
    'collection.new': async () => {
      await expect(page.getByTestId('rename-input')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('rename-input')).toHaveCount(0);
    },
    // Both states: hidden, then shown again by the same command.
    'view.toggleSidebar': async () => {
      await expect.poll(sidebar).toBe('hidden');
      await runMenuCommand(app, 'view.toggleSidebar');
      await expect.poll(sidebar).toBe('shown');
    },
    // The item panel, both states as for the sidebar; the menu item says what it will do next. 240 + 520 + 320 fit: the
    // command hid the panel; in a narrower window (the 1024 px macOS runner) it showed the folded one on demand.
    'view.toggleInspector': async () => {
      const first = (await page.evaluate(() => innerWidth)) >= 1080 ? 'hidden' : 'shown';
      const next = (state: string) => (state === 'hidden' ? '항목 패널 보기' : '항목 패널 가리기');
      await expect.poll(inspector).toBe(first);
      await expect.poll(() => menuLabel(app, 'view.toggleInspector')).toBe(next(first));
      await runMenuCommand(app, 'view.toggleInspector');
      const second = first === 'hidden' ? 'shown' : 'hidden';
      await expect.poll(inspector).toBe(second);
      await expect.poll(() => menuLabel(app, 'view.toggleInspector')).toBe(next(second));
    },
    'library.find': () => expect(searchInput).toBeFocused(),
    // 보기 › 정렬 기준 ▸ 연도: the column row keeps the direction, so the table is sorted by 연도, newest first as it was.
    'library.sortBy': () => expect(page.locator('[data-testid="column-header"][data-col="year"]')).toHaveAttribute('aria-sort', 'descending'),
    // 컬렉션에 추가 ▸ 전수 시험: the selected sample is filed there (main has it, not only the screen).
    'collection.addItems': () => expect.poll(async () => (await organizeSnapshot(page)).members[filing] ?? []).toEqual([filedId]),
    // A pref round trip: ⌘+ and ⌘− in menu order, 13 → 14 → 13. In the reader the same keys zoom: the scale is a number, not a fit mode, and the pref stays.
    'view.textBigger': async () => {
      if (await readerOpen()) await expect.poll(scale).toBeGreaterThan(scaleBefore);
      else await expect.poll(() => fontSize(page)).toBe(14);
    },
    'view.textSmaller': async () => {
      if (await readerOpen()) await expect.poll(scale).toBeLessThan(scaleBefore);
      else await expect.poll(() => fontSize(page)).toBe(13);
    },
    // The reader's own: each does what its name says on the open PDF (run in registry order, so the page colours end on 어둡게).
    'view.textReset': async () => {
      if (await readerOpen()) await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-scale', '1');
    },
    'reader.zoomAuto': () => expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-zoom', 'auto'),
    'reader.zoomPageWidth': () => expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-zoom', 'page-width'),
    'reader.zoomPageFit': () => expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-zoom', 'page-fit'),
    'reader.rotateCw': () => expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-rotation', '90'),
    'reader.rotateCcw': () => expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-rotation', '0'),
    'reader.goToPage': async () => {
      await expect(page.getByTestId('pdf-page-field')).toBeFocused();
      await page.getByTestId('pdf-stage').focus();
    },
    'reader.pageColorAuto': () => expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-page-color', /^(original|dark)$/),
    'reader.pageColorOriginal': () => expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-page-color', 'original'),
    'reader.pageColorSepia': () => expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-page-color', 'sepia'),
    'reader.pageColorDark': () => expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-page-color', 'dark'),
    // The 파일 menu's item commands, on the selected sample.
    'item.showInFolder': () => expect.poll(lastShell).toEqual(['reveal', namedCopy('sample.pdf')]),
    'item.openExternally': () => expect.poll(lastShell).toEqual(['open', namedCopy('sample.pdf')]),
    'item.exportCopy': async () => {
      await expect.poll(() => saveDialogCalls(app)).toBe(1);
      await expect(page.getByTestId('export-done').last()).toBeVisible();
      expect(fs.existsSync(exportFromMenu)).toBe(true);
      expect(fs.readFileSync(exportFromMenu).equals(fs.readFileSync(PDF))).toBe(true);
    },
  };
  try {
    filedId = (await importPaths(page, [PDF]))[0]!.id;
    filing = await createCollection(page, '전수 시험'); // 컬렉션에 추가 ▸ runs from one of its rows: this collection's
    await stubOpenDialog(app, []); // import dialogs come back empty
    await stubShell(app); // no Finder and no other app on CI: main's shell calls are recorded instead
    await stubSaveDialog(app, exportFromMenu);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });
    const ran = new Set<CommandId>();
    for (const view of ['library', 'reader'] as const) {
      if (view === 'library') {
        // The 파일 menu's item commands are judged on the table selection: select the row, then wait for main's menu
        // (the renderer reports the selection asynchronously; the list below is read once).
        await rowByTitle(page, 'sample').click();
        await expect(rowByTitle(page, 'sample')).toHaveAttribute('aria-selected', 'true');
        await expect.poll(() => menuItemEnabled(app, 'item.showInFolder')).toBe(true);
      } else {
        // The library pass ends with a sheet (단축키): on macOS main holds the window for up to 250 ms after it closes and
        // refuses a double-click in that gap, so the reader never opened (Mac run 41380108893).
        await sheetReleased(page);
        await openItem(page, 'sample'); // a double-click: a single click only selects
        // The menu is read once below: wait until the reader is up and main's menu has followed.
        await expect(page.getByTestId('viewer-title')).toBeVisible();
        await expect.poll(() => menuItemEnabled(app, 'library.find')).toBe(false);
        // The reader's commands follow the PDF's pages, which main hears of a moment after the toolbar shows.
        await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-pages', /^[1-9]/);
        await expect.poll(() => menuItemEnabled(app, 'reader.rotateCw')).toBe(true);
      }
      const ids = (await enabledMenuCommands(app)).sort((a, b) => Number(a === 'nav.back') - Number(b === 'nav.back')); // leave the reader last
      expect(ids.length).toBeGreaterThan(3);
      const libraryOnly = ids.filter((id) => id.startsWith('item.') || id === 'collection.addItems' || id === 'library.find' || id === 'library.sortBy' || id === 'view.toggleInspector');
      // Spec 6: the 자료 commands, 컬렉션에 추가, ⌘F, 정렬 기준 and the item panel belong to the library view; the reader's menu has them greyed.
      // The reader's own commands (zoom modes, rotation, page colours, 쪽으로 이동…) are on there and nowhere else.
      const readerOwn = ids.filter((id) => id.startsWith('reader.'));
      if (view === 'library') expect(readerOwn).toEqual([]);
      else expect(readerOwn.sort()).toEqual(COMMANDS.filter((c) => c.id.startsWith('reader.')).map((c) => c.id).sort());
      if (view === 'library') expect(libraryOnly.sort()).toEqual(['collection.addItems', 'item.exportCopy', 'item.openExternally', 'item.showInFolder', 'item.trash', 'library.find', 'library.sortBy', 'view.toggleInspector']);
      else expect(libraryOnly).toEqual([]);
      for (const id of ids) {
        if (DESTRUCTIVE.has(id)) continue;
        if (id === 'collection.addItems') await expect.poll(() => menuItemEnabled(app, `collection.addItems?collectionId=${filing}`)).toBe(true); // the menu bar is rebuilt after the collection exists
        if (view === 'reader') scaleBefore = await scale();
        await runMenuCommand(app, id, id === 'collection.addItems' ? { collectionId: filing } : REPRESENTATIVE_ARGS[id]);
        await effects[id]?.();
        await closeTransient(app, page);
        ran.add(id);
      }
    }
    await expect(page.getByTestId('library-table')).toBeVisible(); // nav.back ran last
    // ⌘0 is enabled only away from 13: one more round trip for it, restored to 13.
    await runMenuCommand(app, 'view.textBigger');
    await expect.poll(() => fontSize(page)).toBe(14);
    await runMenuCommand(app, 'view.textReset');
    await expect.poll(() => fontSize(page)).toBe(13);
    ran.add('view.textReset');

    // 이 컬렉션에서 빼기 is on only inside a collection: view the one the sample was just filed into, run it from the menu bar.
    await treeRow(page, filing).click();
    await rowByTitle(page, 'sample').click();
    await runMenuCommand(app, 'collection.removeItems');
    await expect(page.getByTestId('undo-toast')).toContainText('‘전수 시험’\u2060에서 자료 1개를 뺐습니다.');
    await expect.poll(async () => (await organizeSnapshot(page)).members[filing] ?? []).toEqual([]);
    await specialRow(page, 'all').click();
    ran.add('collection.removeItems');

    // The item context menu, through the native menu path: 열기, Finder에서 보기, 사본 내보내기… (design-spec 7.3).
    // A right-click selects the row first (spec 3.3).
    await stubContextMenu(app, '열기');
    await rowByTitle(page, 'sample').click({ button: 'right' });
    await expect(page.getByTestId('pdf-viewer')).toBeVisible();
    ran.add('item.open');
    await runMenuCommand(app, 'nav.back');
    const before = (await shellCalls(app)).length;
    await stubContextMenu(app, REVEAL);
    await rowByTitle(page, 'sample').click({ button: 'right' });
    await expect.poll(async () => (await shellCalls(app)).length).toBe(before + 1);
    expect(await lastShell()).toEqual(['reveal', namedCopy('sample.pdf')]);
    // 사본 내보내기… from the item menu: one more save panel, and the whole copy at the path it answered.
    await stubSaveDialog(app, exportFromItemMenu); // calls recorded from none again
    await stubContextMenu(app, '사본 내보내기…');
    await rowByTitle(page, 'sample').click({ button: 'right' });
    await expect.poll(() => saveDialogCalls(app)).toBe(1);
    await expect.poll(() => fs.existsSync(exportFromItemMenu)).toBe(true);
    expect(fs.readFileSync(exportFromItemMenu).equals(fs.readFileSync(PDF))).toBe(true);

    // 다시 연결… (first in the item menu for a linked item whose file is gone): the dialog picks the moved file.
    const src = testInfo.outputPath('src');
    fs.mkdirSync(src, { recursive: true });
    const linked = path.join(src, 'linked.pdf');
    fs.copyFileSync(PDF, linked);
    await importPaths(page, [linked], { mode: 'linked', allowDuplicate: true });
    await expect(page.getByTestId('item-row')).toHaveCount(2);
    const moved = path.join(src, 'moved.pdf');
    fs.renameSync(linked, moved);
    await stubOpenDialog(app, [moved]);
    await stubContextMenu(app, '다시 연결…');
    await rowByTitle(page, 'linked').click({ button: 'right' });
    await expect.poll(() => openDialogCalls(app)).toBe(1);
    await expect.poll(() => page.evaluate(async () => {
      const r = await window.learn.library.list();
      return r.ok ? r.data.filter((i) => i.storageMode === 'linked').map((i) => i.availability) : null;
    })).toEqual(['available']);
    ran.add('item.relink');

    // 정보 편집 lives in the palette (and the panel's pencil): ⌘K, its name, ↩ opens the form; 취소 closes it. No title
    // matches the query, so the cursor is on the first command row, above the 라이브러리에서 검색 row.
    await rowByTitle(page, 'sample').click();
    await runMenuCommand(app, 'app.palette');
    await expect(page.getByTestId('palette-input')).toBeFocused(); // the keys go to the field that has the focus when they arrive
    await page.keyboard.type('정보 편집');
    await expect(page.getByTestId('palette-result')).toHaveCount(0);
    await expect(page.locator('.palette [role="option"][data-focused]')).toHaveAttribute('data-command-id', 'item.editInfo');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('info-editor')).toBeVisible();
    await page.getByTestId('editor-cancel').click();
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
    ran.add('item.editInfo');

    // 기본 앱으로 열기 is also a notice button (the unplayable video, 10.7); it runs the same registry command.
    await importPaths(page, [MPEG4]);
    await openItem(page, 'sample-mpeg4part2');
    const opens = (await shellCalls(app)).length;
    await page.getByTestId('codec-open').click();
    await expect.poll(async () => (await shellCalls(app)).length).toBe(opens + 1);
    const [kind, opened] = (await lastShell())!;
    expect(kind).toBe('open');
    expect(opened).toMatch(/[\\/]derived[\\/]open[\\/][0-9a-f-]{36}[\\/]sample-mpeg4part2\.mp4$/);
    expect(fs.existsSync(opened)).toBe(true);
    await runMenuCommand(app, 'nav.back');

    // Tag commands, on tags made for the purpose: 1 from 파일 › 색 태그 ▸ (the other seven keys further down), the chip menu's
    // rows through the native menu path, 태그 선택 해제 through the palette.
    await rowByTitle(page, 'sample').click();
    const sampleId = await page.evaluate(async () => {
      const r = await window.learn.library.list();
      return r.ok ? (r.data.find((i) => i.title === 'sample')?.id ?? null) : null;
    });
    const [coloured, plain] = await makeTags(page, [{ name: '중요', slot: 1 }, { name: '복습' }]);
    await expect.poll(() => menuItemEnabled(app, 'tag.color1')).toBe(true);
    await runMenuCommand(app, 'tag.color1');
    await expect.poll(async () => (await organizeSnapshot(page)).tagged[coloured]).toEqual([sampleId]);
    ran.add('tag.color1');
    await assignTag(page, plain!, [sampleId!]);
    await stubContextMenu(app, ['색 지정', '3 초록']);
    await tagChip(page, plain!).click({ button: 'right' });
    await expect.poll(async () => (await organizeSnapshot(page)).tags.find((t) => t.id === plain)?.position).toBe(3);
    ran.add('tag.setColor');
    await stubContextMenu(app, '색 해제');
    await tagChip(page, plain!).click({ button: 'right' });
    await expect.poll(async () => (await organizeSnapshot(page)).tags.find((t) => t.id === plain)?.position).toBeNull();
    ran.add('tag.clearColor');
    await stubContextMenu(app, '이름 바꾸기');
    await tagChip(page, plain!).click({ button: 'right' });
    await expect(page.getByTestId('tag-rename-input')).toBeFocused();
    await page.keyboard.press('Escape');
    ran.add('tag.rename');
    await tagChip(page, plain!).click(); // the filter, so there is one to clear
    await expect(tagChip(page, plain!)).toHaveAttribute('aria-pressed', 'true');
    await runPalette(page, app, '태그 선택 해제', 'tags.clearFilter');
    await expect(tagChip(page, plain!)).toHaveAttribute('aria-pressed', 'false');
    ran.add('tags.clearFilter');
    await stubConfirm(app, 'confirm');
    await stubContextMenu(app, '태그 삭제…');
    await tagChip(page, plain!).click({ button: 'right' });
    await expect(page.getByTestId(`tag-chip-${plain}`)).toHaveCount(0);
    ran.add('tag.delete');

    {
      // The collection commands, on a collection made for the purpose, through the native menu path of its tree row (a right
      // click selects the row first, so each command acts on it).
      const parent = await createCollection(page, '정리 시험');
      await expect(treeRow(page, parent)).toBeVisible();
      const nameField = page.getByTestId('rename-input');

      await stubContextMenu(app, commandById('collection.newChild').label);
      await treeRow(page, parent).click({ button: 'right' });
      await expect(nameField).toBeFocused();
      await page.keyboard.type('하위');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await organizeSnapshot(page)).collections.some((c) => c.name === '하위' && c.parentId === parent)).toBe(true);
      ran.add('collection.newChild');

      await stubContextMenu(app, commandById('collection.rename').label);
      await treeRow(page, parent).click({ button: 'right' });
      await expect(nameField).toBeFocused();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('정리 시험 2');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await organizeSnapshot(page)).collections.find((c) => c.id === parent)?.name).toBe('정리 시험 2');
      ran.add('collection.rename');

      await stubOpenDialog(app, [KO_PDF]);
      await stubContextMenu(app, commandById('collection.importInto').label);
      await treeRow(page, parent).click({ button: 'right' });
      await expect.poll(async () => (await organizeSnapshot(page)).members[parent]?.length ?? 0).toBe(1);
      ran.add('collection.importInto');

      // 휴지통으로 이동 (M6 spec 4.2): no question; the collection (and its child) go to the trash, 실행 취소 brings them back.
      await stubConfirm(app, 'confirm');
      await stubContextMenu(app, commandById('collection.delete').label);
      await treeRow(page, parent).click({ button: 'right' });
      await expect(treeRow(page, parent)).toHaveCount(0);
      expect(await confirmCalls(app)).toEqual([]);
      await expect(page.getByTestId('undo-toast')).toContainText('‘정리 시험 2’ 컬렉션을 휴지통으로 옮겼습니다');
      await page.getByTestId('undo-action').click();
      await expect(treeRow(page, parent)).toBeVisible();
      ran.add('collection.delete');

      // The other seven colour keys, from 파일 › 색 태그 ▸ on the selected sample (1 ran above): each puts its slot's tag on it.
      await specialRow(page, 'all').click();
      await rowByTitle(page, 'sample').click();
      const target = await page.evaluate(async () => {
        const r = await window.learn.library.list();
        return r.ok ? (r.data.find((i) => i.title === 'sample')?.id ?? null) : null;
      });
      const slots = await makeTags(page, [2, 3, 4, 5, 6, 7, 8].map((n) => ({ name: `색 ${n}`, slot: n })));
      for (const [i, id] of slots.entries()) {
        const command = `tag.color${i + 2}` as CommandId;
        await runMenuCommand(app, command);
        await expect.poll(async () => (await organizeSnapshot(page)).tagged[id] ?? [], { message: command }).toEqual([target]);
        ran.add(command);
      }

      // 내 라이브러리 전체에서 찾기: listed in the palette only for a search outside 내 라이브러리; it keeps the query.
      await treeRow(page, parent).click();
      await runMenuCommand(app, 'library.find');
      await expect(searchInput).toBeFocused(); // keys go where the focus is when they arrive
      await page.keyboard.type('zzzz');
      await runPalette(page, app, '내 라이브러리 전체에서 찾기', 'library.findEverywhere');
      await expect(specialRow(page, 'all')).toHaveAttribute('aria-selected', 'true');
      await expect(searchInput).toHaveValue('zzzz');
      await page.getByTestId('search-field-clear').click();
      ran.add('library.findEverywhere');
    }

    {
      // The trash (M6 spec 4). ⌘⌫ has two names: 휴지통으로 이동 in the library (menu bar, then undone), 영구 삭제… in the trash view.
      const trashToast = page.getByTestId('trash-undo');
      await rowByTitle(page, 'sample-mpeg4part2').click();
      await expect.poll(() => menuLabel(app, 'item.trash')).toBe('휴지통으로 이동');
      await runMenuCommand(app, 'item.trash');
      await expect(trashToast).toContainText('휴지통으로 옮겼습니다');
      await expect(rowByTitle(page, 'sample-mpeg4part2')).toHaveCount(0);
      ran.add('item.trash');

      // 복원 is a row-menu command (and the panel's button): the trashed row's menu picks it.
      await specialRow(page, 'trash').click();
      await stubContextMenu(app, '복원');
      await rowByTitle(page, 'sample-mpeg4part2').click({ button: 'right' });
      await expect(specialRow(page, 'trash')).toHaveCount(0);
      await expect(page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
      await expect(rowByTitle(page, 'sample-mpeg4part2')).toBeVisible();
      ran.add('item.restore');

      // The second name: in the trash view the same ⌘⌫ asks the permanent-delete question in its sheet, and 영구 삭제 answers it.
      await trashItems(page, [(await organizeIdOf(page, 'sample-mpeg4part2'))!]);
      await specialRow(page, 'trash').click();
      await rowByTitle(page, 'sample-mpeg4part2').click();
      await expect.poll(() => menuLabel(app, 'item.trash')).toBe('영구 삭제…');
      const purge = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'item.trash'));
      await clickToCloseSheet(purge, purge.getByTestId('purge-confirm'));
      await expect(page.getByTestId('purge-done')).toHaveText('자료 1개를 영구히 삭제했습니다');
      await expect(specialRow(page, 'trash')).toHaveCount(0);

      // 휴지통 비우기…: one more item in the trash, then the whole trash is asked about and emptied.
      await trashItems(page, [(await organizeIdOf(page, KO))!]);
      await specialRow(page, 'trash').click();
      await expect(page.getByTestId('item-row')).toHaveCount(1);
      const emptied = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'trash.empty'));
      await expect(emptied.getByTestId('purge-title')).toHaveText('휴지통을 비우겠습니까?');
      await clickToCloseSheet(emptied, emptied.getByTestId('purge-confirm'));
      await expect(page.getByTestId('purge-done').last()).toHaveText('휴지통을 비웠습니다');
      await expect(page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
      ran.add('trash.empty');

      // 중복 정리: the same file imported twice more makes two groups. 모두 정리 from the palette keeps the earliest of each (undone by
      // its toast), 하나만 남기고 휴지통으로 from a row menu of 중복 항목 cleans one group.
      await importPaths(page, [PDF], { allowDuplicate: true });
      await importPaths(page, [KO_PDF]); // the Korean file went with the emptied trash: new once, then twice
      await importPaths(page, [KO_PDF], { allowDuplicate: true });
      await specialRow(page, 'duplicates').click();
      const groups = await page.getByTestId('item-row').count();
      expect(groups).toBeGreaterThanOrEqual(4);
      await expect(page.getByTestId('keep-all-duplicates')).toBeVisible();
      await runPalette(page, app, '모두 정리', 'duplicates.keepOneAll');
      await expect(page.getByTestId('undo-toast')).toContainText('휴지통으로 옮겼습니다');
      await expect(specialRow(page, 'duplicates')).toHaveCount(0);
      ran.add('duplicates.keepOneAll');
      await page.getByTestId('undo-action').click();
      await expect(specialRow(page, 'duplicates')).toBeVisible();
      await specialRow(page, 'duplicates').click();
      await expect(page.getByTestId('item-row')).toHaveCount(groups);
      await stubContextMenu(app, '하나만 남기고 휴지통으로');
      await page.getByTestId('item-row').last().click({ button: 'right' });
      await expect(page.getByTestId('undo-toast').last()).toContainText('휴지통으로 옮겼습니다');
      expect((await recordedPopups(app)).length).toBeGreaterThan(0);
      await expect.poll(() => page.getByTestId('item-row').count()).toBeLessThan(groups);
      ran.add('duplicates.keepOne');
      await specialRow(page, 'all').click();

      // 가져오기 취소: an import held at its checkpoint is stopped from the palette; the file stays out.
      const before = await page.getByTestId('item-row').count();
      const unseen = path.join(testInfo.outputPath('src'), 'never-in.pdf');
      fs.writeFileSync(unseen, '%PDF-1.4\n% never in\n%%EOF\n');
      await importPause(app, 'afterStage');
      await stubOpenDialog(app, [unseen]);
      await runMenuCommand(app, 'file.importManaged');
      await expect.poll(() => importWaiting(app)).toBe('afterStage');
      await runPalette(page, app, '가져오기 취소', 'file.cancelImport');
      await importResume(app);
      await expect(page.getByTestId('import-done')).toContainText('가져오기를 취소했습니다');
      await waitImportIdle(page);
      await expect(page.getByTestId('item-row')).toHaveCount(before);
      ran.add('file.cancelImport');

      // 백업 만들기… and 백업에서 복원…, the folder panels stubbed: the result sheet of each.
      const backups = testInfo.outputPath('backups');
      const restores = testInfo.outputPath('restores');
      for (const dir of [backups, restores]) fs.mkdirSync(dir, { recursive: true });
      await stubFolderPicker(app, backups);
      const made = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'file.backup'));
      await expect(made.getByTestId('backup-title')).toHaveText('백업을 만들었습니다');
      await clickToCloseSheet(made, made.getByTestId('backup-done'));
      const [backup] = fs.readdirSync(backups);
      expect(backup).toMatch(/^Learn 백업 /);
      ran.add('file.backup');
      await stubFolderPicks(app, [path.join(backups, backup!), restores]);
      await expect.poll(() => menuItemEnabled(app, 'file.restore')).toBe(true);
      const restored = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'file.restore'));
      await expect(restored.getByTestId('restore-title')).toHaveText('백업을 복원했습니다');
      await closeSheet(restored, 'Escape');
      expect(fs.readdirSync(restores)).toHaveLength(1);
      ran.add('file.restore');
      // 라이브러리 점검… ran in the menu loop above (its sheet opened); once more with the sheet's answer read.
      const check = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'file.checkLibrary'));
      await expect(check.locator('[data-sheet-root]')).toBeVisible();
      await closeSheet(check, 'Escape');
      ran.add('file.checkLibrary');
    }

    // The ledger: every registry command ran here, or is named with the test that runs it. A command added later fails
    // here until it is in one of the two; a ledger entry for a command that is gone fails too.
    const all = COMMANDS.map((c) => c.id);
    // The M5 commands, all run here: a command added to the registry later fails this until it is run above.
    const m5 = all.filter((id) => /^(collection|tag|tags)\./.test(id) || id === 'library.findEverywhere' || id === 'library.sortBy').sort();
    expect(m5, 'the M5 commands in the registry').toEqual([...M5_COMMANDS].sort());
    expect(m5.filter((id) => !ran.has(id)), 'M5 commands this test did not run itself').toEqual([]);
    expect(Object.keys(COVERED_ELSEWHERE).filter((id) => M5_COMMANDS.includes(id as CommandId)), 'M5 commands left to another test').toEqual([]);
    // The M6 commands, all run above: none is left to another test, and every one is in the registry.
    expect(M6_COMMANDS.filter((id) => !all.includes(id)), 'M6 commands gone from the registry').toEqual([]);
    expect(M6_COMMANDS.filter((id) => !ran.has(id)), 'M6 commands this test did not run itself').toEqual([]);
    expect(Object.keys(COVERED_ELSEWHERE).filter((id) => M6_COMMANDS.includes(id as CommandId)), 'M6 commands left to another test').toEqual([]);
    expect(Object.keys(COVERED_ELSEWHERE).filter((id) => !all.includes(id as CommandId)), 'stale coveredElsewhere entries').toEqual([]);
    // The backstop for M5 commands outside the prefix filter above: they still have to run here or be covered elsewhere.
    expect(all.filter((id) => !ran.has(id) && !(id in COVERED_ELSEWHERE)), 'commands neither run here nor covered elsewhere').toEqual([]);
    for (const [id, where] of Object.entries(COVERED_ELSEWHERE)) {
      const [file, title] = where.split(' › ') as [string, string];
      expect(fs.readFileSync(path.join(import.meta.dirname, file), 'utf8'), `${id}: ${where}`).toContain(`test('${title}'`);
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
