// 복원 (spec 9, P-20, AC15): a backup restored into a new folder beside the library, the result sheet and its answers, an
// app on the restored folder holding the same library; a backup that lost a file and changed another; what a restore
// refuses before it runs; its toast and 취소; the work line it shares; quitting while it runs; the fatal screen (9.4).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication } from '@playwright/test';
import { RESTORE_COPY } from '../../packages/domain/src/backup';
import {
  addToCollection, assignTag, clickToCloseSheet, closeSheet, confirmCalls, createCollection, createTag, distinctPdfs, enabledMenuCommands, expectWindow,
  folderPicks, importFiles, importPause, importPaths, importResume, launch, libraryFacts, relaunchRequested, restorePause, restoreResume, restoreWaiting, runMenuCommand,
  setTagColor, shellCalls, stubConfirm, stubFolderPicker, stubFolderPicks, stubShell, trashItems, waitImportIdle, waitRestoreIdle,
} from './helpers';

const RESTORED = /^Learn 복원 \d{4}-\d{2}-\d{2} \d{4}( \d+)?$/;
const IS_MAC = process.platform === 'darwin';
const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const folderFor = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const prefsFile = (ud: string) => JSON.parse(fs.readFileSync(path.join(ud, 'preferences.json'), 'utf8')) as Record<string, unknown>;
/** The folders in `parent` named `prefix …`, and any a restore left half-made (`….restoring-<id>`). */
const madeIn = (parent: string, prefix: string) => fs.readdirSync(parent).filter((n) => n.startsWith(prefix) || n.includes('.restoring-'));
interface Manifest {
  createdAt: string;
  assets: Array<{ assetId: string; sha256: string; storageMode: 'managed' | 'linked'; relativePath: string | null; included: boolean }>;
}
const readManifest = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8')) as Manifest;

/** A backup of the library the session has open, in `parent` (Task 9's flow); its folder. */
async function backUp(app: ElectronApplication, parent: string): Promise<string> {
  await stubFolderPicker(app, parent);
  await closeSheet(await expectWindow(app, 'sheet', () => runMenuCommand(app, 'file.backup')), 'Enter');
  const [name] = fs.readdirSync(parent).filter((n) => n.startsWith('Learn 백업'));
  return path.join(parent, name!);
}

type Facts = Awaited<ReturnType<typeof libraryFacts>>;

