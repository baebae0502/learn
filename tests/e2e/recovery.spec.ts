// 라이브러리 점검 (M6 spec 7, P-16–P-18, P-26): the sheet that opens by itself after a killed import and its fingerprint,
// the rows and their actions, and 파일 › 라이브러리 점검… with nothing wrong.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { expectNoSeriousA11y } from './a11y';
import {
  FIXTURES, clickToCloseSheet, closeSheet, distinctPdfs, expectWindow, hardKill, importFiles, importPause, importPaths, importWaiting, launch, libraryCheckState, menuItemEnabled,
  rowByTitle, runMenuCommand, shellCalls, stubOpenDialog, stubShell, waitForSheet, waitImportIdle, type Session,
} from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const ORPHAN_ID = '0a1b2c3d-4e5f-4061-8172-8394a5b6c7d8';
const EDIT = '단백질 접힘 정리 (수정본 2026-10-18 2210).pdf';
const sha256 = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** Where the library keeps a managed copy of `file`'s bytes (layout.ts managedRelativePath). */
const copyIn = (lib: string, file: string) => {
  const sha = sha256(file);
  return path.join(lib, 'assets', sha.slice(0, 2), sha);
};
const row = (sheet: Page, kind: string) => sheet.locator(`[data-testid="check-row"][data-kind="${kind}"]`);
const visibleSheets = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && w.isVisible() && w.webContents.getURL().includes('window=sheet')).length);
const openCheck = (s: Session) => expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'file.checkLibrary'));

test('a killed import leaves a .part: the sheet opens by itself after the relaunch; the same list does not open it again, a new leftover does; 임시 파일 정리 removes the .part only', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const data = testInfo.outputPath('userdata');
  const staging = path.join(lib, 'staging');
  let s = await launch(lib, data);
  let killed = false;
  try {
    await importPaths(s.page, [PDF]);
    await importPause(s.app, 'afterStage');
    await importFiles(s, distinctPdfs(testInfo.outputPath('src'), 1));
    await expect.poll(() => importWaiting(s.app)).toBe('afterStage');
    expect(fs.readdirSync(staging).filter((n) => n.endsWith('.part'))).toHaveLength(1);
    await hardKill(s.app);
    killed = true;
  } finally {
    if (!killed) await s.app.close();
  }
  // Finder's .DS_Store in staging/ is never counted (spec 7.2).
  fs.writeFileSync(path.join(staging, '.DS_Store'), Buffer.alloc(6148));

  s = await launch(lib, data);
  try {
    const sheet = await waitForSheet(s.app);
    await expect(sheet.getByTestId('sheet-root')).toHaveAttribute('data-mode', 'auto');
    await expect(sheet.getByTestId('check-intro')).toHaveText('라이브러리를 열 때 정리할 것을 찾았습니다. 자동으로 지운 것은 없습니다.');
    await expect(sheet.getByTestId('check-hint')).toHaveText('언제든 메뉴 막대의 파일 › 라이브러리 점검에서 다시 할 수 있습니다.');
    await expect(sheet.getByTestId('check-row')).toHaveCount(2);
    await expect(row(sheet, 'staging').locator('.ci-title')).toHaveText('가져오다 멈춘 임시 파일 1개');
    await expect(sheet.getByTestId('check-row').last()).toHaveAttribute('data-kind', 'records');
    await expect(row(sheet, 'records').locator('.ci-text')).toHaveText('자료 1개의 정보⁠·컬렉션⁠·태그가 그대로입니다.');
    await expect(sheet.getByTestId('check-done')).toBeFocused();
    await expectNoSeriousA11y(sheet, 'library check sheet (automatic)');
    // The window under it is held as under any of our sheets: the menu bar refuses the library's commands.
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged')).toBe(false);
    await clickToCloseSheet(sheet, sheet.getByTestId('check-done'));
  } finally {
    await s.app.close();
  }

  // The list the user was shown: nothing opens by itself.
  s = await launch(lib, data);
  try {
    await expect.poll(async () => (await libraryCheckState(s.app)).auto).toBe('not-due');
    expect((await libraryCheckState(s.app)).check).toMatchObject({ actionable: true, staging: { count: 1 } });
    expect(await visibleSheets(s.app)).toBe(0);
  } finally {
    await s.app.close();
  }

  // Something new: it opens again, and 임시 파일 정리 turns the row ok in place.
  fs.writeFileSync(path.join(staging, '33333333-3333-4333-8333-333333333333.part'), Buffer.alloc(100));
  s = await launch(lib, data);
  try {
    const sheet = await waitForSheet(s.app);
    await expect(row(sheet, 'staging').locator('.ci-title')).toHaveText('가져오다 멈춘 임시 파일 2개');
    await sheet.getByTestId('check-cleanStaging').click();
    await expect(row(sheet, 'staging')).toHaveAttribute('data-state', 'done');
    await expect(row(sheet, 'staging').locator('.ci-title')).toHaveText('가져오다 멈춘 임시 파일');
    await expect(row(sheet, 'staging').locator('.ci-text')).toHaveText('정리했습니다.');
    await expect(sheet.getByTestId('check-badge')).toHaveAttribute('data-tone', 'success');
    await expect(sheet.getByTestId('check-done')).toBeFocused();
    expect(fs.readdirSync(staging)).toEqual(['.DS_Store']);
    await closeSheet(sheet, 'Enter');
  } finally {
    await s.app.close();
  }
});

