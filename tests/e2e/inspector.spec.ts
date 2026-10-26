// The item panel (spec §5, design-spec 2.5): its slot under the toolbar, folding before the sidebar, ⌥⌘I, F6, and the
// info mode's head, sections and states. ⌥⌘I goes through its menu item (CDP keys never reach native accelerators on
// Linux); the macOS evidence lane presses it for real.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURES, expectDisabledReason, expectSameShot, importPaths, launch, mainWindow, menuSnapshot, readClipboard, runMenuCommand, seedMetadata, selectRows, showItemPanel, sidebarTop88, type MenuNode } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const REVEAL = process.platform === 'darwin' ? 'Finder에서 보기' : '폴더에서 보기';

const dirs = (testInfo: { outputPath(...p: string[]): string }) => [testInfo.outputPath('library'), testInfo.outputPath('userdata')] as const;
const zoom = async (app: ElectronApplication, f: number) => (await mainWindow(app)).evaluate((w, f) => w.webContents.setZoomFactor(f), f);
const contentWidth = async (app: ElectronApplication, width: number) =>
  (await mainWindow(app)).evaluate((w, width) => w.setContentSize(width, w.getContentSize()[1]!), width);
const panelState = (page: Page) => page.getByTestId('shell').getAttribute('data-inspector');
const panelWidth = async (page: Page) => Math.round((await page.getByTestId('inspector-panel').boundingBox())?.width ?? 0);
const inPane = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-pane]')?.getAttribute('data-pane') ?? null);
const focusedTestId = (page: Page) => page.evaluate(() => document.activeElement?.closest('[data-testid]')?.getAttribute('data-testid') ?? null);
const flatten = (nodes: readonly MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flatten(n.submenu ?? [])]);
const menuItem = async (app: ElectronApplication, id: string) => flatten(await menuSnapshot(app)).find((n) => n.id === id);
/** Titles in the table's order: rows are placed by data-index, and a virtualized body's DOM order need not be the visual one. */
const tableOrder = (page: Page) =>
  page.getByTestId('item-row').evaluateAll((rows) =>
    rows.sort((a, b) => Number(a.getAttribute('data-index')) - Number(b.getAttribute('data-index'))).map((r) => r.getAttribute('data-title') ?? ''),
  );
/** Text with U+00A0 read as a space (the copy binds values with it, design-spec 4). */
const plain = (s: string | null) => (s ?? '').replace(/ /g, ' ');
const detailOf = (page: Page, itemId: string) =>
  page.evaluate(async (id) => {
    const r = await window.learn.library.detail({ itemId: id });
    if (!r.ok) throw new Error(`library.detail failed: ${r.code}`);
    return r.data;
  }, itemId);
