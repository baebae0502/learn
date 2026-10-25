// 정보 편집 (spec §5.3): the form in place, its checks, what happens when something leaves it — another row, the reader,
// closing the window, quitting (main's flush, M/edit-flush.ts) — and item.editInfo from the palette. ⌘↩ is a key of the
// form (no menu accelerator), so it is pressed in the page.
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURES, importPaths, launch, mainWindow, rowByTitle, runMenuCommand, selectRows, showItemPanel, windowKinds } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const SAVE_KEY = process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';

const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;
const contentWidth = async (app: ElectronApplication, width: number) =>
  (await mainWindow(app)).evaluate((w, width) => w.setContentSize(width, w.getContentSize()[1]!), width);
const field = (page: Page, name: string) => page.locator(`[data-testid="editor-field"][data-field="${name}"] :is(input, textarea)`);
const fieldBox = (page: Page, name: string) => page.locator(`[data-testid="editor-field"][data-field="${name}"]`);
const infoValue = (page: Page, name: string) => page.locator(`[data-testid="info-row"][data-field="${name}"] dd`);
const panelState = (page: Page) => page.getByTestId('shell').getAttribute('data-inspector');
const detailOf = (page: Page, itemId: string) =>
  page.evaluate(async (id) => {
    const r = await window.learn.library.detail({ itemId: id });
    if (!r.ok) throw new Error(`library.detail failed: ${r.code}`);
    return r.data;
  }, itemId);
const windowCount = (app: ElectronApplication) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length);
/** What main's flush was answered for each close or quit (M/index.ts, E2E only). */
const flushLog = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as { __learnEditFlushLog?: Array<{ action: string; result: string }> }).__learnEditFlushLog ?? []);

test('the pencil turns 정보 into a form in place; 저장, ⌘↩ and ↩ in a one-line field save; 취소 and esc write nothing', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    await showItemPanel(app, page);
    await selectRows(page, ['sample']);
    const pencil = page.getByTestId('info-edit');
    await expect(pencil).toHaveAccessibleName('정보 편집');
    await pencil.click();
    const editor = page.getByTestId('info-editor');
    await expect(editor).toBeVisible();
    await expect(field(page, 'title')).toBeFocused();
    await expect(field(page, 'title')).toHaveValue('sample');
    await expect(pencil).toHaveCount(0); // the form's own buttons take over
    await field(page, 'title').fill('세포 신호 전달');
    await page.getByTestId('creator-add').click();
    await expect(page.getByTestId('creator-row').nth(0).locator('input')).toBeFocused();
    await page.keyboard.type('한서진');
    await field(page, 'date').fill('2024-03');
    await field(page, 'publisher').fill('학습출판');
    await page.getByTestId('editor-save').click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByTestId('inspector-head').locator('h2')).toHaveText('세포 신호 전달');
    await expect(infoValue(page, 'date')).toHaveText('2024. 3.');
    await expect(rowByTitle(page, '세포 신호 전달')).toBeVisible(); // the table took the new title (libraryChanged)
    await expect(page.getByTestId('info-edit')).toBeFocused(); // back where the edit began
    const saved = await detailOf(page, pdf!.id);
    expect(saved.item.title).toBe('세포 신호 전달');
    expect(saved.metadata).toEqual({ creators: [{ name: '한서진', role: 'author' }], date: '2024-03', publisher: '학습출판' });

    // ⌘↩ (Ctrl+Enter off macOS) saves from anywhere; ↩ in a multi-line field is a new line.
    await page.getByTestId('info-edit').click();
    await field(page, 'extra').click();
    await page.keyboard.type('첫 줄');
    await page.keyboard.press('Enter');
    await page.keyboard.type('둘째 줄');
    await page.keyboard.press(SAVE_KEY);
    await expect(editor).toHaveCount(0);
    expect((await detailOf(page, pdf!.id)).metadata.extra).toBe('첫 줄\n둘째 줄');
    // ↩ in a one-line field saves.
    await page.getByTestId('info-edit').click();
    await field(page, 'language').fill('한국어');
    await field(page, 'language').press('Enter');
    await expect(editor).toHaveCount(0);
    expect((await detailOf(page, pdf!.id)).metadata.language).toBe('한국어');

    // 취소 and esc keep the stored values; nothing is written (수정일 stays).
    const before = (await detailOf(page, pdf!.id)).item.updatedAt;
    await page.getByTestId('info-edit').click();
    await field(page, 'publisher').fill('바뀐 출판사');
    await page.getByTestId('editor-cancel').click();
    await expect(infoValue(page, 'publisher')).toHaveText('학습출판');
    await page.getByTestId('info-edit').click();
    await field(page, 'publisher').fill('바뀐 출판사');
    await page.keyboard.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(infoValue(page, 'publisher')).toHaveText('학습출판');
    // 저장 with nothing changed only ends the edit.
    await page.getByTestId('info-edit').click();
    await page.getByTestId('editor-save').click();
    await expect(editor).toHaveCount(0);
    expect((await detailOf(page, pdf!.id)).item.updatedAt).toBe(before);
  } finally {
    await app.close();
  }
});

