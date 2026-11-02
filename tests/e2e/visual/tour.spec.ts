// Visual tour: Linux baseline screenshots of every shell state, light and dark (quality spec M3).
// Baselines: tests/e2e/visual/tour.spec.ts-snapshots/*-linux.png. Update with the 1x run (README "시각 투어 기준 PNG"):
//   pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts --update-snapshots=all, then restore any jitter-only rewrite.
// @2x captures for the design critic, without updating (the baselines stay as committed):
//   LEARN_TOUR_2X=1 pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts → test-results/tour/
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  FIXTURES, addToCollection, assignTag, backupPause, backupResume, backupWaiting, clickToCloseSheet, closeSheet, createCollection, createTag, distinctPdfs, drag, expectWindow, holdCopies, holdJob, importFiles, importPause, importPaths, importResume, importWaiting, mainWindow, menuItemEnabled, openItem, releaseCopies, releaseJob, requestLibraryCheck, rowAt, recordedPopups, restorePause, restoreResume, restoreWaiting, rowByTitle, runMenuCommand, seedLibrary, seedMetadata, selectRows,
  makeTags, setTagColor, specialRow, stubContextMenu, stubFolderPicker, stubFolderPicks, stubSaveDialog, tagChip, trashItems, treeRow, waitForSheet, waitImportIdle, type Session,
} from '../helpers';
import { THEMES, TOUR_VIDEO_BYTES, fixedSizeCopy, launchTour, setTheme, shoot } from './tour';

test.skip(process.platform !== 'linux', 'Linux baselines only; macOS chrome is captured by tests/evidence/shell.evidence.ts');

test('component state board (gallery parts 1–2)', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  try {
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      for (const part of [1, 2]) {
        await s.page.goto(`learn://app/index.html?window=gallery&part=${part}&platform=linux&det=1`);
        await s.page.getByTestId('gallery').waitFor();
        // The board fits the 1440 × 900 window: nothing at its bottom is cut off.
        expect(await s.page.getByTestId('gallery').evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
        await shoot(s.page, `gallery${part}-${theme}`);
      }
    }
  } finally {
    await s.app.close();
  }
});

/** The video fixtures at fixed sizes in `dir` (their table sizes read the same on every machine). */
const h264 = (dir: string) => fixedSizeCopy(path.join(FIXTURES, 'sample-h264-aac.mp4'), dir, TOUR_VIDEO_BYTES.h264);
const library = (dir: string) => [
  path.join(FIXTURES, 'sample.pdf'),
  path.join(FIXTURES, '한글 경로 (테스트) #1.pdf'),
  h264(dir),
  fixedSizeCopy(path.join(FIXTURES, 'sample-mpeg4part2.mp4'), dir, TOUR_VIDEO_BYTES.mpeg4),
];

/** A file named `name` in `dir`: `src`'s bytes and a line of its own (new content every time, and for every `salt`), zero-extended to `bytes`. */
function sizedCopy(src: string, dir: string, name: string, bytes: number, salt = ''): string {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, name);
  fs.writeFileSync(out, Buffer.concat([fs.readFileSync(src), Buffer.from(`\n% ${name}${salt}\n`)]));
  if (fs.statSync(out).size > bytes) throw new Error(`${name} outgrew its tour size (${bytes} B)`);
  fs.truncateSync(out, bytes);
  return out;
}

/** What changes between runs in the item panel: its dates, a fixture's SHA-256 (pdf-lib writes the date), an outside file's path. */
const panelMasks = (page: Page) => [
  page.locator('[data-testid="info-row"]:is([data-field="createdAt"], [data-field="updatedAt"]) dd'),
  page.getByTestId('sha-value'),
  page.locator('[data-testid="file-row"][data-field="location"] dd'),
];
/**
 * Under a palette the dates behind the scrim are hidden, not masked: a mask is painted over everything, so one on a date
 * the palette covers also covered the palette's corner and scroll bar (critique 5).
 */
const BEHIND_PALETTE = [
  '[data-testid="item-row"] [data-col="createdAt"]',
  '[data-testid="info-row"]:is([data-field="createdAt"], [data-field="updatedAt"]) dd',
  '[data-testid="sha-value"]',
  '[data-testid="file-row"][data-field="location"] dd',
]
  .map((sel) => `${sel} { visibility: hidden !important; }`)
  .join('\n');
/** One item in the panel as it stays: its kind line (the page count or length is read from the file, later) and its sections. */
async function panelSettled(page: Page, kind: string | RegExp): Promise<void> {
  await expect(page.getByTestId('inspector-kind')).toHaveText(kind);
  await expect(page.getByTestId('info-section')).toBeVisible();
}

test('library: empty, list, collapsed sidebar, failure toasts', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const dates = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)];
  try {
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `empty-${theme}`);
    }
    const LIBRARY = library(testInfo.outputPath('videos'));
    await importPaths(s.page, LIBRARY);
    // A linked file that went missing: the row shows the link mark and the 파일 없음 flag.
    const gone = testInfo.outputPath('gone.pdf');
    fs.copyFileSync(LIBRARY[0]!, gone);
    await importPaths(s.page, [gone], { mode: 'linked', allowDuplicate: true });
    fs.rmSync(gone);
    await s.page.evaluate(async () => {
      const list = await window.learn.library.list();
      if (list.ok) for (const i of list.data) await window.learn.library.get({ itemId: i.id });
    });
    await expect(s.page.getByTestId('missing-flag')).toHaveCount(1);
    await rowAt(s.page, 0).click(); // library.html: the first row selected while the table has the focus
    await expect(rowAt(s.page, 0)).toHaveAttribute('aria-selected', 'true');
    await panelSettled(s.page, 'PDF'); // a missing original is not read
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `library-${theme}`, { mask: dates() });
      await runMenuCommand(s.app, 'view.toggleSidebar');
      await shoot(s.page, `library-collapsed-${theme}`, { mask: dates() });
      await runMenuCommand(s.app, 'view.toggleSidebar');
    }
    await setTheme(s.page, 'light');
    // A duplicate opens the duplicate sheet (shot in its own test below): close it, which skips.
    const dup = await expectWindow(s.app, 'sheet', () => importFiles(s, [path.join(FIXTURES, 'sample.pdf')]));
    await closeSheet(dup, 'Escape');
    await waitImportIdle(s.page);
    const txt = testInfo.outputPath('notes.txt');
    fs.writeFileSync(txt, 'x');
    await importFiles(s, [txt]);
    await expect(s.page.getByTestId('import-failures')).toBeVisible();
    await shoot(s.page, 'toast-failure-light', { mask: dates() });
    // Several files with one cause: three one-line rows (a long name is cut, its cause stays), "외 2개", the advice once.
    await s.page.getByTestId('import-failures').getByTestId('toast-close').click();
    await expect(s.page.getByTestId('import-failures')).toHaveCount(0);
    await setTheme(s.page, 'dark');
    const names = ['세포 신호 전달 강의 녹음 메모 — 3주차 정리본 (최종).txt', 'notes.txt', 'slides.key', 'draft.docx', 'archive.zip'];
    const files = names.map((n) => {
      const f = testInfo.outputPath(n);
      fs.writeFileSync(f, 'x');
      return f;
    });
    await importFiles(s, files);
    await expect(s.page.getByTestId('import-failures').locator('.t-line')).toHaveCount(4);
    // The long name is what gets cut; its cause stays whole.
    const long = s.page.getByTestId('import-failures').locator('.t-line').first();
    expect(await long.locator('.t-name').evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    expect(await long.locator('.t-cause').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
    await shoot(s.page, 'toast-failure-multi-dark', { mask: dates() });
  } finally {
    await s.app.close();
  }
});

test('quick search: 초성 results with the count and the title mark, and no results', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const dates = () => [s.page.locator('[data-col="createdAt"]')];
  const field = s.page.getByTestId('search-field').locator('input');
  try {
    const items = await importPaths(s.page, library(testInfo.outputPath('videos')));
    await seedMetadata(s.page, items[0]!.id, { creators: [{ name: '김철수', role: 'author' }], date: '2024' }, '세포 신호 전달 개요');
    await expect(rowByTitle(s.page, '세포 신호 전달 개요')).toBeVisible();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      // ⌘F, then 초성: the focused field with its value, "1개 / 4개", 신호 marked in the one row.
      // The menu command reaches the renderer asynchronously: wait for the focus before typing, and set the value the
      // same way in both themes, so no key is lost to the focus's select().
      await runMenuCommand(s.app, 'library.find');
      await expect(field).toBeFocused();
      await field.fill('ㅅㅎ');
      await expect(field).toHaveValue('ㅅㅎ');
      await expect(s.page.getByTestId('toolbar-count')).toHaveText('1개 / 4개');
      await shoot(s.page, `search-${theme}`, { mask: dates() });
      await field.fill('효소 억제제');
      await expect(s.page.getByTestId('search-empty')).toBeVisible();
      await shoot(s.page, `search-none-${theme}`, { mask: dates() });
      await field.fill('');
      await expect(s.page.getByTestId('item-row')).toHaveCount(4);
    }
  } finally {
    await s.app.close();
  }
});

test('quick search in a collection: no results names the view and offers the whole library (library.html ?state=noresults)', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const dates = () => [s.page.locator('[data-col="createdAt"]')];
  const field = s.page.getByTestId('search-field').locator('input');
  try {
    const items = await importPaths(s.page, library(testInfo.outputPath('videos')));
    await seedMetadata(s.page, items[0]!.id, { creators: [{ name: '김철수', role: 'author' }], date: '2024' }, '세포 신호 전달 개요');
    const bio = await createCollection(s.page, '분자생물학');
    await addToCollection(s.page, bio, [items[0]!.id]);
    await s.page.getByTestId(`nav-collection-${bio}`).click();
    await expect(s.page.getByTestId('toolbar-title')).toHaveText('분자생물학');
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await runMenuCommand(s.app, 'library.find');
      await expect(field).toBeFocused();
      await field.fill('효소 억제제');
      await expect(s.page.getByTestId('search-empty-everywhere')).toBeVisible();
      await shoot(s.page, `search-none-collection-${theme}`, { mask: dates() });
      await field.fill('');
      await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    }
  } finally {
    await s.app.close();
  }
});

test('keyboard focus: sidebar row and table row cursor', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  try {
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf'), h264(testInfo.outputPath('videos'))]);
    await setTheme(s.page, 'light');
    await s.page.keyboard.press('F6');
    await shoot(s.page, 'focus-sidebar-light', { mask: [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]')] });
    await s.page.keyboard.press('F6');
    await panelSettled(s.page, / · /);
    await shoot(s.page, 'focus-row-light', { mask: [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)] });
  } finally {
    await s.app.close();
  }
});

