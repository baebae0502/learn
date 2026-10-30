import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { Channels } from '../../packages/domain/src/ipc-channels';
import { FIXTURES, clickToCloseSheet, drag, dropSource, expectDisabledReason, expectTooltipText, expectWindow, hoverLikeUser, holdOpenDialog, importFiles, importPaths, launch, mainWindow, menuItemEnabled, openDialogCalls, openItem, releaseOpenDialog, rowAt, rowByTitle, runMenuCommand, stubOpenDialog, type Session } from './helpers';

const BUSY = '진행 중인 작업이 끝나면 쓸 수 있습니다';

/** Replace one IPC handler in main with a fixed reply (a Result, as createHandle would send it). */
const stubHandler = (app: ElectronApplication, channel: string, reply: unknown) =>
  app.evaluate(({ ipcMain }, [channel, reply]) => {
    ipcMain.removeHandler(channel as string);
    ipcMain.handle(channel as string, () => reply);
  }, [channel, reply] as const);

function fakePdf(dir: string, name: string, body: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, `%PDF-1.4\n% ${body}\n%%EOF\n`);
  return p;
}

test('import, duplicate prompt, failure toast, missing linked file and relink', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  const src = testInfo.outputPath('src');
  const a = fakePdf(src, 'Chapter 06.pdf', 'six');
  const b = fakePdf(src, '신호 전달 (2).pdf', 'two');

  let s: Session = await launch(lib, ud);
  await expect(s.page.getByTestId('empty-state')).toBeVisible();
  await expect(s.page.getByTestId('toolbar-count')).toHaveCount(0);

  await importFiles(s, [a]);
  await expect(s.page.getByTestId('item-row')).toHaveCount(1);
  // Success toasts live 5 s, so several import-done toasts can be up at once: always narrow by text (R-8).
  await expect(s.page.getByTestId('import-done').filter({ hasText: '자료 1개를 가져왔습니다' })).toBeVisible();
  await expect(s.page.getByTestId('import-done').getByTestId('toast-close')).toHaveCount(0); // C-6: success has no ×
  await expect(s.page.getByTestId('toolbar-count')).toHaveText('1개');

  let sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [a]));
  // The import waits for the sheet's answer: 가져오기 ▾ is disabled and says why (M-2; the description is its tooltip text).
  await expectDisabledReason(s.page.getByTestId('import-menu'), BUSY);
  await clickToCloseSheet(sheet, sheet.getByTestId('dup-skip'));
  await expect(s.page.getByTestId('item-row')).toHaveCount(1);
  await expectDisabledReason(s.page.getByTestId('import-menu'), null);

  sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [a]));
  await clickToCloseSheet(sheet, sheet.getByTestId('dup-add'));
  await expect(s.page.getByTestId('item-row')).toHaveCount(2);

  sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [a]));
  await clickToCloseSheet(sheet, sheet.getByTestId('dup-open'));
  await expect(s.page.getByTestId('viewer-title')).toHaveText('Chapter 06');
  await s.page.getByTestId('viewer-back').click();

  const notes = path.join(src, 'notes.txt');
  fs.writeFileSync(notes, 'plain text');
  await importFiles(s, [notes]);
  await expect(s.page.getByTestId('import-failures')).toContainText('파일 1개를 가져오지 못했습니다');
  await expect(s.page.getByTestId('import-failures')).toContainText('notes.txt');
  await expect(s.page.getByTestId('import-failures')).toContainText('지원하지 않는 형식');
  await s.page.getByTestId('import-failures').getByTestId('toast-close').click();
  await expect(s.page.getByTestId('import-failures')).toHaveCount(0);

  // The 가져오기 ▾ menu runs the same registry command (linked).
  await stubOpenDialog(s.app, [b]);
  await s.page.getByTestId('import-menu').click();
  await s.page.getByTestId('import-menu-linked').click();
  await expect(s.page.getByTestId('item-row')).toHaveCount(3);
  await expect(s.page.getByTestId('import-done').filter({ hasText: '연결했습니다' })).toBeVisible();
  await s.app.close();

  const moved = path.join(src, 'moved.pdf');
  fs.renameSync(b, moved);
  s = await launch(lib, ud);
  const row = s.page.getByTestId('item-row').filter({ hasText: '신호 전달 (2)' });
  await expect(row.getByTestId('missing-flag')).toHaveText('파일 없음');
  await openItem(s.page, '신호 전달 (2)');
  await expect(s.page.getByTestId('missing-notice')).toBeVisible();
  await stubOpenDialog(s.app, [moved]);
  await s.page.getByTestId('relink').click();
  await expect(s.page.getByTestId('missing-notice')).toBeHidden();
  await s.page.getByTestId('viewer-back').click();
  await expect(row.getByTestId('missing-flag')).toHaveCount(0);
  await s.page.screenshot({ path: testInfo.outputPath('library.png') });
  await s.app.close();
});

