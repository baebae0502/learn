// ⌘K command palette and launcher (design-spec 10.5, 6, 2.3; ADR-0005 §5).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURES, closeSheet, drag, dropSource, expectWindow, importPaths, launch, mainWindow, menuItemEnabled, openDialogCalls, openItem, runMenuCommand, stubOpenDialog } from './helpers';

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

/** Two frames: whatever a handled event would have rendered is on screen by then. */
const twoFrames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

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
    // It finds items and commands, and the launcher says so, like the palette's own field (design-spec 10.5).
    await expect(page.getByTestId('launcher')).toContainText('검색 및 명령');
    // Named by its visible text (WCAG 2.5.3, axe); the shortcut is aria-keyshortcuts (Task 12).
    await expect(page.getByTestId('launcher')).toHaveAccessibleName('검색 및 명령');
    await expect(page.getByTestId('launcher')).toHaveAttribute('aria-keyshortcuts', IS_MAC ? 'Meta+K' : 'Control+K');
    await page.getByTestId('launcher').click();
    await expect(page.getByTestId('palette')).toBeVisible();
    await expect(page.getByTestId('palette-input')).toHaveAttribute('placeholder', '검색 및 명령');
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
    // Runs picked here go to palette.recent; every expectation below already starts with the one run first (파일 가져오기…).
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
    const listbox = page.getByRole('listbox', { name: '검색 결과' });
    await expect(listbox).toHaveCount(1);
    await expect(input).toHaveAttribute('aria-controls', (await listbox.getAttribute('id'))!);
    const ids = await listbox.getByRole('option').evaluateAll((els) => els.map((e) => e.id));
    expect(ids.length).toBe(7);
    await expect(listbox.getByRole('group')).toHaveText([/^명령/]); // one group with an empty query, named by its header
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
    await expect(page.getByRole('listbox', { name: '검색 결과' })).toHaveCount(0);
    await expect(status).toHaveText('‘효소 억제제’와 일치하는 자료·명령이 없습니다');
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

