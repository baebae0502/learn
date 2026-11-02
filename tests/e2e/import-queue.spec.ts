// The import queue through the window (spec 3, Task 4): the progress toast in place, files joining a run, 취소 from the toast
// and from the palette, one answer for the remaining duplicates, the palette held under the question (next-session M6), a
// drop of more than 500 files (P-2), waiting for the work before it, and the empty library's busy screen counting the queue.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import {
  backupPause, backupResume, backupWaiting, clickToCloseSheet, closeSheet, distinctPdfs, drag, dropSource, expectWindow, holdJob, importFiles, importPause, importPaths, importResume, importWaiting, launch,
  mainWindow, menuItemEnabled, releaseJob, rowByTitle, runMenuCommand, runPalette, stubFolderPicker, waitBackupIdle, waitImportIdle,
} from './helpers';

/** A file that imports as a PDF (sniffed by its header), `bytes` long, with content of its own. */
function fakePdf(dir: string, name: string, bytes = 0): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, `%PDF-1.4\n% ${name}\n%%EOF\n`);
  if (bytes > 0) fs.truncateSync(file, bytes);
  return file;
}
const filesUnder = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name) : []);
const toast = (page: import('@playwright/test').Page) => page.getByTestId('import-progress');

test('the progress toast: none for a short run; past 1 s one toast, in place, its bar on the hashed bytes, that becomes the result (spec 3.3, P-3)', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const src = testInfo.outputPath('src');
  try {
    await s.page.evaluate(() => {
      const w = window as unknown as { __progressSeen?: boolean; __toastNodes: number };
      w.__toastNodes = 0;
      new MutationObserver((records) => {
        if (document.querySelector('[data-testid="import-progress"]')) w.__progressSeen = true;
        for (const r of records) for (const n of r.addedNodes) if (n instanceof Element) w.__toastNodes += n.matches('.toast') ? 1 : n.querySelectorAll('.toast').length;
      }).observe(document.body, { childList: true, subtree: true, attributes: true });
    });
    await importFiles(s, [fakePdf(src, 'quick.pdf')]);
    await expect(s.page.getByTestId('import-done')).toHaveText('자료 1개를 가져왔습니다');
    await waitImportIdle(s.page);
    expect(await s.page.evaluate(() => (window as unknown as { __progressSeen?: boolean }).__progressSeen ?? false)).toBe(false);
    await expect(s.page.getByTestId('import-done')).toHaveCount(0, { timeout: 10_000 }); // its result closes by itself after 5 s

    await s.page.evaluate(() => void ((window as unknown as { __toastNodes: number }).__toastNodes = 0));
    await importPause(s.app, 'beforeCommit');
    await importFiles(s, [fakePdf(src, 'big-1.pdf', 300_000), fakePdf(src, 'big-2.pdf', 100_000), fakePdf(src, 'big-3.pdf', 100_000)]);
    await expect.poll(() => importWaiting(s.app)).toBe('beforeCommit');
    await expect(toast(s.page)).toHaveAttribute('data-state', 'running');
    await expect(toast(s.page)).toContainText('가져오는 중 · 0 / 3');
    await expect(toast(s.page).locator('.t-file')).toHaveText('big-1.pdf');
    const bar = toast(s.page).getByRole('progressbar', { name: '가져오는 중' });
    await expect(bar).toHaveAttribute('aria-valuenow', '30'); // 300 KB of 500 KB hashed is half of that file's work
    await expect(bar).toHaveAttribute('aria-valuetext', '파일 3개 중 0개, 30%');
    await expect(toast(s.page).locator('.pct')).toHaveText('30%');
    // Only the title is the announced part (RAC's role=alert): the count and the bar change ten times a second.
    await expect(toast(s.page).getByRole('alert')).toHaveText('가져오는 중');
    await importResume(s.app);
    await expect(s.page.getByTestId('import-done')).toHaveText('자료 3개를 가져왔습니다');
    expect(await s.page.evaluate(() => (window as unknown as { __toastNodes: number }).__toastNodes)).toBe(1); // one toast, progress to result
    await waitImportIdle(s.page);
  } finally {
    await s.app.close();
  }
});

