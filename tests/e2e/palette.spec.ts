// ⌘K command palette and launcher (design-spec 10.5, 6, 2.3; ADR-0005 §5).
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURES, closeSheet, expectWindow, importPaths, launch, mainWindow, menuItemEnabled, openDialogCalls, openItem, runMenuCommand, stubOpenDialog } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const IS_MAC = process.platform === 'darwin';
const dirs = (i: { outputPath(...p: string[]): string }) => [i.outputPath('library'), i.outputPath('userdata')] as const;

/** A computed CSS value of a token, read off a probe element (`prop` set to `var(name)`). */
const tokenValue = (page: Page, prop: 'color' | 'backgroundColor', name: string) =>
  page.evaluate(
    ([p, v]) => {
      const probe = document.createElement('span');
      document.body.append(probe);
      probe.style[p as 'color'] = `var(${v})`;
      const out = getComputedStyle(probe)[p as 'color'];
      probe.remove();
      return out;
    },
    [prop, name] as const,
  );

/** Another window takes the key (as a second app would): the main window is neither key nor main. */
async function deactivate(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const w = new BrowserWindow({ width: 300, height: 200, show: true });
    void w.loadURL('about:blank');
    w.focus();
    (globalThis as { __probeWindow?: unknown }).__probeWindow = w;
  });
}

test('the launcher opens the palette; 초성 finds 파일 가져오기…; ↩ runs it exactly once', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await stubOpenDialog(app, []);
    // M3 finds commands only, and the launcher says so, like the palette's own field (critic T9-m1).
    await expect(page.getByTestId('launcher')).toContainText('명령 검색');
    await expect(page.getByTestId('launcher')).toHaveAccessibleName(`명령 검색 (${IS_MAC ? '⌘K' : 'Ctrl+K'})`);
    await page.getByTestId('launcher').click();
    await expect(page.getByTestId('palette')).toBeVisible();
    await expect(page.getByTestId('palette-input')).toHaveAttribute('placeholder', '명령 검색');
    await expect(page.getByTestId('palette-input')).toBeFocused();
    await expect(page.getByTestId('palette-esc')).toHaveText(IS_MAC ? 'esc' : 'Esc'); // input-row keycap (palette.html, C-7), platform spelling
    // The scrim lies over the 52 px drag strips; it must not drag the window (R-23).
    expect(await page.locator('.palette-scrim').evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region') || getComputedStyle(el).getPropertyValue('app-region'))).toBe('no-drag');
    // What can run now, in registry order, the toggle by what it will do (사이드바 가리기 while shown; Task 8 m2).
    await expect(page.getByTestId('palette-item')).toHaveText([/파일 가져오기…/, /외부 파일 연결…/, /사이드바 가리기/, /단축키 도움말/, /설정…/, /글자 크게/, /글자 작게/]);
    // ㄱㅈㅇ: only 가져오기 (ㄱㅈ alone also finds 글자 크게 / 작게 and 설정…'s 글자 크기, Task 10).
    await page.getByTestId('palette-input').fill('ㄱㅈㅇ');
    const first = page.getByTestId('palette-item').first();
    await expect(first).toHaveAttribute('data-command-id', 'file.importManaged');
    await expect(first.locator('mark')).toHaveText('가져오');
    await expect(first).toHaveAttribute('data-focused', 'true'); // the list cursor is on the first result
    // The cursor row's keycaps darken the accent (critic T9-n1); ↑ ↓ in the footer are alternatives, set apart (T9-n2).
    expect(await first.locator('.kbd').first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await tokenValue(page, 'backgroundColor', '--bg-kbd-on-accent'));
    expect(await page.locator('.p-foot .kbd-group').first().evaluate((el) => [el.classList.contains('alternatives'), getComputedStyle(el).columnGap])).toEqual([true, '6px']);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect.poll(() => openDialogCalls(app)).toBe(1);
    await page.waitForTimeout(300);
    expect(await openDialogCalls(app)).toBe(1);
  } finally {
    await app.close();
  }
});

/** The id of the row under the palette's list cursor, or null. */
const cursorRow = (page: Page) => page.evaluate(() => document.querySelector('[data-testid="palette-item"][data-focused]')?.getAttribute('data-command-id') ?? null);