test('the empty-state buttons and the drop path need a real file location', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await expect(s.page.getByTestId('import-managed')).toHaveText('파일 가져오기…');
    await expect(s.page.getByTestId('import-linked')).toHaveText('외부 파일 연결…');
    // A synthetic drop has no Finder path: nothing is imported and the toast says what to do instead.
    await s.page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['%PDF-1.4'], 'x.pdf', { type: 'application/pdf' }));
      document.body.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      document.body.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect(s.page.getByTestId('drop-failed')).toContainText('파일 › 파일 가져오기로 다시 시도하세요.'); // the command named in prose: no "…" (critic T14-n2)
    await expect(s.page.getByTestId('empty-state')).toBeVisible();
  } finally {
    await s.app.close();
  }
});

/** Two frames: anything a click set off in React has rendered. */
const frames = (s: Session) => s.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

test('while an import runs, its controls are disabled with the reason as their tooltip (M-2) and the list opens nothing', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const pdf = fakePdf(testInfo.outputPath('src'), 'held.pdf', 'held');
  try {
    const managed = s.page.getByTestId('import-managed');
    // A dropped file's import runs while the window stays key (held in main here): the controls are disabled with the
    // reason, which is their tooltip on hover.
    await s.app.evaluate(({ ipcMain }) => {
      const g = globalThis as { __learnReleaseImport?: () => void };
      ipcMain.removeHandler('library:import');
      ipcMain.handle('library:import', () => new Promise((resolve) => (g.__learnReleaseImport = () => resolve({ ok: true, data: [] }))));
    });
    await dropSource(s.page, [pdf]);
    await drag(s.page, 'dragenter', 'source');
    await drag(s.page, 'drop', 'source', { repeat: false });
    // The first-run screen gives way to the import's progress; the toolbar's 가져오기 stays.
    await expectDisabledReason(s.page.getByTestId('import-menu'), BUSY);
    await hoverLikeUser(s.page, 'import-menu');
    await expectTooltipText(s.page, BUSY, 'import-menu');
    await s.app.evaluate(() => (globalThis as { __learnReleaseImport?: () => void }).__learnReleaseImport?.());
    await expectDisabledReason(managed, null); // nothing imported: the first-run screen is back
    await s.page.mouse.move(700, 880);

    // The import from 파일 가져오기… waits on its open panel, a sheet on the window (follow-up D): the controls are
    // disabled with the reason as well, but the window is not key under the panel, so no tooltip shows on hover.
    await holdOpenDialog(s.app, [pdf]);
    await managed.click();
    for (const id of ['import-managed', 'import-linked', 'import-menu']) await expectDisabledReason(s.page.getByTestId(id), BUSY);
    await expect(s.page.locator('html')).toHaveAttribute('data-window-inactive', '');
    await s.page.mouse.move(700, 880); // leave the button the click pressed, then come back
    await managed.hover();
    await s.page.waitForTimeout(900); // past the 600 ms hover delay
    await expect(s.page.getByRole('tooltip')).toHaveCount(0);
    await releaseOpenDialog(s.app);
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    await expect(s.page.getByTestId('import-done').filter({ hasText: '자료 1개를 가져왔습니다' })).toHaveCount(1);
    await expectDisabledReason(s.page.getByTestId('import-menu'), null);
    // The focused button left with the first-run screen: focus continues on the table's first row, not on <body>.
    await expect(rowAt(s.page, 0)).toBeFocused();

    // Opening from the list goes through the registry (item.open), so it is refused while the import holds the window.
    await holdOpenDialog(s.app, []);
    await s.page.getByTestId('import-menu').click();
    await s.page.getByTestId('import-menu-managed').click();
    await expectDisabledReason(s.page.getByTestId('import-menu'), BUSY);
    // The quick search is held like the other toolbar controls (drawn disabled, no input) while the panel is up.
    await expect(s.page.getByTestId('search-field').locator('input')).toHaveAttribute('aria-disabled', 'true');
    const row = rowByTitle(s.page, 'held');
    const opensNothing = async (how: () => Promise<void>) => {
      await how();
      await frames(s);
      await expect(s.page.getByTestId('viewer-title')).toHaveCount(0);
      await expect(s.page.getByTestId('library-table')).toBeVisible();
    };
    await opensNothing(() => row.dblclick());
    await opensNothing(async () => {
      await row.click(); // selecting stays allowed; opening is the registry's item.open, refused while held
      await s.page.keyboard.press('Enter');
    });
    await releaseOpenDialog(s.app); // cancelled: nothing imported, nothing to report
    await expectDisabledReason(s.page.getByTestId('import-menu'), null);
    await expect(s.page.getByTestId('search-field').locator('input')).not.toHaveAttribute('aria-disabled', 'true');
    await row.dblclick();
    await expect(s.page.getByTestId('viewer-title')).toHaveText('held');
  } finally {
    await s.app.close();
  }
});

