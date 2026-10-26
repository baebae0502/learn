// Visual tour: Linux baseline screenshots of every shell state, light and dark (quality spec M3).
// Baselines: tests/e2e/visual/tour.spec.ts-snapshots/*-linux.png. Update with the 1x run (README "시각 투어 기준 PNG"):
//   pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts --update-snapshots=all, then restore any jitter-only rewrite.
// @2x captures for the design critic, without updating (the baselines stay as committed):
//   LEARN_TOUR_2X=1 pnpm e2e:xvfb tests/e2e/visual/tour.spec.ts → test-results/tour/
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  FIXTURES, addToCollection, closeSheet, createCollection, drag, expectWindow, holdCopies, importFiles, importPaths, mainWindow, menuItemEnabled, openItem, releaseCopies, rowAt, rowByTitle, runMenuCommand, seedLibrary, seedMetadata, selectRows,
  makeTags, specialRow, stubContextMenu, stubSaveDialog, tagChip, treeRow, type Session,
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

/** What changes between runs in the item panel: its dates, a fixture's SHA-256 (pdf-lib writes the date), an outside file's path. */
const panelMasks = (page: Page) => [
  page.locator('[data-testid="info-row"]:is([data-field="createdAt"], [data-field="updatedAt"]) dd'),
  page.getByTestId('sha-value'),
  page.locator('[data-testid="file-row"][data-field="location"] dd'),
];
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
    await s.page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'linked', allowDuplicate: true }), gone);
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
    await expect.poll(() => menuItemEnabled(s.app, 'file.importManaged')).toBe(true);
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
    await s.page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'linked', allowDuplicate: true }), gone);
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
    await shoot(s.page, 'palette-selection-light', { mask: [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)] });
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
  // The table's dates in its rows only and whatever moves in the item panel behind the scrim.
  const dates = () => [s.page.locator('[data-testid="item-row"] [data-col="createdAt"]'), ...panelMasks(s.page)];
  const input = s.page.getByTestId('palette-input');
  const cursor = s.page.locator('.palette [role="option"][data-focused]');
  try {
    const ids = await paletteLibrary(s, testInfo.outputPath('media'));
    for (const theme of THEMES) {
      await setTheme(s.page, theme);
      await runMenuCommand(s.app, 'app.palette');
      // Every available command, the cursor on the first; nothing ran from the palette yet.
      await expect(cursor).toHaveAttribute('data-command-id', 'file.importManaged');
      await shoot(s.page, `palette-empty-${theme}`, { mask: dates() });
      // palette.html: 자료 above 명령, the matched 신호 in each title, 저자 · 연도 on the right, 라이브러리에서 ‘신호’ 검색 last.
      await input.fill('신호');
      await expect(s.page.getByTestId('palette-result')).toHaveCount(4);
      await expect(cursor).toHaveAttribute('data-testid', 'palette-result');
      await expect(s.page.locator('.p-foot')).toContainText('ㅅㅎ → 신호');
      await shoot(s.page, `palette-items-${theme}`, { mask: dates() });
      // Commands only, the search row under them (ㄱㅈㅇ: 파일 가져오기… alone, in no title) — M3's palette-{light,dark} state.
      await input.fill('ㄱㅈㅇ');
      await expect(cursor).toHaveAttribute('data-command-id', 'file.importManaged');
      await expect(s.page.getByTestId('palette-search-library')).toBeVisible();
      await shoot(s.page, `palette-${theme}`, { mask: dates() });
      if (theme === 'light') {
        // ㄱ: several command rows (빠른 검색 by its 검색, 항목 패널 by 가리기), the <mark> in accent text on the rows the cursor is not on.
        await input.fill('ㄱ');
        await expect(s.page.getByTestId('palette-item').nth(2)).toBeVisible();
        await expect(s.page.locator('[data-testid="palette-item"]:not([data-focused]) mark').first()).toBeVisible();
        await shoot(s.page, 'palette-multi-light', { mask: dates() });
      }
      // palette.html ?state=none: the notice, then the search row under the cursor; the foot says ↩ 실행 · esc 닫기.
      await input.fill('효소 억제제');
      await expect(s.page.getByTestId('palette-empty')).toBeVisible();
      await expect(cursor).toHaveAttribute('data-testid', 'palette-search-library');
      await shoot(s.page, `palette-none-${theme}`, { mask: dates() });
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
    await shoot(s.page, 'palette-inactive-light', { mask: dates() });
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
    await shoot(s.page, 'palette-long-light', { mask: dates() });
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
    await s.page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'linked', allowDuplicate: true }), gone);
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

// M5 Task 5: the sidebar. Pairs for the critic: library.html (tree open with a selection; the three special views),
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
    await s.page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'managed', allowDuplicate: true }), path.join(FIXTURES, 'sample.pdf'));
    for (const kind of ['recent', 'unfiled', 'duplicates'] as const) await expect(specialRow(s.page, kind)).toBeVisible();
    await specialRow(s.page, 'unfiled').click();
    await shoot(s.page, 'sidebar-special-light', { mask: dates() });
  } finally {
    await s.app.close();
  }
});

// M5 Task 6: the tag selector and the table's dots. Pairs for the critic: library.html (the selector at the sidebar's foot, the
// dots in the title cell, a selected row on the accent fill) and components.html?part=1 (chips, the eight colours).
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