test('item panel: nothing selected, one item, several, a missing original, folded, loading', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  // The table's dates in its rows only (the header keeps its sort arrow), and what moves in the panel (panelMasks).
  const masks = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)];
  try {
    const LIBRARY = library(testInfo.outputPath('videos'));
    const [sample] = await importPaths(s.page, LIBRARY);
    await seedMetadata(s.page, sample!.id, {
      creators: [{ name: '한서진', role: 'author' }, { name: '윤재하', role: 'author' }, { name: '배유나', role: 'editor' }],
      date: '2024-03-15', publisher: '학습출판', language: '한국어', url: 'https://example.org/molbio/6',
      abstract: ['세포가 바깥 신호를 받아들이는 과정을 수용체, G 단백질, 2차 전령의 순서로 정리한다.', '각 단계에서 신호가 어떻게 증폭되는지 그림 6-4와 함께 설명한다.', '신호를 끄는 장치와 그 속도가 반응의 크기를 정한다는 점을 다룬다.', '마지막 절은 수용체 타이로신 인산화효소를 소개한다.', '연습 문제는 66쪽에 있다.'].join('\n'),
      extra: '시험 범위: 6장 전체',
    });
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await expect(s.page.getByTestId('inspector-none')).toBeVisible(); // imported from the page: no focus entered the table
      await shoot(s.page, `inspector-none-${theme}`, { mask: masks() });
    }
    await selectRows(s.page, ['sample']);
    await expect(s.page.getByTestId('inspector-kind')).toHaveText('PDF · 3쪽');
    await expect(s.page.getByTestId('info-row')).toHaveCount(9);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `inspector-item-${theme}`, { mask: masks() });
    }
    await selectRows(s.page, ['sample', '한글 경로 (테스트) #1', 'sample-h264-aac'], { modifier: 'Meta' });
    await expect(s.page.getByTestId('multi-row')).toHaveCount(3);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `inspector-multi-${theme}`, { mask: masks() });
    }
    await setTheme(s.page, 'light');
    // A linked original that went missing: 다시 연결… leads.
    const gone = testInfo.outputPath('gone.pdf');
    fs.copyFileSync(LIBRARY[0]!, gone);
    await importPaths(s.page, [gone], { mode: 'linked', allowDuplicate: true });
    fs.rmSync(gone);
    await s.page.evaluate(async () => {
      const list = await window.learn.library.list();
      if (list.ok) for (const i of list.data) await window.learn.library.get({ itemId: i.id });
    });
    await selectRows(s.page, ['gone']);
    await expect(s.page.getByTestId('inspector-relink')).toBeVisible();
    await panelSettled(s.page, 'PDF'); // a missing file is not read; its outside path is masked
    await shoot(s.page, 'inspector-missing-light', { mask: masks() });
    // Folded by the user: the toolbar toggle off.
    await runMenuCommand(s.app, 'view.toggleInspector');
    await expect(s.page.getByTestId('shell')).toHaveAttribute('data-inspector', 'hidden');
    await shoot(s.page, 'inspector-hidden-light', { mask: masks() });
    await runMenuCommand(s.app, 'view.toggleInspector');
    // Loading past 300 ms (design-spec 6): the item's detail never answers. Last: the handler stays replaced.
    await s.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('library:detail');
      ipcMain.handle('library:detail', () => new Promise(() => {}));
    });
    await selectRows(s.page, ['sample-mpeg4part2']);
    await expect(s.page.getByTestId('inspector-loading')).toBeVisible();
    await shoot(s.page, 'inspector-loading-light', { mask: masks() });
  } finally {
    await s.app.close();
  }
});

test('toasts: 내보내는 중… while a copy runs, then 사본을 저장했습니다 with 폴더에서 보기', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  // The table's date cells only, and what moves in the item panel.
  const dates = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)];
  try {
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf'), h264(testInfo.outputPath('videos'))]);
    await setTheme(s.page, 'light');
    const out = testInfo.outputPath('exports');
    fs.mkdirSync(out, { recursive: true });
    await stubSaveDialog(s.app, path.join(out, 'sample.pdf'));
    await holdCopies(s.app);
    await stubContextMenu(s.app, '사본 내보내기…');
    await rowByTitle(s.page, 'sample').click({ button: 'right' }); // selects it first (spec 3.3), then the item menu
    await expect(s.page.getByTestId('file-busy')).toBeVisible();
    await panelSettled(s.page, 'PDF · 3쪽'); // the panel reads the page count from the file, not through a copy
    await shoot(s.page, 'toast-busy-light', { mask: dates() });
    await releaseCopies(s.app);
    // Shot at once: a success toast closes 5 s after it first paints.
    await expect(s.page.getByTestId('export-done')).toBeVisible();
    await shoot(s.page, 'toast-export-light', { mask: dates() });
  } finally {
    await s.app.close();
  }
});

test('정보 편집: the form in place, its end, and a marked field with the unsaved line', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  // What moves in the panel (the SHA-256 shows under the form) and the table's dates in its rows only.
  const masks = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)];
  try {
    const [sample] = await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf'), path.join(FIXTURES, '한글 경로 (테스트) #1.pdf')]);
    await seedMetadata(s.page, sample!.id, {
      creators: [{ name: '한서진', role: 'author' }, { name: '배유나', role: 'editor' }],
      date: '2024-03-15', publisher: '학습출판', language: '한국어', url: 'https://example.org/molbio/6',
      abstract: '세포가 바깥 신호를 받아들이는 과정을 수용체, G 단백질, 2차 전령의 순서로 정리한다.',
    });
    await selectRows(s.page, ['sample']);
    await panelSettled(s.page, 'PDF · 3쪽');
    await s.page.getByTestId('info-edit').click();
    await expect(s.page.getByTestId('info-editor')).toBeVisible();
    await expect(s.page.locator('[data-testid="editor-field"][data-field="title"] input')).toBeFocused();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `inspector-edit-${theme}`, { mask: masks() }); // the title field focused (its halo)
    }
    await setTheme(s.page, 'light');
    await s.page.locator('.inspector-scroll').evaluate((e) => e.scrollTo(0, e.scrollHeight));
    await shoot(s.page, 'inspector-edit-end-light', { mask: masks() }); // 메모, 취소 · 저장
    await s.page.locator('[data-testid="editor-field"][data-field="date"] input').fill('2024-13');
    await expect(s.page.locator('[data-testid="editor-field"][data-field="date"] input')).toHaveValue('2024-13');
    await selectRows(s.page, ['한글 경로 (테스트) #1']); // refused: the selection comes back to sample
    await expect(s.page.getByTestId('editor-unsaved')).toBeVisible();
    await s.page.locator('.inspector-scroll').evaluate((e) => e.scrollTo(0, 0));
    await shoot(s.page, 'inspector-edit-invalid-light', { mask: masks() });
    await s.page.getByTestId('editor-discard').click(); // nothing left to hold the window when the app closes
  } finally {
    await s.app.close();
  }
});

test('sheets: duplicate and shortcuts', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  try {
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf')]);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      const dup = await expectWindow(s.app, 'sheet', () => importFiles(s, [path.join(FIXTURES, 'sample.pdf')]));
      await shoot(dup, `sheet-duplicate-${theme}`, { mask: [dup.getByTestId('dup-card').locator('.t-footnote')] });
      await closeSheet(dup, 'Escape');
      await expect.poll(() => menuItemEnabled(s.app, 'app.shortcuts')).toBe(true);
      const keys = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'app.shortcuts'));
      await shoot(keys, `sheet-shortcuts-${theme}`);
      await closeSheet(keys, 'Escape');
      await expect.poll(() => menuItemEnabled(s.app, 'app.shortcuts')).toBe(true);
    }
  } finally {
    await s.app.close();
  }
});

const fileSha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const managedCopy = (lib: string, file: string) => {
  const sha = fileSha(file);
  return path.join(lib, 'assets', sha.slice(0, 2), sha);
};

test('library check sheet: automatic, every row, a row fixed (M6 spec 7.2, P-26)', async ({}, testInfo) => {
  const dir = testInfo.outputPath();
  const lib = path.join(dir, 'library');
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  const linkedSrc = path.join(outside, 'Calcium Signaling Revisited.pdf');
  fs.writeFileSync(linkedSrc, Buffer.concat([fs.readFileSync(path.join(FIXTURES, 'sample.pdf')), Buffer.from('\n% linked\n')]));
  const files = library(dir);
  // Two more documents whose copies go missing with the others: four in all, so the row names two and says 외 2개.
  const extras = ['Extra A', 'Extra B'].map((n) => sizedCopy(path.join(FIXTURES, 'sample.pdf'), path.join(dir, 'extra'), `${n}.pdf`, 60_000));
  let s = await launchTour(dir);
  await importPaths(s.page, files);
  await importPaths(s.page, extras);
  await importPaths(s.page, [linkedSrc], { mode: 'linked' });
  await s.app.close();
  // Left while the app was closed (the mockup's automatic scene): two stopped imports, a damaged copy set aside, the
  // linked original moved away.
  for (const n of ['11111111-1111-4111-8111-111111111111.part', '22222222-2222-4222-8222-222222222222.part']) fs.writeFileSync(path.join(lib, 'staging', n), Buffer.alloc(2_060_000, 1));
  fs.writeFileSync(path.join(lib, 'staging', `corrupt-${fileSha(files[0]!)}-44444444-4444-4444-8444-444444444444`), Buffer.alloc(4_200_000, 2));
  fs.renameSync(linkedSrc, path.join(outside, 'moved.pdf'));
  s = await launchTour(dir);
  const masks = (sheet: Page) => [sheet.locator('.ce-path')]; // the original's folder is the test's own
  try {
    // The sheet that opened by itself was measured before the tour sized the window: closed, and asked for again.
    await closeSheet(await waitForSheet(s.app), 'Escape');
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      const sheet = await expectWindow(s.app, 'sheet', () => requestLibraryCheck(s.app));
      await shoot(sheet, `check-auto-${theme}`, { mask: masks(sheet) });
      await closeSheet(sheet, 'Escape');
    }
    // Every row (recovery-full): an unused copy, an orphan edited copy, two managed copies gone.
    fs.mkdirSync(path.join(lib, 'assets', 'cc'), { recursive: true });
    fs.writeFileSync(path.join(lib, 'assets', 'cc', 'c'.repeat(64)), Buffer.alloc(96_000, 3));
    const edit = path.join(lib, 'derived', 'open', '0a1b2c3d-4e5f-4061-8172-8394a5b6c7d8', '단백질 접힘 정리 (수정본 2026-10-18 2210).pdf');
    fs.mkdirSync(path.dirname(edit), { recursive: true });
    fs.writeFileSync(edit, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3_091, 4)]));
    for (const f of [files[1]!, files[2]!, ...extras]) fs.rmSync(managedCopy(lib, f));
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      const sheet = await expectWindow(s.app, 'sheet', () => requestLibraryCheck(s.app));
      // The sheet is at its cap on Linux: the list scrolls inside its card under the head and over the foot, 외 2개 in the row.
      await expect(sheet.getByTestId('check-more')).toHaveText('외 2개');
      await expect.poll(() => sheet.getByTestId('check-scroll').evaluate((el) => el.scrollHeight > el.clientHeight + 1)).toBe(true);
      await shoot(sheet, `check-full-${theme}`, { mask: masks(sheet) });
      // The one action that cannot be undone asks in its row (Q-8h), right after 정리…; esc keeps the copies.
      await sheet.getByTestId('check-askClean').click();
      await expect(sheet.getByTestId('check-confirm')).toBeVisible();
      await shoot(sheet, `check-confirm-${theme}`, { mask: masks(sheet) });
      await sheet.keyboard.press('Escape');
      await expect(sheet.getByTestId('check-confirm')).toHaveCount(0);
      await closeSheet(sheet, 'Escape');
    }
    // 파일 › 라이브러리 점검… with something to do (Q-8i): the rows to act on, and no sentence at the foot.
    await setTheme(s.page, 'light');
    await expect.poll(() => menuItemEnabled(s.app, 'file.checkLibrary')).toBe(true);
    const manual = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'file.checkLibrary'));
    await expect(manual.getByTestId('check-cleanStaging')).toBeVisible();
    await expect(manual.getByTestId('check-hint')).toHaveCount(0);
    await shoot(manual, 'check-manual-light', { mask: masks(manual) });
    await closeSheet(manual, 'Escape');
    // A row fixed in place: 임시 파일 정리, both themes on the one sheet.
    const sheet = await expectWindow(s.app, 'sheet', () => requestLibraryCheck(s.app));
    await sheet.getByTestId('check-cleanStaging').click();
    await expect(sheet.locator('[data-testid="check-row"][data-kind="staging"]')).toHaveAttribute('data-state', 'done');
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      // The open sheet follows the native theme on its own: wait for it before the shot.
      await expect.poll(() => sheet.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark');
      await shoot(sheet, `check-fixed-${theme}`, { mask: masks(sheet) });
    }
    await closeSheet(sheet, 'Escape');
  } finally {
    await s.app.close();
  }
});

