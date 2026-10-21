import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launch, openItem, stubOpenDialog } from './helpers';

function fakePdf(dir: string, name: string, body: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, name);
  fs.writeFileSync(p, `%PDF-1.4\n% ${body}\n%%EOF\n`);
  return p;
}

test('import, duplicate prompt, missing linked file and relink', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  const src = testInfo.outputPath('src');
  const a = fakePdf(src, 'Chapter 06.pdf', 'six');
  const b = fakePdf(src, '신호 전달 (2).pdf', 'two');

  let { app, page } = await launch(lib, ud);
  await expect(page.getByTestId('empty-state')).toBeVisible();

  await stubOpenDialog(app, [a]);
  await page.getByTestId('import-managed').click();
  await expect(page.getByTestId('item-row')).toHaveCount(1);

  await stubOpenDialog(app, [a]);
  await page.getByTestId('import-managed').click();
  await expect(page.getByTestId('duplicate-dialog')).toBeVisible();
  await page.getByTestId('dup-cancel').click();
  await expect(page.getByTestId('duplicate-dialog')).toBeHidden();
  await expect(page.getByTestId('item-row')).toHaveCount(1);

  await stubOpenDialog(app, [a]);
  await page.getByTestId('import-managed').click();
  await page.getByTestId('dup-add').click();
  await expect(page.getByTestId('item-row')).toHaveCount(2);

  await stubOpenDialog(app, [a]);
  await page.getByTestId('import-managed').click();
  await page.getByTestId('dup-open').click();
  await expect(page.getByTestId('viewer-title')).toHaveText('Chapter 06');
  await page.getByTestId('viewer-back').click();

  const notes = path.join(src, 'notes.txt');
  fs.writeFileSync(notes, 'plain text');
  await stubOpenDialog(app, [notes]);
  await page.getByTestId('import-managed').click();
  await expect(page.getByTestId('import-failures')).toContainText('지원하지 않는 형식');

  await stubOpenDialog(app, [b]);
  await page.getByTestId('import-linked').click();
  await expect(page.getByTestId('item-row')).toHaveCount(3);
  await app.close();

  const moved = path.join(src, 'moved.pdf');
  fs.renameSync(b, moved);
  ({ app, page } = await launch(lib, ud));
  const row = page.getByTestId('item-row').filter({ hasText: '신호 전달 (2)' });
  await expect(row.getByTestId('availability-badge')).toHaveText('파일 없음');
  await openItem(page, '신호 전달 (2)');
  await expect(page.getByTestId('missing-notice')).toBeVisible();
  await stubOpenDialog(app, [moved]);
  await page.getByTestId('relink').click();
  await expect(page.getByTestId('missing-notice')).toBeHidden();
  await page.getByTestId('viewer-back').click();
  await expect(row.getByTestId('availability-badge')).toHaveText('사용 가능');
  await page.screenshot({ path: testInfo.outputPath('library.png') });
  await app.close();
});