/** The 전체 화면 menu item (macOS only: elsewhere it is the togglefullscreen role, always there). */
const fullScreenItemEnabled = (s: Session) =>
  s.app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('menu.view.fullScreen');
    return item ? item.enabled : null;
  });

test('under its own open panel (⌘O) the main window is not key — no ring, no tooltip — but stays main and held; after it, key again with its focus back (follow-up D)', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const html = s.page.locator('html');
  const managed = s.page.getByTestId('import-managed');
  const ringed = () => managed.evaluate((el) => el === document.activeElement && getComputedStyle(el).outlineStyle !== 'none');
  try {
    await expect(html).not.toHaveAttribute('data-window-inactive', '');
    await managed.focus();
    await s.page.keyboard.press('Shift+Tab');
    await s.page.keyboard.press('Tab'); // keyboard focus on 파일 가져오기…: its ring
    await expect.poll(ringed).toBe(true);
    if (process.platform === 'darwin') expect(await fullScreenItemEnabled(s)).toBe(true);

    // The panel is held open (a user still choosing): it hangs on the window as a sheet, as our own sheets do.
    await holdOpenDialog(s.app, []);
    await runMenuCommand(s.app, 'file.importManaged'); // ⌘O from the menu bar
    await expect(html).toHaveAttribute('data-window-inactive', ''); // not key: no rings, no keyboard cursor
    await expect(html).not.toHaveAttribute('data-window-not-main', ''); // still main: the chrome does not dim
    expect(await html.getAttribute('data-tooltip-block')).toContain('inactive');
    expect(await ringed()).toBe(false); // the focus stays on the button, without its ring
    await expectDisabledReason(s.page.getByTestId('sidebar-toggle'), BUSY); // the window is held (n1)
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged')).toBe(false);
    if (process.platform === 'darwin') expect(await fullScreenItemEnabled(s)).toBe(false); // 전체 화면 waits for the sheet

    await releaseOpenDialog(s.app); // cancelled
    await expect(html).not.toHaveAttribute('data-window-inactive', '');
    await expect(managed).toBeFocused();
    await expect.poll(ringed).toBe(true); // the ring is back where it was
    await expectDisabledReason(s.page.getByTestId('sidebar-toggle'), null);
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged')).toBe(true);
    if (process.platform === 'darwin') await expect.poll(() => fullScreenItemEnabled(s)).toBe(true);
  } finally {
    await s.app.close();
  }
});