test('library check sheet: nothing wrong (파일 › 라이브러리 점검…, recovery-ok)', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  try {
    await importPaths(s.page, library(testInfo.outputPath()));
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await expect.poll(() => menuItemEnabled(s.app, 'file.checkLibrary')).toBe(true);
      const sheet = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'file.checkLibrary'));
      await shoot(sheet, `check-ok-${theme}`);
      await closeSheet(sheet, 'Enter');
    }
  } finally {
    await s.app.close();
  }
});

// M6 (spec 3.4): the duplicate question with its box for the rest, ticked as it opens; the existing station above is the
// single duplicate, which has no box.
test('sheets: duplicate with the box for the remaining duplicates', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  try {
    const dir = testInfo.outputPath('again');
    const twice = ['molbio_ch06_signaling.pdf', 'molbio_ch07_receptors.pdf', 'molbio_ch08_kinases.pdf'].map((n) => sizedCopy(path.join(FIXTURES, 'sample.pdf'), dir, n, 1_000_000));
    await importPaths(s.page, twice);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      const sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, twice));
      await expect(sheet.getByRole('checkbox', { name: '남은 중복 파일 2개에도 같은 선택 적용' })).toBeChecked();
      await shoot(sheet, `sheet-duplicate-rest-${theme}`, { mask: [sheet.getByTestId('dup-card').locator('.t-footnote')] });
      if (theme === 'light') {
        // Tab from 건너뛰기 round to the box: its ring is the keyboard's.
        for (let i = 0; i < 6 && !(await sheet.locator('label.checkbox[data-focus-visible]').count()); i++) await sheet.keyboard.press('Tab');
        await expect(sheet.locator('label.checkbox[data-focus-visible]')).toHaveCount(1);
        await shoot(sheet, 'sheet-duplicate-rest-focus-light', { mask: [sheet.getByTestId('dup-card').locator('.t-footnote')], keepPointer: true });
      }
      await closeSheet(sheet, 'Escape'); // 건너뛰기 for all three: the box was ticked
      await waitImportIdle(s.page);
    }
  } finally {
    await s.app.close();
  }
});

test('selection commands: the palette with one selected row lists 폴더에서 보기 and 기본 앱으로 열기', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  try {
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf')]);
    await setTheme(s.page, 'light');
    await rowByTitle(s.page, 'sample').click();
    await panelSettled(s.page, 'PDF · 3쪽');
    await expect.poll(() => menuItemEnabled(s.app, 'item.showInFolder')).toBe(true);
    await runMenuCommand(s.app, 'app.palette');
    await expect(s.page.locator('[data-testid="palette-item"][data-command-id="item.openExternally"]')).toBeVisible();
    await shoot(s.page, 'palette-selection-light', { style: BEHIND_PALETTE });
  } finally {
    await s.app.close();
  }
});

/** palette.html's items: 신호 in four titles, one of them a video; author and year on two (spec §4.4: 저자 · 연도, else the kind). */
async function paletteLibrary(s: Session, dir: string): Promise<string[]> {
  fs.mkdirSync(dir, { recursive: true });
  const pdf = (name: string) => {
    const p = path.join(dir, `${name}.pdf`);
    fs.writeFileSync(p, `%PDF-1.4\n% ${name}\n%%EOF\n`);
    return p;
  };
  const video = path.join(dir, 'c.mp4');
  fs.renameSync(h264(dir), video);
  // One import each, a few ms apart: the list (newest first) is d, c, b, a, and b and c, which match 신호 at the same
  // place, keep that order in the palette too (the newer first) — the shot is the same on every run.
  const imported: string[] = [];
  for (const p of [pdf('a'), pdf('b'), video, pdf('d')]) {
    imported.push(...(await importPaths(s.page, [p])).map((i) => i.id));
    await s.page.waitForTimeout(5);
  }
  await s.page.evaluate(async (ids) => {
    const set = (itemId: string, title: string, names: string[], date: string | null, role: 'author' | 'lecturer') =>
      window.learn.library.updateMetadata({ itemId, title, metadata: { creators: names.map((name) => ({ name, role })), ...(date ? { date } : {}) } });
    await set(ids[0]!, '세포 신호 그림 모음', [], null, 'author');
    await set(ids[1]!, '분자생물학 6장 · 신호 전달', ['김하늘'], '2024', 'author');
    await set(ids[2]!, '강의 04 · 세포 신호', ['박서준'], '2025', 'lecturer');
    await set(ids[3]!, '신호 증폭의 정량 모델', ['이도윤', '최민서'], '2023', 'author');
  }, imported);
  await expect(rowByTitle(s.page, '신호 증폭의 정량 모델')).toBeVisible();
  return imported;
}

test('palette: empty query, 자료 results (palette.html), commands only, no results, and the cursor row when the window is not key', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const input = s.page.getByTestId('palette-input');
  const cursor = s.page.locator('.palette [role="option"][data-focused]');
  try {
    const ids = await paletteLibrary(s, testInfo.outputPath('media'));
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await runMenuCommand(s.app, 'app.palette');
      // Every available command, the cursor on the first; nothing ran from the palette yet.
      await expect(cursor).toHaveAttribute('data-command-id', 'file.importManaged');
      await shoot(s.page, `palette-empty-${theme}`, { style: BEHIND_PALETTE });
      // palette.html: 자료 above 명령, the matched 신호 in each title, 저자 · 연도 on the right, 라이브러리에서 ‘신호’ 검색 last.
      await input.fill('신호');
      await expect(s.page.getByTestId('palette-result')).toHaveCount(4);
      await expect(cursor).toHaveAttribute('data-testid', 'palette-result');
      await expect(s.page.locator('.p-foot')).toContainText('ㅅㅎ → 신호');
      await shoot(s.page, `palette-items-${theme}`, { style: BEHIND_PALETTE });
      // Commands only, the search row under them (ㄱㅈㅇ: 파일 가져오기… alone, in no title) — M3's palette-{light,dark} state.
      await input.fill('ㄱㅈㅇ');
      await expect(cursor).toHaveAttribute('data-command-id', 'file.importManaged');
      await expect(s.page.getByTestId('palette-search-library')).toBeVisible();
      await shoot(s.page, `palette-${theme}`, { style: BEHIND_PALETTE });
      if (theme === 'light') {
        // ㄱ: several command rows (빠른 검색 by its 검색, 항목 패널 by 가리기), the <mark> in accent text on the rows the cursor is not on.
        await input.fill('ㄱ');
        await expect(s.page.getByTestId('palette-item').nth(2)).toBeVisible();
        await expect(s.page.locator('[data-testid="palette-item"]:not([data-focused]) mark').first()).toBeVisible();
        await shoot(s.page, 'palette-multi-light', { style: BEHIND_PALETTE });
      }
      // palette.html ?state=none: the notice, then the search row under the cursor; the foot says ↩ 실행 · esc 닫기.
      await input.fill('효소 억제제');
      await expect(s.page.getByTestId('palette-empty')).toBeVisible();
      await expect(cursor).toHaveAttribute('data-testid', 'palette-search-library');
      await shoot(s.page, `palette-none-${theme}`, { style: BEHIND_PALETTE });
      await s.page.keyboard.press('Escape');
      await expect(s.page.getByTestId('palette')).toBeHidden();
    }
    // Another window takes the key: the palette stays, its cursor row (an item) is the neutral selection (design-spec 3.1).
    await setTheme(s.page, 'light');
    await runMenuCommand(s.app, 'app.palette');
    await input.fill('신호');
    await expect(cursor).toHaveAttribute('data-testid', 'palette-result');
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = new BrowserWindow({ width: 300, height: 200, show: true });
      void w.loadURL('about:blank');
      w.focus();
      (globalThis as { __probeWindow?: unknown }).__probeWindow = w;
    });
    await expect(s.page.locator('html')).toHaveAttribute('data-window-inactive', '');
    await shoot(s.page, 'palette-inactive-light', { style: BEHIND_PALETTE });
    await s.app.evaluate(() => (globalThis as { __probeWindow?: { close(): void } }).__probeWindow?.close());
    await (await mainWindow(s.app)).evaluate((w) => w.focus());
    await expect(s.page.locator('html')).not.toHaveAttribute('data-window-inactive', '');
    // A long author list is cut with an ellipsis inside 240 px and the title keeps its width (spec 10.5).
    await s.page.evaluate(
      (id) => window.learn.library.updateMetadata({ itemId: id, title: '신호 증폭의 정량 모델', metadata: { creators: ['김하늘', '박서준', '이도윤', '최민서', '정우진', '한지민', '오세훈', '윤아름'].map((name) => ({ name, role: 'author' as const })), date: '2023' } }),
      ids[3]!,
    );
    await input.fill('증폭');
    const longSub = s.page.getByTestId('palette-result').first().locator('.p-sub');
    await expect(longSub).toContainText('김하늘');
    await expect.poll(() => longSub.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await shoot(s.page, 'palette-long-light', { style: BEHIND_PALETTE });
  } finally {
    await s.app.close();
  }
});

