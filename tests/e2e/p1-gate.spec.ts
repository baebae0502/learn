// P1 게이트 (M6 spec 1 condition 1, spec 15; AC15): an import killed once its temp copy is written, then one killed once its
// copy is placed but before its row; after each relaunch the library check opens by itself — 임시 파일 정리 removes the
// one, 자료로 되살리기 brings the other back as an item; the library, with collections, tags, memberships and an item in
// the trash, is backed up and restored into an empty folder; an app on that folder with a profile of its own holds the
// same items, files, counts and trash. The switch's restart is recorded, not followed (Playwright cannot follow a new process).
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  FIXTURES, addToCollection, assignTag, clickToCloseSheet, createCollection, createTag, distinctPdfs, expectWindow, factCounts, hardKill,
  importFiles, importPause, importPaths, importWaiting, launch, libraryCheckState, libraryFacts, relaunchRequested, rowByTitle, runMenuCommand,
  setTagColor, specialRow, stubFolderPicker, stubFolderPicks, trashItems, waitForSheet, waitImportIdle, type LibraryFacts, type Session,
} from './helpers';

/** Four distinct files of the fixture set: two documents (one with a Korean path) and two videos. */
const SOURCES = [
  path.join(FIXTURES, 'sample.pdf'),
  path.join(FIXTURES, '한글 경로 (테스트) #1.pdf'),
  path.join(FIXTURES, 'sample-h264-aac.mp4'),
  path.join(FIXTURES, 'sample-mpeg4part2.mp4'),
];
const BACKUP = /^Learn 백업 \d{4}-\d{2}-\d{2} \d{4}( \d+)?$/;
const RESTORED = /^Learn 복원 \d{4}-\d{2}-\d{2} \d{4}( \d+)?$/;
/** The library at its backup: 5 items and 1 in the trash, 3 collections, 2 tags, 7 memberships and 5 assignments (the trashed item's included). */
const COUNTS = { items: 5, trashed: 1, collections: 3, trashedCollections: 0, tags: 2, memberships: 7, assignments: 5 };

const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** Where a library keeps the managed copy of these bytes (layout.ts managedRelativePath). */
const copyOf = (lib: string, sha: string) => path.join(lib, 'assets', sha.slice(0, 2), sha);
const tempFiles = (lib: string) => fs.readdirSync(path.join(lib, 'staging')).filter((n) => n.endsWith('.part'));
const checkRow = (sheet: Page, kind: string) => sheet.locator(`[data-testid="check-row"][data-kind="${kind}"]`);
const emptyFolder = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const prefsOf = (ud: string) => JSON.parse(fs.readFileSync(path.join(ud, 'preferences.json'), 'utf8')) as Record<string, unknown>;
interface Manifest {
  counts: Record<string, number>;
  assets: Array<{ storageMode: 'managed' | 'linked'; included: boolean }>;
}

/** The live items by title (titles are unique here). */
async function idsByTitle(page: Page): Promise<Record<string, string>> {
  const r = await page.evaluate(() => window.learn.library.list());
  if (!r.ok) throw new Error(`library.list failed: ${r.code}`);
  return Object.fromEntries(r.data.map((i) => [i.title, i.id]));
}

/** 파일 가져오기… of one file, held at `at` (Task 3's pause) until the test kills the app. */
async function holdImport(s: Session, file: string, at: 'afterStage' | 'afterPlace'): Promise<void> {
  await importPause(s.app, at);
  await importFiles(s, [file]);
  await expect.poll(() => importWaiting(s.app), { message: `the import is held at ${at}`, timeout: 15_000 }).toBe(at);
}