test('the cursor is on a row whenever the list has rows: on open and after every edit (T9-M1)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const input = page.getByTestId('palette-input');
  /** The cursor row, and the input names it as its active descendant (screen readers follow the cursor). */
  const expectCursor = async (id: string) => {
    await expect.poll(() => cursorRow(page)).toBe(id);
    const row = page.locator(`[data-testid="palette-item"][data-command-id="${id}"]`);
    await expect(input).toHaveAttribute('aria-activedescendant', (await row.getAttribute('id'))!);
    await expect(row).toHaveAttribute('aria-selected', 'true');
  };
  const PASTE = IS_MAC ? 'Meta+V' : 'Control+V';
  const UNDO = IS_MAC ? 'Meta+Z' : 'Control+Z';
  try {
    await stubOpenDialog(app, []);
    // On open, with an empty query: the first row; ↓ and ↑ move it; ↩ runs the cursor row, once.
    await runMenuCommand(app, 'app.palette');
    await expect(input).toBeFocused();
    await expectCursor('file.importManaged');
    await page.keyboard.press('ArrowDown');
    await expectCursor('file.importLinked');
    await page.keyboard.press('ArrowUp');
    await expectCursor('file.importManaged');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect.poll(() => openDialogCalls(app)).toBe(1);
    await page.waitForTimeout(300);
    expect(await openDialogCalls(app)).toBe(1);

    // Every edit puts the cursor back on the first row: typing, Backspace, a paste, undo.
    await runMenuCommand(app, 'app.palette');
    await expect(input).toBeFocused();
    await page.keyboard.type('ㅅㅇ');
    await expectCursor('view.toggleSidebar');
    await page.keyboard.press('Backspace');
    await expect(input).toHaveValue('ㅅ');
    await expect(page.getByTestId('palette-item')).toHaveCount(4); // 사이드바, 설정…, 가져오기 (사본), 글자 작게 (축소)
    await page.keyboard.press('ArrowDown');
    await expectCursor('app.settings');
    await page.keyboard.press('Backspace');
    await expect(input).toHaveValue('');
    await expectCursor('file.importManaged');
    await page.keyboard.press('ArrowDown');
    await app.evaluate(({ clipboard }) => clipboard.writeText('단축'));
    await page.keyboard.press(PASTE);
    await expect(input).toHaveValue('단축');
    await expectCursor('app.shortcuts');
    await page.keyboard.press(UNDO);
    await expect(input).toHaveValue('');
    await expectCursor('file.importManaged');
    await page.keyboard.insertText('연결');
    await expectCursor('file.importLinked');
    await stubOpenDialog(app, []);
    await page.keyboard.press('Enter');
    await expect.poll(() => openDialogCalls(app)).toBe(1);
    await page.waitForTimeout(300);
    expect(await openDialogCalls(app)).toBe(1);
  } finally {
    await app.close();
  }
});

test('ARIA: a combobox over a listbox, unique option ids, nothing to point at with no rows, a polite result count, Tab stays inside', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const input = page.getByTestId('palette-input');
  const status = page.getByTestId('palette-status');
  try {
    await runMenuCommand(app, 'app.palette');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('role', 'combobox');
    await expect(input).toHaveAttribute('aria-autocomplete', 'list');
    await expect(input).toHaveAttribute('aria-expanded', 'true');
    const listbox = page.getByRole('listbox', { name: '명령' });
    await expect(listbox).toHaveCount(1);
    await expect(input).toHaveAttribute('aria-controls', (await listbox.getAttribute('id'))!);
    const ids = await listbox.getByRole('option').evaluateAll((els) => els.map((e) => e.id));
    expect(ids.length).toBe(7);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    await expect(listbox.getByRole('option', { selected: true })).toHaveCount(1);
    // The result count is a polite status, and a cursor move does not change it.
    await expect(status).toHaveAttribute('role', 'status');
    await expect(status).toHaveText('명령 7개');
    await page.keyboard.press('ArrowDown');
    await expect(status).toHaveText('명령 7개');
    await input.fill('ㄱㅈㅇ');
    await expect(status).toHaveText('명령 1개');
    // No rows: collapsed, nothing controlled or active, the status reads the notice's title.
    await input.fill('효소 억제제');
    await expect(input).toHaveAttribute('aria-expanded', 'false');
    await expect(input).not.toHaveAttribute('aria-activedescendant', /.*/);
    await expect(input).not.toHaveAttribute('aria-controls', /.*/);
    await expect(page.getByRole('listbox', { name: '명령' })).toHaveCount(0);
    await expect(status).toHaveText('‘효소 억제제’에 맞는 명령이 없습니다');
    // Tab and ⇧Tab keep the focus inside the palette (the options are not tab stops; RAC's FocusScope contains it).
    await input.fill('');
    for (const key of ['Tab', 'Tab', 'Shift+Tab']) {
      await page.keyboard.press(key);
      expect(await page.evaluate(() => document.activeElement?.closest('[data-testid="palette"]') !== null)).toBe(true);
    }
    await expect(input).toBeFocused();
  } finally {
    await app.close();
  }
});