test('palette: the 컬렉션 group between 자료 and 명령 (palette.html)', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  try {
    const ids = await paletteLibrary(s, testInfo.outputPath('media'));
    const bio = await createCollection(s.page, '분자생물학');
    const ch6 = await createCollection(s.page, '6장 · 신호 전달', bio);
    await createCollection(s.page, '7장 · 세포 주기', bio);
    await addToCollection(s.page, ch6, [ids[1]!]);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await runMenuCommand(s.app, 'app.palette');
      await s.page.getByTestId('palette-input').fill('신호');
      await expect(s.page.getByTestId('palette-result')).toHaveCount(4);
      await expect(s.page.getByTestId('palette-collection')).toHaveCount(1);
      await expect(s.page.locator('.palette .p-group')).toHaveText(['자료', '컬렉션', '명령']);
      await shoot(s.page, `palette-collections-${theme}`, { style: BEHIND_PALETTE });
      await s.page.keyboard.press('Escape');
      await expect(s.page.getByTestId('palette')).toBeHidden();
    }
  } finally {
    await s.app.close();
  }
});

test('drop overlay: copy and ⌥ link, and in a window that is neither key nor main', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const files: Array<[string, string]> = [
    ['a.pdf', 'application/pdf'],
    ['b.pdf', 'application/pdf'],
    ['c.mp4', 'video/mp4'],
  ];
  // As the OS does, the held drag repeats dragover (helpers drag), so the overlay's idle timeout never ends it mid-shot.
  const fire = (type: 'dragenter' | 'dragover' | 'dragleave', altKey: boolean) => drag(s.page, type, files, { altKey });
  const overlay = s.page.getByTestId('drop-overlay');
  try {
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await fire('dragenter', false);
      await expect(overlay).toHaveAttribute('data-mode', 'copy');
      await shoot(s.page, `drop-${theme}`);
      if (theme === 'light') {
        await fire('dragover', true);
        await expect(overlay).toHaveAttribute('data-mode', 'link');
        await shoot(s.page, 'drop-link-light');
        // A drag from Finder arrives while Finder is the active app: the window is neither key nor main (forced, as
        // main sets them). The chrome above recedes; the overlay's ring, tile and current card do not.
        await fire('dragover', false);
        await s.page.evaluate(() => {
          document.documentElement.setAttribute('data-window-inactive', '');
          document.documentElement.setAttribute('data-window-not-main', '');
        });
        await expect(overlay).toHaveAttribute('data-mode', 'copy');
        await shoot(s.page, 'drop-inactive-light');
        await s.page.evaluate(() => {
          document.documentElement.removeAttribute('data-window-inactive');
          document.documentElement.removeAttribute('data-window-not-main');
        });
      }
      await fire('dragleave', false);
      await expect(overlay).toHaveCount(0);
    }
  } finally {
    await s.app.close();
  }
});

/** The settings window's BrowserWindow, evaluated in main. */
const settingsWindow = (app: Session['app']) =>
  app.evaluateHandle(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('window=settings'))!);

test('settings window (light, dark, focus, not key, a refused folder), compact density, 15 pt text', async ({}, testInfo) => {
  // The library as deep as the default macOS one, under a HOME in the test folder: the path reads the same everywhere.
  const home = tourHome(testInfo.outputPath());
  const s = await launchTour(path.join(home, 'Library', 'Application Support', 'Learn'), { HOME: home });
  const dates = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]')];
  try {
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf'), h264(testInfo.outputPath('videos'))]);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      const settings = await expectWindow(s.app, 'settings', () => runMenuCommand(s.app, 'app.settings'));
      await expect(settings.getByTestId('library-path')).toHaveText('~/Library/Application Support/Learn/library');
      await shoot(settings, `settings-${theme}`);
      if (theme === 'light') {
        // Keyboard focus on the selected tile: the focus ring 2 px outside the selection ring (critic T10-n5).
        await settings.keyboard.press('Tab');
        await expect(settings.getByTestId('theme-tile-light')).toHaveAttribute('data-focus-visible', 'true');
        await shoot(settings, 'settings-focus-light');
        // Not the key window: no focus ring, and the selection ring turns neutral (design-spec 2.1, 3.1).
        await (await mainWindow(s.app)).evaluate((w) => w.focus());
        await expect(settings.locator('html')).toHaveAttribute('data-window-inactive', '');
        await shoot(settings, 'settings-inactive-light');
        await (await settingsWindow(s.app)).evaluate((w) => w.focus());
        await expect(settings.locator('html')).not.toHaveAttribute('data-window-inactive', '');
        // A folder the user cannot write to: the cause and the next step under the buttons.
        const ro = testInfo.outputPath('read-only');
        fs.mkdirSync(ro, { recursive: true, mode: 0o555 });
        await s.app.evaluate(({ dialog }, dir) => {
          dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
        }, ro);
        await settings.getByTestId('library-choose').click();
        await expect(settings.getByTestId('library-error')).toBeVisible();
        await shoot(settings, 'settings-error-light');
        fs.chmodSync(ro, 0o755);
      }
      await settings.close(); // Playwright's Page.close closes the BrowserWindow
    }
    // The main window is key again (Xvfb has no window manager to hand it back).
    await (await mainWindow(s.app)).evaluate((w) => w.focus());
    await expect(s.page.locator('html')).not.toHaveAttribute('data-window-inactive', '');
    await setTheme(s.page, 'light');
    await s.page.evaluate(() => window.learn.prefs.set({ density: 'compact' }));
    await expect(s.page.locator('html')).toHaveAttribute('data-density', 'compact');
    await shoot(s.page, 'density-compact-light', { mask: dates() });
    await s.page.evaluate(() => window.learn.prefs.set({ density: 'regular', fontSize: 15 }));
    await expect(s.page.locator('html')).toHaveAttribute('data-font-size', '15');
    await shoot(s.page, 'font-15-light', { mask: dates() });
  } finally {
    await s.app.close();
  }
});

// 백업 (spec 8; dialogs.html?scene=jobs, ?scene=backup, ?scene=backup-missing, settings.html): the backup's toast with an
// import waiting behind it, the result sheet, 마지막 백업. Files of fixed sizes, so the bar and the sizes read the same
// everywhere; the minute (the folder's name, the sheet's first line, the settings date) is masked.
test('backup: its toast with an import waiting behind it, the result sheet (and with a lost copy), 마지막 백업 in settings', async ({}, testInfo) => {
  const home = tourHome(testInfo.outputPath());
  const dir = path.join(home, 'Library', 'Application Support', 'Learn');
  const s = await launchTour(dir, { HOME: home });
  const documents = path.join(home, 'Documents');
  fs.mkdirSync(documents, { recursive: true });
  const dates = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)];
  const sheetMasks = (sheet: Page) => [sheet.getByTestId('backup-when'), sheet.getByTestId('backup-location')];
  try {
    const src = testInfo.outputPath('src');
    await importPaths(s.page, [fixedSizeCopy(path.join(FIXTURES, 'sample.pdf'), src, 1_500_000), h264(src)]);
    const more = distinctPdfs(testInfo.outputPath('more'), 2);
    for (const p of more) fs.truncateSync(p, 1_000_000);
    const toastsGone = () => expect(s.page.locator('[data-pane="toasts"] .toast')).toHaveCount(0, { timeout: 15_000 });
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await toastsGone(); // an earlier result toast would sit under the backup's (5 s), and the two themes must show the same stack
      await backupPause(s.app);
      await stubFolderPicker(s.app, documents);
      await runMenuCommand(s.app, 'file.backup');
      await expect.poll(() => backupWaiting(s.app)).not.toBeNull();
      await importFiles(s, more.slice(0, 2));
      await expect(s.page.getByTestId('import-progress')).toHaveAttribute('data-state', 'waiting-job');
      await expect(s.page.getByTestId('backup-progress')).toHaveAttribute('data-state', 'running');
      await shoot(s.page, `toast-backup-jobs-${theme}`, { mask: [...dates(), s.page.getByTestId('backup-progress').locator('.t-file')] });
      // The waiting import is cancelled, so the library keeps its two items and both themes back up (and show) the same.
      await s.page.getByTestId('import-cancel').click();
      await expect(s.page.getByTestId('import-progress')).toHaveCount(0);
      const sheet = await expectWindow(s.app, 'sheet', () => backupResume(s.app));
      await expect(sheet.getByTestId('backup-files')).toContainText('손상 없음');
      await shoot(sheet, `sheet-backup-${theme}`, { mask: sheetMasks(sheet) });
      await closeSheet(sheet, 'Enter');
      await waitImportIdle(s.page);
      const settings = await expectWindow(s.app, 'settings', () => runMenuCommand(s.app, 'app.settings'));
      await expect(settings.getByTestId('last-backup-date')).toBeVisible();
      await shoot(settings, `settings-backup-${theme}`, { mask: [settings.getByTestId('last-backup-date')] });
      await settings.close();
      await (await mainWindow(s.app)).evaluate((w) => w.focus());
    }
    // A managed copy gone from the library: the sheet says it was kept without its file (?scene=backup-missing).
    await setTheme(s.page, 'light');
    const assets = path.join(dir, 'library', 'assets');
    const shard = fs.readdirSync(assets).sort()[0]!;
    fs.rmSync(path.join(assets, shard, fs.readdirSync(path.join(assets, shard))[0]!));
    await stubFolderPicker(s.app, documents);
    const sheet = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'file.backup'));
    await expect(sheet.getByTestId('backup-missing-note')).toBeVisible();
    await shoot(sheet, 'sheet-backup-missing-light', { mask: sheetMasks(sheet) });
    await closeSheet(sheet, 'Enter');
  } finally {
    await s.app.close();
  }
});

// 복원 (spec 9; dialogs.html?scene=restore, ?scene=restore-issues): the result sheet, the one with problems, and the restore's
// toast (as ?scene=jobs draws the backup's). Files of fixed sizes, so the bar reads the same everywhere; the backup's minute,
// the restored folder's name and the table's dates are masked.
test('restore: the result sheet (and with problems), its toast', async ({}, testInfo) => {
  const home = tourHome(testInfo.outputPath());
  const dir = path.join(home, 'Library', 'Application Support', 'Learn');
  const s = await launchTour(dir, { HOME: home });
  const backups = path.join(home, 'Documents');
  fs.mkdirSync(backups, { recursive: true });
  const dates = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]')];
  const masks = (sheet: Page) => [sheet.getByTestId('restore-when'), sheet.getByTestId('restore-location')];
  // Restored beside the library (its parent, the second panel's default): ~/Library/Application Support/Learn/Learn 복원 ….
  const restoreFrom = async (backup: string) => {
    await stubFolderPicks(s.app, [backup, dir]);
    return expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'file.restore'));
  };
  try {
    const src = testInfo.outputPath('src');
    const items = await importPaths(s.page, [
      fixedSizeCopy(path.join(FIXTURES, 'sample.pdf'), src, 1_500_000),
      fixedSizeCopy(path.join(FIXTURES, '한글 경로 (테스트) #1.pdf'), src, 900_000),
      h264(src),
    ]);
    const bio = await createCollection(s.page, '분자생물학');
    await addToCollection(s.page, bio, [items[0]!.id]);
    await assignTag(s.page, await createTag(s.page, '시험 범위'), [items[1]!.id]);
    await stubFolderPicker(s.app, backups);
    await closeSheet(await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'file.backup')), 'Enter');
    const backup = path.join(backups, fs.readdirSync(backups).find((n) => n.startsWith('Learn 백업'))!);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      const sheet = await restoreFrom(backup);
      await expect(sheet.getByTestId('restore-files')).toHaveText('3개 확인 · 손상 없음');
      await shoot(sheet, `sheet-restore-${theme}`, { mask: masks(sheet) });
      await closeSheet(sheet, 'Escape');
    }
    // A file the backup no longer holds and one whose contents changed (?scene=restore-issues).
    await setTheme(s.page, 'light');
    const listed = (JSON.parse(fs.readFileSync(path.join(backup, 'manifest.json'), 'utf8')) as { assets: Array<{ included: boolean; relativePath: string | null }> }).assets;
    const [lost, changed] = listed.filter((a) => a.included);
    fs.rmSync(path.join(backup, ...lost!.relativePath!.split('/')));
    fs.appendFileSync(path.join(backup, ...changed!.relativePath!.split('/')), 'changed on the way');
    const issues = await restoreFrom(backup);
    await expect(issues.getByTestId('restore-badge')).toHaveAttribute('data-tone', 'warning');
    await shoot(issues, 'sheet-restore-issues-light', { mask: masks(issues) });
    await closeSheet(issues, 'Escape');
    // The restore's toast while it copies (the backup's machine, P-3).
    await restorePause(s.app);
    await stubFolderPicks(s.app, [backup, dir]);
    await runMenuCommand(s.app, 'file.restore');
    await expect.poll(() => restoreWaiting(s.app)).not.toBeNull();
    await expect(s.page.getByTestId('restore-progress')).toHaveAttribute('data-state', 'running');
    await shoot(s.page, 'toast-restore-light', { mask: [...dates(), s.page.getByTestId('restore-progress').locator('.t-file')] });
    await closeSheet(await expectWindow(s.app, 'sheet', () => restoreResume(s.app)), 'Escape');
  } finally {
    await s.app.close();
  }
});

