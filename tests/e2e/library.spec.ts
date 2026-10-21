import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { expectDisabledReason, importFiles, importPaths, launch, openItem, stubOpenDialog, type Session } from './helpers';

const BUSY = '진행 중인 작업이 끝나면 쓸 수 있습니다';

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

  await importFiles(s, [a]);
  await expect(s.page.getByTestId('duplicate-dialog')).toBeVisible();
  // The import waits for the answer: 가져오기 ▾ is disabled and says why (M-2; the description is its tooltip text).
  await expectDisabledReason(s.page.getByTestId('import-menu'), BUSY);
  await s.page.getByTestId('dup-cancel').click();
  await expect(s.page.getByTestId('duplicate-dialog')).toBeHidden();
  await expect(s.page.getByTestId('item-row')).toHaveCount(1);
  await expectDisabledReason(s.page.getByTestId('import-menu'), null);

  await importFiles(s, [a]);
  await s.page.getByTestId('dup-add').click();
  await expect(s.page.getByTestId('item-row')).toHaveCount(2);

  await importFiles(s, [a]);
  await s.page.getByTestId('dup-open').click();
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

test('while an import runs, the first-run buttons are disabled with the reason as their tooltip (M-2)', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const pdf = fakePdf(testInfo.outputPath('src'), 'held.pdf', 'held');
  try {
    // An open dialog that stays up until the test lets it go (a user still choosing files).
    await s.app.evaluate(({ dialog }, paths) => {
      const g = globalThis as { __learnReleaseDialog?: () => void };
      dialog.showOpenDialog = (() =>
        new Promise((resolve) => {
          g.__learnReleaseDialog = () => resolve({ canceled: false, filePaths: paths });
        })) as typeof dialog.showOpenDialog;
    }, [pdf]);
    const managed = s.page.getByTestId('import-managed');
    await managed.click();
    for (const id of ['import-managed', 'import-linked', 'import-menu']) await expectDisabledReason(s.page.getByTestId(id), BUSY);
    await s.page.mouse.move(700, 880); // leave the button the click pressed, then come back: the tooltip opens on hover
    await managed.hover();
    await expect(s.page.getByRole('tooltip')).toHaveText(BUSY);
    await s.app.evaluate(() => (globalThis as { __learnReleaseDialog?: () => void }).__learnReleaseDialog?.());
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    await expect(s.page.getByTestId('import-done').filter({ hasText: '자료 1개를 가져왔습니다' })).toHaveCount(1);
    await expectDisabledReason(s.page.getByTestId('import-menu'), null);
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
