// IME: keys that belong to a Korean composition must not act (quality spec M3 `ime`, ADR-0004 risk: Enter and the arrows).
// CDP Input.imeSetComposition starts a real composition: Chromium then marks keydown events isComposing (R-13 spike,
// Task 9: ↓ 40, ↩ 13 and esc 27 all arrived with isComposing true on Linux/Xvfb).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FIXTURES, importPaths, launch, openDialogCalls, runMenuCommand, stubOpenDialog } from './helpers';

test('palette: ↓, Enter and Escape during a composition neither move, run nor close; after commit ↩ runs once', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await stubOpenDialog(app, []);
    await runMenuCommand(app, 'app.palette');
    const input = page.getByTestId('palette-input');
    await expect(input).toBeFocused();
    const cdp = await page.context().newCDPSession(page);
    /** The palette's list cursor (RAC virtual focus), or null when no row has it. */
    const cursor = () => page.evaluate(() => document.querySelector('[data-testid="palette-item"][data-focused]')?.getAttribute('data-command-id') ?? null);
    // M-1 (ADR-0004 risk): ↓ that the IME owns must not move the list cursor. ㄱ alone matches three commands.
    await cdp.send('Input.imeSetComposition', { text: 'ㄱ', selectionStart: 1, selectionEnd: 1 });
    await expect.poll(() => page.getByTestId('palette-item').count()).toBeGreaterThan(1);
    await expect.poll(cursor).not.toBeNull();
    const before = await cursor();
    await page.keyboard.press('ArrowDown');
    expect(await cursor()).toBe(before);
    await cdp.send('Input.imeSetComposition', { text: 'ㄱㅈㅇ', selectionStart: 3, selectionEnd: 3 });
    await expect(page.getByTestId('palette-item').first()).toHaveAttribute('data-command-id', 'file.importManaged');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toBeVisible();
    expect(await openDialogCalls(app)).toBe(0);
    await cdp.send('Input.insertText', { text: 'ㄱㅈㅇ' }); // commits the composition
    await expect(input).toHaveValue('ㄱㅈㅇ');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect.poll(() => openDialogCalls(app)).toBe(1);
  } finally {
    await app.close();
  }
});

test('palette: keyCode 229 keys (macOS IME) are ignored even without isComposing: ↓ does not move, ↩ does not run, esc does not close', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await stubOpenDialog(app, []);
    await runMenuCommand(app, 'app.palette');
    await page.getByTestId('palette-input').fill('ㄱ');
    // The cursor is on a row first (글자 크게), so a 229 ↩ that got through would run it: the text size would change.
    const cursor = page.locator('[data-testid="palette-item"][data-focused]');
    const textSize = () => page.evaluate(() => document.documentElement.dataset['fontSize']);
    await expect(cursor).toHaveAttribute('data-command-id', 'view.textBigger');
    expect(await page.getByTestId('palette-item').count()).toBeGreaterThan(1);
    expect(await textSize()).toBe('13');
    const cdp = await page.context().newCDPSession(page);
    for (const key of ['ArrowDown', 'Enter', 'Escape'] as const) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    }
    await page.waitForTimeout(300);
    await expect(page.getByTestId('palette')).toBeVisible();
    await expect(cursor).toHaveAttribute('data-command-id', 'view.textBigger');
    expect(await textSize()).toBe('13');
    expect(await openDialogCalls(app)).toBe(0);
    // The same keys without 229 do act (the control): ↓ moves the cursor.
    await page.keyboard.press('ArrowDown');
    await expect(cursor).not.toHaveAttribute('data-command-id', 'view.textBigger');
  } finally {
    await app.close();
  }
});

test('palette: the 자료 group follows the composition; ↩ while composing opens nothing, after commit it opens the item', async ({}, testInfo) => {
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const dir = testInfo.outputPath('src');
    fs.mkdirSync(dir, { recursive: true });
    const pdf = path.join(dir, '세포 신호.pdf');
    fs.copyFileSync(path.join(FIXTURES, 'sample.pdf'), pdf);
    const [item] = await importPaths(page, [pdf]);
    await runMenuCommand(app, 'app.palette');
    const input = page.getByTestId('palette-input');
    await expect(input).toBeFocused();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: 'ㅅㅎ', selectionStart: 2, selectionEnd: 2 });
    const result = page.locator(`[data-testid="palette-result"][data-item-id="${item!.id}"]`);
    await expect(result).toHaveAttribute('data-focused', 'true'); // filtered while still composing (spec §4.1)
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeVisible();
    await expect(page.getByTestId('viewer-title')).toHaveCount(0);
    await cdp.send('Input.insertText', { text: 'ㅅㅎ' }); // commits the composition
    await expect(input).toHaveValue('ㅅㅎ');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('viewer-title')).toHaveText('세포 신호');
  } finally {
    await app.close();
  }
});