/**
 * A home folder inside the test folder (HOME for the app): paths on screen read "~/…" the same on every machine, so
 * the path lines need no mask. Returns its path.
 */
function tourHome(dir: string): string {
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  return home;
}

test('readers: PDF, unplayable video, PDF that cannot be opened, missing original', async ({}, testInfo) => {
  const home = tourHome(testInfo.outputPath());
  const s = await launchTour(home, { HOME: home });
  try {
    // The unplayable fixture at a fixed size: "300 KB" everywhere, still refused as MPEG-4 Part 2.
    const unplayable = fixedSizeCopy(path.join(FIXTURES, 'sample-mpeg4part2.mp4'), home, TOUR_VIDEO_BYTES.mpeg4);
    const broken = path.join(home, 'broken.pdf');
    fs.writeFileSync(broken, '%PDF-1.4\n% not a real document\n%%EOF\n'); // passes the import's type check, pdf.js rejects it
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf'), unplayable, broken]);
    const gone = path.join(home, 'Downloads', 'gone.pdf');
    fs.mkdirSync(path.dirname(gone), { recursive: true });
    fs.copyFileSync(path.join(FIXTURES, 'sample.pdf'), gone);
    await importPaths(s.page, [gone], { mode: 'linked', allowDuplicate: true });
    fs.rmSync(gone);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await openItem(s.page, 'sample');
      await expect(s.page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
      // The page's own text: the sample's non-embedded standard font is drawn with the system's fallback font, which
      // differs between Debian and Ubuntu (CI). The page box, its shadow, the stage and both toolbars stay compared.
      await shoot(s.page, `reader-pdf-${theme}`, { mask: [s.page.getByTestId('pdf-canvas')] });
      await s.page.getByTestId('viewer-back').click();
      await openItem(s.page, 'sample-mpeg4part2');
      await expect(s.page.getByTestId('video-error')).toContainText('이 동영상은 재생할 수 없습니다');
      await shoot(s.page, `reader-codec-${theme}`);
      await s.page.getByTestId('viewer-back').click();
      await openItem(s.page, 'broken');
      await expect(s.page.getByTestId('pdf-error')).toBeVisible();
      await shoot(s.page, `reader-error-${theme}`);
      await s.page.getByTestId('viewer-back').click();
      await openItem(s.page, 'gone');
      await expect(s.page.getByTestId('missing-notice').locator('.file')).toHaveText('~/Downloads/gone.pdf');
      await shoot(s.page, `reader-missing-${theme}`);
      await s.page.getByTestId('missing-back').click();
      await expect(s.page.getByTestId('library-table')).toBeVisible();
    }
  } finally {
    await s.app.close();
  }
});

test('table: several rows selected with the keyboard cursor, sorted by title, and the window not key', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const dates = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)];
  try {
    const [pdf] = await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf')]);
    await seedLibrary(s.app, { count: 11, from: pdf! });
    await expect(s.page.getByTestId('toolbar-count')).toHaveText('12개');
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      // library.html?state=multi: rows 1, 3 and 6 selected, the keyboard cursor on 6 (← does nothing in the table, but
      // it is a key: the cursor shows its ring).
      await rowAt(s.page, 0).click();
      await rowAt(s.page, 2).click({ modifiers: ['Control'] });
      await rowAt(s.page, 5).click({ modifiers: ['Control'] });
      await s.page.keyboard.press('ArrowLeft');
      await expect(rowAt(s.page, 5)).toHaveAttribute('data-focus-visible', 'true');
      await expect(s.page.locator('[data-testid="item-row"][aria-selected="true"]')).toHaveCount(3);
      await shoot(s.page, `table-multi-${theme}`, { mask: dates() });
    }
    await setTheme(s.page, 'light');
    const title = s.page.locator('[data-testid="column-header"][data-col="title"]');
    await title.click();
    await expect(title).toHaveAttribute('aria-sort', 'ascending');
    await rowAt(s.page, 0).click();
    await panelSettled(s.page, 'PDF · 3쪽');
    await shoot(s.page, 'table-sorted-light', { mask: dates() });
    // Tags, so the not-main capture shows the tag selector's "…", glass and placeholder dimmed with the rest of the chrome.
    await makeTags(s.page, [
      { name: '중요', slot: 1, items: [pdf!.id] },
      { name: '수용체', items: [pdf!.id] },
    ]);
    await expect(s.page.getByTestId('tag-selector')).toBeVisible();
    // Another window takes the key: the selection turns neutral and the cursor ring goes (design-spec 2.1, 3.1).
    await s.page.keyboard.press('ArrowDown');
    await expect(rowAt(s.page, 1)).toHaveAttribute('data-focus-visible', 'true');
    await s.app.evaluate(({ BrowserWindow }) => {
      const w = new BrowserWindow({ width: 300, height: 200, show: true });
      void w.loadURL('about:blank');
      w.focus();
      (globalThis as { __probeWindow?: unknown }).__probeWindow = w;
    });
    await expect(s.page.locator('html')).toHaveAttribute('data-window-inactive', '');
    await panelSettled(s.page, 'PDF · 3쪽');
    await shoot(s.page, 'table-inactive-light', { mask: dates() });
    await s.app.evaluate(() => (globalThis as { __probeWindow?: { close(): void } }).__probeWindow?.close());
    await (await mainWindow(s.app)).evaluate((w) => w.focus());
    await expect(s.page.locator('html')).not.toHaveAttribute('data-window-inactive', '');
  } finally {
    await s.app.close();
  }
});

test('table: a long list with its scroll bar under the header, and a header cell mid-drag with its insertion line', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const dates = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]')];
  const header = (col: string) => s.page.locator(`[data-testid="column-header"][data-col="${col}"]`);
  try {
    const [pdf] = await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf')]);
    await seedLibrary(s.app, { count: 59, from: pdf! });
    await expect(s.page.getByTestId('toolbar-count')).toHaveText('60개');
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      // Linux draws a classic scroll bar: it starts under the header, which ends where the bar's column begins (spec 5.2).
      expect(await s.page.getByTestId('library-scroller').evaluate((e: HTMLElement) => e.offsetWidth - e.clientWidth)).toBeGreaterThan(0);
      await shoot(s.page, `table-scrollbar-${theme}`, { mask: dates() });
    }
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      const [from, to] = [(await header('createdAt').boundingBox())!, (await header('creators').boundingBox())!];
      const y = from.y + from.height / 2;
      await s.page.mouse.move(from.x + from.width / 2, y);
      await s.page.mouse.down();
      await s.page.mouse.move(to.x + 6, y, { steps: 8 });
      await expect(s.page.getByTestId('column-drop-line')).toBeVisible();
      await shoot(s.page, `column-drag-${theme}`, { mask: dates(), keepPointer: true });
      await s.page.keyboard.press('Escape'); // the drag ends without a save: the next theme starts from the same columns
      await s.page.mouse.up();
      await expect(s.page.getByTestId('column-drop-line')).toHaveCount(0);
    }
  } finally {
    await s.app.close();
  }
});

test('table: loading — the header, the search field and the item panel stay and 불러오는 중… comes after 300 ms', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  try {
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf')]);
    await s.app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('library:list');
      ipcMain.handle('library:list', () => new Promise(() => {})); // never answers: the loading state holds for the shot
    });
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await s.page.reload();
      await expect(s.page.getByTestId('table-loading')).toBeVisible();
      // The toolbar's right group and the item panel stay (disabled, no statistics): only the rows are on their way.
      await expect(s.page.getByTestId('search-field').locator('input')).toHaveAttribute('aria-disabled', 'true');
      await expect(s.page.getByTestId('inspector-none')).toBeVisible();
      await shoot(s.page, `table-loading-${theme}`);
    }
  } finally {
    await s.app.close();
  }
});

/** An unreadable database (and one pre-update backup) in `<dir>/library`, which launchTour opens. */
function brokenLibrary(dir: string): void {
  const lib = path.join(dir, 'library');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'library.sqlite'), 'not a database');
  fs.writeFileSync(path.join(lib, 'library.sqlite.pre-v2.bak'), '');
}

test('fatal: the library cannot be opened (a short and a deep library folder)', async ({}, testInfo) => {
  const home = tourHome(testInfo.outputPath());
  // "~/library/library.sqlite.pre-v2.bak" fits one line; a folder as deep as the default macOS library
  // (~/Library/Application Support/Learn/…) wraps after a separator (design-spec 4: no middle elision).
  const cases = [
    { name: 'fatal', dir: home, shown: '~/library/library.sqlite.pre-v2.bak' },
    { name: 'fatal-longpath', dir: path.join(home, 'Library', 'Application Support', 'Learn'), shown: '~/Library/Application Support/Learn/library/library.sqlite.pre-v2.bak' },
  ];
  for (const c of cases) {
    brokenLibrary(c.dir);
    const s = await launchTour(c.dir, { HOME: home });
    try {
      await expect(s.page.getByTestId('fatal-notice').locator('.file')).toHaveText(c.shown);
      for (const theme of THEMES) {
        await setTheme(s.page, theme);
        await shoot(s.page, `${c.name}-${theme}`);
      }
    } finally {
      await s.app.close();
    }
  }
});

