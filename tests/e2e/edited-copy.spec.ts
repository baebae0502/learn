// M6 외부 수정본 (spec 6): copies another app saved beside the read-only copy, in the item panel's 파일 section —
// 새 자료로 가져오기 through the import queue (the copy goes after its commit, only with its bytes unchanged) and
// Finder에서 보기 with it selected. The panel reads them when it shows the item and when the window gets the focus back.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { LibraryItem } from '../../packages/domain/src/library';
import { expectNoSeriousA11y } from './a11y';
import {
  FIXTURES, addToCollection, createCollection, distinctPdfs, importPause, importPaths, importResume, importWaiting, launch, organizeSnapshot, runMenuCommand,
  shellCalls, stubShell,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const row = (page: Page, id: string) => page.locator(`[data-testid="item-row"][data-item-id="${id}"]`);
const ASIDE = /^세포생물학 3장 \(수정본 \d{4}-\d{2}-\d{2} \d{4}\)\.pdf$/;
const sha256 = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
async function listed(page: Page): Promise<LibraryItem[]> {
  const r = await page.evaluate(() => window.learn.library.list());
  if (!r.ok) throw new Error(`library.list failed: ${r.code}`);
  return r.data;
}
/** 세포생물학 3장.pdf: the sample's bytes and a line of its own. */
function lecture(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '세포생물학 3장.pdf');
  fs.writeFileSync(file, Buffer.concat([fs.readFileSync(PDF), Buffer.from('\n% 세포생물학 3장\n')]));
  return file;
}
/** The main window losing the focus and getting it back, as main pushes it (a window manager-less Xvfb sends no focus change). */
async function focusBounce(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('window=main'))!;
    for (const focused of [false, true]) w.webContents.send('evt:window-state', { fullscreen: w.isFullScreen(), focused, sheetOpen: false, main: focused });
  });
}

test('an edited copy kept aside shows in the item panel when the item is shown again; 새 자료로 가져오기 imports it as a new item titled after it, in no collection, and removes it; Finder에서 보기 selects it', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const { app, page } = await launch(lib, testInfo.outputPath('userdata'));
  try {
    const [item] = await importPaths(page, [lecture(testInfo.outputPath('in'))]);
    const [other] = await importPaths(page, distinctPdfs(testInfo.outputPath('other'), 1));
    const coll = await createCollection(page, '강의');
    await addToCollection(page, coll, [item!.id]);
    await stubShell(app);
    await row(page, item!.id).click();
    await expect(page.getByTestId('file-section')).toBeVisible();
    await expect(page.getByTestId('edited-copies')).toHaveCount(0);

    // 기본 앱으로 열기 makes the read-only named copy; another app unlocks it and saves an edit into it.
    await runMenuCommand(app, 'item.openExternally');
    await expect.poll(async () => (await shellCalls(app)).length).toBe(1);
    const named = (await shellCalls(app))[0]![1];
    const folder = path.join(lib, 'derived', 'open', item!.assetId);
    expect(named).toBe(path.join(folder, '세포생물학 3장.pdf'));
    fs.chmodSync(named, 0o644);
    fs.appendFileSync(named, '% edited in another app\n');
    const edited = fs.readFileSync(named);
    // The next 기본 앱으로 열기 keeps the edited one aside (openable.ts) and opens a fresh copy.
    await runMenuCommand(app, 'item.openExternally');
    await expect.poll(async () => (await shellCalls(app)).length).toBe(2);
    const aside = fs.readdirSync(folder).find((n) => ASIDE.test(n.normalize('NFC')))!;
    expect(aside).toBeDefined();

    // The panel learns of it when it shows the item again.
    await row(page, other!.id).click();
    await row(page, item!.id).click();
    const card = page.getByTestId('edited-copies');
    await expect(card.getByTestId('edited-copies-head')).toHaveText('다른 앱에서 고친 수정본 1개');
    await expect(card.getByTestId('edited-copy')).toHaveAttribute('data-name', aside.normalize('NFC'));
    await expectNoSeriousA11y(page, 'the item panel with an edited copy');

    await card.getByTestId('edited-copy-reveal').click();
    await expect.poll(async () => (await shellCalls(app)).at(-1)).toEqual(['reveal', path.join(folder, aside)]);

    await card.getByTestId('edited-copy-import').click();
    await expect(page.getByTestId('import-done')).toHaveText('자료 1개를 가져왔습니다');
    await expect(card).toHaveCount(0);
    expect(fs.existsSync(path.join(folder, aside))).toBe(false);
    const added = (await listed(page)).find((i) => i.id !== item!.id && i.id !== other!.id)!;
    expect(added).toMatchObject({ title: path.parse(aside).name.normalize('NFC'), storageMode: 'managed' });
    const detail = await page.evaluate((itemId) => window.learn.library.detail({ itemId }), added.id);
    expect(detail.ok && detail.data.file.sha256).toBe(sha256(edited));
    expect((await organizeSnapshot(page)).members[coll]).toEqual([item!.id]); // not filed with the original
  } finally {
    await app.close();
  }
});

test('a copy saved over while it is imported stays, its bytes checked again after the commit; the panel reads the copies again when the window gets the focus back', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const { app, page } = await launch(lib, testInfo.outputPath('userdata'));
  try {
    const [item] = await importPaths(page, [lecture(testInfo.outputPath('in'))]);
    await row(page, item!.id).click();
    await expect(page.getByTestId('file-section')).toBeVisible();
    // A copy appears while the item is shown: nothing reads it until the window gets the focus back.
    const folder = path.join(lib, 'derived', 'open', item!.assetId);
    fs.mkdirSync(folder, { recursive: true });
    const copy = path.join(folder, '세포생물학 3장 (수정본 2026-10-30 1412).pdf');
    fs.writeFileSync(copy, Buffer.concat([fs.readFileSync(PDF), Buffer.from('\n% edited in another app\n')]));
    await page.waitForTimeout(300);
    await expect(page.getByTestId('edited-copies')).toHaveCount(0);
    await focusBounce(app);
    const card = page.getByTestId('edited-copies');
    await expect(card.getByTestId('edited-copy')).toHaveCount(1);
    await expect(card.locator('.ec-meta')).toHaveText(/^\d{4}\. \d{1,2}\. \d{1,2}\. 오[전후] \d{1,2}:\d{2}$/);

    // Held right before its commit, the copy is saved over: the library keeps the bytes it read, the copy stays.
    await importPause(app, 'beforeCommit');
    await card.getByTestId('edited-copy-import').click();
    await expect.poll(() => importWaiting(app)).toBe('beforeCommit');
    await expect(card.getByTestId('edited-copy-import')).toHaveAttribute('aria-disabled', 'true');
    fs.appendFileSync(copy, '% saved again\n');
    await importResume(app);
    await expect(page.getByTestId('import-done')).toHaveText('자료 1개를 가져왔습니다');
    expect(fs.existsSync(copy)).toBe(true);
    await expect(card.getByTestId('edited-copy')).toHaveCount(1);
    await expect(card.getByTestId('edited-copy-import')).not.toHaveAttribute('aria-disabled', 'true');
    const added = (await listed(page)).find((i) => i.id !== item!.id)!;
    expect(added.title).toBe('세포생물학 3장 (수정본 2026-10-30 1412)');
  } finally {
    await app.close();
  }
});
