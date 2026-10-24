// No fake controls (quality spec): every registry command that is enabled in the library and in the reader runs
// through its real menu item without a page error; the item context-menu commands run through the native menu path,
// 기본 앱으로 열기 through its notice button. The rest of the registry is accounted for in COVERED_ELSEWHERE.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { COMMANDS, type CommandId } from '../../packages/domain/src/commands';
import {
  FIXTURES, enabledMenuCommands, importPaths, launch, menuItemEnabled, openDialogCalls, openItem, rowByTitle, runMenuCommand, saveDialogCalls, shellCalls, stubContextMenu, stubOpenDialog, stubSaveDialog,
  stubShell,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const MPEG4 = path.join(FIXTURES, 'sample-mpeg4part2.mp4');

/** Closes what a command opened: sheets by Escape once they rendered, other windows directly, then the palette. */
async function closeTransient(app: ElectronApplication, main: Page): Promise<void> {
  await main.waitForTimeout(250);
  for (const w of app.windows()) {
    if (w === main || w.isClosed()) continue;
    await w.waitForLoadState('domcontentloaded').catch(() => {});
    if (w.url().includes('window=sheet')) {
      // R-12: the sheet handles Escape only after its payload arrived and rendered; wait for it, then for the close.
      await w.locator('[data-sheet-root]').waitFor({ timeout: 5_000 });
      const closed = w.waitForEvent('close');
      await w.keyboard.press('Escape').catch(() => {}); // the window can be gone before the key-up
      await closed;
    } else await w.close().catch(() => {});
  }
  if (await main.getByTestId('palette').count()) await main.keyboard.press('Escape');
  await main.waitForTimeout(150);
}

/** The `?window=` kinds of the open windows other than the main one. */
const otherWindows = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed())
      .map((w) => /[?&]window=(\w+)/.exec(w.webContents.getURL())?.[1] ?? '')
      .filter((kind) => kind !== 'main'),
  );
const fontSize = (page: Page) =>
  page.evaluate(async () => {
    const r = await window.learn.prefs.get();
    if (!r.ok) throw new Error(`prefs.get failed: ${r.code}`);
    return r.data.fontSize;
  });

/**
 * Commands this test does not run, each with the test that does (`<spec file> › <test title>`): F6 / ⇧F6 are keys of
 * the renderer keymap, with no menu item to click.
 */
const COVERED_ELSEWHERE: Partial<Record<CommandId, string>> = {
  'view.nextPane': 'keyboard.spec.ts › F6 / ⇧F6 cycle sidebar ↔ content, also out of a text field; a folded sidebar is skipped',
  'view.previousPane': 'keyboard.spec.ts › F6 / ⇧F6 cycle sidebar ↔ content, also out of a text field; a folded sidebar is skipped',
  'item.editInfo': 'inspector-edit.spec.ts › 정보 편집 from the palette edits the selected item, showing a folded item panel first',
};