// M5: the sidebar. Pairs for the critic: library.html (tree open with a selection; the three special views),
// library.html?state=empty-collection, and the unpaired row being named (design-spec 6 field, 3.1).
test('organize: the sidebar tree with a selection, a row being named, an empty collection, the special views', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const dates = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)];
  try {
    const items = await importPaths(s.page, library(testInfo.outputPath('videos')));
    const bio = await createCollection(s.page, '분자생물학');
    const c6 = await createCollection(s.page, '6장 · 신호 전달', bio);
    const c7 = await createCollection(s.page, '7장 · 세포 주기', bio);
    await createCollection(s.page, '실험 노트', bio); // empty: its row shows no number
    const stats = await createCollection(s.page, '통계');
    await createCollection(s.page, '회귀분석', stats);
    const conf = await createCollection(s.page, '학회 준비');
    await addToCollection(s.page, bio, items.map((i) => i.id));
    await addToCollection(s.page, c6, [items[0]!.id, items[1]!.id]);
    await addToCollection(s.page, c7, [items[2]!.id]);
    await addToCollection(s.page, stats, [items[3]!.id]);

    // The tree open, 6장 viewed, the table focused: the sidebar's selection is the neutral one, as library.html draws it.
    await treeRow(s.page, bio).locator('.disclosure').click();
    await treeRow(s.page, c6).click();
    await rowAt(s.page, 0).click();
    await expect(rowAt(s.page, 0)).toHaveAttribute('aria-selected', 'true');
    await expect(s.page.getByTestId('info-section')).toBeVisible();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `sidebar-tree-${theme}`, { mask: dates() });
    }

    // A new collection being named: the field with the default name selected, at the top of the tree.
    await setTheme(s.page, 'light');
    await runMenuCommand(s.app, 'collection.new');
    const field = s.page.getByTestId('rename-input');
    await expect(field).toBeFocused();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await expect(field).toBeFocused();
      await shoot(s.page, `sidebar-edit-${theme}`, { mask: dates() });
    }
    await s.page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);

    // The viewed collection being renamed (↩ on its row): the selection stays the neutral one and the row holds only the field.
    await setTheme(s.page, 'light');
    await treeRow(s.page, c6).click();
    await s.page.keyboard.press('Enter');
    await expect(field).toBeFocused();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await expect(field).toBeFocused();
      await shoot(s.page, `sidebar-rename-${theme}`, { mask: dates() });
    }
    await s.page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);

    // An empty collection: the table body and the item panel; the panel's day is masked.
    await treeRow(s.page, conf).click();
    await expect(s.page.getByTestId('collection-empty')).toBeVisible();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `collection-empty-${theme}`, { mask: [s.page.getByTestId('collection-empty-meta')] });
    }

    // The special views: 최근 연 자료 (an item was opened), 미분류 and 중복 항목 (the same file imported again, in no collection).
    await setTheme(s.page, 'light');
    await specialRow(s.page, 'all').click();
    await openItem(s.page, 'sample');
    await expect(s.page.getByTestId('viewer-title')).toBeVisible();
    await runMenuCommand(s.app, 'nav.back');
    await importPaths(s.page, [path.join(FIXTURES, 'sample.pdf')], { allowDuplicate: true });
    for (const kind of ['recent', 'unfiled', 'duplicates'] as const) await expect(specialRow(s.page, kind)).toBeVisible();
    await specialRow(s.page, 'unfiled').click();
    await shoot(s.page, 'sidebar-special-light', { mask: dates() });

    // An empty collection with a 9-character name: ‘…’로 is one 어절 (U+2060), so the line breaks before the quote, never after it.
    const signal = await createCollection(s.page, '세포막 신호 전달');
    await treeRow(s.page, signal).click();
    await expect(s.page.getByTestId('collection-empty')).toBeVisible();
    await shoot(s.page, 'collection-empty-long-light', { mask: [s.page.getByTestId('collection-empty-meta')] });
  } finally {
    await s.app.close();
  }
});

// M5: the tag selector and the table's dots. Pairs for the critic: library.html (the selector at the sidebar's foot, the
// dots in the title cell, a selected row on the accent fill) and components.html?part=1 (chips, the eight colours).
// M6: the trash. Pairs for the critic: library.html?state=trash (the sidebar row, a collection row on top, 삭제한 날짜 last,
// 휴지통 비우기… in the head, a row's read-only panel), dialogs.html?scene=purge and ?scene=empty-trash (the app sheet),
// reader-pdf.html?state=trashed (the stage notice) and components.html?part=1 (the undo toast).
test('trash: the undo toast, the trash view and its read-only panel, the purge and empty-trash sheets, the reader notice', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  // The days in the table's body rows (not its header: the sort mark stays in the picture), the trash line's time alone
  // (its icon and wording stay), and what moves in the item panel.
  const dates = () => [s.page.locator('[data-row-id] :is([data-col="createdAt"], [data-col="deletedAt"])'), s.page.getByTestId('trash-note-when'), ...panelMasks(s.page)];
  try {
    const items = await importPaths(s.page, library(testInfo.outputPath('videos')));
    const conf = await createCollection(s.page, '학회 준비');
    await createCollection(s.page, '발표', conf);
    await addToCollection(s.page, conf, [items[0]!.id]);
    const exam = await createTag(s.page, '시험 범위');
    await assignTag(s.page, exam, [items[1]!.id]);
    await setTheme(s.page, 'light');

    // The trash view: one collection row (발표 inside it), two items; the first trashed item selected, its read-only panel.
    await trashItems(s.page, [items[1]!.id, items[2]!.id]);
    await s.page.evaluate((id) => window.learn.collections.remove({ collectionId: id }), conf);
    await specialRow(s.page, 'trash').click();
    await rowByTitle(s.page, items[1]!.title).click();
    await expect(s.page.getByTestId('inspector-restore')).toBeVisible();
    await panelSettled(s.page, /^PDF/);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `trash-view-${theme}`, { mask: dates() });
    }

    // 영구 삭제… on that row, and 휴지통 비우기….
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      const purge = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'item.trash'));
      await shoot(purge, `sheet-purge-${theme}`);
      await closeSheet(purge, 'Escape');
      await expect.poll(() => menuItemEnabled(s.app, 'trash.empty')).toBe(true);
      const empty = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'trash.empty'));
      await shoot(empty, `sheet-empty-trash-${theme}`);
      await closeSheet(empty, 'Escape');
      await expect.poll(() => menuItemEnabled(s.app, 'item.trash')).toBe(true);
    }

    // More than one row, and a collection row (C-5): a third item joins the trash; three rows chosen (no sheet), then the collection.
    await trashItems(s.page, [items[3]!.id]);
    await expect(rowByTitle(s.page, items[3]!.title)).toBeVisible();
    await selectRows(s.page, [items[1]!.title, items[2]!.title, items[3]!.title]);
    await expect(s.page.getByTestId('inspector-trash')).toBeVisible();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `trash-selection-${theme}`, { mask: dates() });
    }
    await setTheme(s.page, 'light');
    await s.page.locator('[data-testid="trash-collection-row"]').first().click();
    await expect(s.page.getByTestId('inspector-kind')).toContainText('컬렉션');
    await shoot(s.page, 'trash-collection-light', { mask: dates() });

    // The reader: its item moved to the trash.
    await setTheme(s.page, 'light');
    await specialRow(s.page, 'all').click();
    await openItem(s.page, items[0]!.title);
    await expect(s.page.getByTestId('viewer-title')).toBeVisible();
    await trashItems(s.page, [items[0]!.id]);
    await expect(s.page.getByTestId('reader-trashed')).toBeVisible();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `reader-trashed-${theme}`);
    }

    // The toasts, last (a success toast closes 5 s after it first paints, so none may be on screen in another shot): each is
    // shot at once and waited out before the next. ⌘⌫ on one row: the undo toast names it.
    const gone = (id: string) => expect(s.page.getByTestId(id)).toHaveCount(0, { timeout: 12_000 });
    await setTheme(s.page, 'light');
    await s.page.evaluate((id) => window.learn.library.restore({ itemIds: [id] }), items[0]!.id);
    await specialRow(s.page, 'all').click();
    await rowByTitle(s.page, items[0]!.title).click();
    await runMenuCommand(s.app, 'item.trash');
    await expect(s.page.getByTestId('trash-undo')).toBeVisible();
    await shoot(s.page, 'toast-trash-undo-light', { mask: dates() });
    await gone('trash-undo');
    await setTheme(s.page, 'dark');
    await s.page.evaluate((id) => window.learn.library.restore({ itemIds: [id] }), items[0]!.id);
    await rowByTitle(s.page, items[0]!.title).click();
    await runMenuCommand(s.app, 'item.trash');
    await expect(s.page.getByTestId('trash-undo')).toBeVisible();
    await shoot(s.page, 'toast-trash-undo-dark', { mask: dates() });
    await gone('trash-undo');
    // 복원 and 영구 삭제… from the trash view: their result toasts.
    await setTheme(s.page, 'light');
    await specialRow(s.page, 'trash').click();
    await rowByTitle(s.page, items[1]!.title).click();
    await s.page.getByTestId('inspector-restore').click();
    await expect(s.page.getByTestId('restore-done')).toBeVisible();
    await shoot(s.page, 'toast-restore-done-light', { mask: dates() });
    await gone('restore-done');
    await rowByTitle(s.page, items[2]!.title).click();
    await expect.poll(() => menuItemEnabled(s.app, 'item.trash')).toBe(true);
    const purge = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'item.trash'));
    await clickToCloseSheet(purge, purge.getByTestId('purge-confirm'));
    await expect(s.page.getByTestId('purge-done')).toBeVisible();
    await shoot(s.page, 'toast-purge-done-light', { mask: dates() });
  } finally {
    await s.app.close();
  }
});

test('organize: the tag selector with a filter and dim chips, the table dots with a selected row, and the filter that leaves nothing', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const dates = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)];
  try {
    const items = await importPaths(s.page, library(testInfo.outputPath('videos')));
    const [a, b, c, d] = items.map((i) => i.id) as [string, string, string, string];
    const bio = await createCollection(s.page, '분자생물학');
    await addToCollection(s.page, bio, [a, b, c]);
    const [, , , , receptor, , , regression] = await makeTags(s.page, [
      { name: '중요', slot: 1, items: [a, b] },
      { name: '시험 범위', slot: 2, items: [a] },
      { name: '다시 보기', slot: 4, items: [b] },
      { name: '질문 있음', slot: 5, items: [c] },
      { name: '수용체', items: [a, b] },
      { name: 'G 단백질', items: [a] },
      { name: '인산화', items: [c] },
      { name: '회귀분석', items: [d] },
      { name: '표본 추출', items: [d] },
    ]);
    // A collection, 모든 태그 (the two tags of the item outside it are dim), one chip on, a row selected with the table focused.
    await treeRow(s.page, bio).click();
    await s.page.getByTestId('tag-selector-more').click();
    await s.page.getByTestId('tag-menu-all').click();
    await tagChip(s.page, receptor!).click();
    await rowAt(s.page, 0).click();
    await expect(rowAt(s.page, 0)).toHaveAttribute('aria-selected', 'true');
    await expect(s.page.getByTestId('info-section')).toBeVisible();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `tags-selector-${theme}`, { mask: dates() });
    }
    // A dim chip chosen too: nothing has both. The body says so; the chips keep their state.
    await setTheme(s.page, 'light');
    await tagChip(s.page, regression!).click();
    await expect(s.page.getByTestId('tag-filter-empty')).toBeVisible();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `tags-filter-empty-${theme}`, { mask: [s.page.getByTestId('inspector-panel')] });
    }
  } finally {
    await s.app.close();
  }
});