test('a backup restores into a new folder beside the library; the sheet says what came back; 전환 saves the folder and asks for a restart; an app on it holds the same library (spec 9, AC15)', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  const backups = folderFor(testInfo.outputPath('backups'));
  let before: Facts | undefined;
  let restored = '';
  const s = await launch(lib, ud);
  try {
    // Copies and a linked file, a collection tree, a colour tag and a plain one, memberships, a trashed item that keeps
    // its membership and tag, a trashed collection.
    const [a, b, c, d] = distinctPdfs(testInfo.outputPath('src'), 4);
    const [one, two, three] = await importPaths(s.page, [a!, b!, c!]);
    const [linked] = await importPaths(s.page, [d!], { mode: 'linked' });
    const bio = await createCollection(s.page, '분자생물학');
    const ch6 = await createCollection(s.page, '6장 · 신호 전달', bio);
    const old = await createCollection(s.page, '지난 학기');
    await addToCollection(s.page, bio, [one!.id, linked!.id]);
    await addToCollection(s.page, ch6, [two!.id, three!.id]);
    await addToCollection(s.page, old, [one!.id]);
    const exam = await createTag(s.page, '시험 범위');
    await setTagColor(s.page, exam, 'red', 1);
    const plain = await createTag(s.page, '기말');
    await assignTag(s.page, exam, [one!.id, three!.id]);
    await assignTag(s.page, plain, [two!.id]);
    await trashItems(s.page, [three!.id]);
    expect((await s.page.evaluate((id) => window.learn.collections.remove({ collectionId: id }), old)).ok).toBe(true);
    before = await libraryFacts(s.page);
    expect(before.trashed.map((x) => x.id)).toEqual([three!.id]);
    expect(before.trashedCollections.map((x) => x.id)).toEqual([old]);
    const backup = await backUp(s.app, backups);

    // 백업에서 복원…: the backup (the panel opens where backups were made), then where (beside the library by default).
    await expect.poll(() => enabledMenuCommands(s.app)).toContain('file.restore'); // once the backup's sheet has closed and the menu bar was told
    await stubShell(s.app);
    await stubFolderPicks(s.app, [backup, path.dirname(lib)]);
    const sheet = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'file.restore'));
    expect(await folderPicks(s.app)).toEqual([
      { parent: true, title: '백업에서 복원', message: '복원할 백업 폴더를 고르세요.', buttonLabel: '선택', defaultPath: backups, properties: ['openDirectory'] },
      {
        parent: true, title: '복원할 위치', message: '고른 폴더 안에 새 라이브러리 폴더를 만듭니다. 지금 라이브러리는 그대로 남습니다.', buttonLabel: '여기에 복원',
        defaultPath: path.dirname(lib), properties: ['openDirectory', 'createDirectory'],
      },
    ]);
    const made = madeIn(path.dirname(lib), 'Learn 복원');
    expect(made).toHaveLength(1);
    expect(made[0]).toMatch(RESTORED);
    restored = path.join(path.dirname(lib), made[0]!);
    expect(fs.readdirSync(restored).sort()).toEqual(['assets', 'derived', 'exports', 'library.sqlite', 'staging']);

    // The sheet (dialogs.html?scene=restore).
    await expect(sheet.getByTestId('restore-badge')).toHaveAttribute('data-tone', 'success');
    await expect(sheet.getByTestId('restore-title')).toHaveText('백업을 복원했습니다');
    await expect(sheet.getByTestId('restore-when')).toHaveText(/^\d{4}\. \d{1,2}\. \d{1,2}\. 오[전후] \d{1,2}:\d{2}에 만든 백업$/);
    await expect(sheet.getByTestId('restore-items')).toHaveText('3개 · 휴지통 1개 · 컬렉션 2개 · 태그 2개');
    await expect(sheet.getByTestId('restore-files')).toHaveText('3개 확인 · 손상 없음');
    await expect(sheet.getByTestId('restore-location')).toHaveAttribute('title', restored);
    expect((await sheet.getByTestId('restore-location').textContent())!.endsWith(`/${made[0]}`)).toBe(true);
    await expect(sheet.getByTestId('restore-issues')).toHaveCount(0);
    await expect(sheet.getByTestId('restore-keep')).toHaveText('지금 라이브러리는 그대로 남습니다. 나중에 전환하려면 설정의 ‘다른 폴더 선택’⁠에서 이 폴더를 고르세요.');
    await expect(sheet.getByTestId('restore-reveal')).toHaveText(IS_MAC ? 'Finder에서 보기' : '폴더에서 보기');
    await expect(sheet.getByTestId('restore-switch')).toBeFocused();
    await sheet.getByTestId('restore-reveal').click();
    await expect.poll(() => shellCalls(s.app)).toEqual([['reveal', restored]]);
    // 이 라이브러리로 전환하고 다시 시작: saved as this device's library folder, then the restart (recorded under E2E).
    await clickToCloseSheet(sheet, sheet.getByTestId('restore-switch'));
    await expect.poll(() => relaunchRequested(s.app)).toBe(true);
    expect(prefsFile(ud)['libraryRoot']).toBe(restored);
    // The library in use is untouched.
    expect(await libraryFacts(s.page)).toEqual(before);
  } finally {
    await s.app.close();
  }

  // The restored folder in an app of its own: the same items and files, collections, tags, memberships and trash.
  const second = await launch(restored, testInfo.outputPath('userdata-2'));
  try {
    const after = await libraryFacts(second.page);
    expect(after).toEqual(before);
    const managed = Object.values(after.files).filter((f) => f.storageMode === 'managed');
    expect(managed).toHaveLength(3);
    for (const f of managed) expect(sha256(path.join(restored, 'assets', f.sha256.slice(0, 2), f.sha256)), f.title).toBe(f.sha256);
  } finally {
    await second.app.close();
  }
});