/** The stored layout.panes setting (null while nothing was ever saved), read after the 300 ms save debounce. */
const savedPanes = async (page: Page): Promise<unknown> => {
  await page.waitForTimeout(600);
  return page.evaluate(async () => {
    const r = await window.learn.settings.get({ key: 'layout.panes' });
    if (!r.ok) throw new Error(`settings.get failed: ${r.code}`);
    return r.data;
  });
};
/** The window at 1440 px: room for 240 + 520 + 320. The 1024 px macOS runner may keep it narrower: there the panel folds. */
async function widen(app: ElectronApplication, page: Page): Promise<number> {
  await contentWidth(app, 1440);
  await expect.poll(() => page.evaluate(() => innerWidth)).toBeGreaterThan(1000);
  return page.evaluate(() => innerWidth);
}
/** For the tests about width itself (geometry, the automatic folds): a narrower window cannot show what they measure. */
async function roomForPanel(app: ElectronApplication, page: Page): Promise<void> {
  const width = await widen(app, page);
  test.skip(width < 1080, `a ${width} px window folds the item panel by design; Linux CI and the macOS evidence lane cover this`);
}
test('one item: the head, the info rows that have a value and the file section; nothing selected shows the library; several show a summary in table order', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await widen(app, page);
    const [pdf] = await importPaths(page, [PDF, KO_PDF, MP4]);
    await showItemPanel(app, page);
    await expect(page.getByTestId('item-row')).toHaveCount(3);
    // Nothing is selected: the import came from the page, so no focus entered the table (only that picks a first row).
    const none = page.getByTestId('inspector-none');
    await expect(none).toContainText('선택한 자료 없음');
    await expect(none).toContainText('표에서 자료를 고르면 정보가 여기에 보입니다.');
    expect(plain(await page.getByTestId('inspector-stats').textContent())).toMatch(/^내 라이브러리 · 자료 3개\(PDF 2 · 동영상 1\) · [\d.]+ MB$/);
    // The numbers are 12 px text: the description's secondary colour (4.5:1 and more), not tertiary (the owner's choice).
    const [stats, text] = await none.evaluate((el) => [el.querySelector('.pe-stats')!, el.querySelector('.pe-text:not(.pe-stats)')!].map((e) => getComputedStyle(e).color));
    expect(stats).toBe(text);

    await selectRows(page, ['sample']);
    const head = page.getByTestId('inspector-head');
    await expect(head.locator('h2')).toHaveText('sample');
    await expect(page.getByTestId('inspector-kind')).toHaveText('PDF · 3쪽'); // pdf.js numPages of the 3-page fixture
    await expect(page.getByTestId('inspector-open')).toHaveText('열기');
    await expect(page.getByTestId('inspector-open')).toHaveClass(/btn-primary/);
    await expect(page.getByTestId('inspector-reveal')).toHaveText(REVEAL);
    await expect(page.getByTestId('inspector-relink')).toHaveCount(0);
    await expect(page.getByTestId('info-empty')).toHaveText('저자와 연도를 적어 두면 표에서 정렬하고 찾을 수 있습니다.');
    expect(await page.getByTestId('info-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-field')))).toEqual(['createdAt', 'updatedAt']);
    const file = (field: string) => page.locator(`[data-testid="file-row"][data-field="${field}"] dd`);
    await expect(file('storage')).toHaveText('사본 · 라이브러리 안');
    await expect(file('originalName')).toHaveText('sample.pdf');
    await expect(page.locator('[data-testid="file-row"][data-field="location"]')).toHaveCount(0); // a library copy has no outside location
    const sha = (await detailOf(page, pdf!.id)).file.sha256;
    await expect(page.getByTestId('sha-value')).toHaveText(`${sha.slice(0, 8)}…`);
    await expect(page.getByTestId('sha-value')).toHaveAttribute('title', sha);

    // Info written meanwhile arrives with libraryChanged: rows in the spec's order, and the byline in the head.
    await seedMetadata(page, pdf!.id, {
      creators: [{ name: '한서진', role: 'author' }, { name: '윤재하', role: 'editor' }],
      date: '2024-03', publisher: '학습출판', language: '한국어', url: 'https://example.org/signal', abstract: '세포 신호 전달의 개요.', extra: '6장 전체',
    });
    await expect(page.getByTestId('info-empty')).toHaveCount(0);
    await expect
      .poll(() => page.getByTestId('info-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-field'))))
      .toEqual(['creators', 'date', 'publisher', 'language', 'url', 'abstract', 'extra', 'createdAt', 'updatedAt']);
    const info = (field: string) => page.locator(`[data-testid="info-row"][data-field="${field}"]`);
    await expect(info('creators').locator('dd')).toHaveText('한서진, 윤재하 (편집자)');
    await expect(info('date').locator('dt')).toHaveText('날짜');
    await expect(info('date').locator('dd')).toHaveText('2024. 3.');
    await expect(head.locator('.authors')).toHaveText('한서진, 윤재하 · 2024');

    await selectRows(page, ['sample', '한글 경로 (테스트) #1', 'sample-h264-aac'], { modifier: 'Meta' });
    const multi = page.getByTestId('inspector-multi');
    await expect(multi.locator('h2')).toHaveText('자료 3개 선택');
    expect(plain(await multi.getByTestId('inspector-kind').textContent())).toMatch(/^PDF 2개 · 동영상 1개 · 합계 [\d.]+ MB$/);
    await expect(multi.getByTestId('multi-row')).toHaveText(await tableOrder(page));
    await expect(multi.locator('.item-head button')).toHaveText(['컬렉션에 추가']); // tabs (M7) are not drawn yet
  } finally {
    await app.close();
  }
});