test('the pointer: hovering a row moves the cursor there, a click runs it once', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await stubOpenDialog(app, []);
    await runMenuCommand(app, 'app.palette');
    const linked = page.locator('[data-testid="palette-item"][data-command-id="file.importLinked"]');
    await linked.hover();
    await expect.poll(() => cursorRow(page)).toBe('file.importLinked');
    await expect(page.getByTestId('palette-input')).toBeFocused(); // the field keeps the focus
    await linked.click();
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect.poll(() => openDialogCalls(app)).toBe(1);
    await page.waitForTimeout(300);
    expect(await openDialogCalls(app)).toBe(1);
  } finally {
    await app.close();
  }
});

test('the list follows the registry while the palette is open: a drop that starts an import leaves 설정… under the busy notice; ↩ opens it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const input = page.getByTestId('palette-input');
  const ids = () => page.getByTestId('palette-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-command-id')));
  const busy = page.getByTestId('palette-busy');
  /** A real file dropped on the window (its path from a file input, as from Finder): a duplicate, so the import waits in the duplicate sheet and holds the window. */
  const dropDuplicate = () =>
    expectWindow(app, 'sheet', () =>
      page.evaluate(() => {
        const dt = new DataTransfer();
        dt.items.add((document.getElementById('drop-source') as HTMLInputElement).files![0]!);
        document.body.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      }),
    );
  try {
    await importPaths(page, [PDF]);
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await page.evaluate(() => {
      const picker = document.createElement('input');
      picker.type = 'file';
      picker.id = 'drop-source';
      picker.hidden = true;
      document.body.append(picker);
    });
    await page.locator('#drop-source').setInputFiles(PDF);
    await runMenuCommand(app, 'app.palette');
    await expect(page.locator('[data-testid="palette-item"][data-command-id="file.importManaged"]')).toHaveCount(1);
    await expect(busy).toHaveCount(0);
    let sheet = await dropDuplicate();
    // The window is held: only the main-owned 설정… can run, listed under a header that says why the rest is missing
    // and that it comes back when the work ends (not "nothing can run" above a row that can).
    await expect(page.getByTestId('palette')).toBeVisible();
    await expect.poll(ids).toEqual(['app.settings']);
    await expect(busy.locator('.pe-title')).toHaveText('진행 중인 작업이 있습니다');
    await expect(busy.locator('.pe-text')).toHaveText('작업이 끝나면 다른\u00a0명령도 쓸 수 있습니다.');
    await expect(page.getByRole('listbox').getByTestId('palette-busy')).toHaveCount(0); // a header, not an option
    await expect(page.getByTestId('palette-status')).toHaveText('진행 중인 작업이 있습니다. 실행할 수 있는 명령 1개');
    await expect.poll(() => cursorRow(page)).toBe('app.settings');
    // Nothing listed: the notice alone (not "no match"): nothing can run until the work ends.
    await input.fill('효소 억제제');
    await expect(page.getByTestId('palette-item')).toHaveCount(0);
    await expect(busy.locator('.pe-title')).toHaveText('지금은 명령을 실행할 수 없습니다');
    await expect(busy.locator('.pe-text')).toHaveText('진행 중인 작업이 있습니다. 작업이 끝나면 다시 쓸 수 있습니다.');
    await expect(page.getByTestId('palette-empty')).toHaveCount(0);
    await expect(page.getByTestId('palette-status')).toHaveText('지금은 명령을 실행할 수 없습니다');
    await input.fill('');
    await closeSheet(sheet, 'Escape'); // 건너뛰기: the import ends
    await expect(page.locator('[data-testid="palette-item"][data-command-id="file.importManaged"]')).toHaveCount(1);
    await expect(busy).toHaveCount(0);
    await expect.poll(() => cursorRow(page)).toBe('file.importManaged');
    // Held again: ↩ on 설정… opens the settings window (main-owned, it runs while the import waits).
    sheet = await dropDuplicate();
    await expect.poll(ids).toEqual(['app.settings']);
    const settings = await expectWindow(app, 'settings', () => page.keyboard.press('Enter'));
    await expect(settings.getByTestId('settings-root')).toBeVisible();
    await expect(page.getByTestId('palette')).toBeHidden();
    await closeSheet(sheet, 'Escape');
  } finally {
    await app.close();
  }
});