test('쓰이지 않는 사본: 자료로 되살리기 brings a copy back as 이름 없는 자료 through the queue and says what stayed; 정리… asks in its row, then removes it', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const s = await launch(lib, testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, [PDF]);
    // A copy that lost its row (a purge whose file stayed, an import cut between its rename and its commit) and a file of no known type.
    const [lost] = distinctPdfs(testInfo.outputPath('src'), 1);
    const copy = copyIn(lib, lost!);
    fs.mkdirSync(path.dirname(copy), { recursive: true });
    fs.copyFileSync(lost!, copy);
    const junk = path.join(lib, 'assets', 'ee', 'e'.repeat(64));
    fs.mkdirSync(path.dirname(junk), { recursive: true });
    fs.writeFileSync(junk, 'not a document');
    const sheet = await openCheck(s);
    await expect(sheet.getByTestId('sheet-root')).toHaveAttribute('data-mode', 'manual');
    await expect(sheet.getByTestId('check-intro')).toHaveText('라이브러리에서 정리할 것을 찾았습니다. 자동으로 지운 것은 없습니다.');
    await expect(sheet.getByTestId('check-hint')).toHaveCount(0);
    const unused = row(sheet, 'unreferenced');
    await expect(unused.locator('.ci-title')).toHaveText('쓰이지 않는 사본 2개');
    await unused.getByTestId('check-revive').click();
    await expect(unused.locator('.ci-title')).toHaveText('쓰이지 않는 사본 1개');
    await expect(unused.getByTestId('check-error')).toHaveText('사본 1개는 자료로 되살리지 못했습니다. 지원하지 않는 형식이면 정리할 수 있습니다.');
    await expect(rowByTitle(s.page, '이름 없는 자료')).toBeVisible();
    expect(fs.existsSync(copy)).toBe(true);
    // 정리… asks in the row first: esc keeps the copy, and the sheet stays.
    await unused.getByTestId('check-askClean').click();
    await expect(unused.locator('.ci-title')).toHaveText('쓰이지 않는 사본 1개를 지우겠습니까?');
    await expect(sheet.getByTestId('check-confirm-cancel')).toBeFocused();
    await expect(unused.locator('.ci-text')).toHaveText('되돌릴 수 없습니다. 라이브러리 폴더에서 지웁니다.');
    await expect(unused.locator('.ci-meta')).toBeVisible(); // what would go, and how much, stays on the line
    // [지우기] [취소] side by side on one line, the destructive one first; 취소 is the filled default and takes ↩ from 완료.
    const [remove, cancel, ends] = await Promise.all([
      unused.getByTestId('check-confirm').boundingBox(),
      unused.getByTestId('check-confirm-cancel').boundingBox(),
      unused.getByTestId('check-askClean').count(),
    ]);
    expect(ends).toBe(0);
    expect(remove!.y).toBeCloseTo(cancel!.y, 0);
    expect(remove!.x + remove!.width).toBeLessThanOrEqual(cancel!.x);
    await expect(unused.getByTestId('check-confirm-cancel')).toHaveClass(/btn-primary/);
    await expect(unused.getByTestId('check-confirm')).not.toHaveClass(/btn-primary/);
    await expect(sheet.getByTestId('check-done')).not.toHaveClass(/btn-primary/);
    await sheet.keyboard.press('Enter'); // ↩ is 취소: nothing is deleted
    await expect(unused.locator('.ci-title')).toHaveText('쓰이지 않는 사본 1개');
    await expect(sheet.getByTestId('check-done')).toHaveClass(/btn-primary/);
    expect(fs.existsSync(junk)).toBe(true);
    await unused.getByTestId('check-askClean').click();
    await sheet.keyboard.press('Escape');
    await expect(unused.locator('.ci-title')).toHaveText('쓰이지 않는 사본 1개');
    await expect(unused.getByTestId('check-askClean')).toBeFocused();
    expect(fs.existsSync(junk)).toBe(true);
    await unused.getByTestId('check-askClean').click();
    await sheet.getByTestId('check-confirm').click();
    await expect(unused).toHaveAttribute('data-state', 'done');
    await expect(unused.locator('.ci-text')).toHaveText('정리했습니다.');
    expect(fs.existsSync(junk)).toBe(false);
    expect(fs.existsSync(copy)).toBe(true);
    await clickToCloseSheet(sheet, sheet.getByTestId('check-done'));
    await waitImportIdle(s.page);
  } finally {
    await s.app.close();
  }
});

