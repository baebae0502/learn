import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { COMMANDS, MAIN_OWNED_COMMANDS, type CommandId } from '../../packages/domain/src/commands';
import { FIXTURES, expectDisabledReason, importPaths, launch, menuSnapshot, openItem, recordedPopups, runMenuCommand, stubContextMenu, stubOpenDialog, type MenuNode } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const MPEG4 = path.join(FIXTURES, 'sample-mpeg4part2.mp4');
const REVEAL = process.platform === 'darwin' ? 'Finder에서 보기' : '폴더에서 보기';

test.beforeAll(() => {
  for (const f of [PDF, MPEG4]) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

/** Record shell calls in main instead of opening Finder / another app; `openFails` makes openPath report an error. */
async function stubShell(app: ElectronApplication, openFails = false): Promise<void> {
  await app.evaluate(({ shell }, openFails) => {
    const g = globalThis as { __learnShell?: Array<[string, string]> };
    g.__learnShell = [];
    shell.showItemInFolder = (p: string) => void g.__learnShell!.push(['reveal', p]);
    shell.openPath = async (p: string) => {
      g.__learnShell!.push(['open', p]);
      return openFails ? 'No application knows how to open this file' : '';
    };
  }, openFails);
}
const shellCalls = (app: ElectronApplication) => app.evaluate(() => (globalThis as { __learnShell?: Array<[string, string]> }).__learnShell ?? []);

const heightOf = async (page: Page, testId: string) => Math.round((await page.getByTestId(testId).boundingBox())!.height);

/** The final states' 44 px title row (design-spec 6): title, then kind · size (· 외부 연결). */
async function expectTitleRow(page: Page, title: string, meta: RegExp): Promise<void> {
  const row = page.getByTestId('reader-title-row');
  await expect(row.locator('.t-headline')).toHaveText(title);
  await expect(row.locator('.t-footnote')).toHaveText(meta);
  expect(await heightOf(page, 'reader-title-row')).toBe(44);
}

test('reader chrome: back button and ⌘1, title and kind · size in the toolbar, a 44 px reader toolbar', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, [PDF]);
    await openItem(s.page, 'sample');
    await expect(s.page.getByTestId('viewer-title')).toHaveText('sample');
    await expect(s.page.getByTestId('toolbar-count')).toHaveText(/^PDF · \d+(\.\d)? KB$/);
    await expect(s.page.getByTestId('pdf-page-indicator')).toHaveText('1 / 3쪽');
    await expect(s.page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    expect(await heightOf(s.page, 'reader-toolbar')).toBe(44);
    // The page sits on the sunken stage; the stage is the scroller.
    const stage = await s.page.locator('.pdf-stage').evaluate((el) => {
      const probe = document.createElement('div');
      probe.style.background = 'var(--bg-sunken)';
      document.body.append(probe);
      const want = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { got: getComputedStyle(el).backgroundColor, want, overflow: getComputedStyle(el).overflow };
    });
    expect(stage.got).toBe(stage.want);
    expect(stage.overflow).toBe('auto');
    // A disabled control says why (M-2): focusable, aria-disabled, the reason as its description; an enabled one has none.
    await expectDisabledReason(s.page.getByTestId('pdf-prev'), '첫 쪽입니다');
    await expectDisabledReason(s.page.getByTestId('pdf-next'), null);
    await s.page.getByTestId('pdf-next').click();
    await s.page.getByTestId('pdf-next').click();
    await expect(s.page.getByTestId('pdf-page-indicator')).toHaveText('3 / 3쪽');
    await expectDisabledReason(s.page.getByTestId('pdf-next'), '마지막 쪽입니다');
    await expectDisabledReason(s.page.getByTestId('pdf-prev'), null);
    await s.page.getByTestId('pdf-next').click({ force: true }); // soft-disabled: a press does nothing
    await expect(s.page.getByTestId('pdf-page-indicator')).toHaveText('3 / 3쪽');
    await s.page.getByTestId('viewer-back').click();
    await expect(s.page.getByTestId('library-table')).toBeVisible();
    // ⌘1 (go menu) is the same registry command.
    await openItem(s.page, 'sample');
    await expect(s.page.getByTestId('viewer-title')).toHaveText('sample');
    await runMenuCommand(s.app, 'nav.back');
    await expect(s.page.getByTestId('library-table')).toBeVisible();
  } finally {
    await s.app.close();
  }
});

