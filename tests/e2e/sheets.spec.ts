import path from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { COMMANDS, commandLabel } from '../../packages/domain/src/commands';
import { expectNoSeriousA11y } from './a11y';
import { FIXTURES, clickToCloseSheet, closeSheet, expectWindow, importFiles, importPaths, launch, mainWindow, menuItemEnabled, runMenuCommand } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
/** The keyboard focus ring (outline) of a button: 'none' or 'solid'. */
const ring = (button: Locator) => button.evaluate((e) => getComputedStyle(e).outlineStyle);
/**
 * Keyboard focus is back in the main window once a sheet has closed. Asked of main (the focused BrowserWindow):
 * inside the page, document.hasFocus() is always true under Playwright's focus emulation.
 */
const mainHasFocus = (app: ElectronApplication) =>
  expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.webContents.getURL().includes('window=main') ?? false), {
      message: 'focus back in the main window',
    })
    .toBe(true);

test('a duplicate import asks in a sheet: ↩ skips (whichever button has focus), 새 자료로 추가 adds, esc skips, 기존 자료 열기 opens', async ({}, testInfo) => {
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
    // The default button has focus, marked by its accent fill alone (no ring) until the keyboard is used.
    await expect(sheet.getByTestId('dup-skip')).toBeFocused();
    expect(await ring(sheet.getByTestId('dup-skip'))).toBe('none');
    expect(await menuItemEnabled(s.app, 'file.importManaged')).toBe(false); // the main window waits for the answer
    await sheet.keyboard.press('Shift+Tab');
    await expect(sheet.getByTestId('dup-add')).toBeFocused();
    expect(await ring(sheet.getByTestId('dup-add'))).toBe('solid');
    await sheet.keyboard.press('Tab');
    await expect(sheet.getByTestId('dup-skip')).toBeFocused();
    expect(await ring(sheet.getByTestId('dup-skip'))).toBe('solid'); // back on the default button: its ring shows now
    // ↩ runs the default button (건너뛰기) even with 새 자료로 추가 focused; Space would press the focused one.
    await sheet.keyboard.press('Shift+Tab');
    await expect(sheet.getByTestId('dup-add')).toBeFocused();
    // A modified ↩ (⇧↩ ⌃↩ ⌥↩ ⌘↩) does nothing: it does not press the focused 새 자료로 추가 either.
    for (const combo of ['Shift+Enter', 'Control+Enter', 'Alt+Enter', 'Meta+Enter']) await sheet.keyboard.press(combo);
    expect(sheet.isClosed()).toBe(false);
    await expect(sheet.getByTestId('dup-add')).toBeFocused();
    await expect(rows).toHaveCount(1);
    await closeSheet(sheet, 'Enter');
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged')).toBe(true);
    await expect(rows).toHaveCount(1);
    await mainHasFocus(s.app);
    // The page shows an active window again (selection colours, tooltips): main pushed the state back after the sheet.
    await expect(s.page.locator('html')).not.toHaveAttribute('data-window-inactive', '');

    sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [PDF]));
    await clickToCloseSheet(sheet, sheet.getByTestId('dup-add'));
    await expect(rows).toHaveCount(2);

    sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [PDF]));
    // A click on static text keeps focus on the button, as on a macOS sheet …
    await sheet.locator('#sheet-text').click();
    await expect(sheet.getByTestId('dup-skip')).toBeFocused();
    // … and esc / ↩ work wherever focus is, even on <body> (the main window must never stay blocked).
    await sheet.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(sheet.locator('body')).toBeFocused();
    await closeSheet(sheet, 'Escape');
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged')).toBe(true);
    await expect(rows).toHaveCount(2);
    await mainHasFocus(s.app);

    sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [PDF]));
    await clickToCloseSheet(sheet, sheet.getByTestId('dup-open'));
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

test('⌘/ lists every registry shortcut in a sheet; only the main window opens sheets; ↩ closes it', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const sheet = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'app.shortcuts'));
    await expect(sheet.getByTestId('sheet-root')).toHaveAttribute('data-kind', 'shortcuts');
    for (const c of COMMANDS.filter((x) => x.accelerator || x.key)) {
      await expect(sheet.getByTestId('shortcut-row').filter({ hasText: commandLabel(c, process.platform) }), c.id).toHaveCount(1);
    }
    await expect(sheet.getByTestId('shortcuts-done')).toBeFocused();
    expect(await ring(sheet.getByTestId('shortcuts-done'))).toBe('none');
    expect(await menuItemEnabled(s.app, 'app.shortcuts')).toBe(false);
    // A sheet cannot open another sheet over itself (nor, from Task 10, the settings window): main window only.
    expect(await sheet.evaluate(() => window.learn.ui.showShortcuts())).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
    // A click on a row (static text) leaves ↩ working.
    await sheet.getByTestId('shortcut-row').first().click();
    await closeSheet(sheet, 'Enter');
    await expect.poll(() => menuItemEnabled(s.app, 'app.shortcuts')).toBe(true);
    await mainHasFocus(s.app);
  } finally {
    await s.app.close();
  }
});

/** A CSS colour token as `page` computes it. */
const tokenIn = (page: Page, name: string) =>
  page.evaluate((v) => {
    const p = document.createElement('span');
    document.body.append(p);
    p.style.color = `var(${v})`;
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  }, name);