test('a missing original (P-8): a linked file leads with 다시 연결…, a managed one with 열기; Finder에서 보기 says why it is off; 열기 reaches the notice', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const { app, page } = await launch(lib, testInfo.outputPath('userdata'));
  try {
    await widen(app, page);
    await importPaths(page, [KO_PDF]);
    await showItemPanel(app, page);
    const gone = testInfo.outputPath('gone.pdf');
    fs.copyFileSync(PDF, gone);
    const linked = await page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'linked' }), gone);
    expect(linked).toMatchObject({ ok: true });
    fs.rmSync(gone);
    const assets = path.join(lib, 'assets'); // the managed copy goes too (readers.spec does the same)
    for (const d of fs.readdirSync(assets)) fs.rmSync(path.join(assets, d), { recursive: true, force: true });
    await page.evaluate(async () => {
      const list = await window.learn.library.list();
      if (list.ok) for (const i of list.data) await window.learn.library.get({ itemId: i.id });
    });

    await selectRows(page, ['gone']);
    await expect(page.getByTestId('inspector-relink')).toHaveText('다시 연결…');
    // The head names the cause beside the action, as the table's row does: the link glyph and 파일 없음 after the title.
    const marks = page.getByTestId('inspector-head').locator('h2');
    await expect(marks.locator('.inline-flag')).toHaveText('파일 없음');
    await expect(marks.locator('.linked-mark')).toHaveCount(1);
    await expect(page.getByTestId('inspector-relink')).toHaveClass(/btn-primary/);
    await expect(page.getByTestId('inspector-open')).toHaveClass(/btn-secondary/);
    await expectDisabledReason(page.getByTestId('inspector-reveal'), '원본 파일이 있어야 쓸 수 있습니다');
    await expect(page.getByTestId('inspector-kind')).toHaveText('PDF'); // a missing file is not read
    await expect(page.locator('[data-testid="file-row"][data-field="location"] dd')).toHaveAttribute('title', gone);
    await expect(page.locator('[data-testid="file-row"][data-field="storage"] dd')).toHaveText('외부 연결');

    await selectRows(page, ['한글 경로 (테스트) #1']);
    await expect(page.getByTestId('inspector-relink')).toHaveCount(0);
    await expect(marks.locator('.inline-flag')).toHaveText('파일 없음');
    await expect(marks.locator('.linked-mark')).toHaveCount(0);
    await expect(page.getByTestId('inspector-open')).toHaveClass(/btn-primary/);
    await expectDisabledReason(page.getByTestId('inspector-reveal'), '원본 파일이 있어야 쓸 수 있습니다');
    await page.getByTestId('inspector-open').click();
    await expect(page.getByTestId('missing-notice')).toContainText('라이브러리 안의 사본을 찾을 수 없습니다');
  } finally {
    await app.close();
  }
});

test('⌥⌘I and the toolbar toggle hide and show the panel, named by what they do; its width and the user\'s choice survive a restart', async ({}, testInfo) => {
  const [lib, ud] = dirs(testInfo);
  let { app, page } = await launch(lib, ud);
  try {
    await widen(app, page);
    // The empty library has no panel and no toggle; the menu item is off under its neutral name (design-spec 2.4, 7.4).
    await expect(page.getByTestId('inspector-toggle')).toHaveCount(0);
    await expect(page.getByTestId('inspector-panel')).toHaveCount(0);
    expect(await menuItem(app, 'view.toggleInspector')).toMatchObject({ label: '항목 패널 보기/가리기', enabled: false, accelerator: 'Alt+CmdOrCtrl+I' });

    await importPaths(page, [PDF]);
    const roomy = (await page.evaluate(() => innerWidth)) >= 1080;
    await expect.poll(() => panelState(page)).toBe(roomy ? 'shown' : 'hidden');
    await showItemPanel(app, page);
    expect(await panelWidth(page)).toBe(320);
    const toggle = page.getByTestId('inspector-toggle');
    await expect(toggle).toHaveAccessibleName('항목 패널 가리기');
    await expect(toggle).toHaveAttribute('data-on', '');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(async () => (await menuItem(app, 'view.toggleInspector'))?.label).toBe('항목 패널 가리기');
    expect((await menuItem(app, 'view.toggleInspector'))?.enabled).toBe(true);

    await toggle.click();
    await expect.poll(() => panelState(page)).toBe('hidden');
    expect(await panelWidth(page)).toBe(0);
    await expect(toggle).toHaveAccessibleName('항목 패널 보기');
    await expect(toggle).not.toHaveAttribute('data-on');
    await expect.poll(async () => (await menuItem(app, 'view.toggleInspector'))?.label).toBe('항목 패널 보기');
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(() => panelState(page)).toBe('shown');

    // The boundary resizes within 260–480 and is stored on release, with the sidebar's keys (one record).
    const x = (await page.locator('#inspector-separator').boundingBox())!.x;
    const drag = async (from: number, to: number) => {
      await page.mouse.move(from, 400);
      await page.mouse.down();
      await page.mouse.move(to, 400, { steps: 10 });
      await page.mouse.up();
    };
    await drag(x, x - 80);
    await expect.poll(() => panelWidth(page)).toBe(400);
    await drag(x - 80, x - 400);
    await expect.poll(() => panelWidth(page)).toBe(480);
    await drag(x - 160, x - 80);
    await expect.poll(() => panelWidth(page)).toBe(400);
    expect(await savedPanes(page)).toEqual({ sidebar: 240, sidebarCollapsed: 0, 'inspector.info': 400, inspectorCollapsed: 0 });
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(() => panelState(page)).toBe('hidden');
    // Hiding is the user's choice only where the panel fits; a narrow window's panel was shown on demand and folds back by itself.
    expect(await savedPanes(page)).toEqual({ sidebar: 240, sidebarCollapsed: 0, 'inspector.info': 400, inspectorCollapsed: roomy ? 1 : 0 });
    await app.close();

    ({ app, page } = await launch(lib, ud));
    await widen(app, page);
    await expect.poll(() => panelState(page)).toBe('hidden');
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(() => panelWidth(page)).toBe(400); // the width is remembered while hidden
  } finally {
    await app.close();
  }
});