test('a bad date or URL is marked with its footnote and keeps the form, the first marked field focused; fixing it saves', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    await showItemPanel(app, page);
    await selectRows(page, ['sample']);
    await page.getByTestId('info-edit').click();
    await field(page, 'date').fill('2024-13');
    await field(page, 'url').fill('example.org');
    await field(page, 'title').fill('   ');
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('info-editor')).toBeVisible();
    await expect(field(page, 'title')).toBeFocused();
    await expect(field(page, 'title')).toHaveAttribute('aria-invalid', 'true');
    await expect(field(page, 'title')).toHaveAccessibleDescription('제목은 비워 둘 수 없습니다. 자료를 알아볼 이름을 적으세요.');
    await expect(fieldBox(page, 'date')).toContainText('날짜는 2024, 2024-03, 2024-03-15처럼 적어 주세요.');
    await expect(fieldBox(page, 'url')).toContainText('http:// 또는 https://로 시작하는 주소를 적어 주세요.');
    await expect(fieldBox(page, 'publisher').locator('.ed-error')).toHaveCount(0); // only the wrong ones
    // The marks follow the typing.
    await field(page, 'title').fill('sample');
    await expect(field(page, 'title')).not.toHaveAttribute('aria-invalid', 'true');
    await field(page, 'date').fill('2024-03-15');
    await field(page, 'url').fill('https://example.org/a');
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
    expect((await detailOf(page, pdf!.id)).metadata).toMatchObject({ date: '2024-03-15', url: 'https://example.org/a' });
  } finally {
    await app.close();
  }
});