test('사본이 사라진 자료 and 원본을 찾을 수 없는 외부 연결: 다시 연결… per item — two names then 외 N개, the next name after each; a copy comes back only from the same bytes', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const s = await launch(lib, testInfo.outputPath('userdata'));
  try {
    const sources = distinctPdfs(testInfo.outputPath('src'), 3);
    const items = await importPaths(s.page, sources);
    const outside = testInfo.outputPath('outside');
    fs.mkdirSync(outside, { recursive: true });
    const original = path.join(outside, 'linked.pdf');
    fs.copyFileSync(PDF, original);
    const [linked] = await importPaths(s.page, [original], { mode: 'linked' });
    for (const src of sources) fs.rmSync(copyIn(lib, src));
    const moved = path.join(outside, 'moved.pdf');
    fs.renameSync(original, moved);
    const sheet = await openCheck(s);
    const lost = row(sheet, 'missingManaged');
    await expect(lost.locator('.ci-title')).toHaveText('사본이 사라진 자료 3개');
    await expect(lost.getByTestId('check-entry')).toHaveCount(2);
    await expect(lost.getByTestId('check-more')).toHaveText('외 1개');
    await expect(lost.getByTestId('check-entry').first()).toHaveAttribute('data-item-id', items[0]!.id);
    // The table shows them as missing (the check announced them).
    await expect(rowByTitle(s.page, 'distinct-01')).toContainText('파일 없음');
    // Other bytes are refused, said under the row; the row stays.
    await stubOpenDialog(s.app, [sources[1]!]);
    await lost.getByTestId('check-relink').first().click();
    await expect(lost.getByTestId('check-error')).toHaveText('선택한 파일의 내용이 원래 자료와 다릅니다. 같은 파일을 선택하세요.');
    await stubOpenDialog(s.app, [sources[0]!]);
    await lost.getByTestId('check-relink').first().click();
    await expect(lost.locator('.ci-title')).toHaveText('사본이 사라진 자료 2개');
    await expect(lost.getByTestId('check-more')).toHaveCount(0);
    await expect(lost.getByTestId('check-entry').first()).toHaveAttribute('data-item-id', items[1]!.id);
    expect(fs.readFileSync(copyIn(lib, sources[0]!)).equals(fs.readFileSync(sources[0]!))).toBe(true);
    for (const k of [1, 2]) {
      await stubOpenDialog(s.app, [sources[k]!]);
      await lost.getByTestId('check-relink').first().click();
      await expect(lost.getByTestId('check-entry')).toHaveCount(k === 1 ? 1 : 0);
    }
    await expect(lost).toHaveAttribute('data-state', 'done');
    await expect(lost.locator('.ci-text')).toHaveText('다시 연결했습니다.');
    // The linked original: its title, its old location under it (whole path in the tooltip), 다시 연결… to where it went.
    const away = row(sheet, 'missingLinked');
    await expect(away.locator('.ce-title')).toHaveText('linked');
    await expect(away.locator('.ce-path')).toHaveAttribute('title', original);
    await stubOpenDialog(s.app, [moved]);
    await away.getByTestId('check-relink').click();
    await expect(away).toHaveAttribute('data-state', 'done');
    await clickToCloseSheet(sheet, sheet.getByTestId('check-done'));
    await expect(rowByTitle(s.page, 'linked')).not.toContainText('파일 없음');
    await expect(rowByTitle(s.page, 'distinct-01')).not.toContainText('파일 없음');
    expect(linked).toBeDefined();
  } finally {
    await s.app.close();
  }
});

