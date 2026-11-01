// 백업 (spec 8, P-20): the folder it makes and what is in it, the result sheet and 마지막 백업, its toast and 취소, a copy
// that reads back different, the work line it shares with imports, and quitting while it runs.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  addToCollection, assignTag, backupPause, backupResume, backupWaiting, clickToCloseSheet, closeSheet, confirmCalls, createCollection, createTag, distinctPdfs,
  documentsDir, enabledMenuCommands, expectWindow, folderPicks, importFiles, importPause, importPaths, importResume, launch, runMenuCommand, runPalette,
  shellCalls, stubConfirm, stubFolderPicker, stubShell, trashItems, waitBackupIdle, waitImportIdle,
} from './helpers';

/** manifest.json as the backup writes it (packages/library/src/backup.ts BackupManifest). */
interface Manifest {
  format: string;
  formatVersion: number;
  createdAt: string;
  counts: Record<string, number>;
  assets: Array<{ assetId: string; sha256: string; storageMode: 'managed' | 'linked'; relativePath: string | null; externalPath: string | null; size: number; included: boolean }>;
}
const NAME = /^Learn 백업 \d{4}-\d{2}-\d{2} \d{4}$/;
const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readManifest = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')) as Manifest;
const kvLast = (page: Page) => page.evaluate(() => window.learn.settings.get({ key: 'backup.last' }));
/** The name a backup made in `when`'s minute takes first (spec 8.1), in local time as main writes it. */
function nameAt(when: Date): string {
  const two = (n: number) => String(n).padStart(2, '0');
  return `Learn 백업 ${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())} ${two(when.getHours())}${two(when.getMinutes())}`;
}
const folderFor = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** The job toasts on screen from top to bottom, by test id: the DOM order, which is also F6's and the arrow keys'. */
const toastOrder = (page: Page) =>
  page.locator('[data-pane="toasts"] .toast').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset['testid']).filter((id) => id?.endsWith('-progress')));

