// No fake controls (quality spec): every registry command that is enabled in the library — with one item selected, so
// that the 파일 menu's item commands are on — and in the reader runs through its real menu item without a page
// error; the item context-menu commands run through the native menu path, 정보 편집 through the palette (its only
// place), 기본 앱으로 열기 also through its notice button. The rest of the registry is accounted for in COVERED_ELSEWHERE.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { COMMANDS, type CommandArgs, type CommandId } from '../../packages/domain/src/commands';
import {
  FIXTURES, enabledMenuCommands, importPaths, launch, menuItemEnabled, menuSnapshot, openDialogCalls, openItem, rowByTitle, runMenuCommand, saveDialogCalls, shellCalls,
  stubContextMenu, stubOpenDialog, stubSaveDialog, stubShell, type MenuNode,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const MPEG4 = path.join(FIXTURES, 'sample-mpeg4part2.mp4');
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
const escaped = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A value submenu's command runs from one of its rows (P-18): this value; the other rows are the menu unit tests'. */
const REPRESENTATIVE_ARGS: Partial<Record<CommandId, CommandArgs>> = { 'library.sortBy': { column: 'year' } };

/**
 * Commands this test does not run, each with the test that does (`<spec file> › <test title>`): F6 / ⇧F6 are keys of
 * the renderer keymap, with no menu item to click.
 */
const COVERED_ELSEWHERE: Partial<Record<CommandId, string>> = {
  'view.nextPane': 'keyboard.spec.ts › F6 / ⇧F6 cycle sidebar ↔ content, also out of a text field; a folded sidebar is skipped',
  'view.previousPane': 'keyboard.spec.ts › F6 / ⇧F6 cycle sidebar ↔ content, also out of a text field; a folded sidebar is skipped',
  'collection.newChild': 'collections.spec.ts › new sub-collection from the menu and the palette: the parent opens and the child is named under it',
  'collection.rename': 'collections.spec.ts › rename by the ↩ key, the menu and the palette keeps the tree in name order and allows equal names',
  'collection.importInto': 'collections.spec.ts › an empty collection says so in the table and the item panel, and its button brings files into it',
  'collection.delete': 'collections.spec.ts › delete asks in the sheet words, the view moves to the parent, and 실행 취소 brings it back without what was deleted before it',
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
  /** Named copies under derived/open/<uuid>/ with the type's extension. */
  const openDir = path.join(testInfo.outputPath('library'), 'derived', 'open');
  const namedCopy = (file: string) => expect.stringMatching(new RegExp(`^${escaped(openDir)}[\\\\/][0-9a-f-]{36}[\\\\/]${escaped(file)}$`));
  const lastShell = async () => (await shellCalls(app)).at(-1) ?? null;
  const exported = testInfo.outputPath('exported');
  fs.mkdirSync(exported, { recursive: true });
  const exportFromMenu = path.join(exported, 'from-menu.pdf');
  const exportFromItemMenu = path.join(exported, 'from-item-menu.pdf');
  /** What each command must visibly have done, beyond running without an error. */
  const effects: Partial<Record<CommandId, () => Promise<void>>> = {
    'app.settings': () => expect.poll(() => otherWindows(app)).toContain('settings'),
    'app.shortcuts': () => expect.poll(() => otherWindows(app)).toContain('sheet'),
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
    // A pref round trip: ⌘+ and ⌘− in menu order, 13 → 14 → 13.
    'view.textBigger': () => expect.poll(() => fontSize(page)).toBe(14),
    'view.textSmaller': () => expect.poll(() => fontSize(page)).toBe(13),
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
    await importPaths(page, [PDF]);
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
      } else await openItem(page, 'sample'); // a double-click: a single click only selects
      const ids = (await enabledMenuCommands(app)).sort((a, b) => Number(a === 'nav.back') - Number(b === 'nav.back')); // leave the reader last
      expect(ids.length).toBeGreaterThan(3);
      const libraryOnly = ids.filter((id) => id.startsWith('item.') || id === 'library.find' || id === 'library.sortBy' || id === 'view.toggleInspector');
      // Spec 6: the 자료 commands, ⌘F, 정렬 기준 and the item panel belong to the library view; the reader's menu has them greyed.
      if (view === 'library') expect(libraryOnly.sort()).toEqual(['item.exportCopy', 'item.openExternally', 'item.showInFolder', 'library.find', 'library.sortBy', 'view.toggleInspector']);
      else expect(libraryOnly).toEqual([]);
      for (const id of ids) {
        await runMenuCommand(app, id, REPRESENTATIVE_ARGS[id]);
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

    // The item context menu, through the native menu path: 열기, Finder에서 보기, 사본 내보내기… (design-spec 7.3).
    // A right-click selects the row first (spec 3.3).
    await stubContextMenu(app, '열기');
    await rowByTitle(page, 'sample').click({ button: 'right' });
    await expect(page.getByTestId('pdf-canvas')).toBeVisible();
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
    await page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'linked', allowDuplicate: true }), linked);
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

    // The ledger: every registry command ran here, or is named with the test that runs it. A command added later fails
    // here until it is in one of the two; a ledger entry for a command that is gone fails too.
    const all = COMMANDS.map((c) => c.id);
    expect(Object.keys(COVERED_ELSEWHERE).filter((id) => !all.includes(id as CommandId)), 'stale coveredElsewhere entries').toEqual([]);
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