test('취소 from the toast: the file past its rename still comes in, the rest are dropped — "3개 중 1개를 가져왔습니다" (spec 3.5)', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const s = await launch(lib, testInfo.outputPath('userdata'));
  try {
    await importPause(s.app, 'beforeCommit');
    await importFiles(s, distinctPdfs(testInfo.outputPath('src'), 3));
    await expect.poll(() => importWaiting(s.app)).toBe('beforeCommit');
    await toast(s.page).getByTestId('import-cancel').click();
    await importResume(s.app);
    await expect(s.page.getByTestId('import-done')).toContainText('3개 중 1개를 가져왔습니다');
    await expect(s.page.getByTestId('import-done')).toContainText('취소해서 남은 2개는 가져오지 않았습니다.');
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    await waitImportIdle(s.page);
    expect(fs.readdirSync(path.join(lib, 'staging'))).toEqual([]);
  } finally {
    await s.app.close();
  }
});

test('취소 pressed with the keyboard: the focus goes back to the table, and the result toast closes by itself after 5 s (M6 task 4 fix 2)', async ({}, testInfo) => {
  const src = testInfo.outputPath('src');
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, distinctPdfs(path.join(src, 'first'), 1));
    await waitImportIdle(s.page);
    await importPause(s.app, 'beforeCommit');
    await importFiles(s, distinctPdfs(path.join(src, 'more'), 3));
    await expect.poll(() => importWaiting(s.app)).toBe('beforeCommit');
    await expect(toast(s.page)).toBeVisible();
    await s.page.getByTestId('item-row').first().focus();
    await expect.poll(() => s.page.evaluate(() => document.querySelector('[data-pane="content"]')?.contains(document.activeElement) ?? false)).toBe(true);
    // F6 from the table would pass the item panel first, so the toast region is entered straight from the table.
    await s.page.evaluate(() => document.querySelector<HTMLElement>('[data-pane="toasts"] .toast')!.focus());
    for (let i = 0; i < 3 && !(await s.page.getByTestId('import-cancel').evaluate((b) => b === document.activeElement)); i++) {
      await s.page.keyboard.press('Tab'); // F6 lands on the toast itself; Tab reaches 취소
    }
    await expect(s.page.getByTestId('import-cancel')).toBeFocused();
    await s.page.keyboard.press('Space');
    await importResume(s.app);
    await expect(s.page.getByTestId('import-done')).toBeVisible();
    const where = await s.page.evaluate(() => ({
      inContent: document.querySelector('[data-pane="content"]')?.contains(document.activeElement) ?? false,
      body: document.activeElement === document.body,
    }));
    expect(where).toEqual({ inContent: true, body: false });
    await expect(s.page.getByTestId('import-done')).toHaveCount(0, { timeout: 7000 });
  } finally {
    await s.app.close();
  }
});

// 가져오기 취소 stops the file at its checkpoint: nothing of it is left, and the result reads "가져오기를 취소했습니다" (spec 11.1).
test('가져오기 취소 from the palette stops the file at its checkpoint', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const s = await launch(lib, testInfo.outputPath('userdata'));
  try {
    await importPause(s.app, 'afterStage');
    await importFiles(s, distinctPdfs(testInfo.outputPath('src'), 2));
    await expect.poll(() => importWaiting(s.app)).toBe('afterStage');
    await runPalette(s.page, s.app, '가져오기 취소', 'file.cancelImport');
    await importResume(s.app);
    const done = s.page.getByTestId('import-done');
    await expect(done).toContainText('가져오기를 취소했습니다');
    await expect(done).toContainText('파일 2개를 가져오지 않았습니다.');
    await expect(done).toHaveAttribute('data-kind', 'info');
    await waitImportIdle(s.page);
    expect(fs.readdirSync(path.join(lib, 'staging'))).toEqual([]);
    expect(filesUnder(path.join(lib, 'assets'))).toEqual([]);
    await expect(s.page.getByTestId('item-row')).toHaveCount(0);
  } finally {
    await s.app.close();
  }
});