test('leaving the edit: another row after valid changes saves first; invalid ones bring the selection back with the unsaved line and 버리기; no change just ends it', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF, KO_PDF]);
    await showItemPanel(app, page);
    const head = page.getByTestId('inspector-head').locator('h2');
    await selectRows(page, ['sample']);
    await page.getByTestId('info-edit').click();
    await selectRows(page, ['한글 경로 (테스트) #1']); // no change: the other row simply shows
    await expect(head).toHaveText('한글 경로 (테스트) #1');
    await expect(page.getByTestId('info-editor')).toHaveCount(0);

    await selectRows(page, ['sample']);
    await page.getByTestId('info-edit').click();
    await field(page, 'publisher').fill('학습출판');
    await selectRows(page, ['한글 경로 (테스트) #1']); // valid: saved, then the other row
    await expect(head).toHaveText('한글 경로 (테스트) #1');
    expect((await detailOf(page, pdf!.id)).metadata.publisher).toBe('학습출판');

    await selectRows(page, ['sample']);
    await page.getByTestId('info-edit').click();
    await field(page, 'date').fill('어제');
    await selectRows(page, ['한글 경로 (테스트) #1']); // invalid: nothing moves
    await expect(page.getByTestId('editor-unsaved')).toContainText('저장하지 못한 변경이 있습니다. 표시한 칸을 고치거나 변경을 버리세요.');
    await expect(rowByTitle(page, 'sample')).toHaveAttribute('aria-selected', 'true');
    await expect(rowByTitle(page, '한글 경로 (테스트) #1')).toHaveAttribute('aria-selected', 'false');
    await expect(head).toHaveText('sample');
    await expect(field(page, 'date')).toHaveAttribute('aria-invalid', 'true');
    // The focus is on the marked field, not left in the table: the field draws its halo and the table's selection is neutral.
    await expect(field(page, 'date')).toBeFocused();
    // The reader is a way out too: refused the same way. The double-click's first press selects that row (the edit is
    // asked and the selection comes back), then its item.open goes through env.open's afterEditing: asked again, refused.
    await rowByTitle(page, '한글 경로 (테스트) #1').dblclick();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('library-table')).toBeVisible();
    await expect(page.getByTestId('pdf-canvas')).toHaveCount(0);
    // 버리기 ends the edit without a write.
    await page.getByTestId('editor-discard').click();
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
    expect((await detailOf(page, pdf!.id)).metadata.date).toBeUndefined();

    // Valid changes and 열기: saved, then the reader (the press selects the edited row itself: no change, nothing asked).
    await selectRows(page, ['sample']);
    await page.getByTestId('info-edit').click();
    await field(page, 'language').fill('영어');
    await rowByTitle(page, 'sample').dblclick();
    await expect(page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    expect((await detailOf(page, pdf!.id)).metadata.language).toBe('영어');
  } finally {
    await app.close();
  }
});

test('creator rows: added, reordered, given a role and removed; saved in that order, an empty row left out', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    await showItemPanel(app, page);
    await selectRows(page, ['sample']);
    await page.getByTestId('info-edit').click();
    const rows = page.getByTestId('creator-row');
    for (const name of ['김하린', '윤재하', '배유나']) {
      await page.getByTestId('creator-add').click();
      await page.keyboard.type(name); // the new row's name has the focus
    }
    await expect(rows.nth(0).locator('input')).toHaveAccessibleName('저자 1 이름');
    await expect(rows.nth(0).getByTestId('creator-up')).toBeDisabled();
    await expect(rows.nth(2).getByTestId('creator-down')).toBeDisabled();
    await rows.nth(1).getByTestId('creator-role').selectOption('editor'); // 윤재하
    await rows.nth(2).getByTestId('creator-up').click(); // 배유나 above 윤재하
    await expect(rows.nth(1).locator('input')).toBeFocused(); // the moved row keeps the focus
    await rows.nth(0).getByTestId('creator-remove').click(); // 김하린 goes
    await expect(rows.locator('input')).toHaveCount(2);
    await expect(rows.nth(0).locator('input')).toHaveValue('배유나');
    await expect(rows.nth(1).locator('input')).toHaveValue('윤재하');
    await expect(rows.nth(1).getByTestId('creator-role')).toHaveValue('editor');
    await page.getByTestId('creator-add').click(); // left empty: not saved
    await page.getByTestId('editor-save').click();
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
    expect((await detailOf(page, pdf!.id)).metadata.creators).toEqual([{ name: '배유나', role: 'author' }, { name: '윤재하', role: 'editor' }]);
    await expect(infoValue(page, 'creators')).toHaveText('배유나, 윤재하 (편집자)');
    await expect(page.getByTestId('inspector-head').locator('.authors')).toHaveText('배유나, 윤재하');
  } finally {
    await app.close();
  }
});