test.beforeAll(() => {
  for (const f of SOURCES) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

test('P1 gate: killed imports → the library check after each relaunch → 임시 파일 정리 · 자료로 되살리기 → a backup → a restore into an empty folder → an app on it holds the same library (spec 1, 15; AC15)', async ({}, testInfo) => {
  test.setTimeout(300_000);
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  const [held, placed, outside] = distinctPdfs(testInfo.outputPath('src'), 3) as [string, string, string];
  // Each item's file by its title (the file's name; the revived copy is 이름 없는 자료): the hashes AC15 compares.
  const shaByTitle: Record<string, string> = {
    sample: sha256(SOURCES[0]!),
    '한글 경로 (테스트) #1': sha256(SOURCES[1]!),
    'sample-h264-aac': sha256(SOURCES[2]!),
    'sample-mpeg4part2': sha256(SOURCES[3]!),
    'distinct-03': sha256(outside),
    '이름 없는 자료': sha256(placed),
  };
  const placedSha = shaByTitle['이름 없는 자료']!;

  // 1. Four distinct files copied in, one linked; then an import killed once its temp copy is written (staging/*.part).
  let s = await launch(lib, ud);
  let killed = false;
  try {
    expect(await importPaths(s.page, SOURCES)).toHaveLength(4);
    expect(await importPaths(s.page, [outside], { mode: 'linked' })).toHaveLength(1);
    await holdImport(s, held, 'afterStage');
    expect(tempFiles(lib)).toHaveLength(1);
    await hardKill(s.app);
    killed = true;
  } finally {
    if (!killed) await s.app.close();
  }
  expect(tempFiles(lib), 'the killed import left its temp copy').toHaveLength(1);
  expect(fs.existsSync(copyOf(lib, sha256(held))), 'and placed nothing').toBe(false);

  // 2. The relaunch: the check sheet opens by itself with the temp file; 임시 파일 정리 removes it. Then the variant — an
  //    import killed once its copy is in assets/ and before its row is written.
  s = await launch(lib, ud);
  killed = false;
  try {
    const sheet = await waitForSheet(s.app);
    await expect(sheet.getByTestId('sheet-root')).toHaveAttribute('data-mode', 'auto');
    await expect(sheet.getByTestId('check-intro')).toHaveText('라이브러리를 열 때 정리할 것을 찾았습니다. 자동으로 지운 것은 없습니다.');
    await expect(sheet.getByTestId('check-row')).toHaveCount(2);
    const temp = checkRow(sheet, 'staging');
    await expect(temp.locator('.ci-title')).toHaveText('가져오다 멈춘 임시 파일 1개');
    await expect(checkRow(sheet, 'records').locator('.ci-text')).toHaveText('자료 5개의 정보⁠·컬렉션⁠·태그가 그대로입니다.');
    await sheet.getByTestId('check-cleanStaging').click();
    await expect(temp).toHaveAttribute('data-state', 'done');
    await expect(temp.locator('.ci-text')).toHaveText('정리했습니다.');
    expect(tempFiles(lib)).toEqual([]);
    await clickToCloseSheet(sheet, sheet.getByTestId('check-done'));

    await holdImport(s, placed, 'afterPlace');
    expect(sha256(copyOf(lib, placedSha)), 'the copy was placed whole').toBe(placedSha);
    expect(Object.keys(await idsByTitle(s.page)), 'and no row was written').toHaveLength(5);
    await hardKill(s.app);
    killed = true;
  } finally {
    if (!killed) await s.app.close();
  }
  expect(tempFiles(lib), 'a placed copy leaves no temp file').toEqual([]);

  let before: LibraryFacts | undefined;
  let trashedId = '';
  let restored = '';
  s = await launch(lib, ud);
  try {
    const { app, page } = s;
    // 3. The list differs from the one last shown: the sheet opens by itself again, with the unused copy only.
    const sheet = await waitForSheet(app);
    await expect(sheet.getByTestId('sheet-root')).toHaveAttribute('data-mode', 'auto');
    await expect(sheet.getByTestId('check-row')).toHaveCount(2);
    const unused = checkRow(sheet, 'unreferenced');
    await expect(unused.locator('.ci-title')).toHaveText('쓰이지 않는 사본 1개');
    expect((await libraryCheckState(app)).check?.unreferenced.keys).toEqual([`assets/${placedSha.slice(0, 2)}/${placedSha}`]);
    await unused.getByTestId('check-revive').click();
    await expect(unused).toHaveAttribute('data-state', 'done');
    await expect(unused.locator('.ci-text')).toHaveText('자료로 되살렸습니다.');
    await clickToCloseSheet(sheet, sheet.getByTestId('check-done'));
    await waitImportIdle(page);
    await expect(rowByTitle(page, '이름 없는 자료')).toBeVisible();

    // 4. Collections (one inside another), a colour tag and a plain one, memberships, and an item in the trash keeping its own.
    const id = await idsByTitle(page);
    expect(Object.keys(id).sort()).toEqual(Object.keys(shaByTitle).sort());
    const bio = await createCollection(page, '분자생물학');
    const ch6 = await createCollection(page, '6장 · 신호 전달', bio);
    const term = await createCollection(page, '이번 학기');
    await addToCollection(page, bio, [id['sample']!, id['distinct-03']!]);
    await addToCollection(page, ch6, [id['한글 경로 (테스트) #1']!, id['sample-h264-aac']!]);
    await addToCollection(page, term, [id['sample']!, id['이름 없는 자료']!, id['sample-mpeg4part2']!]);
    const exam = await createTag(page, '시험 범위');
    await setTagColor(page, exam, 'red', 1);
    const finals = await createTag(page, '기말');
    await assignTag(page, exam, [id['sample']!, id['sample-h264-aac']!, id['이름 없는 자료']!]);
    await assignTag(page, finals, [id['한글 경로 (테스트) #1']!, id['sample-mpeg4part2']!]);
    trashedId = id['sample-h264-aac']!;
    expect(await trashItems(page, [trashedId])).toBe(1);
    await expect(specialRow(page, 'trash')).toBeVisible();
    before = await libraryFacts(page);
    expect(factCounts(before)).toEqual(COUNTS);
    expect(Object.fromEntries(Object.values(before.files).map((f) => [f.title, f.sha256])), "every item's hash is its own file's").toEqual(shaByTitle);
    expect(before.files[trashedId]).toMatchObject({ collections: ['6장 · 신호 전달'], tags: ['시험 범위'] });

    // 5. 백업 만들기…: the copies — the trashed item's too — and the linked original as its location only.
    const backups = emptyFolder(testInfo.outputPath('backups'));
    await stubFolderPicker(app, backups);
    const done = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'file.backup'));
    await expect(done.getByTestId('backup-title')).toHaveText('백업을 만들었습니다');
    await expect(done.getByTestId('backup-items')).toHaveText('5개 · 휴지통 1개 · 컬렉션⁠·태그 포함');
    await expect(done.getByTestId('backup-files')).toHaveText(/^5개 · \d+(\.\d)? [KMG]?B · 손상 없음$/);
    await expect(done.getByTestId('backup-linked-note')).toHaveText('외부 연결 자료 1개는 파일 없이 위치만 기록했습니다. 다른 Mac에서 복원하면 다시 연결해야 합니다.');
    await clickToCloseSheet(done, done.getByTestId('backup-done'));
    const made = fs.readdirSync(backups);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatch(BACKUP);
    const backup = path.join(backups, made[0]!);
    const manifest = JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8')) as Manifest;
    expect(manifest.counts).toMatchObject({ items: 5, trashedItems: 1, assets: 6, collections: 3, collectionItems: 7, tags: 2, itemTags: 5 });
    expect(manifest.assets.map((a) => `${a.storageMode}:${a.included}`).sort()).toEqual([
      'linked:false', 'managed:true', 'managed:true', 'managed:true', 'managed:true', 'managed:true',
    ]);

    // 6. 백업에서 복원… into an empty folder: a new library folder inside it, every copy read back, nothing amiss; 전환.
    const parent = emptyFolder(testInfo.outputPath('restores'));
    expect(fs.readdirSync(parent)).toEqual([]);
    await stubFolderPicks(app, [backup, parent]);
    const result = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'file.restore'));
    const into = fs.readdirSync(parent);
    expect(into).toHaveLength(1);
    expect(into[0]).toMatch(RESTORED);
    restored = path.join(parent, into[0]!);
    await expect(result.getByTestId('restore-badge')).toHaveAttribute('data-tone', 'success');
    await expect(result.getByTestId('restore-title')).toHaveText('백업을 복원했습니다');
    await expect(result.getByTestId('restore-items')).toHaveText('5개 · 휴지통 1개 · 컬렉션 3개 · 태그 2개');
    await expect(result.getByTestId('restore-files')).toHaveText('5개 확인 · 손상 없음');
    await expect(result.getByTestId('restore-issues')).toHaveCount(0);
    await expect(result.getByTestId('restore-location')).toHaveAttribute('title', restored);
    await clickToCloseSheet(result, result.getByTestId('restore-switch'));
    await expect.poll(() => relaunchRequested(app)).toBe(true);
    expect(prefsOf(ud)['libraryRoot']).toBe(restored);
    expect(await libraryFacts(page), 'the library in use is as it was').toEqual(before);
  } finally {
    await s.app.close();
  }

  // 7. An app on the restored folder with a profile of its own: the same items, files, counts and trash.
  expect(before).toBeDefined();
  const second = await launch(restored, testInfo.outputPath('userdata-restored'));
  try {
    const after = await libraryFacts(second.page);
    expect(after).toEqual(before);
    expect(factCounts(after)).toEqual(COUNTS);
    for (const f of Object.values(after.files)) {
      if (f.storageMode === 'managed') expect(sha256(copyOf(restored, f.sha256)), `${f.title}: the restored copy has its bytes`).toBe(f.sha256);
    }
    expect(after.trashed.map((t) => t.id), 'the trashed item is in the trash').toEqual([trashedId]);
    expect(after.items).not.toContain(trashedId);
    await expect(specialRow(second.page, 'trash')).toBeVisible();
    await expect.poll(async () => (await libraryCheckState(second.app)).auto, { message: 'the startup check decided', timeout: 20_000 }).not.toBe('pending');
    expect(await libraryCheckState(second.app), 'the restored library has nothing to clean').toMatchObject({ auto: 'not-due', check: { items: 5, actionable: false } });
  } finally {
    await second.app.close();
  }
});