test('a success toast closes 5 s after it appears, also when the pointer reaches it just as its time runs out (Mac run 2)', async ({}, testInfo) => {
  // Mac run 2 (39884763777): the drop's "자료 8개를 가져왔습니다" stayed through the whole demo. The pointer reached the
  // toasts as its 5 s ran out, after the deadline but before the timer's task ran (input runs before timers): RAC's
  // timer subtracted past zero, cleared itself and never resumed. The page's clock makes that moment exact here.
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await s.page.clock.install();
    await s.page.mouse.move(10, 10);
    await s.page.evaluate(() => {
      new MutationObserver((_, obs) => {
        if (!document.querySelector('[data-testid="import-done"]')) return;
        obs.disconnect();
        (window as unknown as { __toastAt: number }).__toastAt = Date.now(); // the page's (fake) clock
      }).observe(document.body, { childList: true, subtree: true });
    });
    await dropSource(s.page, [path.join(FIXTURES, 'sample.pdf'), path.join(FIXTURES, 'sample-mpeg4part2.mp4')]);
    await drag(s.page, 'dragenter', 'source');
    await drag(s.page, 'drop', 'source', { repeat: false });
    const dropped = s.page.getByTestId('import-done').filter({ hasText: '자료 2개를 가져왔습니다' });
    await expect(dropped).toHaveCount(1);
    // ⌘O with a panel that answers at once (the demo's), and its own toast above the first.
    await stubOpenDialog(s.app, [path.join(FIXTURES, 'sample-h264-aac.mp4')]);
    await runMenuCommand(s.app, 'file.importManaged');
    await expect(s.page.getByTestId('item-row')).toHaveCount(3);
    await expect(s.page.getByTestId('import-done')).toHaveCount(2);
    const toastAt = await s.page.evaluate(() => (window as unknown as { __toastAt: number }).__toastAt);
    // The first toast's 5 s are up, and its timer's task has not run yet: the pointer comes onto the toasts now.
    await s.page.clock.setSystemTime(toastAt + 5010);
    const box = (await s.page.getByTestId('import-done').first().boundingBox())!;
    await s.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await s.page.clock.runFor(1000); // resting on them: the second toast waits, the first is already due
    await s.page.mouse.move(10, 10);
    await s.page.clock.runFor(500);
    await expect(dropped).toHaveCount(0); // closed when its time was up, not kept for good
    await s.page.clock.runFor(10_000); // the second toast's remaining time, plus a margin
    await expect(s.page.getByTestId('import-done')).toHaveCount(0);
  } finally {
    await s.app.close();
  }
});

test('only the pointer on the toasts or the focus in them holds a toast: not a panel, a sheet state or the window losing the key (Mac run 2)', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const html = s.page.locator('html');
  const windowState = () => s.page.evaluate(() => window.learn.ui.windowState().then((r) => (r.ok ? r.data : null)));
  try {
    await s.page.clock.install();
    await s.page.mouse.move(10, 10);
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf')]);
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    // A toast of its own (importPaths is silent), then ⌘O answered at once, as in the demo: no sheet state is left behind.
    await stubOpenDialog(s.app, [path.join(FIXTURES, 'sample-h264-aac.mp4')]);
    await runMenuCommand(s.app, 'file.importManaged');
    const toast = s.page.getByTestId('import-done');
    await expect(toast).toHaveCount(1);
    await expect.poll(windowState).toMatchObject({ focused: true, sheetOpen: false });
    await expect(html).not.toHaveAttribute('data-window-inactive', '');
    // A real panel held open (here 2 s), then cancelled: not key meanwhile, and the toast's time runs on.
    await holdOpenDialog(s.app, []);
    await runMenuCommand(s.app, 'file.importManaged');
    await expect(html).toHaveAttribute('data-window-inactive', '');
    await s.page.clock.runFor(2000);
    await releaseOpenDialog(s.app);
    await expect(html).not.toHaveAttribute('data-window-inactive', '');
    await expect.poll(windowState).toMatchObject({ focused: true, sheetOpen: false });
    // Another window takes the key and gives it back (2 s): the time runs on.
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = new BrowserWindow({ width: 300, height: 200, show: true });
      w.focus();
      (globalThis as { __probeWindow?: unknown }).__probeWindow = w;
    });
    await expect(html).toHaveAttribute('data-window-inactive', '');
    await s.page.clock.runFor(2000);
    await s.app.evaluate(() => (globalThis as { __probeWindow?: { close(): void } }).__probeWindow?.close());
    await (await mainWindow(s.app)).evaluate((w) => w.focus());
    await expect(html).not.toHaveAttribute('data-window-inactive', '');
    await expect(toast).toHaveCount(1);
    await s.page.clock.runFor(1200); // 5.2 s since it appeared
    await expect(toast).toHaveCount(0);
  } finally {
    await s.app.close();
  }
});