test('the item panel folds before the sidebar as the window narrows; shown on demand it is not a user choice; 200 % zoom has no sideways scroll', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await roomForPanel(app, page);
    await importPaths(page, [PDF]);
    await expect.poll(() => panelState(page)).toBe('shown');
    await contentWidth(app, 1100); // 240 + 520 + 320 = 1080 fits
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1100);
    expect(await panelState(page)).toBe('shown');
    await contentWidth(app, 1000); // the panel folds first; the sidebar stays (it folds below 760)
    await expect.poll(() => panelState(page)).toBe('hidden');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'shown');
    await runMenuCommand(app, 'view.toggleInspector'); // shown on demand in the narrow window
    await expect.poll(() => panelState(page)).toBe('shown');
    await runMenuCommand(app, 'view.toggleInspector'); // folded again: back to the automatic fold
    await expect.poll(() => panelState(page)).toBe('hidden');
    await contentWidth(app, 1440);
    await expect.poll(() => panelState(page)).toBe('shown');
    await zoom(app, 2);
    await expect.poll(() => page.evaluate(() => innerWidth)).toBeLessThan(760);
    await expect.poll(() => panelState(page)).toBe('hidden');
    await expect(page.getByTestId('shell')).toHaveAttribute('data-sidebar', 'hidden');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await zoom(app, 1);
    await expect.poll(() => panelState(page)).toBe('shown');
    expect(await savedPanes(page)).toBeNull(); // automatic folds and on-demand showing are never stored
  } finally {
    await app.close();
  }
});

test('layout B: the toolbar spans the content and the item panel, which starts under it; the sidebar top 88 px does not change', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  const top88 = () => sidebarTop88(page);
  try {
    await roomForPanel(app, page);
    const empty = await top88();
    await importPaths(page, [PDF]);
    await expect.poll(() => panelState(page)).toBe('shown');
    const vw = await page.evaluate(() => innerWidth);
    const box = async (testId: string) => (await page.getByTestId(testId).boundingBox())!;
    const [toolbar, panel, content] = [await box('toolbar'), await box('inspector-panel'), await box('content')];
    expect(Math.round(toolbar.x + toolbar.width)).toBe(vw);
    expect(Math.round(toolbar.y + toolbar.height)).toBe(52);
    expect(Math.round(panel.y)).toBe(52);
    expect(Math.round(panel.x + panel.width)).toBe(vw);
    expect(Math.round(panel.width)).toBe(320);
    expect(Math.round(content.x + content.width)).toBe(Math.round(panel.x));
    // 가져오기 → 검색 → 토글 at the toolbar's end (design-spec 2.4).
    const order = await page
      .getByTestId('toolbar')
      .locator('[data-testid="import-menu"], [data-testid="search-field"], [data-testid="inspector-toggle"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual(['import-menu', 'search-field', 'inspector-toggle']);
    // The toggle sits on a whole pixel in every view (a fraction of a pixel draws the glyph's edge differently).
    const toggleX = () => page.getByTestId('sidebar-toggle').evaluate((el) => el.getBoundingClientRect().x);
    expect(Number.isInteger(await toggleX()), 'the toggle is on a whole pixel with the panel').toBe(true);
    await expectSameShot(page, testInfo, await top88(), empty, 'with the panel');
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(() => panelState(page)).toBe('hidden');
    await expectSameShot(page, testInfo, await top88(), empty, 'panel hidden');
    expect(Number.isInteger(await toggleX()), 'the toggle is on a whole pixel with the panel hidden').toBe(true);
    await runMenuCommand(app, 'view.toggleInspector');
    await expect(page.getByRole('separator', { name: '항목 패널' })).toHaveCount(1); // the handle is named after its pane
  } finally {
    await app.close();
  }
});