test('closing the window over invalid changes keeps it, the form saying why; valid ones are saved, then it closes', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let { app, page } = await launch(lib, ud);
  try {
    const [pdf] = await importPaths(page, [PDF]);
    await showItemPanel(app, page);
    await selectRows(page, ['sample']);
    await page.getByTestId('info-edit').click();
    await field(page, 'url').fill('example.org');
    await (await mainWindow(app)).evaluate((w) => w.close()); // ⌘W / 윈도우 닫기
    await expect(page.getByTestId('editor-unsaved')).toBeVisible();
    await expect.poll(() => flushLog(app)).toEqual([{ action: 'close', result: 'invalid' }]);
    expect(await windowKinds(app)).toEqual(['main', 'settings (hidden)']); // nothing closed, the prepared settings window neither
    await field(page, 'url').fill('https://example.org/a');
    const quit = process.platform === 'darwin' ? null : app.waitForEvent('close'); // Linux/Windows quit with the main window
    await (await mainWindow(app)).evaluate((w) => w.close());
    if (quit) await quit;
    else await expect.poll(() => windowCount(app)).toBe(0);
    await app.close().catch(() => {});
    ({ app, page } = await launch(lib, ud));
    expect((await detailOf(page, pdf!.id)).metadata.url).toBe('https://example.org/a');
  } finally {
    await app.close().catch(() => {});
  }
});

test('quitting (⌘Q, app.quit) over invalid changes is called off; valid ones are saved and the app really quits', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let { app, page } = await launch(lib, ud);
  try {
    const [pdf] = await importPaths(page, [PDF]);
    await showItemPanel(app, page);
    await selectRows(page, ['sample']);
    await page.getByTestId('info-edit').click();
    await field(page, 'date').fill('2024-13');
    await app.evaluate(({ app: electronApp }) => electronApp.quit()); // what ⌘Q and the Dock's 종료 do
    await expect(page.getByTestId('editor-unsaved')).toBeVisible();
    await expect.poll(() => flushLog(app)).toEqual([{ action: 'quit', result: 'invalid' }]);
    // Nothing closed: the quit is off, and the prepared settings window outlived the attempt the edit gate called off
    // (it is discarded only on a before-quit nobody prevented).
    expect(await windowKinds(app)).toEqual(['main', 'settings (hidden)']);
    await field(page, 'date').fill('2024-03');
    const exited = app.waitForEvent('close');
    await app.evaluate(({ app: electronApp }) => electronApp.quit());
    await exited; // the process ends, on macOS too: not just the window
    ({ app, page } = await launch(lib, ud));
    expect((await detailOf(page, pdf!.id)).metadata.date).toBe('2024-03');
  } finally {
    await app.close().catch(() => {});
  }
});

test('정보 편집 from the palette edits the selected item, showing a folded item panel first', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF, KO_PDF]);
    await showItemPanel(app, page);
    await selectRows(page, ['sample']);
    await runMenuCommand(app, 'view.toggleInspector'); // folded by the user
    await expect.poll(() => panelState(page)).toBe('hidden');
    await runMenuCommand(app, 'app.palette');
    await page.getByTestId('palette-input').fill('정보 편집');
    await expect(page.getByTestId('palette-item').first()).toHaveAttribute('data-command-id', 'item.editInfo');
    await page.keyboard.press('Enter');
    await expect.poll(() => panelState(page)).toBe('shown');
    await expect(page.getByTestId('info-editor')).toBeVisible();
    await expect(field(page, 'title')).toBeFocused();
    await page.keyboard.press('Escape'); // nothing changed: the edit ends
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
    // Not for two items (the rule judges the selection).
    await selectRows(page, ['sample', '한글 경로 (테스트) #1'], { modifier: 'Meta' });
    await runMenuCommand(app, 'app.palette');
    await page.getByTestId('palette-input').fill('정보 편집');
    expect(await page.getByTestId('palette-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-command-id')))).not.toContain('item.editInfo');
    await page.keyboard.press('Escape');
  } finally {
    await app.close();
  }
});