test('keywords, no results, esc, and a menu command while open', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await runMenuCommand(app, 'app.palette');
    const input = page.getByTestId('palette-input');
    await input.fill('import');
    await expect(page.getByTestId('palette-item').first()).toHaveAttribute('data-command-id', 'file.importManaged');
    await input.fill('ㅅㅇㄷㅂ');
    await expect(page.getByTestId('palette-item').first()).toHaveAttribute('data-command-id', 'view.toggleSidebar');
    await input.fill('효소 억제제');
    await expect(page.getByTestId('palette-empty')).toContainText('‘효소 억제제’에 맞는 명령이 없습니다');
    await expect(page.getByTestId('palette-item')).toHaveCount(0);
    await expect(page.locator('.p-foot .row')).toHaveText([/닫기/]); // nothing to move to or run: only esc is hinted
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toBeHidden();
    // Opened again: the query starts empty. ⌘K while open keeps it open and selects the field.
    await runMenuCommand(app, 'app.palette');
    await expect(input).toHaveValue('');
    await input.fill('사이드');
    await runMenuCommand(app, 'app.palette');
    await expect(page.getByTestId('palette')).toBeVisible();
    expect(await input.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd])).toEqual([0, 3]);
    await runMenuCommand(app, 'view.toggleSidebar'); // closes the palette, then runs
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
  } finally {
    await app.close();
  }
});

test('사이드바 가리기 from the palette opened by the sidebar launcher: the focus goes on, never to <body>', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await page.getByTestId('launcher').click();
    await page.getByTestId('palette-input').fill('ㅅㅇㄷㅂ');
    await expect(page.getByTestId('palette-item').first()).toHaveAttribute('data-command-id', 'view.toggleSidebar');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    // The opener (the sidebar's launcher) is gone: the sidebar's focus rescue hands a keyboard user to the copy that
    // takes over, the toolbar's launcher (useSidebar keepFocusAcross), as ⌃⌘S from the launcher itself would.
    const notBody = () => page.evaluate(() => document.activeElement !== null && document.activeElement !== document.body);
    await expect(page.getByTestId('toolbar').getByTestId('launcher')).toBeFocused();
    expect(await notBody()).toBe(true);
    // Esc gives the focus back to the opener (the toolbar's launcher, pressed with the keyboard).
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect(page.getByTestId('toolbar').getByTestId('launcher')).toBeFocused();
    // And back: 사이드바 보기 from the toolbar's launcher hands the focus to the sidebar's.
    await page.keyboard.press('Enter');
    await page.getByTestId('palette-input').fill('ㅅㅇㄷㅂ');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
    await expect(page.getByTestId('sidebar-top').locator('..').getByTestId('launcher')).toBeFocused();
    expect(await notBody()).toBe(true);
    // A row picked during the entry animation (↩ at once): the opener still gets the focus before the command runs.
    await page.getByTestId('nav-library').focus();
    await page.keyboard.press('ArrowDown');
    await runMenuCommand(app, 'app.palette');
    await expect(page.getByTestId('palette-input')).toBeFocused();
    await page.keyboard.type('ㅅ');
    await expect(page.locator('[data-testid="palette-item"][data-focused]')).toHaveAttribute('data-command-id', 'view.toggleSidebar');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    await expect(page.getByTestId('toolbar-sidebar-toggle')).toBeFocused(); // a sidebar row's copy is the toolbar toggle
    expect(await notBody()).toBe(true);
  } finally {
    await app.close();
  }
});

test('opening the palette closes an open tooltip, and none opens while it is up', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const tooltip = page.getByRole('tooltip');
  try {
    await page.getByTestId('sidebar-toggle').hover();
    await expect(tooltip).toHaveText(/사이드바 가리기/); // after the 600 ms hover delay
    await runMenuCommand(app, 'app.palette'); // ⌘K from the menu bar
    await expect(page.getByTestId('palette')).toBeVisible();
    await expect(tooltip).toHaveCount(0);
    expect(await page.locator('html').getAttribute('data-tooltip-block')).toContain('modal');
    await page.waitForTimeout(900); // the pointer still rests on the toggle under the scrim
    await expect(tooltip).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).not.toHaveAttribute('data-tooltip-block', /modal/);
  } finally {
    await app.close();
  }
});