test('F6 visits sidebar → table → item panel; a folded panel is skipped, and a fold under the keyboard focus hands it to the toggle', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await widen(app, page);
    await importPaths(page, [PDF]);
    await showItemPanel(app, page);
    await selectRows(page, ['sample']); // its row is the table's cursor: F6 lands there (roving tabindex)
    await expect(page.getByTestId('inspector-open')).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (const pane of ['sidebar', 'content', 'inspector', 'sidebar']) {
      await page.keyboard.press('F6');
      expect(await inPane(page)).toBe(pane);
    }
    await page.keyboard.press('Shift+F6');
    expect(await inPane(page)).toBe('inspector');
    expect(await focusedTestId(page)).toBe('inspector-open'); // the head's first action
    await runMenuCommand(app, 'view.toggleInspector');
    await expect.poll(() => panelState(page)).toBe('hidden');
    await expect(page.getByTestId('inspector-toggle')).toBeFocused(); // not <body>
    for (const pane of ['sidebar', 'content', 'sidebar']) {
      await page.keyboard.press('F6');
      expect(await inPane(page)).toBe(pane);
    }
  } finally {
    await app.close();
  }
});

test('전체 SHA-256 복사 puts the whole value on the clipboard and says 복사했습니다 for 1.5 s, no toast; the page still cannot read the clipboard (P-6)', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await widen(app, page);
    const [pdf] = await importPaths(page, [PDF]);
    await showItemPanel(app, page);
    const sha = (await detailOf(page, pdf!.id)).file.sha256;
    await selectRows(page, ['sample']);
    const copy = page.getByTestId('copy-sha');
    await expect(copy).toHaveAccessibleName('전체 SHA-256 복사');
    await (await mainWindow(app)).evaluate((w) => w.focus()); // the clipboard takes writes from a focused document
    await copy.click();
    await expect.poll(() => readClipboard(app)).toBe(sha);
    await page.mouse.move(5, 600); // away: what stays open is the confirmation, not a hover tooltip
    await expect(page.locator('.tooltip')).toHaveText('복사했습니다');
    await expect(copy).toHaveAccessibleName('복사했습니다');
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(page.locator('.tooltip')).toHaveCount(0, { timeout: 3_000 });
    await expect(copy).toHaveAccessibleName('전체 SHA-256 복사');
    expect(await page.evaluate(() => navigator.clipboard.readText().then(() => 'read', (e: Error) => e.name))).toBe('NotAllowedError');
  } finally {
    await app.close();
  }
});

test('page count and length come from the file and are kept per revision; a long abstract folds to four lines; a URL opens through main', async ({}, testInfo) => {
  const { app, page } = await launch(...dirs(testInfo));
  try {
    await widen(app, page);
    const [pdf] = await importPaths(page, [PDF, MP4]);
    await showItemPanel(app, page);
    await selectRows(page, ['sample-h264-aac']);
    await expect(page.getByTestId('inspector-kind')).toHaveText('동영상 · 0:10'); // the 10 s fixture, from its metadata
    await selectRows(page, ['sample']);
    await expect(page.getByTestId('inspector-kind')).toHaveText('PDF · 3쪽');
    await selectRows(page, ['sample-h264-aac']);
    await expect(page.getByTestId('inspector-kind')).toHaveText('동영상 · 0:10', { timeout: 200 }); // known for this revision: at once

    await seedMetadata(page, pdf!.id, { url: 'https://example.org/signal', abstract: Array.from({ length: 8 }, (_, i) => `${i + 1}번째 줄의 초록 문장입니다.`).join('\n') });
    await selectRows(page, ['sample']);
    const abstract = page.locator('[data-testid="info-row"][data-field="abstract"] .long');
    await expect(abstract).toHaveClass(/clamp/);
    const clamped = await abstract.evaluate((e) => e.clientHeight);
    await page.getByTestId('info-more').click();
    await expect(page.getByTestId('info-more')).toHaveText('접기');
    expect(await abstract.evaluate((e) => e.clientHeight)).toBeGreaterThan(clamped);

    await app.evaluate(({ shell }) => {
      const g = globalThis as { __learnExternal?: string[] };
      g.__learnExternal = [];
      shell.openExternal = async (url: string) => {
        g.__learnExternal!.push(url);
      };
    });
    await page.locator('[data-testid="info-row"][data-field="url"] a').click();
    await expect.poll(() => app.evaluate(() => (globalThis as { __learnExternal?: string[] }).__learnExternal ?? [])).toEqual(['https://example.org/signal']);
    await expect(page.getByTestId('library-table')).toBeVisible(); // the page did not navigate
  } finally {
    await app.close();
  }
});