test('a backup that lost a file and changed another: a warning sheet names both with their items; esc is 나중에 and changes nothing; the restored library shows those items without their file (spec 9.2, 9.3)', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  const parent = folderFor(testInfo.outputPath('restores'));
  let restored = '';
  const titles: Record<string, string> = {};
  const gone: string[] = [];
  const s = await launch(lib, ud);
  try {
    for (const i of await importPaths(s.page, distinctPdfs(testInfo.outputPath('src'), 3))) titles[i.assetId] = i.title;
    const backup = await backUp(s.app, folderFor(testInfo.outputPath('backups')));
    const [lost, changed] = readManifest(backup).assets.filter((x) => x.included);
    fs.rmSync(path.join(backup, ...lost!.relativePath!.split('/')));
    fs.appendFileSync(path.join(backup, ...changed!.relativePath!.split('/')), 'changed on the way');
    gone.push(titles[lost!.assetId]!, titles[changed!.assetId]!);

    await stubFolderPicks(s.app, [backup, parent]);
    const sheet = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'file.restore'));
    await expect(sheet.getByTestId('restore-badge')).toHaveAttribute('data-tone', 'warning');
    await expect(sheet.getByTestId('restore-files')).toHaveText('3개 중 1개 확인');
    const issues = sheet.getByTestId('restore-issue');
    await expect(issues).toHaveCount(2);
    await expect(issues.nth(0)).toHaveAttribute('data-kind', 'missing');
    await expect(issues.nth(0).locator('.ri-line')).toHaveText('백업에 없는 파일 1개');
    await expect(issues.nth(0).getByTestId('restore-issue-item')).toHaveText([gone[0]!]);
    await expect(issues.nth(1)).toHaveAttribute('data-kind', 'damaged');
    await expect(issues.nth(1).locator('.ri-line')).toHaveText('내용이 손상된 파일 1개');
    await expect(issues.nth(1).getByTestId('restore-issue-item')).toHaveText([gone[1]!]);
    await expect(sheet.getByTestId('restore-missing-note')).toHaveText('이 라이브러리로 전환해도 그 자료는 ‘파일 없음’⁠으로 보입니다. 원래 파일이 있으면 전환한 뒤 다시 연결할 수 있습니다.');
    await closeSheet(sheet, 'Escape');
    expect(await relaunchRequested(s.app)).toBe(false);
    expect(prefsFile(ud)['libraryRoot'] ?? null).toBeNull();
    const made = madeIn(parent, 'Learn 복원');
    expect(made).toHaveLength(1);
    restored = path.join(parent, made[0]!);
    // The changed copy waits in staging for the library check; nothing is where its hash says.
    expect(fs.readdirSync(path.join(restored, 'staging'))).toEqual([expect.stringMatching(new RegExp(`^corrupt-${changed!.sha256}-`))]);
    for (const x of [lost!, changed!]) expect(fs.existsSync(path.join(restored, ...x.relativePath!.split('/'))), x.assetId).toBe(false);
  } finally {
    await s.app.close();
  }

  const second = await launch(restored, testInfo.outputPath('userdata-2'));
  try {
    const shown = await second.page.evaluate(async () => {
      const r = await window.learn.library.list();
      if (!r.ok) throw new Error(r.code);
      return Object.fromEntries(r.data.map((i) => [i.title, i.availability]));
    });
    expect(shown).toEqual(Object.fromEntries(Object.values(titles).map((t) => [t, gone.includes(t) ? 'missing' : 'available'])));
  } finally {
    await second.app.close();
  }
});