test('a backup holds the database, every managed copy — the trash\'s too — and the manifest; the sheet says what it holds; 마지막 백업 shows it (spec 8.1–8.3)', async ({}, testInfo) => {
  const ud = testInfo.outputPath('userdata');
  const parent = folderFor(testInfo.outputPath('backups'));
  const s = await launch(testInfo.outputPath('library'), ud);
  try {
    expect(await enabledMenuCommands(s.app)).not.toContain('file.backup'); // nothing to back up yet
    const [a, b, c] = distinctPdfs(testInfo.outputPath('src'), 3);
    const [kept, trashed] = await importPaths(s.page, [a!, b!]);
    await importPaths(s.page, [c!], { mode: 'linked' });
    const collectionId = await createCollection(s.page, '세포생물학');
    await addToCollection(s.page, collectionId, [kept!.id]);
    await assignTag(s.page, await createTag(s.page, '시험 범위'), [trashed!.id]);
    await trashItems(s.page, [trashed!.id]);
    await expect.poll(() => enabledMenuCommands(s.app)).toContain('file.backup');

    await stubFolderPicker(s.app, parent);
    await stubShell(s.app);
    const sheet = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'file.backup'));
    // The panel: over the main window, on the documents folder the first time, saying what a backup leaves out.
    expect(await folderPicks(s.app)).toEqual([
      { parent: true, title: '백업 만들기', message: '외부 연결 자료는 파일 없이 위치만 기록합니다.', buttonLabel: '여기에 만들기', defaultPath: await documentsDir(s.app), properties: ['openDirectory', 'createDirectory'] },
    ]);

    // One folder, named by the minute, nothing left beside it: the database, the copies and the manifest only.
    const [name] = fs.readdirSync(parent);
    expect(fs.readdirSync(parent)).toEqual([name]);
    expect(name).toMatch(NAME);
    const folder = path.join(parent, name!);
    expect(fs.readdirSync(folder).sort()).toEqual(['assets', 'library.sqlite', 'manifest.json']);
    const manifest = readManifest(folder);
    expect(manifest).toMatchObject({ format: 'learn-backup', formatVersion: 1, counts: { items: 2, trashedItems: 1, collections: 1, collectionItems: 1, tags: 1, itemTags: 1, assets: 3 } });
    const managed = manifest.assets.filter((x) => x.storageMode === 'managed');
    expect(managed.map((x) => x.included)).toEqual([true, true]); // the trashed item's copy too (spec 8.1)
    for (const x of managed) expect(sha256(path.join(folder, ...x.relativePath!.split('/'))), x.assetId).toBe(x.sha256);
    expect(manifest.assets.find((x) => x.storageMode === 'linked')).toMatchObject({ included: false, externalPath: c });

    // The sheet (dialogs.html?scene=backup).
    await expect(sheet.getByTestId('backup-title')).toHaveText('백업을 만들었습니다');
    await expect(sheet.getByTestId('backup-when')).toHaveText(/^\d{4}\. \d{1,2}\. \d{1,2}\. 오[전후] \d{1,2}:\d{2} · \d+초 걸림$/);
    await expect(sheet.getByTestId('backup-items')).toHaveText('2개 · 휴지통 1개 · 컬렉션⁠·태그 포함');
    await expect(sheet.getByTestId('backup-files')).toHaveText(/^2개 · \d+(\.\d)? [KMG]?B · 손상 없음$/);
    await expect(sheet.getByTestId('backup-location')).toHaveAttribute('title', folder);
    expect((await sheet.getByTestId('backup-location').textContent())!.endsWith(`/${name}`)).toBe(true);
    await expect(sheet.getByTestId('backup-linked-note')).toHaveText('외부 연결 자료 1개는 파일 없이 위치만 기록했습니다. 다른 Mac에서 복원하면 다시 연결해야 합니다.');
    await expect(sheet.getByTestId('backup-missing-note')).toHaveCount(0);
    await expect(sheet.getByTestId('backup-done')).toBeFocused();
    await sheet.getByTestId('backup-reveal').click();
    await expect.poll(() => shellCalls(s.app)).toEqual([['reveal', folder]]);
    await clickToCloseSheet(sheet, sheet.getByTestId('backup-done'));

    // Remembered: the folder chosen (this device), when and where (this library) — neither of which a page can write.
    expect(JSON.parse(fs.readFileSync(path.join(ud, 'preferences.json'), 'utf8'))).toMatchObject({ backupDir: parent });
    expect(await kvLast(s.page)).toEqual({ ok: true, data: { at: manifest.createdAt, folder } });
    expect(await s.page.evaluate(() => window.learn.settings.set({ key: 'backup.last', value: { at: '2026-01-01T00:00:00.000Z', folder: '/tmp' } }))).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await s.page.evaluate(() => window.learn.prefs.set({ backupDir: '/tmp' } as never))).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });

    // 마지막 백업 in the settings window (settings.html).
    const settings = await expectWindow(s.app, 'settings', () => runMenuCommand(s.app, 'app.settings'));
    const date = settings.getByTestId('last-backup-date');
    await expect(date).toHaveText(/^\d{4}\. \d{1,2}\. \d{1,2}\. 오[전후] \d{1,2}:\d{2}$/);
    await expect(date).toHaveAttribute('title', name!);
    await settings.getByTestId('last-backup-reveal').click();
    await expect.poll(async () => (await shellCalls(s.app)).at(-1)).toEqual(['reveal', folder]);
  } finally {
    await s.app.close();
  }
});

test('a long parent path gives way in the middle of the result sheet\'s 위치; the backup folder\'s own name stays whole (C-2)', async ({}, testInfo) => {
  const parent = folderFor(path.join(testInfo.outputPath('backups'), 'a-very-long-folder-name-'.repeat(3), 'and-another-long-one-'.repeat(3)));
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, distinctPdfs(testInfo.outputPath('src'), 1));
    await stubFolderPicker(s.app, parent);
    const sheet = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'file.backup'));
    const [folder] = fs.readdirSync(parent);
    const where = sheet.getByTestId('backup-location');
    await expect(where.locator('.path-tail')).toHaveText(`${path.sep}${folder!}`);
    const box = await where.evaluate((dd) => {
      const head = dd.querySelector('.path-head') as HTMLElement;
      const tail = dd.querySelector('.path-tail') as HTMLElement;
      return { headCut: head.scrollWidth > head.clientWidth, tailWhole: tail.scrollWidth <= tail.clientWidth, tailInside: tail.getBoundingClientRect().right <= dd.getBoundingClientRect().right + 0.5 };
    });
    expect(box).toEqual({ headCut: true, tailWhole: true, tailInside: true });
    await expect(where).toHaveAttribute('title', path.join(parent, folder!));
    await closeSheet(sheet, 'Enter');
  } finally {
    await s.app.close();
  }
});