test('a file drag with the palette open closes it, as a menu command would, and shows the drop overlay; the drop imports', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const palette = page.getByTestId('palette');
  const overlay = page.getByTestId('drop-overlay');
  /** A drag event at the middle of the window, on whatever element is there (the palette's scrim, then the overlay). */
  const fire = (type: 'dragenter' | 'dragover' | 'dragleave' | 'drop', carry: 'text' | 'source') => drag(page, type, carry, { at: 'centre' });
  try {
    await dropSource(page, [PDF]);
    await runMenuCommand(app, 'app.palette');
    await expect(palette).toBeVisible();
    // Text dragged in from another app is no drop for the library: the palette stays.
    await fire('dragenter', 'text');
    await fire('dragover', 'text');
    await twoFrames(page);
    await expect(palette).toBeVisible();
    await expect(overlay).toHaveCount(0);
    // Files are a new intent: the palette closes first, then the overlay comes up.
    await fire('dragenter', 'source');
    await expect(palette).toBeHidden();
    await expect(overlay).toHaveAttribute('data-mode', 'copy');
    await expect(page.getByTestId('drop-summary')).toHaveText('파일 1개(PDF 1)');
    // The scrim that took the first dragenter has left the document (its dragleave never reaches the window): the drag
    // goes on over the overlay, which stays up, and leaving the window from there takes the overlay down.
    await fire('dragenter', 'source');
    await fire('dragover', 'source');
    await twoFrames(page);
    await expect(overlay).toBeVisible();
    await fire('dragleave', 'source');
    await expect(overlay).toHaveCount(0);
    await fire('dragenter', 'source');
    await expect(overlay).toBeVisible();
    await fire('drop', 'source');
    await expect(overlay).toHaveCount(0);
    await expect(page.getByTestId('import-done')).toHaveText(/자료 1개를 가져왔습니다/);
    await expect(page.getByTestId('item-row')).toHaveCount(1);
    await expect(palette).toHaveCount(0);
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
    await expect(page.getByTestId('palette-empty')).toContainText('‘효소 억제제’와 일치하는 자료·명령이 없습니다');
    await expect(page.getByTestId('palette-item')).toHaveCount(0);
    await expect(page.getByTestId('palette-search-library')).toHaveCount(0); // an empty library has no quick search to hand the query to
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
    // A hover tooltip needs the key window (none shows over an inactive one): on the Mac runner the window launched by
    // Playwright may become key only after the first hover (Mac run t14-diag2). Make it key first.
    await (await mainWindow(app)).evaluate((w) => w.focus());
    await expect(page.locator('html')).not.toHaveAttribute('data-window-inactive', '');
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

test('item results: 자료 above the commands, five at most; title matches by position, then other fields, then the last opened; ↩ opens one', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const dir = testInfo.outputPath('src');
    fs.mkdirSync(dir, { recursive: true });
    const real = path.join(dir, '신호 증폭.pdf'); // the one opened at the end: a real PDF
    fs.copyFileSync(PDF, real);
    const fake = (title: string) => {
      const p = path.join(dir, `${title}.pdf`);
      fs.writeFileSync(p, `%PDF-1.4\n% ${title}\n%%EOF\n`);
      return p;
    };
    // One import each, a few ms apart: the order they were added breaks the last tie (createdAt).
    const ids: Record<string, string> = {};
    for (const p of [fake('세포 신호 전달'), real, fake('단백질 접힘'), fake('전달 신호 모음'), fake('강의 · 신호'), fake('효소 반응'), fake('열역학')]) {
      const [item] = await importPaths(page, [p]);
      ids[item!.title] = item!.id;
      await page.waitForTimeout(5);
    }
    // Opened (openedAt) before the metadata writes: their libraryChanged brings the list with it (reader.open sends none).
    await page.evaluate((itemId) => window.learn.reader.open({ itemId }), ids['전달 신호 모음']!);
    await page.evaluate(async (i) => {
      await window.learn.library.updateMetadata({ itemId: i.a, metadata: { creators: [{ name: '김하늘', role: 'author' }], date: '2024-03' } });
      await window.learn.library.updateMetadata({ itemId: i.b, metadata: { creators: [], publisher: '신호 출판' } });
      await window.learn.library.updateMetadata({ itemId: i.c, metadata: { creators: [], extra: '신호 경로를 그린 메모' } });
    }, { a: ids['신호 증폭']!, b: ids['단백질 접힘']!, c: ids['효소 반응']! });
    await runMenuCommand(app, 'app.palette');
    await page.getByTestId('palette-input').fill('신호');
    const results = page.getByTestId('palette-result');
    // Title matches by position (0, 3, 3, 5; the tie at 3 to the one opened), then other fields: the memo (long field,
    // read once the query is there) on the newer item before the publisher; the sixth match is left out.
    await expect
      .poll(() => results.evaluateAll((els) => els.map((e) => e.getAttribute('data-item-id'))))
      .toEqual([ids['신호 증폭'], ids['전달 신호 모음'], ids['세포 신호 전달'], ids['강의 · 신호'], ids['효소 반응']]);
    await expect(page.locator('.palette .p-group')).toHaveText(['자료', '명령']);
    await expect(results.first()).toHaveAttribute('data-focused', 'true');
    await expect(results.first().locator('mark')).toHaveText('신호');
    await expect(results.first().locator('.p-sub')).toHaveText('김하늘 · 2024');
    await expect(results.nth(3).locator('.p-sub')).toHaveText('PDF'); // no author, no year: the kind
    await expect(results.nth(4).locator('mark')).toHaveCount(0); // matched outside the title
    await expect(results.first().locator('.p-meta .kbd-group')).toHaveCount(1); // ↩ on the cursor row only
    await expect(results.nth(1).locator('.p-meta .kbd-group')).toHaveCount(0);
    await expect(page.getByTestId('palette-search-library')).toHaveText(/라이브러리에서 ‘신호’ 검색/);
    await expect(page.getByTestId('palette-search-library').locator('mark')).toHaveText('신호'); // the query is marked, the text reads the same
    await expect(page.locator('.p-foot .row').nth(1)).toHaveText(/열기/); // ↩ opens the item under the cursor
    // The search row is not a command: no command matches 신호, so the status counts the five items alone.
    await expect(page.getByTestId('palette-status')).toHaveText('자료 5개');
    const input = page.getByTestId('palette-input');
    const searchRow = page.getByTestId('palette-search-library');
    for (let i = 1; i < 5; i++) {
      await page.keyboard.press('ArrowDown');
      await expect(results.nth(i)).toHaveAttribute('data-focused', 'true');
    }
    // ↓ from the last item crosses into the group below (here the search row alone): the cursor does not stop at 자료.
    await page.keyboard.press('ArrowDown');
    await expect(searchRow).toHaveAttribute('data-focused', 'true');
    await expect(results.nth(4)).not.toHaveAttribute('data-focused', 'true');
    await expect(input).toHaveAttribute('aria-activedescendant', (await searchRow.getAttribute('id'))!);
    await page.keyboard.press('ArrowUp');
    await expect(results.nth(4)).toHaveAttribute('data-focused', 'true');
    await expect(input).toHaveAttribute('aria-activedescendant', (await results.nth(4).getAttribute('id'))!);
    for (let i = 3; i >= 0; i--) await page.keyboard.press('ArrowUp');
    await expect(results.first()).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect(page.getByTestId('viewer-title')).toHaveText('신호 증폭');
  } finally {
    await app.close();
  }
});