test('a ⌘/ sheet whose list scrolls (a short window) is a keyboard stop with a name and a ring, between a fixed title and foot with scroll edges; one that fits is no stop', async ({}, testInfo) => {
  // Mac run 39779536146: on the 768-tall runner the sheet's body scrolled but no key could reach it (axe
  // scrollable-region-focusable, serious). A window as short as the minimum makes it scroll here too.
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const open = () => expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'app.shortcuts'));
  try {
    await (await mainWindow(s.app)).evaluate((w) => w.setContentSize(1200, 600));
    let sheet = await open();
    let body = sheet.locator('.d-body');
    await expect.poll(() => body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(body).toHaveAttribute('tabindex', '0');
    await expect(body).toHaveAttribute('role', 'region');
    await expect(body).toHaveAccessibleName('단축키'); // the sheet's title
    await expectNoSeriousA11y(sheet, 'shortcut sheet, scrolling');
    // The keyboard reaches it (before 완료 in the tab order), shows the ring and scrolls it.
    await expect(sheet.getByTestId('shortcuts-done')).toBeFocused();
    await sheet.keyboard.press('Shift+Tab');
    await expect(body).toBeFocused();
    expect(await body.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    expect(await body.evaluate((el) => getComputedStyle(el).outlineColor)).toBe(await tokenIn(sheet, '--focus'));
    // Critique m3: the ring is inside the scroll area, the title and the foot stay put outside it, and each edge
    // draws its hairline only while content is under it.
    expect(await body.evaluate((el) => getComputedStyle(el).outlineOffset)).toBe('-2px');
    await expect(body.locator('#sheet-title')).toHaveCount(0);
    const edges = () =>
      sheet.evaluate(() => ({
        title: getComputedStyle(document.querySelector('.sheet > .d-title')!).borderBottomColor,
        foot: getComputedStyle(document.querySelector('.sheet > .d-foot')!).borderTopColor,
      }));
    const line = await tokenIn(sheet, '--separator-on-surface');
    const none = 'rgba(0, 0, 0, 0)';
    expect(await edges()).toEqual({ title: none, foot: line }); // at the top: content under the foot only
    const titleAt = (await sheet.locator('#sheet-title').boundingBox())!.y;
    await sheet.keyboard.press('PageDown');
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect.poll(edges).toEqual({ title: line, foot: line });
    await sheet.keyboard.press('End');
    await expect.poll(edges).toEqual({ title: line, foot: none }); // at the end: nothing under the foot
    expect((await sheet.locator('#sheet-title').boundingBox())!.y).toBe(titleAt);
    // The last row is whole above the foot's edge once scrolled to the end.
    const [last, bodyBox] = await Promise.all([sheet.getByTestId('shortcut-row').last().boundingBox(), body.boundingBox()]);
    expect(last!.y + last!.height).toBeLessThanOrEqual(bodyBox!.y + bodyBox!.height);
    await closeSheet(sheet, 'Escape');
    await expect.poll(() => menuItemEnabled(s.app, 'app.shortcuts')).toBe(true);
    // A window tall enough for the whole list: the body is no stop, no region.
    await (await mainWindow(s.app)).evaluate((w) => w.setContentSize(1440, 900));
    sheet = await open();
    body = sheet.locator('.d-body');
    expect(await body.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(false);
    await expect(body).not.toHaveAttribute('tabindex');
    await expect(body).not.toHaveAttribute('role');
    expect(await sheet.evaluate(() => [getComputedStyle(document.querySelector('.sheet > .d-title')!).borderBottomColor, getComputedStyle(document.querySelector('.sheet > .d-foot')!).borderTopColor])).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);
    await closeSheet(sheet, 'Escape');
  } finally {
    await s.app.close();
  }
});

test('the window greys only when the ⌘/ sheet is on screen; until then its commands are already refused (T13M-n4)', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    // The next window's page becomes ready 1.5 s late: the sheet is asked for but not on screen yet.
    await s.app.evaluate(({ app }) => {
      app.once('browser-window-created', (_event, win) => {
        const once = win.once.bind(win) as (event: string, listener: (...args: unknown[]) => void) => typeof win;
        (win as unknown as { once: typeof once }).once = (event, listener) =>
          once(event, event === 'ready-to-show' ? (...args) => void setTimeout(() => listener(...args), 1500) : listener);
      });
    });
    const importMenu = s.page.getByTestId('import-menu');
    await expect(importMenu).toBeEnabled();
    const opened = s.app.waitForEvent('window');
    await runMenuCommand(s.app, 'app.shortcuts');
    // Main's menu bar refuses at once (the context says blocked) …
    await expect.poll(() => menuItemEnabled(s.app, 'app.palette')).toBe(false);
    expect(await menuItemEnabled(s.app, 'file.importManaged')).toBe(false);
    // … but nothing in the window is drawn disabled before the sheet appears.
    await expect(importMenu).toBeEnabled();
    await expect(s.page.locator('html')).not.toHaveAttribute('data-window-inactive');
    const sheet = await opened;
    await expect.poll(() => s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('window=sheet') && w.isVisible()))).toBe(true);
    await expect(importMenu).toBeDisabled();
    await closeSheet(sheet, 'Enter');
    await expect(importMenu).toBeEnabled();
    await expect.poll(() => menuItemEnabled(s.app, 'app.palette')).toBe(true);
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