test('component state board: tag chips and colour dots (gallery part 4)', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  try {
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await s.page.goto('learn://app/index.html?window=gallery&part=4&platform=linux&det=1');
      await s.page.getByTestId('gallery').waitFor();
      expect(await s.page.getByTestId('gallery').evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
      await shoot(s.page, `gallery4-${theme}`);
    }
  } finally {
    await s.app.close();
  }
});

test('organize: the first tag chip focused from the keyboard — the ring is whole at the cloud\'s edge', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  try {
    const items = await importPaths(s.page, library(testInfo.outputPath('videos')));
    const ids = items.map((i) => i.id);
    await makeTags(s.page, [
      { name: '중요', slot: 1, items: ids.slice(0, 2) },
      { name: '시험 범위', slot: 2, items: ids.slice(0, 1) },
      { name: '수용체', items: ids.slice(0, 2) },
    ]);
    await s.page.getByTestId('tag-selector-more').focus();
    await s.page.keyboard.press('Tab'); // the cloud's one stop: its first chip
    await expect(s.page.locator('[data-testid="tag-selector"] [data-chip-id]:focus-visible')).toHaveCount(1);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `tags-focus-${theme}`, { mask: [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)] });
    }
  } finally {
    await s.app.close();
  }
});

// M5: the item panel's 태그 and 컬렉션 sections, the add field with its suggestions, several items with their common
// sections, and the open 컬렉션에 추가 ▾ menu. Pairs for the critic: library.html (inspectorItem) and library.html?state=multi.
test('organize: the item panel with tags and collections, the add field, several items, the open 컬렉션에 추가 menu', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const masks = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)];
  try {
    const [sample, ko, h264] = await importPaths(s.page, library(testInfo.outputPath('videos')));
    const bio = await createCollection(s.page, '분자생물학');
    const c6 = await createCollection(s.page, '6장 · 신호 전달', bio);
    await createCollection(s.page, '통계');
    await addToCollection(s.page, bio, [sample!.id, ko!.id, h264!.id]);
    await addToCollection(s.page, c6, [sample!.id, ko!.id]);
    const important = await createTag(s.page, '중요');
    await setTagColor(s.page, important, 'yellow', 1);
    const exam = await createTag(s.page, '시험 범위');
    await setTagColor(s.page, exam, 'red', 2);
    for (const name of ['수용체', 'G 단백질', '2차 전령']) await assignTag(s.page, await createTag(s.page, name), [sample!.id]);
    await assignTag(s.page, important, [sample!.id, ko!.id]);
    await assignTag(s.page, exam, [sample!.id]);
    // What the field will offer: one coloured suggestion among plain ones, so the mark column and the names' column are judged together.
    for (const name of ['수용체 억제제', '수용체 작용제', '수용기', '신경 수용 경로']) {
      const id = await createTag(s.page, name);
      if (name === '수용체 작용제') await setTagColor(s.page, id, 'green', 3);
    }

    // One item with four colours' worth of chips (two coloured, three plain) in two collections (library.html inspectorItem).
    await selectRows(s.page, ['sample']);
    await panelSettled(s.page, 'PDF · 3쪽');
    await expect(s.page.getByTestId('tags-section').getByTestId(`tag-chip-${important}`)).toBeVisible();
    await expect(s.page.getByTestId('collection-path')).toHaveCount(2);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `organize-item-${theme}`, { mask: masks() });
    }
    // The add field with "수용" typed and the second suggestion chosen.
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await s.page.getByTestId('tag-add-chip').click();
      await s.page.getByTestId('tag-input').fill('수용');
      await expect(s.page.getByTestId('tag-suggestion')).toHaveCount(4);
      await s.page.keyboard.press('ArrowDown');
      await s.page.keyboard.press('ArrowDown');
      await shoot(s.page, `organize-tag-add-${theme}`, { mask: masks() });
      await s.page.keyboard.press('Escape');
      await expect(s.page.getByTestId('tag-field')).toHaveCount(0);
    }
    // A name that is no tag yet: the hint is the last row of the floating list (no suggestion chosen).
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await s.page.getByTestId('tag-add-chip').click();
      await s.page.getByTestId('tag-input').fill('수용 후보');
      await expect(s.page.getByTestId('tag-hint')).toBeVisible();
      await shoot(s.page, `organize-tag-hint-${theme}`, { mask: masks() });
      await s.page.keyboard.press('Escape');
      await expect(s.page.getByTestId('tag-field')).toHaveCount(0);
    }
    // Three items, no tag in common, one collection (library.html?state=multi).
    await selectRows(s.page, ['sample', '한글 경로 (테스트) #1', 'sample-h264-aac'], { modifier: 'Meta' });
    await expect(s.page.getByTestId('multi-row')).toHaveCount(3);
    await expect(s.page.getByTestId('tags-common-none')).toBeVisible();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `organize-multi-${theme}`, { mask: masks() });
    }
    // Two items that share a tag and two collections: the common chips and both rows.
    await selectRows(s.page, ['sample', '한글 경로 (테스트) #1'], { modifier: 'Meta' });
    await expect(s.page.getByTestId('tags-section').getByTestId(`tag-chip-${important}`)).toBeVisible();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `organize-multi-common-${theme}`, { mask: masks() });
    }
    // The 컬렉션에 추가 ▾ menu open on the three: 분자생물학 marked and off, 6장 and 통계 on.
    await selectRows(s.page, ['sample', '한글 경로 (테스트) #1', 'sample-h264-aac'], { modifier: 'Meta' });
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await s.page.getByTestId('add-to-collection').click();
      await expect(s.page.getByTestId(`add-to-collection-${bio}`)).toBeVisible();
      await shoot(s.page, `organize-multi-menu-${theme}`, { mask: masks() });
      await s.page.keyboard.press('Escape');
      await expect(s.page.getByTestId(`add-to-collection-${bio}`)).toHaveCount(0);
    }
  } finally {
    await s.app.close();
  }
});

// M6: 중복 항목 with two groups — 남김 on the kept rows (white on the selected one), the line between the groups, 중복 N묶음
// 모두 정리 — and the item panel's edited copy. Pairs for the critic: library.html?state=duplicates and ?state=edited.
test('M6 duplicates and edited copies: 중복 항목 with 남김, the group line and 모두 정리; the item panel edited copy', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const masks = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)];
  try {
    const dir = testInfo.outputPath('in');
    fs.mkdirSync(dir, { recursive: true });
    const named = (name: string) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, Buffer.concat([fs.readFileSync(path.join(FIXTURES, 'sample.pdf')), Buffer.from(`\n% ${name}\n`)]));
      return file;
    };
    const kinase = named('Kinase Cascades A Primer.pdf');
    const molbio = named('분자생물학 6장 · 신호 전달.pdf');
    const cell = named('세포생물학 3장.pdf');
    // Imported K, M, K, K, M: newest first the M group (2 rows) comes before the K group (3), as the mockup draws them.
    await importPaths(s.page, [kinase]);
    const [m1] = await importPaths(s.page, [molbio]);
    await importPaths(s.page, [kinase], { allowDuplicate: true });
    await importPaths(s.page, [kinase], { allowDuplicate: true });
    await importPaths(s.page, [molbio], { allowDuplicate: true });
    const [c1] = await importPaths(s.page, [cell]);

    await specialRow(s.page, 'duplicates').click();
    await expect(s.page.getByTestId('item-row')).toHaveCount(5);
    await expect(s.page.getByTestId('keep-all-duplicates')).toBeVisible();
    // The M group's kept row selected with the table focused (the mockup selects it): its 남김 in white.
    await s.page.locator(`[data-testid="item-row"][data-item-id="${m1!.id}"]`).click();
    await panelSettled(s.page, 'PDF · 3쪽');
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `duplicates-view-${theme}`, { mask: masks() });
    }
    // The same selection with the focus in the sidebar: the grey selected row, 남김 in secondary on it (T7 critique 2 라).
    await setTheme(s.page, 'light');
    await s.page.getByTestId('nav-scope-duplicates').focus();
    await shoot(s.page, 'duplicates-unfocused-light', { mask: masks() });

    // A copy kept aside under the mockup's name and time (as the next 기본 앱으로 열기 would), so it reads the same every run.
    await setTheme(s.page, 'light');
    const folder = path.join(testInfo.outputPath(), 'library', 'derived', 'open', c1!.assetId);
    fs.mkdirSync(folder, { recursive: true });
    const aside = path.join(folder, '세포생물학 3장 (수정본 2026-10-30 1412).pdf');
    fs.writeFileSync(aside, Buffer.concat([fs.readFileSync(cell), Buffer.from('% edited\n')]));
    const at = new Date('2026-10-30T05:12:00Z'); // 오후 2:12 in Seoul (launchTour's TZ)
    fs.utimesSync(aside, at, at);
    await specialRow(s.page, 'all').click();
    await s.page.locator(`[data-testid="item-row"][data-item-id="${c1!.id}"]`).click();
    await panelSettled(s.page, 'PDF · 3쪽');
    await expect(s.page.getByTestId('edited-copy')).toHaveCount(1);
    await s.page.getByTestId('edited-copies').scrollIntoViewIfNeeded();
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `edited-copy-${theme}`, { mask: masks() });
    }

    // The clean-up's other states (T7 critique 2). 가, the item menu on a non-kept row, is a native popup: its picture is not
    // reproducible across machines (the menu takes the system's fonts: tofu on the CI runner, CI 41300686469), so the order of its
    // lines is asserted below (and in duplicates.spec) and the picture is left to the Mac evidence.
    await specialRow(s.page, 'duplicates').click();
    await expect(s.page.getByTestId('item-row')).toHaveCount(5);
    const newest = s.page.locator('[data-testid="item-row"]').first();
    const gone = (id: string) => expect(s.page.getByTestId(id)).toHaveCount(0, { timeout: 12_000 });
    // 나 and 다 (light): the toast after 하나만 남기고 휴지통으로, then — with its 실행 취소 pressed — 중복 2묶음 모두 정리, which leaves for
    // 내 라이브러리 (no 중복 항목 row in the tree). The toasts are last: each is waited out before the next picture.
    await setTheme(s.page, 'light');
    await stubContextMenu(s.app, '하나만 남기고 휴지통으로');
    await newest.click({ button: 'right' });
    await expect(s.page.getByTestId('undo-toast')).toContainText('중복 1개를 휴지통으로 옮겼습니다');
    const menu = (await recordedPopups(s.app)).at(-1)!.map((i) => i.label);
    expect(menu[menu.indexOf('휴지통으로 이동') - 1]).toBe('하나만 남기고 휴지통으로'); // right above 휴지통으로 이동
    await shoot(s.page, 'toast-duplicates-done-light', { mask: masks() });
    await s.page.getByTestId('undo-action').click();
    await expect(s.page.getByTestId('item-row')).toHaveCount(5);
    await gone('undo-toast');
    await s.page.getByTestId('keep-all-duplicates').click();
    await expect(specialRow(s.page, 'duplicates')).toHaveCount(0);
    await expect(s.page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');
    // The toast is what says what happened once the view has left 중복 항목 (two groups: 2 + 1).
    await expect(s.page.getByTestId('undo-toast')).toContainText('중복 3개를 휴지통으로 옮겼습니다');
    await shoot(s.page, 'toast-duplicates-all-light', { mask: masks() });
    await gone('undo-toast');
    await shoot(s.page, 'duplicates-cleaned-light', { mask: masks() });
  } finally {
    await s.app.close();
  }
});

