import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { Channels } from '../../packages/domain/src/ipc-channels';
import { expectDisabledReason, expectWindow, holdOpenDialog, importFiles, importPaths, launch, openItem, releaseOpenDialog, stubOpenDialog, type Session } from './helpers';

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
  await sheet.getByTestId('dup-skip').click();
  await expect(s.page.getByTestId('item-row')).toHaveCount(1);
  await expectDisabledReason(s.page.getByTestId('import-menu'), null);

  sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [a]));
  await sheet.getByTestId('dup-add').click();
  await expect(s.page.getByTestId('item-row')).toHaveCount(2);

  sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [a]));
  await sheet.getByTestId('dup-open').click();
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
    await expect(s.page.getByTestId('drop-failed')).toContainText('파일 › 파일 가져오기…');
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
    await holdOpenDialog(s.app, [pdf]);
    const managed = s.page.getByTestId('import-managed');
    await managed.click();
    for (const id of ['import-managed', 'import-linked', 'import-menu']) await expectDisabledReason(s.page.getByTestId(id), BUSY);
    await s.page.mouse.move(700, 880); // leave the button the click pressed, then come back: the tooltip opens on hover
    await managed.hover();
    await expect(s.page.getByRole('tooltip')).toHaveText(BUSY);
    await releaseOpenDialog(s.app);
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    await expect(s.page.getByTestId('import-done').filter({ hasText: '자료 1개를 가져왔습니다' })).toHaveCount(1);
    await expectDisabledReason(s.page.getByTestId('import-menu'), null);
    // The focused button left with the first-run screen: focus continues on the first title, not on <body>.
    await expect(s.page.getByTestId('open-item').first()).toBeFocused();

    // Opening from the list goes through the registry (item.open), so it is refused while the import holds the window.
    await holdOpenDialog(s.app, []);
    await s.page.getByTestId('import-menu').click();
    await s.page.getByTestId('import-menu-managed').click();
    await expectDisabledReason(s.page.getByTestId('import-menu'), BUSY);
    const title = s.page.locator('[data-testid="open-item"][data-title="held"]');
    const opensNothing = async (how: () => Promise<void>) => {
      await how();
      await frames(s);
      await expect(s.page.getByTestId('viewer-title')).toHaveCount(0);
      await expect(s.page.getByTestId('library-table')).toBeVisible();
    };
    await opensNothing(() => title.click());
    await opensNothing(() => s.page.getByTestId('item-row').locator('[data-col="added"]').dblclick());
    await opensNothing(async () => {
      await title.focus();
      await s.page.keyboard.press('Enter');
    });
    await releaseOpenDialog(s.app); // cancelled: nothing imported, nothing to report
    await expectDisabledReason(s.page.getByTestId('import-menu'), null);
    await title.click();
    await expect(s.page.getByTestId('viewer-title')).toHaveText('held');
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
    await expect(s.page.getByTestId('nav-library').locator('.count')).toHaveCount(0);
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
    // The focused 다시 시도 left with the notice: focus continues on the first title.
    await expect(s.page.getByTestId('open-item').first()).toBeFocused();
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

test('a title opens on click, ↩ or Space, a row on double-click; the keyboard-focused title rings its row', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const src = testInfo.outputPath('src');
  try {
    await importPaths(s.page, [fakePdf(src, 'first.pdf', '1'), fakePdf(src, 'second.pdf', '2')]);
    await expect(s.page.getByTestId('item-row')).toHaveCount(2);
    // Nothing had focus on the first-run screen, so the list takes none (the hand-off is only for a focused button).
    expect(await s.page.evaluate(() => document.activeElement === document.body)).toBe(true);
    const title = s.page.locator('[data-testid="open-item"][data-title="first"]');
    const row = s.page.getByTestId('item-row').filter({ has: title });
    const other = s.page.getByTestId('item-row').filter({ hasNot: title });
    const ring = (r: typeof row) => r.evaluate((e) => getComputedStyle(e).boxShadow);
    await expect(title).toHaveAttribute('title', 'first'); // the full title as its tooltip (the cell truncates)

    const back = async () => {
      await s.page.getByTestId('viewer-back').click();
      await expect(s.page.getByTestId('library-table')).toBeVisible();
    };
    for (const key of ['Enter', 'Space']) {
      await title.focus();
      await s.page.keyboard.press('Shift+Tab'); // arrive by keyboard (focus-visible), as a user does
      await s.page.keyboard.press('Tab');
      await expect(title).toBeFocused();
      // Keyboard-cursor grammar: an inside 2 px ring on the whole row, none on the others.
      expect(await ring(row)).toMatch(/ 0px 0px 0px 2px inset$/);
      expect(await ring(other)).toBe('none');
      await s.page.keyboard.press(key);
      await expect(s.page.getByTestId('viewer-title')).toHaveText('first');
      await back();
    }
    await title.click();
    await expect(s.page.getByTestId('viewer-title')).toHaveText('first');
    await back();
    await row.locator('[data-col="added"]').dblclick();
    await expect(s.page.getByTestId('viewer-title')).toHaveText('first');
  } finally {
    await s.app.close();
  }
});