test('따로 보관한 손상된 사본 and 주인 없는 수정본: 폴더에서 보기 shows the file and removes nothing; 새 자료로 가져오기 imports the edited copy through the queue and removes it after its commit', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const s = await launch(lib, testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, [PDF]);
    const corrupt = path.join(lib, 'staging', `corrupt-${sha256(PDF)}-44444444-4444-4444-8444-444444444444`);
    fs.writeFileSync(corrupt, Buffer.alloc(4200, 1));
    const edit = path.join(lib, 'derived', 'open', ORPHAN_ID, EDIT);
    fs.mkdirSync(path.dirname(edit), { recursive: true });
    fs.copyFileSync(distinctPdfs(testInfo.outputPath('src'), 1)[0]!, edit);
    await stubShell(s.app);
    const sheet = await openCheck(s);
    const damaged = row(sheet, 'corrupt');
    await expect(damaged).toHaveAttribute('data-tone', 'info');
    await expect(damaged.locator('.ci-meta')).toHaveText('sample · 4.2 KB');
    await damaged.getByTestId('check-revealCorrupt').click();
    await expect.poll(() => shellCalls(s.app)).toEqual([['reveal', corrupt]]);
    await expect(damaged).toHaveAttribute('data-state', 'todo');
    const edited = row(sheet, 'orphanEdits');
    await expect(edited.locator('.ci-meta')).toContainText(EDIT);
    await edited.getByTestId('check-revealOrphanEdit').click();
    await expect.poll(() => shellCalls(s.app)).toEqual([['reveal', corrupt], ['reveal', edit]]);
    await edited.getByTestId('check-importOrphanEdits').click();
    await expect(edited).toHaveAttribute('data-state', 'done');
    await expect(edited.locator('.ci-text')).toHaveText('새 자료로 가져왔습니다.');
    expect(fs.existsSync(edit)).toBe(false);
    await clickToCloseSheet(sheet, sheet.getByTestId('check-done'));
    await expect(rowByTitle(s.page, '단백질 접힘 정리 (수정본 2026-10-18 2210)')).toBeVisible();
    expect(fs.existsSync(corrupt)).toBe(true); // the app never removes a corrupt copy
  } finally {
    await s.app.close();
  }
});

test('파일 › 라이브러리 점검… with nothing wrong: 문제가 없습니다 and the records row; a missing linked original alone opens nothing at launch; the check runs after the window', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const data = testInfo.outputPath('userdata');
  const outside = testInfo.outputPath('outside');
  fs.mkdirSync(outside, { recursive: true });
  const original = path.join(outside, 'linked.pdf');
  fs.copyFileSync(distinctPdfs(testInfo.outputPath('src'), 1)[0]!, original);
  let s = await launch(lib, data);
  try {
    await importPaths(s.page, [PDF]);
    await importPaths(s.page, [original], { mode: 'linked' });
    const sheet = await openCheck(s);
    await expect(sheet.getByTestId('check-intro')).toHaveText('문제가 없습니다.');
    await expect(sheet.getByTestId('check-badge')).toHaveAttribute('data-tone', 'success');
    await expect(sheet.getByTestId('check-row')).toHaveCount(1);
    await expect(row(sheet, 'records').locator('.ci-text')).toHaveText('자료 2개의 정보⁠·컬렉션⁠·태그가 그대로입니다.');
    await expect(sheet.getByTestId('check-hint')).toHaveCount(0);
    await expectNoSeriousA11y(sheet, 'library check sheet (nothing wrong)');
    await closeSheet(sheet, 'Enter');
  } finally {
    await s.app.close();
  }
  fs.rmSync(original);
  s = await launch(lib, data);
  try {
    await expect.poll(async () => (await libraryCheckState(s.app)).auto).toBe('not-due');
    expect((await libraryCheckState(s.app)).check).toMatchObject({ actionable: false, missingLinked: { itemIds: [expect.any(String)] } });
    expect(await visibleSheets(s.app)).toBe(0);
    await expect(rowByTitle(s.page, 'linked')).toContainText('파일 없음'); // announced by the check, nothing opened
    const marks = await s.app.evaluate(() => (globalThis as { __learnPerf?: Record<string, number> }).__learnPerf!);
    expect(marks['windowCreated']).toBeGreaterThan(0);
    expect(marks['checkStart']).toBeGreaterThanOrEqual(marks['windowCreated']!);
    expect(marks['checkEnd']).toBeGreaterThanOrEqual(marks['checkStart']!);
  } finally {
    await s.app.close();
  }
});