test('the palette runs it too; a name used this minute is never taken; a copy gone from the library is said, not copied; the next opens where the last was made', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const parent = folderFor(testInfo.outputPath('backups'));
  const s = await launch(lib, testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, distinctPdfs(testInfo.outputPath('src'), 2));
    // The names this minute and the next could take are used: it takes " 2" of whichever minute it runs in.
    const now = new Date();
    const used = [nameAt(now), nameAt(new Date(now.getTime() + 60_000))];
    for (const n of used) fs.mkdirSync(path.join(parent, n));
    // A managed copy lost from the library (its row stays).
    const assets = path.join(lib, 'assets');
    const shard = fs.readdirSync(assets).sort()[0]!;
    const lost = fs.readdirSync(path.join(assets, shard))[0]!;
    fs.rmSync(path.join(assets, shard, lost));

    await stubFolderPicker(s.app, parent);
    const sheet = await expectWindow(s.app, 'sheet', () => runPalette(s.page, s.app, '백업', 'file.backup'));
    expect((await folderPicks(s.app))[0]!.defaultPath).toBe(await documentsDir(s.app));
    const made = fs.readdirSync(parent).filter((n) => !used.includes(n));
    expect(made).toHaveLength(1);
    expect(used.map((n) => `${n} 2`)).toContain(made[0]);
    await expect(sheet.getByTestId('backup-files')).toHaveText(/^1개 · /);
    await expect(sheet.getByTestId('backup-missing-note')).toHaveText('사본이 사라진 자료 1개는 파일 없이 기록했습니다.');
    await expect(sheet.getByTestId('backup-linked-note')).toHaveCount(0);
    expect(readManifest(path.join(parent, made[0]!)).assets.filter((x) => !x.included).map((x) => x.sha256)).toEqual([lost]);
    await closeSheet(sheet, 'Enter');

    await stubFolderPicker(s.app, parent);
    const second = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'file.backup'));
    expect((await folderPicks(s.app))[0]!.defaultPath).toBe(parent);
    await closeSheet(second, 'Escape');
    expect(fs.readdirSync(parent).filter((n) => n.includes('.partial-'))).toEqual([]);
  } finally {
    await s.app.close();
  }
});

test('its toast: 백업을 만드는 중 · files, the folder\'s name, the bar; one backup at a time; 취소 stops it and leaves no folder (spec 8.1, P-3)', async ({}, testInfo) => {
  const parent = folderFor(testInfo.outputPath('backups'));
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, distinctPdfs(testInfo.outputPath('src'), 3));
    await backupPause(s.app);
    await stubFolderPicker(s.app, parent);
    await runMenuCommand(s.app, 'file.backup');
    await expect.poll(() => backupWaiting(s.app)).not.toBeNull();
    const toast = s.page.getByTestId('backup-progress');
    await expect(toast).toHaveAttribute('data-state', 'running'); // up once the run passed its first second
    await expect(toast).toContainText('백업을 만드는 중 · 0 / 3');
    await expect(toast.locator('.t-file')).toHaveAttribute('title', NAME);
    await expect(toast.getByRole('progressbar')).toHaveAttribute('aria-valuetext', /^파일 3개 중 0개, \d+%$/);
    await expect.poll(() => enabledMenuCommands(s.app)).not.toContain('file.backup');
    const node = await toast.elementHandle();
    await toast.getByTestId('backup-cancel').click();
    await backupResume(s.app);
    const done = s.page.getByTestId('backup-cancelled');
    await expect(done).toContainText('백업을 취소했습니다');
    await expect(done).toContainText('만들던 백업 폴더는 남기지 않았습니다.');
    await expect(done).toHaveAttribute('data-kind', 'info');
    expect(await node!.evaluate((e) => e.isConnected)).toBe(true); // the same toast, now its end (P-3)
    await waitBackupIdle(s.app);
    expect(fs.readdirSync(parent)).toEqual([]);
    expect(await kvLast(s.page)).toEqual({ ok: true, data: null });
    await expect.poll(() => enabledMenuCommands(s.app)).toContain('file.backup');
  } finally {
    await s.app.close();
  }
});

test('a copy that reads back different fails the whole backup: an error toast with the cause and what to do, no folder (spec 8.1)', async ({}, testInfo) => {
  const parent = folderFor(testInfo.outputPath('backups'));
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, distinctPdfs(testInfo.outputPath('src'), 2));
    await backupPause(s.app);
    await stubFolderPicker(s.app, parent);
    await runMenuCommand(s.app, 'file.backup');
    let held: string | null = null;
    await expect.poll(async () => (held = await backupWaiting(s.app))).not.toBeNull();
    fs.appendFileSync(held!, 'changed on the way');
    await backupResume(s.app);
    const failed = s.page.getByTestId('backup-failed');
    await expect(failed).toContainText('백업을 만들지 못했습니다');
    await expect(failed).toContainText('복사한 파일의 내용이 원래 자료와 달라 백업을 남기지 않았습니다. 다른 디스크나 폴더에 다시 만들어 보세요.');
    await expect(failed).toHaveAttribute('data-kind', 'error');
    await waitBackupIdle(s.app);
    expect(fs.readdirSync(parent)).toEqual([]);
    expect(await kvLast(s.page)).toEqual({ ok: true, data: null });
  } finally {
    await s.app.close();
  }
});