test('a PDF that cannot be opened: a 44 px title row and the notice, no reader controls (design-spec 6)', async ({}, testInfo) => {
  const src = testInfo.outputPath('src');
  fs.mkdirSync(src, { recursive: true });
  const broken = path.join(src, 'broken.pdf');
  fs.writeFileSync(broken, '%PDF-1.4\n% not a real document\n%%EOF\n'); // passes the import's type check, pdf.js rejects it
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  const warnings: string[] = [];
  s.page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  try {
    await importPaths(s.page, [broken]);
    await openItem(s.page, 'broken');
    await expect(s.page.getByTestId('pdf-error')).toContainText('이 PDF를 열 수 없습니다');
    await expect(s.page.getByTestId('pdf-error')).toContainText('다시 가져오세요');
    await expectTitleRow(s.page, 'broken', /^PDF · \d+ B$/);
    for (const id of ['pdf-prev', 'pdf-next', 'pdf-zoom', 'pdf-page-indicator', 'pdf-canvas', 'reader-toolbar']) await expect(s.page.getByTestId(id), id).toHaveCount(0);
    // pdf.js's own message is logged by name only and never shown.
    expect(warnings.some((w) => /^\[pdf\] open\/render failed: \w+$/.test(w))).toBe(true);
    await expect(s.page.getByTestId('pdf-error')).not.toContainText(/Invalid|PDF header|structure/i);
  } finally {
    await s.app.close();
  }
});

test('unplayable video: title row and notice with Finder에서 보기 and 기본 앱으로 열기 through the registry', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await stubShell(s.app);
    await importPaths(s.page, [MPEG4]);
    await openItem(s.page, 'sample-mpeg4part2');
    const notice = s.page.getByTestId('video-error');
    await expect(notice).toContainText('이 동영상은 재생할 수 없습니다');
    await expect(notice).toContainText('MP4(H.264/AAC)');
    await expect(notice.locator('.file')).toHaveText(/^sample-mpeg4part2\.mp4 · \d/);
    await expectTitleRow(s.page, 'sample-mpeg4part2', /^동영상 · \d/);
    await expect(s.page.getByTestId('video')).toBeHidden(); // kept in the DOM (the evidence harness reads video.error)
    await expect(s.page.getByTestId('codec-reveal')).toHaveText(REVEAL);
    await expect(s.page.getByTestId('codec-open')).toHaveText('기본 앱으로 열기');
    await expectDisabledReason(s.page.getByTestId('codec-reveal'), null);
    await expectDisabledReason(s.page.getByTestId('codec-open'), null);
    await s.page.getByTestId('codec-reveal').click();
    await s.page.getByTestId('codec-open').click();
    await expect.poll(async () => (await shellCalls(s.app)).map(([k]) => k)).toEqual(['reveal', 'open']);
    const [revealed, opened] = (await shellCalls(s.app)).map(([, p]) => p);
    expect(revealed).toBe(opened);
    expect(revealed!.startsWith(path.join(testInfo.outputPath('library'), 'assets'))).toBe(true); // the managed copy
    // No app for the type: a toast with our own cause + next step, never the OS text.
    await stubShell(s.app, true);
    await s.page.getByTestId('codec-open').click();
    const toast = s.page.getByTestId('action-error');
    await expect(toast).toContainText('기본 앱으로 열지 못했습니다');
    await expect(toast).toContainText('설치되어 있는지 확인하세요');
    await expect(toast).not.toContainText('No application');
  } finally {
    await s.app.close();
  }
});