test('the duplicates of a window\'s import are asked at the end: 확인을 기다리는 중 in the toast, one answer for the rest, 기존 자료 열기 opens it here (spec 3.4)', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const files = distinctPdfs(testInfo.outputPath('src'), 3);
    const items = await importPaths(s.page, files);
    const sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, files));
    await expect(sheet.getByTestId('dup-file')).toHaveText('distinct-01.pdf');
    await expect(sheet.getByRole('checkbox', { name: '남은 중복 파일 2개에도 같은 선택 적용' })).toBeChecked();
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged')).toBe(false); // the sheet holds the window
    await expect(toast(s.page)).toHaveAttribute('data-state', 'waiting-choice');
    await expect(toast(s.page)).toContainText('확인을 기다리는 중 · 0 / 3');
    await expect(toast(s.page).locator('.t-file')).toHaveText('distinct-01.pdf');
    await clickToCloseSheet(sheet, sheet.getByTestId('dup-open'));
    await expect(s.page.getByTestId('viewer-title')).toHaveText(items[0]!.title);
    await expect(toast(s.page)).toHaveCount(0); // nothing came in: the toast goes
    await waitImportIdle(s.page);
    expect(s.app.windows().filter((p) => !p.isClosed() && p.url().includes('window=sheet'))).toEqual([]); // the rest: skipped, unasked
  } finally {
    await s.app.close();
  }
});

test('취소 while the duplicate question is open closes its sheet and ends the run: "가져오기를 취소했습니다" (spec 3.5)', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const files = distinctPdfs(testInfo.outputPath('src'), 3);
    await importPaths(s.page, files);
    const sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, files));
    await expect(sheet.getByTestId('dup-file')).toHaveText('distinct-01.pdf');
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged')).toBe(false); // the sheet holds the window
    await s.page.evaluate(() => window.learn.library.cancelImport());
    await expect.poll(() => sheet.isClosed()).toBe(true);
    await expect(s.page.getByTestId('import-done')).toContainText('가져오기를 취소했습니다');
    await expect(s.page.getByTestId('import-done')).toContainText('파일 3개를 가져오지 않았습니다.');
    await waitImportIdle(s.page);
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged')).toBe(true); // the window is let go
    expect(s.app.windows().filter((p) => !p.isClosed() && p.url().includes('window=sheet'))).toEqual([]);
  } finally {
    await s.app.close();
  }
});

test('the palette under the duplicate question: held, 설정… alone, F6 kept in its field, no serious axe issue; back once answered (next-session M6)', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const src = testInfo.outputPath('src');
  try {
    const [again] = distinctPdfs(src, 1);
    await importPaths(s.page, [again!]);
    await importPause(s.app, 'afterStage');
    await importFiles(s, [fakePdf(src, 'fresh.pdf'), again!]); // a new file first, then a duplicate
    await expect.poll(() => importWaiting(s.app)).toBe('afterStage');
    // The import runs behind the window: ⌘K opens the palette (nothing holds the window).
    await runMenuCommand(s.app, 'app.palette');
    await expect(s.page.getByTestId('palette-input')).toBeFocused();
    await expect(s.page.getByTestId('palette-busy')).toHaveCount(0);
    const sheet = await expectWindow(s.app, 'sheet', () => importResume(s.app));
    await expect(s.page.getByTestId('palette-busy')).toBeVisible();
    await expect(s.page.getByTestId('palette-item')).toHaveCount(1);
    await expect(s.page.locator('[data-testid="palette-item"][data-command-id="app.settings"]')).toBeVisible();
    await expectNoSeriousA11y(s.page, 'palette while a duplicate question holds the window');
    for (const key of ['F6', 'Shift+F6']) {
      await s.page.keyboard.press(key);
      await expect(s.page.getByTestId('palette-input')).toBeFocused();
    }
    await closeSheet(sheet, 'Escape');
    await expect(s.page.getByTestId('palette-busy')).toHaveCount(0);
    await s.page.keyboard.press('Escape');
    await expect(s.page.getByTestId('palette')).toHaveCount(0);
    await waitImportIdle(s.page);
  } finally {
    await s.app.close();
  }
});