test('a first list read that fails says so where the list goes, and 다시 시도 reads it again', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, [fakePdf(testInfo.outputPath('src'), 'kept.pdf', 'kept')]);
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    const listed = await s.page.evaluate(() => window.learn.library.list());
    await stubHandler(s.app, Channels.library.list, { ok: false, code: 'INTERNAL', message: '라이브러리를 읽지 못했습니다. 잠시 뒤 다시 시도하세요.', retryable: true });
    await s.page.reload();
    await expect(s.page.getByTestId('app-ready')).toBeAttached();
    const notice = s.page.getByTestId('list-failed');
    await expect(notice).toContainText('자료 목록을 불러오지 못했습니다');
    await expect(notice).toContainText('잠시 뒤 다시 시도하세요');
    await expect(s.page.getByTestId('empty-state')).toHaveCount(0); // never "아직 자료가 없습니다" for a list we could not read
    await expect(s.page.getByTestId('toolbar-count')).toHaveCount(0);
    await expect(s.page.getByTestId('nav-scope-all').locator('.count')).toHaveCount(0);
    await expect(s.page.getByTestId('import-menu')).toBeEnabled(); // importing still works
    await expect(s.page.getByTestId('list-error')).toHaveCount(0); // the notice is the message; no toast on top
    // The next read answers when the test says so: meanwhile 다시 시도 is pending (focusable, presses ignored).
    await s.app.evaluate(({ ipcMain }, [channel, reply]) => {
      const g = globalThis as { __learnReleaseList?: () => void };
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => new Promise((resolve) => (g.__learnReleaseList = () => resolve(reply))));
    }, [Channels.library.list, listed] as const);
    const retry = s.page.getByTestId('list-retry');
    await retry.click();
    await expect(retry).toHaveAttribute('data-pending', 'true');
    await expect(retry).toHaveAttribute('aria-disabled', 'true');
    await expect(retry).toBeFocused();
    await s.app.evaluate(() => (globalThis as { __learnReleaseList?: () => void }).__learnReleaseList?.());
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    await expect(s.page.getByTestId('list-failed')).toHaveCount(0);
    await expect(s.page.getByTestId('toolbar-count')).toHaveText('1개');
    // The focused 다시 시도 left with the notice: focus continues on the table's first row.
    await expect(rowAt(s.page, 0)).toBeFocused();
  } finally {
    await s.app.close();
  }
});

test('boot: a library with items never shows the first-run screen, not even before the list arrives (N-5)', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, [fakePdf(testInfo.outputPath('src'), 'kept.pdf', 'kept')]);
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    // Watch the document from its first node on, then boot the renderer again with the library already full.
    await s.page.addInitScript(() => {
      const g = globalThis as { __learnMounted?: string[] };
      g.__learnMounted = [];
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of r.addedNodes) {
            if (!(n instanceof Element)) continue;
            for (const id of ['empty-state', 'library-table']) if (n.matches(`[data-testid="${id}"]`) || n.querySelector(`[data-testid="${id}"]`)) g.__learnMounted!.push(id);
          }
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await s.page.reload();
    await expect(s.page.getByTestId('app-ready')).toBeAttached();
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    const mounted = await s.page.evaluate(() => (globalThis as { __learnMounted?: string[] }).__learnMounted ?? []);
    expect(mounted).toContain('library-table'); // the observer did see the boot
    expect(mounted).not.toContain('empty-state');
  } finally {
    await s.app.close();
  }
});

// The demo's ⌘O fallback (residual polish, re-review minor 1): a stub that answers with the files once makes a late
// second ⌘O a cancel, so nothing is imported twice.
test('an open-dialog stub with once answers the files the first time only; a second ⌘O imports nothing', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const pdf = fakePdf(testInfo.outputPath('src'), 'Once.pdf', 'once');
    await stubOpenDialog(s.app, [pdf], { once: true });
    await runMenuCommand(s.app, 'file.importManaged');
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    await expect.poll(() => s.page.evaluate(() => document.documentElement.innerText.includes('가져오는 중'))).toBe(false);
    await runMenuCommand(s.app, 'file.importManaged');
    await expect.poll(() => openDialogCalls(s.app)).toBe(2);
    await s.page.waitForTimeout(500);
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    await expect(s.page.getByTestId('import-failures')).toHaveCount(0);
  } finally {
    await s.app.close();
  }
});