test('every registry command runs without a page error (library and reader menus, item menu, notice buttons)', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const errors: string[] = [];
  const watch = (p: Page) => {
    p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error') errors.push(`${p.url()}: ${m.text()}`);
    });
  };
  watch(page);
  app.on('window', watch);
  const sidebar = () => page.getByTestId('shell').getAttribute('data-sidebar');
  const inspector = () => page.getByTestId('shell').getAttribute('data-inspector');
  const exported = testInfo.outputPath('exports', 'sample.pdf');
  /** What main handed the OS, in order (stubShell below): the kinds, then the paths. */
  const shellKinds = async () => (await shellCalls(app)).map(([kind]) => kind);
  /** The paths main handed the OS: named copies under derived/open/ with the type's extension (final review I1). */
  const shellPaths = async () => (await shellCalls(app)).map(([, p]) => p);
  /** What each command must visibly have done, beyond running without an error (Task 12 rulings). */
  const effects: Partial<Record<CommandId, () => Promise<void>>> = {
    'app.settings': () => expect.poll(() => otherWindows(app)).toContain('settings'),
    'app.shortcuts': () => expect.poll(() => otherWindows(app)).toContain('sheet'),
    // ⌘F: the quick search field has the focus.
    'library.find': () => expect(page.getByTestId('search-field').locator('input')).toBeFocused(),
    'app.palette': () => expect(page.getByTestId('palette')).toBeVisible(),
    // Both states: hidden, then shown again by the same command.
    'view.toggleSidebar': async () => {
      await expect.poll(sidebar).toBe('hidden');
      await runMenuCommand(app, 'view.toggleSidebar');
      await expect.poll(sidebar).toBe('shown');
    },
    // Both states, as for the sidebar. 240 + 520 + 320 fit: the command hid the panel; in a narrower window (the
    // 1024 px macOS runner) it showed the folded one on demand.
    'view.toggleInspector': async () => {
      const first = (await page.evaluate(() => innerWidth)) >= 1080 ? 'hidden' : 'shown';
      await expect.poll(inspector).toBe(first);
      await runMenuCommand(app, 'view.toggleInspector');
      await expect.poll(inspector).toBe(first === 'hidden' ? 'shown' : 'hidden');
    },
    // A pref round trip: ⌘+ and ⌘− in menu order, 13 → 14 → 13.
    'view.textBigger': () => expect.poll(() => fontSize(page)).toBe(14),
    'view.textSmaller': () => expect.poll(() => fontSize(page)).toBe(13),
    // On the selected sample row: the OS is asked to show, then to open, its named copy (파일 menu order).
    'item.showInFolder': () => expect.poll(shellKinds).toEqual(['reveal']),
    // The save panel is stubbed to answer one path: the toast says it is saved and the copy is there.
    'item.exportCopy': async () => {
      await expect(page.getByTestId('export-done').last()).toBeVisible();
      expect(fs.existsSync(exported)).toBe(true);
    },
    'item.openExternally': () => expect.poll(shellKinds).toEqual(['reveal', 'open']),
  };
  try {
    await importPaths(page, [PDF]);
    await stubOpenDialog(app, []); // import dialogs come back empty
    // No Finder, no other app and no save panel on CI: main's shell calls are recorded and the panel answers a path.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
    });
    await stubShell(app);
    fs.mkdirSync(path.dirname(exported), { recursive: true });
    await stubSaveDialog(app, exported);
    const openDir = path.join(testInfo.outputPath('library'), 'derived', 'open');
    const ran = new Set<CommandId>();
    for (const view of ['library', 'reader'] as const) {
      if (view === 'reader') await openItem(page, 'sample');
      // 파일 › Finder에서 보기 and 기본 앱으로 열기 act on the table selection: select the row first, wait for main's menu.
      if (view === 'library') {
        await rowByTitle(page, 'sample').click();
        await expect.poll(() => menuItemEnabled(app, 'item.showInFolder')).toBe(true);
      }
      const ids = (await enabledMenuCommands(app)).sort((a, b) => Number(a === 'nav.back') - Number(b === 'nav.back')); // leave the reader last
      expect(ids.length).toBeGreaterThan(3);
      for (const id of ids) {
        await runMenuCommand(app, id);
        await effects[id]?.();
        await closeTransient(app, page);
        ran.add(id);
      }
    }
    await expect(page.getByTestId('library-table')).toBeVisible(); // nav.back ran last
    // The menu-bar runs handed the OS the named copy (final review I1), like the item menu below.
    for (const p of (await shellPaths()).slice(0, 2)) expect(p).toMatch(/[\\/]derived[\\/]open[\\/][0-9a-f-]{36}[\\/]sample\.pdf$/);
    // ⌘0 is enabled only away from 13: one more round trip for it, restored to 13.
    await runMenuCommand(app, 'view.textBigger');
    await expect.poll(() => fontSize(page)).toBe(14);
    await runMenuCommand(app, 'view.textReset');
    await expect.poll(() => fontSize(page)).toBe(13);
    ran.add('view.textReset');

    // The item context menu, through the native menu path (runPicked): 열기 and Finder에서 보기 (design-spec 7.3, C-1).
    await stubContextMenu(app, '열기');
    await page.getByTestId('item-row').first().click({ button: 'right' });
    await expect(page.getByTestId('pdf-canvas')).toBeVisible();
    ran.add('item.open');
    await runMenuCommand(app, 'nav.back');
    await stubContextMenu(app, process.platform === 'darwin' ? 'Finder에서 보기' : '폴더에서 보기');
    await page.getByTestId('item-row').first().click({ button: 'right' });
    await expect.poll(shellKinds).toEqual(['reveal', 'open', 'reveal']);
    expect((await shellPaths())[2]).toMatch(new RegExp(`^${openDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\/][0-9a-f-]{36}[\\/]sample\\.pdf$`));
    ran.add('item.showInFolder');

    // 사본 내보내기… from the item menu: one more save panel, and the copy at the path it answered.
    const panels = await saveDialogCalls(app);
    fs.rmSync(exported);
    await stubContextMenu(app, '사본 내보내기…');
    await rowByTitle(page, 'sample').click({ button: 'right' });
    await expect.poll(() => saveDialogCalls(app)).toBe(panels + 1);
    await expect.poll(() => fs.existsSync(exported)).toBe(true);
    expect(fs.readFileSync(exported)).toEqual(fs.readFileSync(PDF));
    ran.add('item.exportCopy');

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
    await page.getByTestId('item-row').filter({ hasText: 'linked' }).click({ button: 'right' });
    await expect.poll(() => openDialogCalls(app)).toBe(1);
    await expect.poll(() => page.evaluate(async () => {
      const r = await window.learn.library.list();
      return r.ok ? r.data.filter((i) => i.storageMode === 'linked').map((i) => i.availability) : null;
    })).toEqual(['available']);
    ran.add('item.relink');

    // 기본 앱으로 열기 is a notice button only (the unplayable video, 10.7); it runs the same registry command.
    await importPaths(page, [MPEG4]);
    await openItem(page, 'sample-mpeg4part2');
    await page.getByTestId('codec-open').click();
    await expect.poll(shellKinds).toEqual(['reveal', 'open', 'reveal', 'open']);
    expect((await shellPaths())[3]).toMatch(/[\\/]derived[\\/]open[\\/][0-9a-f-]{36}[\\/]sample-mpeg4part2\.mp4$/);
    expect(fs.existsSync((await shellPaths())[3]!)).toBe(true);
    ran.add('item.openExternally');
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