test('what a restore refuses before it runs: a cancelled panel, a folder that is not a backup, a newer backup, a place inside the library; the page sends no path (spec 9.1)', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const parent = folderFor(testInfo.outputPath('restores'));
  const s = await launch(lib, testInfo.outputPath('userdata'));
  const failed = s.page.getByTestId('restore-failed');
  /** The error toast says `message` under 복원하지 못했습니다 after `panels` panels; then it is closed. */
  const refusedWith = async (message: string, panels: number) => {
    await expect(failed).toContainText('복원하지 못했습니다');
    await expect(failed).toContainText(message);
    expect(await folderPicks(s.app)).toHaveLength(panels);
    await failed.getByTestId('toast-close').click();
    await expect(failed).toHaveCount(0);
  };
  try {
    await importPaths(s.page, distinctPdfs(testInfo.outputPath('src'), 1));
    const backup = await backUp(s.app, folderFor(testInfo.outputPath('backups')));

    await stubFolderPicks(s.app, [null]);
    await runMenuCommand(s.app, 'file.restore');
    await expect.poll(() => folderPicks(s.app)).toHaveLength(1);
    await expect.poll(() => enabledMenuCommands(s.app)).toContain('file.restore'); // the panel is gone; the window is free again
    await expect(failed).toHaveCount(0);

    const notBackup = folderFor(testInfo.outputPath('not-a-backup'));
    fs.writeFileSync(path.join(notBackup, 'notes.txt'), 'x');
    await stubFolderPicks(s.app, [notBackup, parent]);
    await runMenuCommand(s.app, 'file.restore');
    await refusedWith(RESTORE_COPY.unknownFormat, 1);

    const newer = testInfo.outputPath('newer-backup');
    fs.cpSync(backup, newer, { recursive: true });
    fs.writeFileSync(path.join(newer, 'manifest.json'), JSON.stringify({ ...readManifest(backup), schemaVersion: 99 }));
    await stubFolderPicks(s.app, [newer, parent]);
    await runMenuCommand(s.app, 'file.restore');
    await refusedWith(RESTORE_COPY.newerVersion, 1);

    await stubFolderPicks(s.app, [backup, path.join(lib, 'assets')]);
    await runMenuCommand(s.app, 'file.restore');
    await refusedWith('라이브러리 폴더 안에는 복원할 수 없습니다. 다른 폴더를 고르세요.', 2);

    await stubFolderPicks(s.app, [backup, null]);
    await runMenuCommand(s.app, 'file.restore');
    await expect.poll(() => folderPicks(s.app)).toHaveLength(2);
    await expect(failed).toHaveCount(0);

    expect(await s.page.evaluate(() => (window.learn.backup.restore as (input: unknown) => Promise<unknown>)({ folder: '/tmp' }))).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(madeIn(parent, 'Learn 복원')).toEqual([]);
    expect(fs.readdirSync(path.join(lib, 'assets')).filter((n) => n.startsWith('Learn 복원'))).toEqual([]);
  } finally {
    await s.app.close();
  }
});

test('its toast: 복원하는 중 · files, the new folder\'s name, the bar; one restore at a time; 취소 stops it and leaves no folder (spec 9.1, P-3)', async ({}, testInfo) => {
  const parent = folderFor(testInfo.outputPath('restores'));
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, distinctPdfs(testInfo.outputPath('src'), 3));
    const backup = await backUp(s.app, folderFor(testInfo.outputPath('backups')));
    await restorePause(s.app);
    await stubFolderPicks(s.app, [backup, parent]);
    await runMenuCommand(s.app, 'file.restore');
    await expect.poll(() => restoreWaiting(s.app)).not.toBeNull();
    const toast = s.page.getByTestId('restore-progress');
    await expect(toast).toHaveAttribute('data-state', 'running'); // up once the run passed its first second
    await expect(toast).toContainText('복원하는 중 · 0 / 3');
    await expect(toast.locator('.t-file')).toHaveAttribute('title', RESTORED);
    await expect(toast.getByRole('progressbar')).toHaveAttribute('aria-valuetext', /^파일 3개 중 0개, \d+%$/);
    await expect.poll(() => enabledMenuCommands(s.app)).not.toContain('file.restore');
    const node = await toast.elementHandle();
    await toast.getByTestId('restore-cancel').click();
    await restoreResume(s.app);
    const done = s.page.getByTestId('restore-cancelled');
    await expect(done).toContainText('복원을 취소했습니다');
    await expect(done).toContainText('만들던 라이브러리 폴더는 남기지 않았습니다.');
    await expect(done).toHaveAttribute('data-kind', 'info');
    expect(await node!.evaluate((e) => e.isConnected)).toBe(true); // the same toast, now its end (P-3)
    await waitRestoreIdle(s.app);
    expect(madeIn(parent, 'Learn 복원')).toEqual([]);
    await expect.poll(() => enabledMenuCommands(s.app)).toContain('file.restore');
  } finally {
    await s.app.close();
  }
});