test('a drop of 600 files goes in 500 at a time: one run, one toast; main sends at most 10 progress notices a second (P-2, spec 3.3)', async ({}, testInfo) => {
  test.setTimeout(240_000);
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const files = distinctPdfs(testInfo.outputPath('src'), 600);
    await (await mainWindow(s.app)).evaluate((w) => {
      const g = globalThis as { __sentProgress?: number[]; __importCalls?: number };
      g.__sentProgress = [];
      const send = w.webContents.send.bind(w.webContents);
      w.webContents.send = (channel: string, ...args: unknown[]) => {
        if (channel === 'evt:import-progress') g.__sentProgress!.push(performance.now());
        send(channel, ...args);
      };
    });
    const before = (await s.app.evaluate(() => (globalThis as { __learnIpcCalls?: Record<string, number> }).__learnIpcCalls?.['library:import'])) ?? 0;
    await s.page.evaluate(() => {
      const w = window as unknown as { __toastNodes: number };
      w.__toastNodes = 0;
      new MutationObserver((records) => {
        for (const r of records) for (const n of r.addedNodes) if (n instanceof Element) w.__toastNodes += n.matches('.toast') ? 1 : n.querySelectorAll('.toast').length;
      }).observe(document.body, { childList: true, subtree: true });
    });
    await dropSource(s.page, files);
    await drag(s.page, 'dragenter', 'source');
    await drag(s.page, 'drop', 'source', { repeat: false });
    await expect(s.page.getByTestId('import-done')).toHaveText('자료 600개를 가져왔습니다', { timeout: 180_000 });
    await waitImportIdle(s.page);
    const calls = (await s.app.evaluate(() => (globalThis as { __learnIpcCalls?: Record<string, number> }).__learnIpcCalls?.['library:import'])) ?? 0;
    expect(calls - before).toBe(2);
    await expect(s.page.getByTestId('import-done')).toHaveCount(1);
    expect(await s.page.evaluate(() => (window as unknown as { __toastNodes: number }).__toastNodes)).toBe(1); // one toast, progress to result
    const sent = await s.app.evaluate(() => (globalThis as { __sentProgress?: number[] }).__sentProgress ?? []);
    const busiest = Math.max(...sent.map((t) => sent.filter((x) => x >= t && x < t + 1000).length));
    expect(sent.length).toBeGreaterThan(10);
    expect(busiest).toBeLessThanOrEqual(10);
    await expect(rowByTitle(s.page, 'distinct-600')).toHaveCount(1);
  } finally {
    await s.app.close();
  }
});

test('waiting behind the work before it: 앞의 작업을 기다리는 중, then the run goes and its toast becomes its result (spec 3.1, 3.3)', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await holdJob(s.app, 'backup');
    await importFiles(s, distinctPdfs(testInfo.outputPath('src'), 2));
    await expect(toast(s.page)).toHaveAttribute('data-state', 'waiting-job');
    await expect(toast(s.page)).toContainText('앞의 작업을 기다리는 중 · 2개');
    await expect(toast(s.page)).toContainText('앞의 작업이 끝나면 가져오기를 시작합니다.');
    await expect(toast(s.page).getByRole('progressbar')).toHaveCount(0); // nothing to measure yet
    const node = await toast(s.page).elementHandle();
    await releaseJob(s.app);
    await expect(s.page.getByTestId('import-done')).toHaveText('자료 2개를 가져왔습니다');
    expect(await node!.evaluate((e) => e.isConnected)).toBe(true);
    await waitImportIdle(s.page);
  } finally {
    await s.app.close();
  }
});

test('the empty library\'s busy screen counts the queue: 2 becomes 3 with a second drop, without starting over (spec 3.2)', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [a, b, c] = distinctPdfs(testInfo.outputPath('src'), 3);
    await importPause(s.app, 'beforeCommit');
    await dropSource(s.page, [a!, b!]);
    await drag(s.page, 'dragenter', 'source');
    await drag(s.page, 'drop', 'source', { repeat: false });
    const empty = s.page.getByTestId('empty-state');
    await expect(empty).toHaveAttribute('data-busy', 'text');
    await expect(empty.getByRole('heading')).toHaveText('자료 2개를 가져오는 중…');
    const heading = await empty.getByRole('heading').elementHandle();
    await dropSource(s.page, [c!]);
    await drag(s.page, 'dragenter', 'source');
    await drag(s.page, 'drop', 'source', { repeat: false });
    await expect(empty.getByRole('heading')).toHaveText('자료 3개를 가져오는 중…');
    expect(await heading!.evaluate((e) => e.isConnected)).toBe(true);
    await expect(empty).toHaveAttribute('data-busy', 'text');
    await importResume(s.app);
    await expect(s.page.getByTestId('item-row')).toHaveCount(3);
    await expect(s.page.getByTestId('import-done')).toHaveText('자료 3개를 가져왔습니다');
    await waitImportIdle(s.page);
  } finally {
    await s.app.close();
  }
});