// M5: drag and drop at rest. A drag cannot be held for a screenshot (the tour parks the pointer), so the drop state is
// forced on a real tree row and a real table row, in the window the drag would run in; the drag image and the heading are on the
// state board (part 5). Pairs for the critic: components.html?part=1 ("드롭 대상 (⌘ 이동)") and library.html for the window.
test('drag and drop: a tree row and a table row as drop targets, then the board with the drag image', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const dates = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)];
  try {
    const items = await importPaths(s.page, library(testInfo.outputPath('videos')));
    const bio = await createCollection(s.page, '분자생물학');
    await createCollection(s.page, '6장 · 신호 전달', bio);
    const stat = await createCollection(s.page, '통계');
    await addToCollection(s.page, bio, items.map((i) => i.id));
    await treeRow(s.page, bio).locator('.disclosure').click();
    await treeRow(s.page, bio).click();
    await rowAt(s.page, 0).click();
    await expect(rowAt(s.page, 0)).toHaveAttribute('aria-selected', 'true');
    const force = (id: string, on: boolean) => s.page.evaluate(({ id, on }) => {
      const el = document.querySelector(id.startsWith('row:') ? `[data-testid="item-row"][data-index="${id.slice(4)}"]` : `[data-testid="${id}"]`)!;
      if (on) el.setAttribute('data-force', 'drop');
      else el.removeAttribute('data-force');
    }, { id, on });

    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await rowAt(s.page, 0).click(); // the table holds the focus, as it does while a table row is dragged (the loop's end blurs it)
      // A collection row: the neighbour of the viewed one, as a row dragged out of 분자생물학 would find it.
      await force(`nav-collection-${stat}`, true);
      await shoot(s.page, `dnd-tree-drop-${theme}`, { mask: dates() });
      await force(`nav-collection-${stat}`, false);
      // The viewed collection as a target (a collection dragged onto it, a Finder file): the tree holds the focus, so its selection is
      // the accent fill, and the drop mark has to win over it.
      await treeRow(s.page, bio).click();
      await force(`nav-collection-${bio}`, true);
      await shoot(s.page, `dnd-tree-drop-viewed-${theme}`, { mask: dates() });
      await force(`nav-collection-${bio}`, false);
      // A table row beside the selected one: a tag chip over it. Pressing a chip takes the focus out of the table, so the selected row
      // is the neutral one, and the target is a striped row and a plain one in turn.
      await s.page.evaluate(() => void (document.activeElement as HTMLElement | null)?.blur());
      await force('row:1', true);
      await shoot(s.page, `dnd-row-drop-striped-${theme}`, { mask: dates() });
      await force('row:1', false);
      await force('row:2', true);
      await shoot(s.page, `dnd-row-drop-${theme}`, { mask: dates() });
      await force('row:2', false);
    }

    // The overlay beside the sidebar (the pair of the existing drop-* shots, which change by design).
    const two: Array<[string, string]> = [['a.pdf', 'application/pdf'], ['b.pdf', 'application/pdf']];
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await drag(s.page, 'dragenter', two);
      await expect(s.page.getByTestId('drop-overlay')).toBeVisible();
      await shoot(s.page, `dnd-overlay-beside-sidebar-${theme}`);
      await drag(s.page, 'dragleave', two);
      await expect(s.page.getByTestId('drop-overlay')).toHaveCount(0);
    }

    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await s.page.goto('learn://app/index.html?window=gallery&part=5&platform=linux&det=1');
      await s.page.getByTestId('gallery').waitFor();
      expect(await s.page.getByTestId('gallery').evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
      await shoot(s.page, `gallery5-${theme}`);
    }
  } finally {
    await s.app.close();
  }
});

// M6 (spec 3.3, mockup importToast and components part 2): the progress toast while a run goes — one file in, the next held
// before its commit, so the count and the bar agree (1 / 3, half of the work) — and the result
// that takes it over after 취소, in both themes (each theme is a run of its own: the result closes by itself after 5 s).
const LONG_VIDEO = '분자생물학 강의 08 · 세포 신호 전달과 효소 조절 (2026 가을 학기 녹화본).mp4';
test('import progress toast: running, then the result in its place after 취소', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const dates = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]')];
  try {
    await importPaths(s.page, library(testInfo.outputPath('videos')));
    const progress = s.page.getByTestId('import-progress');
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      const dir = testInfo.outputPath(`incoming-${theme}`);
      const files = [
        sizedCopy(path.join(FIXTURES, 'sample.pdf'), dir, '세포생물학 3장.pdf', 1_500_000, theme),
        sizedCopy(path.join(FIXTURES, 'sample-h264-aac.mp4'), dir, LONG_VIDEO, 4_200_000, theme),
        sizedCopy(path.join(FIXTURES, 'sample.pdf'), dir, '세포생물학 4장.pdf', 1_500_000, theme),
      ];
      await importPause(s.app, 'beforeCommit');
      await importFiles(s, files);
      await expect.poll(() => importWaiting(s.app)).toBe('beforeCommit');
      await importPause(s.app, 'beforeCommit'); // the next file is held too
      await importResume(s.app);
      await expect(progress).toContainText('가져오는 중 · 1 / 3');
      await expect.poll(() => importWaiting(s.app)).toBe('beforeCommit');
      await expect(progress.locator('.pct')).toHaveText('50%'); // 1.5 MB in, half of the 4.2 MB under way, of 7.2 MB
      await shoot(s.page, `toast-import-running-${theme}`, { mask: dates() });
      if (theme === 'light') {
        // The keyboard's ring on 취소 (a key first, so it is the keyboard's).
        await s.page.keyboard.press('Shift');
        await progress.getByTestId('import-cancel').focus();
        await shoot(s.page, 'toast-import-focus-cancel-light', { mask: dates(), keepPointer: true });
        await progress.getByTestId('import-cancel').blur(); // a focus the keyboard left in the toast would keep the result from closing by itself
        // F6 lands on the toast itself: its ring is the whole toast's outline (Task 4 review Open-1).
        await progress.focus();
        await expect(progress).toHaveAttribute('data-focus-visible', 'true');
        await shoot(s.page, 'toast-import-focus-toast-light', { mask: dates(), keepPointer: true });
        await progress.blur();
      }
      // Not the button: pressing it takes the focus into the toast and leaves it there when the result replaces the button.
      await s.page.evaluate(() => window.learn.library.cancelImport());
      await importResume(s.app);
      await expect(s.page.getByTestId('import-done')).toContainText('3개 중 2개를 가져왔습니다');
      await expect(s.page.getByTestId('import-done')).toContainText('취소해서 남은 1개는 가져오지 않았습니다.');
      await shoot(s.page, `toast-import-cancelled-${theme}`, { mask: dates() });
      await waitImportIdle(s.page);
      await expect(s.page.getByTestId('import-done')).toHaveCount(0, { timeout: 10_000 });
    }
  } finally {
    await s.app.close();
  }
});

// M6 (spec 3.4, mockup dialogs.html?scene=duplicate): three duplicates asked at the end — the toast waiting under the sheet; the palette opened during an import, held when the question comes; and an import waiting
// behind another job (mockup dialogs.html?scene=jobs).
test('import progress toast: waiting for a choice (and the sheet\'s box), the palette under it, waiting for the work before it', async ({}, testInfo) => {
  const s = await launchTour(testInfo.outputPath());
  const dates = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]')];
  const pdf = path.join(FIXTURES, 'sample.pdf');
  try {
    await importPaths(s.page, library(testInfo.outputPath('videos')));
    const dir = testInfo.outputPath('again');
    const twice = ['molbio_ch06_signaling.pdf', 'molbio_ch07_receptors.pdf', 'molbio_ch08_kinases.pdf'].map((n) => sizedCopy(pdf, dir, n, 1_000_000));
    await importPaths(s.page, twice);
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      const sheet = await expectWindow(s.app, 'sheet', () => importFiles(s, twice));
      await expect(sheet.getByRole('checkbox', { name: '남은 중복 파일 2개에도 같은 선택 적용' })).toBeChecked();
      await expect(s.page.getByTestId('import-progress')).toHaveAttribute('data-state', 'waiting-choice');
      await shoot(s.page, `toast-import-choice-${theme}`, { mask: dates() });
      await closeSheet(sheet, 'Escape'); // 건너뛰기 for all three: the box was ticked
      await waitImportIdle(s.page);
    }
    await setTheme(s.page, 'light');
    await importPause(s.app, 'afterStage');
    await importFiles(s, [sizedCopy(pdf, dir, 'molbio_ch09_cycle.pdf', 1_000_000), twice[0]!]);
    await expect.poll(() => importWaiting(s.app)).toBe('afterStage');
    await runMenuCommand(s.app, 'app.palette');
    await expect(s.page.getByTestId('palette-input')).toBeFocused();
    const sheet = await expectWindow(s.app, 'sheet', () => importResume(s.app));
    await expect(s.page.getByTestId('palette-busy')).toBeVisible();
    await expect(s.page.getByTestId('import-progress')).toHaveAttribute('data-state', 'waiting-choice');
    // Hidden, not masked: a mask paints over the palette that floats above the table.
    await shoot(s.page, 'palette-held-light', { style: '[data-testid="item-row"] [data-col="createdAt"] { visibility: hidden !important; }' });
    await closeSheet(sheet, 'Escape');
    await s.page.keyboard.press('Escape');
    await waitImportIdle(s.page);
    await expect(s.page.getByTestId('import-done')).toHaveCount(0, { timeout: 10_000 }); // the run's result closes by itself, so it is not in the next shots
    await holdJob(s.app, 'backup');
    await importFiles(s, [sizedCopy(pdf, dir, 'molbio_ch10_mitosis.pdf', 1_000_000), sizedCopy(pdf, dir, 'molbio_ch11_meiosis.pdf', 1_000_000)]);
    await expect(s.page.getByTestId('import-progress')).toHaveAttribute('data-state', 'waiting-job');
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await shoot(s.page, `toast-import-waiting-${theme}`, { mask: dates() });
    }
    await releaseJob(s.app);
    await expect(s.page.getByTestId('import-done')).toHaveText('자료 2개를 가져왔습니다');
    await waitImportIdle(s.page);
  } finally {
    await s.app.close();
  }
});