test('folded sidebar: the launcher is 232 × 28 at the toolbar end, centred in the 52 px bar', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    // Sidebar y 52–80, x 8–231 like the row fills (design-spec 2.3); the glyph on the row-icon column (x 24).
    const inSidebar = (await page.getByTestId('launcher').boundingBox())!;
    expect(inSidebar).toMatchObject({ x: 8, y: 52, width: 223, height: 28 });
    const glyph = (await page.getByTestId('launcher').locator('.icon').boundingBox())!;
    expect(glyph.x).toBe(24);
    const row = (await page.getByTestId('nav-library').boundingBox())!;
    expect([row.x, row.x + row.width]).toEqual([inSidebar.x, inSidebar.x + inSidebar.width]);
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('launcher')).toHaveCount(1);
    const b = (await page.getByTestId('launcher').boundingBox())!;
    const bar = (await page.getByTestId('toolbar').boundingBox())!;
    const padRight = await page.getByTestId('toolbar').evaluate((el) => parseFloat(getComputedStyle(el).paddingRight));
    expect(b.width).toBe(232);
    expect(b.height).toBe(28);
    expect(Math.abs(b.y + b.height / 2 - 26)).toBeLessThanOrEqual(0.5); // 52 px bar incl. its 1 px hairline
    expect(Math.round(b.x + b.width)).toBe(Math.round(bar.x + bar.width - padRight));
  } finally {
    await app.close();
  }
});

test('the reader lists reader commands and not library ones; its folded toolbar has the launcher too', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    await openItem(page, 'sample');
    await runMenuCommand(app, 'app.palette');
    const ids = await page.getByTestId('palette-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-command-id')));
    expect(ids).toContain('nav.back');
    expect(ids).not.toContain('file.importManaged');
    expect(ids).not.toContain('app.palette'); // the palette does not list itself
    await page.keyboard.press('Escape');
    await runMenuCommand(app, 'view.toggleSidebar');
    await expect(page.getByTestId('toolbar').getByTestId('launcher')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('while a sheet holds the window the launcher is disabled with the reason', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const launcher = page.getByTestId('launcher');
    await expect(launcher).not.toHaveAttribute('aria-disabled', 'true');
    const sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'app.shortcuts'));
    await expect(launcher).toHaveAttribute('aria-disabled', 'true');
    await expect(launcher).toHaveAccessibleDescription('진행 중인 작업이 끝나면 쓸 수 있습니다');
    await launcher.click({ force: true });
    await expect(page.getByTestId('palette')).toHaveCount(0);
    await closeSheet(sheet, 'Escape');
    await expect.poll(() => menuItemEnabled(app, 'app.palette')).toBe(true);
    await expect(launcher).not.toHaveAttribute('aria-disabled', 'true');
  } finally {
    await app.close();
  }
});

test('the palette stays open in an inactive window; its cursor row turns neutral and the launcher recedes', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const cursorRow = page.locator('[data-testid="palette-item"][data-focused]');
  try {
    await runMenuCommand(app, 'app.palette');
    await page.getByTestId('palette-input').fill('ㄱㅈㅇ');
    await expect(cursorRow).toHaveAttribute('data-command-id', 'file.importManaged');
    expect(await cursorRow.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await tokenValue(page, 'backgroundColor', '--accent'));
    await deactivate(app);
    await expect(page.locator('html')).toHaveAttribute('data-window-not-main', '');
    await expect(page.getByTestId('palette')).toBeVisible();
    // Neutral selection, primary text, no accent fill (design-spec 3.1).
    await expect.poll(() => cursorRow.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await tokenValue(page, 'backgroundColor', '--fill-selected'));
    expect(await cursorRow.evaluate((el) => getComputedStyle(el).color)).toBe(await tokenValue(page, 'color', '--text-primary'));
    // The sidebar launcher's text and glyph dim like the rest of the sidebar chrome (design-spec 2.1).
    const launcher = page.getByTestId('launcher');
    await expect.poll(() => launcher.locator('.placeholder').evaluate((el) => getComputedStyle(el).color)).toBe(await tokenValue(page, 'color', '--text-inactive'));
    expect(await launcher.locator('.icon').evaluate((el) => getComputedStyle(el).opacity)).toBe('0.3');
    await app.evaluate(() => (globalThis as { __probeWindow?: { close(): void } }).__probeWindow?.close());
    await (await mainWindow(app)).evaluate((w) => w.focus());
    await expect(page.locator('html')).not.toHaveAttribute('data-window-inactive', '');
    await expect(page.getByTestId('palette')).toBeVisible();
    await expect.poll(() => cursorRow.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await tokenValue(page, 'backgroundColor', '--accent'));
  } finally {
    await app.close();
  }
});