test('IME: ↩ and esc that belong to a composition neither save nor cancel; keyCode 229 too; after the commit ↩ saves', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    const [pdf] = await importPaths(page, [PDF]);
    await showItemPanel(app, page);
    await selectRows(page, ['sample']);
    await page.getByTestId('info-edit').click();
    const title = field(page, 'title');
    await title.fill('');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '세포', selectionStart: 2, selectionEnd: 2 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('info-editor')).toBeVisible();
    await cdp.send('Input.insertText', { text: '세포' }); // commits the composition
    await expect(title).toHaveValue('세포');
    for (const type of ['keyDown', 'keyUp'] as const) {
      await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 }); // macOS IME confirm
    }
    await page.waitForTimeout(300);
    await expect(page.getByTestId('info-editor')).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
    expect((await detailOf(page, pdf!.id)).item.title).toBe('세포');
  } finally {
    await app.close();
  }
});

test('the palette\'s 정보 편집 on a panel folded by the width shows it and focuses the editor', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    await contentWidth(app, 1024);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(1100);
    await expect.poll(() => panelState(page)).toBe('hidden'); // folded by the width, not by the user
    await selectRows(page, ['sample']);
    await runMenuCommand(app, 'app.palette');
    await page.getByTestId('palette-input').fill('정보 편집');
    await expect(page.getByTestId('palette-item').first()).toHaveAttribute('data-command-id', 'item.editInfo');
    await page.keyboard.press('Enter');
    await expect.poll(() => panelState(page)).toBe('shown');
    await expect(page.getByTestId('info-editor')).toBeVisible();
    await expect(field(page, 'title')).toBeFocused();
  } finally {
    await app.close();
  }
});

test('one save at a time: a double press of 저장 writes once', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    await showItemPanel(app, page);
    await selectRows(page, ['sample']);
    await page.getByTestId('info-edit').click();
    await field(page, 'publisher').fill('학습출판');
    // Hold the write in main so the second press comes while the first is pending.
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as { __learnWrites?: number; __learnRelease?: () => void };
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, (...a: unknown[]) => Promise<unknown>> })._invokeHandlers;
      const original = handlers.get('library:updateMetadata')!;
      g.__learnWrites = 0;
      ipcMain.removeHandler('library:updateMetadata');
      ipcMain.handle('library:updateMetadata', async (...a) => {
        g.__learnWrites! += 1;
        await new Promise<void>((r) => (g.__learnRelease = r));
        return original(...(a as [unknown, unknown]));
      });
    });
    const save = page.getByTestId('editor-save');
    await save.dispatchEvent('click');
    await save.dispatchEvent('click');
    await page.waitForTimeout(200);
    await app.evaluate(() => (globalThis as { __learnRelease?: () => void }).__learnRelease?.());
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
    expect(await app.evaluate(() => (globalThis as { __learnWrites?: number }).__learnWrites)).toBe(1);
  } finally {
    await app.close();
  }
});

test('a refused close answers at once even when the page runs no frames (invalid, never a timeout)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await importPaths(page, [PDF]);
    await showItemPanel(app, page);
    await selectRows(page, ['sample']);
    await page.getByTestId('info-edit').click();
    await field(page, 'date').fill('2024-13');
    await page.evaluate(() => {
      window.requestAnimationFrame = () => 0; // a hidden or occluded window: no frame ever comes
    });
    await (await mainWindow(app)).evaluate((w) => w.close());
    await expect.poll(() => flushLog(app)).toEqual([{ action: 'close', result: 'invalid' }]);
    expect(await windowKinds(app)).toEqual(['main', 'settings (hidden)']);
    await expect(field(page, 'date')).toBeFocused();
    await page.getByTestId('editor-discard').click(); // an invalid edit would keep the app from closing
  } finally {
    await app.close().catch(() => {});
  }
});