/** The focused element's own outline, as drawn: what a keyboard user sees as the ring. */
const focusRing = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const style = getComputedStyle(el);
    // The shared focus token, resolved the way the browser resolves it for an outline (light-dark() included).
    const probe = document.createElement('i');
    probe.style.outlineColor = 'var(--focus)';
    el.append(probe);
    const token = getComputedStyle(probe).outlineColor;
    probe.remove();
    return { testId: el.dataset['testid'] ?? null, isToast: el.matches('.toast'), inToasts: el.closest('[data-pane="toasts"]') !== null, style: style.outlineStyle, width: Number.parseFloat(style.outlineWidth), color: style.outlineColor, token };
  });

test('F6 into a job toast shows a focus ring on what it lands on (M6 task 4 review, Open-1)', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [first, ...more] = distinctPdfs(testInfo.outputPath('src'), 3);
    await importPaths(s.page, [first!]);
    await importPause(s.app, 'beforeCommit');
    await importFiles(s, more);
    await expect.poll(() => importWaiting(s.app)).toBe('beforeCommit');
    await expect(toast(s.page)).toBeVisible();
    await s.page.getByTestId('item-row').first().click(); // the pointer was the last input, as it is when the user reaches for F6
    for (let i = 0; i < 4 && !(await focusRing(s.page)).inToasts; i++) await s.page.keyboard.press('F6');
    const ring = await focusRing(s.page);
    expect(ring.inToasts).toBe(true);
    expect(ring.isToast).toBe(true); // the toast itself carries the ring, not a control inside it
    expect(ring.style).toBe('solid');
    expect(ring.width).toBe(2);
    expect(ring.color).toBe(ring.token);
    await importResume(s.app);
    await waitImportIdle(s.page);
  } finally {
    await s.app.close();
  }
});

test('a job toast that closes with no result while 취소 has the focus hands the focus on: the next toast if one is left, else the table (M6 task 4 review, N1)', async ({}, testInfo) => {
  const parent = testInfo.outputPath('backups');
  fs.mkdirSync(parent, { recursive: true });
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const where = () =>
    s.page.evaluate(() => ({
      body: document.activeElement === document.body,
      inContent: document.querySelector('[data-pane="content"]')?.contains(document.activeElement) ?? false,
      inToasts: document.querySelector('[data-pane="toasts"]')?.contains(document.activeElement) ?? false,
      inBackupToast: document.activeElement?.closest('[data-testid="backup-progress"]') != null,
    }));
  const startBackup = async () => {
    await backupPause(s.app);
    await stubFolderPicker(s.app, parent);
    await runMenuCommand(s.app, 'file.backup');
    await expect.poll(() => backupWaiting(s.app)).not.toBeNull();
    await expect(s.page.getByTestId('backup-progress')).toBeVisible();
  };
  try {
    const [a, b, ...more] = distinctPdfs(testInfo.outputPath('src'), 4);
    await importPaths(s.page, [a!, b!]);

    // Nothing else on screen: the table has the focus afterwards (the done backup's sheet speaks for it; no result toast).
    await startBackup();
    await s.page.getByTestId('backup-progress').getByTestId('backup-cancel').focus();
    await expect(s.page.getByTestId('backup-cancel')).toBeFocused();
    let sheet = await expectWindow(s.app, 'sheet', () => backupResume(s.app));
    await expect(s.page.getByTestId('backup-progress')).toHaveCount(0);
    expect(await where()).toMatchObject({ body: false, inContent: true });
    await closeSheet(sheet, 'Enter');
    await waitBackupIdle(s.app);

    // An import waits behind the backup, so its toast is still there when the backup's goes: the focus moves to it.
    await startBackup();
    await importPause(s.app, 'beforeCommit');
    await importFiles(s, more);
    await expect(toast(s.page)).toHaveAttribute('data-state', 'waiting-job');
    await s.page.getByTestId('backup-progress').getByTestId('backup-cancel').focus();
    await expect(s.page.getByTestId('backup-cancel')).toBeFocused();
    sheet = await expectWindow(s.app, 'sheet', () => backupResume(s.app));
    await expect(s.page.getByTestId('backup-progress')).toHaveCount(0);
    expect(await where()).toMatchObject({ body: false, inToasts: true, inBackupToast: false });
    await closeSheet(sheet, 'Enter');
    // The import starts when the backup lets go of the line, while the sheet is still opening: a resume sent before the
    // file reaches its hold is lost and the file then waits there for good (Mac all 41387123318, failure 2).
    await expect.poll(() => importWaiting(s.app)).toBe('beforeCommit');
    await importResume(s.app);
    await waitImportIdle(s.page);
  } finally {
    await s.app.close();
  }
});
