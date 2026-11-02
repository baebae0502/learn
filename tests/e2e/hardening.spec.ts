import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { ERROR_COPY } from '../../packages/domain/src/errors';
import { clickToCloseSheet, expectWindow, importFiles, launch, stubOpenDialog } from './helpers';

/** Bytes that sniff as a PDF; `body` makes the hash differ. */
function fakePdf(dir: string, name: string, body: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, `%PDF-1.4\n% ${body}\n%%EOF\n`);
  return p;
}

/** main's E2E hook (test-hooks.ts stageCommitFailures): import commits fail as SQLite fails on a full disk, or not. */
const failImportCommits = (app: ElectronApplication, code: 'SQLITE_FULL' | null) =>
  app.evaluate((_electron, c) => {
    (globalThis as unknown as { __learnTest: { failImportCommits(input: { code: 'SQLITE_FULL' | null }): void } }).__learnTest.failImportCommits({ code: c });
  }, code);

test('a full disk at the import commit says so with the next step; once there is room the same file imports', async ({}, testInfo) => {
  const file = fakePdf(testInfo.outputPath('src'), '강의 노트.pdf', 'full disk');
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await failImportCommits(s.app, 'SQLITE_FULL');
    await importFiles(s, [file]);
    const toast = s.page.getByTestId('import-failures');
    await expect(toast).toContainText('파일 1개를 가져오지 못했습니다');
    await expect(toast).toContainText('강의 노트.pdf');
    await expect(toast).toContainText('저장 공간이 부족합니다.'); // the cause on the file's line
    await expect(toast).toContainText('디스크 공간을 확보한 뒤 다시 시도하세요.'); // the next step, once
    await expect(s.page.getByTestId('item-row')).toHaveCount(0);
    await toast.getByTestId('toast-close').click();

    await failImportCommits(s.app, null);
    await importFiles(s, [file]);
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    await expect(s.page.getByTestId('import-done').filter({ hasText: '자료 1개를 가져왔습니다' })).toBeVisible();
  } finally {
    await s.app.close();
  }
});

test('a library database that is not a database is reported as damaged, not as an unknown error', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'library.sqlite'), 'not a database');
  const s = await launch(lib, testInfo.outputPath('userdata'));
  try {
    await expect(s.page.getByTestId('fatal-screen')).toBeVisible();
    const info = await s.page.evaluate(() => window.learn.app.info());
    if (!info.ok) throw new Error(info.code);
    expect(info.data.libraryError).toEqual({ code: 'LIBRARY_UNAVAILABLE', message: ERROR_COPY.libraryCorrupt });
  } finally {
    await s.app.close();
  }
});

test('다시 연결… from the newer of two items on one moved file answers that item, and both rows come back', async ({}, testInfo) => {
  const src = testInfo.outputPath('src');
  const file = fakePdf(src, '공유 원본.pdf', 'shared');
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importFiles(s, [file], 'linked');
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    const sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, [file], 'linked'));
    await clickToCloseSheet(sheet, sheet.getByTestId('dup-add'));
    await expect(s.page.getByTestId('item-row')).toHaveCount(2);
    // library.list is newest first.
    const [newer, older] = await s.page.evaluate(async () => {
      const r = await window.learn.library.list();
      if (!r.ok) throw new Error(r.code);
      return r.data.map((i) => ({ id: i.id, assetId: i.assetId }));
    });
    expect(newer!.assetId).toBe(older!.assetId);

    const moved = path.join(src, 'moved.pdf');
    fs.renameSync(file, moved);
    // library.get checks the file again and announces both items as missing.
    await s.page.evaluate((itemId) => window.learn.library.get({ itemId }), newer!.id);
    await expect(s.page.getByTestId('missing-flag')).toHaveCount(2);

    await stubOpenDialog(s.app, [moved]);
    const answer = await s.page.evaluate((itemId) => window.learn.library.pickAndRelink({ itemId }), newer!.id);
    expect(answer).toMatchObject({ ok: true, data: { id: newer!.id, availability: 'available' } });
    await expect(s.page.getByTestId('missing-flag')).toHaveCount(0);
  } finally {
    await s.app.close();
  }
});