test('a long author list ends in an ellipsis inside 240 px and the title keeps its width', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const dir = testInfo.outputPath('src');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'a.pdf');
    fs.writeFileSync(file, '%PDF-1.4\n% a\n%%EOF\n');
    const [item] = await importPaths(page, [file]);
    const names = ['김하늘', '박서준', '이도윤', '최민서', '정우진', '한지민', '오세훈', '윤아름', '장민호', '서지우'];
    await page.evaluate(
      (i) => window.learn.library.updateMetadata({ itemId: i.id, title: '신호 전달 경로의 정량 모델과 그 응용', metadata: { creators: i.names.map((name) => ({ name, role: 'author' as const })), date: '2024' } }),
      { id: item!.id, names },
    );
    await runMenuCommand(app, 'app.palette');
    const input = page.getByTestId('palette-input');
    const title = page.getByTestId('palette-result').first().locator('.p-title');
    await input.fill('신호');
    await expect(page.getByTestId('palette-result')).toHaveCount(1);
    const sub = page.getByTestId('palette-result').first().locator('.p-sub');
    await expect(sub).toContainText('김하늘');
    // The long list gave way first: it is cut at 240 px and the title shows whole.
    await expect.poll(() => sub.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await sub.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(240);
    expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  } finally {
    await app.close();
  }
});

test('↓ and ↑ cross from 자료 into 명령 and back; ↩ on a command row runs the command and opens no item', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const dir = testInfo.outputPath('src');
    fs.mkdirSync(dir, { recursive: true });
    const fake = (title: string) => {
      const p = path.join(dir, `${title}.pdf`);
      fs.writeFileSync(p, `%PDF-1.4\n% ${title}\n%%EOF\n`);
      return p;
    };
    await importPaths(page, [fake('글자 크게 연습'), fake('글자 크게 노트')]);
    await runMenuCommand(app, 'app.palette');
    const input = page.getByTestId('palette-input');
    await input.fill('글자 크게');
    const results = page.getByTestId('palette-result');
    const commandRows = page.getByTestId('palette-item');
    await expect(results).toHaveCount(2);
    await expect(commandRows.first()).toHaveAttribute('data-command-id', 'view.textBigger');
    const textSize = () => page.evaluate(() => document.documentElement.dataset['fontSize']);
    const before = await textSize();
    await expect(results.first()).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(results.nth(1)).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('ArrowDown'); // the boundary: the next row is the first command, not a stop on the last item
    await expect(commandRows.first()).toHaveAttribute('data-focused', 'true');
    await expect(results.nth(1)).not.toHaveAttribute('data-focused', 'true');
    await expect(input).toHaveAttribute('aria-activedescendant', (await commandRows.first().getAttribute('id'))!);
    await page.keyboard.press('ArrowUp');
    await expect(results.nth(1)).toHaveAttribute('data-focused', 'true');
    await expect(input).toHaveAttribute('aria-activedescendant', (await results.nth(1).getAttribute('id'))!);
    await page.keyboard.press('ArrowDown');
    await expect(commandRows.first()).toHaveAttribute('data-focused', 'true');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect.poll(textSize).not.toBe(before); // the command ran
    await expect(page.getByTestId('viewer-title')).toHaveCount(0); // and no item was opened
  } finally {
    await app.close();
  }
});