test('one work line: an import waits behind a backup and its toast names it; a backup waits behind an import and holds what it brought (spec 3.1, Q-4e)', async ({}, testInfo) => {
  const parent = folderFor(testInfo.outputPath('backups'));
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const pdfs = distinctPdfs(testInfo.outputPath('src'), 6);
  try {
    await importPaths(s.page, pdfs.slice(0, 2));
    // A backup holds the line: the import put in meanwhile waits, saying for what.
    await backupPause(s.app);
    await stubFolderPicker(s.app, parent);
    await runMenuCommand(s.app, 'file.backup');
    await expect.poll(() => backupWaiting(s.app)).not.toBeNull();
    await importFiles(s, pdfs.slice(2, 4));
    const importing = s.page.getByTestId('import-progress');
    await expect(importing).toHaveAttribute('data-state', 'waiting-job');
    await expect(importing).toContainText('앞의 작업을 기다리는 중 · 2개');
    await expect(importing).toContainText('백업이 끝나면 가져오기를 시작합니다.');
    await expect(importing.getByRole('progressbar')).toHaveCount(0);
    await expect(s.page.getByTestId('backup-progress')).toHaveAttribute('data-state', 'running');
    // Oldest on top, in the order the jobs began (the mockup's): the running backup, then the import waiting behind it.
    expect(await toastOrder(s.page)).toEqual(['backup-progress', 'import-progress']);
    let sheet = await expectWindow(s.app, 'sheet', () => backupResume(s.app));
    expect(readManifest(path.join(parent, fs.readdirSync(parent)[0]!)).counts).toMatchObject({ items: 2 }); // made before the import ran
    await closeSheet(sheet, 'Enter');
    await waitImportIdle(s.page);
    await expect(s.page.getByTestId('item-row')).toHaveCount(4);

    // An import holds the line: the backup asked for meanwhile waits, then holds what the import brought in.
    await importPause(s.app, 'afterStage');
    await importFiles(s, pdfs.slice(4, 6));
    await expect(importing).toHaveAttribute('data-state', 'running');
    await stubFolderPicker(s.app, parent);
    await runMenuCommand(s.app, 'file.backup');
    const waiting = s.page.getByTestId('backup-progress');
    await expect(waiting).toHaveAttribute('data-state', 'waiting-job');
    await expect(waiting).toContainText('앞의 작업을 기다리는 중');
    await expect(waiting).toContainText('가져오기가 끝나면 백업을 시작합니다.');
    await expect(waiting.getByRole('progressbar')).toHaveCount(0);
    expect(await toastOrder(s.page)).toEqual(['import-progress', 'backup-progress']);
    sheet = await expectWindow(s.app, 'sheet', () => importResume(s.app));
    await expect(sheet.getByTestId('backup-items')).toHaveText('6개 · 컬렉션⁠·태그 포함');
    await closeSheet(sheet, 'Escape');
    await waitImportIdle(s.page);
  } finally {
    await s.app.close();
  }
});

test('quitting during a backup asks with its own words; 취소 keeps it going, 끝내기 stops it and leaves no folder (spec 3.6, P-19)', async ({}, testInfo) => {
  const parent = folderFor(testInfo.outputPath('backups'));
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  let quit = false;
  try {
    await importPaths(s.page, distinctPdfs(testInfo.outputPath('src'), 2));
    await backupPause(s.app);
    await stubFolderPicker(s.app, parent);
    await runMenuCommand(s.app, 'file.backup');
    await expect.poll(() => backupWaiting(s.app)).not.toBeNull();

    await stubConfirm(s.app, 'cancel');
    await s.app.evaluate(({ app }) => app.quit());
    await expect.poll(() => confirmCalls(s.app)).toEqual([
      { type: 'warning', message: '백업을 만드는 중입니다', detail: '끝내면 만들던 백업은 남지 않습니다.', buttons: ['끝내기', '취소'], defaultId: 0, cancelId: 1 },
    ]);
    expect(await backupWaiting(s.app)).not.toBeNull(); // 취소: it goes on

    await stubConfirm(s.app, 'confirm');
    const exited = new Promise((resolve) => s.app.process().once('exit', resolve));
    await s.app.evaluate(({ app }) => app.quit());
    await expect.poll(async () => (await confirmCalls(s.app)).length).toBe(1);
    await backupResume(s.app).catch(() => {}); // let go, the copy meets the stop at its read-back; then the app quits
    await exited;
    quit = true;
    expect(fs.readdirSync(parent)).toEqual([]);
  } finally {
    if (!quit) await s.app.close().catch(() => {});
  }
});
