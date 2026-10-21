import path from 'node:path';
import { expect, test } from '@playwright/test';
import { COMMANDS, commandLabel } from '../../packages/domain/src/commands';
import { FIXTURES, closeSheet, expectWindow, importFiles, importPaths, launch, menuItemEnabled, runMenuCommand } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');

test('a duplicate import asks in a sheet: ↩ skips, 새 자료로 추가 adds, esc skips, 기존 자료 열기 opens', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const rows = s.page.getByTestId('item-row');
  try {
    await importPaths(s.page, [PDF]);
    await expect(rows).toHaveCount(1);

    let sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [PDF]));
    await expect(sheet.getByTestId('sheet-root')).toHaveAttribute('data-kind', 'duplicate');
    await expect(sheet.getByRole('heading')).toHaveText('이미 라이브러리에 있는 파일입니다');
    await expect(sheet.getByTestId('dup-file')).toHaveText('sample.pdf');
    await expect(sheet.getByTestId('dup-card')).toContainText('sample');
    await expect(sheet.getByTestId('dup-card')).toContainText('PDF ·');
    await expect(sheet.getByTestId('dup-skip')).toBeFocused();
    expect(await menuItemEnabled(s.app, 'file.importManaged')).toBe(false); // the main window waits for the answer
    await closeSheet(sheet, 'Enter');
    await expect(rows).toHaveCount(1);

    sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [PDF]));
    await sheet.getByTestId('dup-add').click();
    await expect(rows).toHaveCount(2);

    sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [PDF]));
    await closeSheet(sheet, 'Escape');
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged')).toBe(true);
    await expect(rows).toHaveCount(2);

    sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [PDF]));
    await sheet.getByTestId('dup-open').click();
    await expect(s.page.getByTestId('viewer-title')).toHaveText('sample');
  } finally {
    await s.app.close();
  }
});

test('the sheet is a 440 px modal child of the main window, 8 px under the toolbar, as tall as its content', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const rows = s.page.getByTestId('item-row');
  try {
    await importPaths(s.page, [PDF]);
    const sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [PDF]));
    const geo = await s.app.evaluate(({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows();
      const child = all.find((w) => w.getParentWindow() !== null)!;
      const parent = child.getParentWindow()!;
      return { modal: child.isModal(), main: parent.getContentBounds(), sheet: child.getContentBounds() };
    });
    expect(geo.modal).toBe(true);
    expect(geo.sheet.width).toBe(440);
    if (process.platform !== 'darwin') {
      expect(geo.sheet.y - geo.main.y).toBe(60);
      expect(Math.abs(geo.sheet.x + geo.sheet.width / 2 - (geo.main.x + geo.main.width / 2))).toBeLessThanOrEqual(1);
    }
    // Sized to its content (measured hidden, then shown): no empty band below the buttons, nothing cut off.
    const content = await sheet.evaluate(() => Math.ceil(document.querySelector('[data-sheet-root]')!.getBoundingClientRect().height));
    expect(geo.sheet.height).toBe(content);
    await expect(sheet.locator(':root')).toHaveAttribute('data-sized', '1');

    // Closing the window itself (창 닫기, ⌘W) answers 건너뛰기: nothing is added and the import ends.
    const closed = sheet.waitForEvent('close');
    await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getParentWindow() !== null)!.close());
    await closed;
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged')).toBe(true);
    await expect(rows).toHaveCount(1);
  } finally {
    await s.app.close();
  }
});

test('⌘/ lists every registry shortcut in a sheet; ↩ closes it', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const sheet = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'app.shortcuts'));
    await expect(sheet.getByTestId('sheet-root')).toHaveAttribute('data-kind', 'shortcuts');
    for (const c of COMMANDS.filter((x) => x.accelerator || x.key)) {
      await expect(sheet.getByTestId('shortcut-row').filter({ hasText: commandLabel(c, process.platform) }), c.id).toHaveCount(1);
    }
    await expect(sheet.getByTestId('shortcuts-done')).toBeFocused();
    expect(await menuItemEnabled(s.app, 'app.shortcuts')).toBe(false);
    await closeSheet(sheet, 'Enter');
    await expect.poll(() => menuItemEnabled(s.app, 'app.shortcuts')).toBe(true);
  } finally {
    await s.app.close();
  }
});

test('sheet IPC refuses a caller that is not an open sheet', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    expect(await s.page.evaluate(() => window.learn.sheet.payload())).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await s.page.evaluate(() => window.learn.sheet.resolve({ kind: 'shortcuts' }))).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  } finally {
    await s.app.close();
  }
});