test('missing linked original: 다시 연결… first in the context menu and in the notice; 라이브러리에서 보기 goes back', async ({}, testInfo) => {
  const src = testInfo.outputPath('src');
  fs.mkdirSync(src, { recursive: true });
  const file = path.join(src, 'linked.pdf');
  fs.copyFileSync(PDF, file);
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await s.page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'linked' }), file);
    await expect(s.page.getByTestId('item-row')).toHaveCount(1);
    const moved = path.join(src, 'moved.pdf');
    fs.renameSync(file, moved);
    await stubContextMenu(s.app, null);
    await s.page.getByTestId('item-row').click({ button: 'right' });
    await expect.poll(async () => (await recordedPopups(s.app)).length).toBe(1);
    const [items] = await recordedPopups(s.app);
    expect(items!.filter((i) => i.type !== 'separator').map((i) => [i.label, i.enabled])).toEqual([
      ['다시 연결…', true],
      ['열기', true],
      [REVEAL, false],
    ]); // 기본 앱으로 열기 is not a context-menu item (design-spec 7.3, C-1)
    await openItem(s.page, 'linked');
    const notice = s.page.getByTestId('missing-notice');
    await expect(notice).toContainText('원본 파일을 찾을 수 없습니다');
    await expect(notice).toContainText('새 위치를 지정하세요');
    await expect(notice.locator('.file')).toHaveText(file); // where it was
    await expectTitleRow(s.page, 'linked', /^PDF · \d+(\.\d)? KB · 외부 연결$/); // N-1
    await expect(s.page.getByTestId('relink')).toHaveText('다시 연결…');
    await expectDisabledReason(s.page.getByTestId('relink'), null);
    await s.page.getByTestId('missing-back').click();
    await expect(s.page.getByTestId('library-table')).toBeVisible();
    await openItem(s.page, 'linked');
    await stubOpenDialog(s.app, [moved]);
    await s.page.getByTestId('relink').click();
    await expect(s.page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expect(s.page.getByTestId('missing-notice')).toHaveCount(0);
    await expect(s.page.getByTestId('reader-title-row')).toHaveCount(0);
  } finally {
    await s.app.close();
  }
});

test('a missing managed copy: the notice says to import the original again, with no 다시 연결…', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  const s = await launch(lib, testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, [PDF]);
    const assets = path.join(lib, 'assets');
    for (const d of fs.readdirSync(assets)) fs.rmSync(path.join(assets, d), { recursive: true, force: true });
    await openItem(s.page, 'sample');
    const notice = s.page.getByTestId('missing-notice');
    await expect(notice).toContainText('라이브러리 안의 사본을 찾을 수 없습니다');
    await expect(notice.locator('.file')).toHaveCount(0); // the path inside the library means nothing to the user
    await expect(s.page.getByTestId('relink')).toHaveCount(0);
    await expectTitleRow(s.page, 'sample', /^PDF · \d+(\.\d)? KB$/);
  } finally {
    await s.app.close();
  }
});

test('a library that cannot be opened shows the fatal notice in our own words and disables every registry command', async ({}, testInfo) => {
  const lib = testInfo.outputPath('library');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'library.sqlite'), 'not a database');
  const s = await launch(lib, testInfo.outputPath('userdata'));
  try {
    const notice = s.page.getByTestId('fatal-notice');
    await expect(notice.locator('h2')).toHaveText('라이브러리를 열 수 없습니다');
    // C-8: the sentence names the backup; the file name (in the library folder) is the monospace file line.
    await expect(notice.locator('p')).toHaveText('데이터는 삭제되지 않았습니다. 아래 위치에 업데이트 전 백업 파일이 있으면 그 파일로 복구할 수 있습니다.');
    await expect(notice.locator('.file')).toHaveText(path.join(lib, 'library.sqlite.pre-v*.bak'));
    await expect(notice.locator('.file')).toHaveAttribute('title', /\((INTERNAL|MIGRATION_FAILED|LIBRARY_UNAVAILABLE)\)$/);
    // main's message never reaches the screen (it can carry paths or engine text).
    const info = await s.page.evaluate(() => window.learn.app.info());
    if (!info.ok || !info.data.libraryError) throw new Error('expected a library error');
    await expect(notice).not.toContainText(info.data.libraryError.message);
    // The window can still be dragged by its top strip.
    expect(await s.page.locator('.fatal-drag').evaluate((el) => getComputedStyle(el).getPropertyValue('-webkit-app-region'))).toBe('drag');
    const flat = (nodes: MenuNode[]): MenuNode[] => nodes.flatMap((n) => [n, ...flat(n.submenu ?? [])]);
    const registry = new Set<string>(COMMANDS.map((c) => c.id));
    const enabled = flat(await menuSnapshot(s.app)).filter((n) => n.id !== null && registry.has(n.id) && n.enabled && !MAIN_OWNED_COMMANDS.has(n.id as CommandId));
    expect(enabled.map((n) => n.id)).toEqual([]);
  } finally {
    await s.app.close();
  }
});