test('one work line: a restore waits behind an import and its toast says so; quitting during a restore asks with its own words, 끝내기 leaves no folder (spec 3.1, 3.6, P-19)', async ({}, testInfo) => {
  const parent = folderFor(testInfo.outputPath('restores'));
  const quitParent = folderFor(testInfo.outputPath('quit-restores'));
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const pdfs = distinctPdfs(testInfo.outputPath('src'), 4);
  let quit = false;
  try {
    await importPaths(s.page, pdfs.slice(0, 2));
    const backup = await backUp(s.app, folderFor(testInfo.outputPath('backups')));
    // An import holds the line: the restore asked for meanwhile waits, saying for what, with no bar.
    await importPause(s.app, 'afterStage');
    await importFiles(s, pdfs.slice(2, 4));
    await expect(s.page.getByTestId('import-progress')).toHaveAttribute('data-state', 'running');
    await stubFolderPicks(s.app, [backup, parent]);
    await runMenuCommand(s.app, 'file.restore');
    const waiting = s.page.getByTestId('restore-progress');
    await expect(waiting).toHaveAttribute('data-state', 'waiting-job');
    await expect(waiting).toContainText('앞의 작업을 기다리는 중');
    await expect(waiting).toContainText('가져오기가 끝나면 복원을 시작합니다.');
    await expect(waiting.getByRole('progressbar')).toHaveCount(0);
    const sheet = await expectWindow(s.app, 'sheet', () => importResume(s.app));
    // What the backup holds — made before this import — not what the library holds now.
    await expect(sheet.getByTestId('restore-items')).toHaveText('2개');
    await closeSheet(sheet, 'Escape');
    await waitImportIdle(s.page);

    // A restore holds the line: quitting asks (Task 3's question, the restore's words); 취소 keeps it going.
    await restorePause(s.app);
    await stubFolderPicks(s.app, [backup, quitParent]);
    await runMenuCommand(s.app, 'file.restore');
    await expect.poll(() => restoreWaiting(s.app)).not.toBeNull();
    await stubConfirm(s.app, 'cancel');
    await s.app.evaluate(({ app }) => app.quit());
    await expect.poll(() => confirmCalls(s.app)).toEqual([
      { type: 'warning', message: '복원하는 중입니다', detail: '끝내면 만들던 라이브러리는 남지 않습니다.', buttons: ['끝내기', '취소'], defaultId: 0, cancelId: 1 },
    ]);
    expect(await restoreWaiting(s.app)).not.toBeNull();

    await stubConfirm(s.app, 'confirm');
    const exited = new Promise((resolve) => s.app.process().once('exit', resolve));
    await s.app.evaluate(({ app }) => app.quit());
    await expect.poll(async () => (await confirmCalls(s.app)).length).toBe(1);
    await restoreResume(s.app).catch(() => {}); // let go: the copy meets the stop at its read-back, then the app quits
    await exited;
    quit = true;
    expect(madeIn(quitParent, 'Learn 복원')).toEqual([]);
  } finally {
    if (!quit) await s.app.close().catch(() => {});
  }
});

test('the fatal screen: Finder에서 보기 shows the pre-update backup selected, before 설정 열기; one gone since says so; 백업에서 복원… is off there (spec 9.4)', async ({}, testInfo) => {
  const lib = folderFor(testInfo.outputPath('broken'));
  fs.writeFileSync(path.join(lib, 'library.sqlite'), 'not a database');
  const bak = path.join(lib, 'library.sqlite.pre-v2.bak');
  fs.writeFileSync(bak, '');
  const { app, page } = await launch(lib, testInfo.outputPath('userdata'));
  try {
    const reveal = page.getByTestId('fatal-reveal');
    await expect(reveal).toHaveText(IS_MAC ? 'Finder에서 보기' : '폴더에서 보기');
    await expect(reveal).toHaveClass(/btn-secondary/);
    expect(await page.getByTestId('fatal-notice').locator('.actions button').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))).toEqual(['fatal-reveal', 'fatal-settings']);
    await page.keyboard.press('Tab');
    await expect(reveal).toBeFocused();
    expect(await enabledMenuCommands(app)).not.toContain('file.restore');
    await stubShell(app);
    await reveal.click();
    await expect.poll(() => shellCalls(app)).toEqual([['reveal', bak]]);
    expect(await page.evaluate(() => (window.learn.app.revealUpdateBackup as (input: unknown) => Promise<unknown>)({ path: '/tmp' }))).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    // Gone since the screen was drawn: said in a toast, nothing shown.
    fs.rmSync(bak);
    await reveal.click();
    await expect(page.getByTestId('action-error')).toContainText('업데이트 전 백업 파일을 찾을 수 없습니다. 옮기거나 지웠는지 확인하세요.');
    expect(await shellCalls(app)).toHaveLength(1);
  } finally {
    await app.close();
  }
});
