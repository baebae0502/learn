// No fake controls (quality spec): every registry command that is enabled in the library and in the reader runs
// through its real menu item without a page error; the item context-menu commands run through the native menu path.
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { COMMANDS, type CommandId } from '../../packages/domain/src/commands';
import { FIXTURES, enabledMenuCommands, importPaths, launch, openItem, runMenuCommand, stubContextMenu, stubOpenDialog } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');

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

test('every enabled registry command runs without a page error (library, reader, item menu)', async ({}, testInfo) => {
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
  /** What each command must visibly have done, beyond running without an error (Task 12 rulings). */
  const effects: Partial<Record<CommandId, () => Promise<void>>> = {
    'app.settings': () => expect.poll(() => otherWindows(app)).toContain('settings'),
    'app.shortcuts': () => expect.poll(() => otherWindows(app)).toContain('sheet'),
    'app.palette': () => expect(page.getByTestId('palette')).toBeVisible(),
    // Both states: hidden, then shown again by the same command.
    'view.toggleSidebar': async () => {
      await expect.poll(sidebar).toBe('hidden');
      await runMenuCommand(app, 'view.toggleSidebar');
      await expect.poll(sidebar).toBe('shown');
    },
    // A pref round trip: ⌘+ and ⌘− in menu order, 13 → 14 → 13.
    'view.textBigger': () => expect.poll(() => fontSize(page)).toBe(14),
    'view.textSmaller': () => expect.poll(() => fontSize(page)).toBe(13),
  };
  try {
    await importPaths(page, [PDF]);
    await stubOpenDialog(app, []); // import dialogs come back empty
    await app.evaluate(({ dialog, shell }) => {
      dialog.showMessageBox = (async () => ({ response: 1, checkboxChecked: false })) as typeof dialog.showMessageBox;
      shell.showItemInFolder = () => {};
      shell.openPath = async () => '';
    });
    const ran = new Set<CommandId>();
    for (const view of ['library', 'reader'] as const) {
      if (view === 'reader') await openItem(page, 'sample');
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
    // ⌘0 is enabled only away from 13: one more round trip for it, restored to 13.
    await runMenuCommand(app, 'view.textBigger');
    await expect.poll(() => fontSize(page)).toBe(14);
    await runMenuCommand(app, 'view.textReset');
    await expect.poll(() => fontSize(page)).toBe(13);
    ran.add('view.textReset');

    // Every menu command of the registry ran in one of the two views.
    expect([...ran].sort()).toEqual(COMMANDS.filter((c) => c.menu).map((c) => c.id).sort());

    // The item context menu has 열기 and Finder에서 보기 only (design-spec 7.3, C-1); 기본 앱으로 열기 is a notice button,
    // covered by readers.spec (codec-open).
    for (const label of ['열기', process.platform === 'darwin' ? 'Finder에서 보기' : '폴더에서 보기']) {
      await stubContextMenu(app, label);
      await page.getByTestId('item-row').first().click({ button: 'right' });
      await closeTransient(app, page);
      if (label === '열기') {
        await expect(page.getByTestId('pdf-canvas')).toBeVisible();
        await runMenuCommand(app, 'nav.back');
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