test('라이브러리에서 ‘…’ 검색 ⌘F: none in an empty library; it stays when nothing matches; from the reader it goes back and hands the query to the quick search', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const input = page.getByTestId('palette-input');
  const row = page.getByTestId('palette-search-library');
  const field = page.getByTestId('search-field').locator('input');
  try {
    await runMenuCommand(app, 'app.palette');
    await input.fill('효소 억제제');
    await expect(page.getByTestId('palette-empty')).toBeVisible();
    await expect(row).toHaveCount(0); // an empty library has no quick search to hand the query to
    await page.keyboard.press('Escape');

    await importPaths(page, [PDF]);
    await openItem(page, 'sample');
    await expect(page.getByTestId('pdf-canvas')).toBeVisible();
    await runMenuCommand(app, 'app.palette');
    await input.fill('효소 억제제');
    await expect(page.getByTestId('palette-empty')).toContainText('‘효소 억제제’와 일치하는 자료·명령이 없습니다');
    await expect(row).toHaveText(/라이브러리에서 ‘효소 억제제’ 검색/);
    await expect(row).toHaveAttribute('data-focused', 'true');
    await expect(row.locator('.kbd')).toHaveText(IS_MAC ? ['⌘', 'F'] : ['Ctrl', 'F']);
    await expect(page.locator('.p-foot .row')).toHaveText([/실행/, /닫기/]); // palette.html ?state=none
    await expect(page.getByTestId('palette-status')).toHaveText('‘효소 억제제’와 일치하는 자료·명령이 없습니다');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('palette')).toBeHidden();
    await expect(page.getByTestId('search-empty')).toBeVisible(); // back in the library, the quick search's own no-results state
    await expect(field).toHaveValue('효소 억제제');
    await expect(field).toBeFocused();

    // A query that finds the item: 자료 first, the row still last; the pointer picks the row.
    await runMenuCommand(app, 'app.palette');
    await input.fill('sam');
    await expect(page.getByTestId('palette-result')).toHaveCount(1);
    await row.click();
    await expect(field).toHaveValue('sam');
    await expect(page.getByTestId('item-row')).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test('recent: commands run from the palette come first with an empty query (five at most), win ties, and survive a restart', async ({}, testInfo) => {
  let session = await launch(...dirs(testInfo));
  const cursor = (page: Page) => page.locator('[data-testid="palette-item"][data-focused]');
  const listed = (page: Page) => page.getByTestId('palette-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-command-id')));
  /** Runs `id` from the palette by typing `query`; its row must be the cursor row. */
  const pick = async (s: { app: ElectronApplication; page: Page }, query: string, id: string) => {
    await runMenuCommand(s.app, 'app.palette');
    await s.page.getByTestId('palette-input').fill(query);
    await expect(cursor(s.page)).toHaveAttribute('data-command-id', id);
    await s.page.keyboard.press('Enter');
    await expect(s.page.getByTestId('palette')).toBeHidden();
  };
  try {
    await stubOpenDialog(session.app, []);
    await pick(session, '파일 가져오기', 'file.importManaged');
    await pick(session, '외부 파일', 'file.importLinked');
    const sheet = await expectWindow(session.app, 'sheet', () => pick(session, '단축키', 'app.shortcuts'));
    await closeSheet(sheet, 'Escape');
    await expect.poll(() => menuItemEnabled(session.app, 'app.palette')).toBe(true);
    await pick(session, '글자 크게', 'view.textBigger');
    await pick(session, '글자 작게', 'view.textSmaller');
    await pick(session, 'ㅅㅇㄷㅂ', 'view.toggleSidebar');
    // The five newest first, then the rest in registry order (설정… never ran; 파일 가져오기… is the sixth newest).
    const expected = ['view.toggleSidebar', 'view.textSmaller', 'view.textBigger', 'app.shortcuts', 'file.importLinked', 'file.importManaged', 'app.settings'];
    await runMenuCommand(session.app, 'app.palette');
    expect(await listed(session.page)).toEqual(expected);
    // 글자 크게 and 글자 작게 both match ㄱㅈ at 0: the one run last comes first.
    await session.page.getByTestId('palette-input').fill('ㄱㅈ');
    expect((await listed(session.page)).slice(0, 2)).toEqual(['view.textSmaller', 'view.textBigger']);
    await session.page.keyboard.press('Escape');
    // A library setting (ADR-0007 (b)): written whole, newest first.
    await expect
      .poll(() => session.page.evaluate(async () => {
        const r = await window.learn.settings.get({ key: 'palette.recent' });
        return r.ok ? r.data : null;
      }))
      .toEqual(['view.toggleSidebar', 'view.textSmaller', 'view.textBigger', 'app.shortcuts', 'file.importLinked', 'file.importManaged']);
    await session.app.close();
    session = await launch(...dirs(testInfo));
    await runMenuCommand(session.app, 'app.palette');
    await expect.poll(() => listed(session.page)).toEqual(expected);
  } finally {
    await session.app.close();
  }
});
