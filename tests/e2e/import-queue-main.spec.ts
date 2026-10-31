import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import type { ImportQueueState, ImportReport } from '../../packages/domain/src/library';
import { clickToCloseSheet, closeSheet, confirmCalls, distinctPdfs, expectWindow, importPaths, launch, stubConfirm } from './helpers';

// Main's import queue before any page can reach it (Task 4 connects the channels): the E2E hooks of main/test-hooks.ts
// put files in, hold one at a fault point and read the reports.
type PausePoint = 'afterStage' | 'afterPlace' | 'beforeCommit';
interface QueueHooks {
  importPause(input: { at: PausePoint | null }): void;
  importResume(): void;
  importWaiting(): PausePoint | null;
  enqueueImport(input: { paths: string[] }): number;
  importQueueState(): ImportQueueState;
  importReports(): ImportReport[];
}
type G = { __learnTest: QueueHooks };
const pauseAt = (app: ElectronApplication, at: PausePoint | null) => app.evaluate((_e, at) => (globalThis as unknown as G).__learnTest.importPause({ at }), at);
const resume = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as G).__learnTest.importResume());
const waitingAt = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as G).__learnTest.importWaiting());
const enqueue = (app: ElectronApplication, paths: string[]) => app.evaluate((_e, paths) => (globalThis as unknown as G).__learnTest.enqueueImport({ paths }), paths);
const queueState = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as G).__learnTest.importQueueState());
const reports = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as G).__learnTest.importReports());
const idle = (app: ElectronApplication) => expect.poll(async () => (await queueState(app)).state, { message: 'the queue went idle' }).toBe('idle');
const filesUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);

test('the E2E pause holds a queued file once its staging copy is verified; resumed, the run imports both (P-6)', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const s = await launch(lib, testInfo.outputPath('userdata'));
  try {
    const files = distinctPdfs(testInfo.outputPath('src'), 2);
    await pauseAt(s.app, 'afterStage');
    expect(await enqueue(s.app, files)).toBe(2);
    await expect.poll(() => waitingAt(s.app)).toBe('afterStage');
    // Held with its verified copy in staging/, nothing in assets/ or in the list yet.
    expect(fs.readdirSync(path.join(lib, 'staging')).filter((n) => n.endsWith('.part'))).toHaveLength(1);
    expect(filesUnder(path.join(lib, 'assets'))).toEqual([]);
    expect(await queueState(s.app)).toMatchObject({
      state: 'running', done: 0, total: 2, current: 'distinct-01.pdf', bytesTotal: files.reduce((n, f) => n + fs.statSync(f).size, 0),
    });
    await resume(s.app);
    await idle(s.app);
    expect(await reports(s.app)).toEqual([
      { imported: 2, filed: 0, filedExisting: 0, failed: [], openItemId: null, requested: 2, cancelled: false, mode: 'managed', collectionId: null },
    ]);
    expect(fs.readdirSync(path.join(lib, 'staging'))).toEqual([]);
    await expect(s.page.getByTestId('item-row')).toHaveCount(2);
  } finally {
    await s.app.close();
  }
});

test('queued duplicates are asked at the end in the sheet, with one answer for the rest (P-1)', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const rows = s.page.getByTestId('item-row');
  try {
    const first = await importPaths(s.page, distinctPdfs(testInfo.outputPath('first'), 3));
    await expect(rows).toHaveCount(3);
    // The same bytes under the same names in another folder (three duplicates) and one new file, a duplicate first.
    const again = distinctPdfs(testInfo.outputPath('again'), 4);

    // 새 자료로 추가 with the box as it opens (ticked): one question for all three, after the new file came in.
    let sheet = await expectWindow(s.app, 'sheet', () => enqueue(s.app, [again[0]!, again[3]!, again[1]!, again[2]!]));
    await expect(sheet.getByTestId('dup-file')).toHaveText('distinct-01.pdf');
    await expect(sheet.getByRole('checkbox', { name: '남은 중복 파일 2개에도 같은 선택 적용' })).toBeChecked();
    expect(await queueState(s.app)).toMatchObject({ state: 'waiting-choice', done: 1, total: 4, current: 'distinct-01.pdf' });
    await clickToCloseSheet(sheet, sheet.getByTestId('dup-add'));
    await idle(s.app);
    expect((await reports(s.app)).at(-1)).toMatchObject({ imported: 4, requested: 4, cancelled: false, openItemId: null });
    await expect(rows).toHaveCount(7);

    // Unticked from the keyboard (Space), ↩ skips this one only; the next asks again, and 기존 자료 열기 with its box
    // ticked opens that item and skips the last one unasked.
    sheet = await expectWindow(s.app, 'sheet', () => enqueue(s.app, again.slice(0, 3)));
    await expect(sheet.getByTestId('dup-skip')).toBeFocused();
    for (let i = 0; i < 3; i++) await sheet.keyboard.press('Shift+Tab');
    await expect(sheet.getByRole('checkbox')).toBeFocused();
    await sheet.keyboard.press('Space');
    await expect(sheet.getByRole('checkbox')).not.toBeChecked();
    const next = s.app.waitForEvent('window', { timeout: 15_000 });
    await closeSheet(sheet, 'Enter');
    sheet = await next;
    await sheet.locator('[data-sheet-root]').waitFor();
    await expect(sheet.getByTestId('dup-file')).toHaveText('distinct-02.pdf');
    await expect(sheet.getByRole('checkbox', { name: '남은 중복 파일 1개에도 같은 선택 적용' })).toBeChecked();
    await clickToCloseSheet(sheet, sheet.getByTestId('dup-open'));
    await expect.poll(async () => (await reports(s.app)).length).toBe(2);
    expect((await reports(s.app)).at(-1)).toMatchObject({ imported: 0, requested: 3, openItemId: first[1]!.id });
    expect(s.app.windows().filter((p) => !p.isClosed() && p.url().includes('window=sheet'))).toEqual([]);
    await expect(rows).toHaveCount(7);
  } finally {
    await s.app.close();
  }
});

test('quitting while the queue imports asks first: 취소 keeps it going, 끝내기 stops the file before its rename and quits (P-19)', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  let s = await launch(lib, ud);
  await pauseAt(s.app, 'afterStage');
  await enqueue(s.app, distinctPdfs(testInfo.outputPath('src'), 3));
  await expect.poll(() => waitingAt(s.app)).toBe('afterStage');

  await stubConfirm(s.app, 'cancel');
  await s.app.evaluate(({ app }) => app.quit());
  await expect.poll(() => confirmCalls(s.app)).toEqual([
    { type: 'warning', message: '가져오는 중입니다', detail: '끝내면 남은 3개는 가져오지 않습니다.', buttons: ['끝내기', '취소'], defaultId: 0, cancelId: 1 },
  ]);
  expect(await waitingAt(s.app)).toBe('afterStage'); // still held: the import goes on

  await stubConfirm(s.app, 'confirm');
  const exited = new Promise((resolve) => s.app.process().once('exit', resolve));
  await s.app.evaluate(({ app }) => app.quit());
  await expect.poll(async () => (await confirmCalls(s.app)).length).toBe(1);
  // Let go, the held file meets the stop at its checkpoint before the rename; the app then quits by itself.
  await resume(s.app).catch(() => {});
  await exited;

  expect(fs.readdirSync(path.join(lib, 'staging'))).toEqual([]);
  expect(filesUnder(path.join(lib, 'assets'))).toEqual([]);
  s = await launch(lib, ud);
  try {
    expect(await s.page.evaluate(() => window.learn.library.list())).toEqual({ ok: true, data: [] });
  } finally {
    await s.app.close();
  }
});
