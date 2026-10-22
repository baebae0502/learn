import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import { COMMANDS, MAIN_OWNED_COMMANDS, type CommandId } from '../../packages/domain/src/commands';
import { FIXTURES, expectDisabledReason, importPaths, launch, mainWindow, menuSnapshot, openItem, recordedPopups, runMenuCommand, stubContextMenu, stubOpenDialog, type MenuNode } from './helpers';

const PDF = path.join(FIXTURES, 'sample.pdf');
const MPEG4 = path.join(FIXTURES, 'sample-mpeg4part2.mp4');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
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

/**
 * A home folder inside the test folder, given to the app as HOME: the paths it shows read "~/…" exactly, whatever
 * the runner's folders are called (a long test-folder name would otherwise be the part that wraps).
 */
function testHome(dir: string): { home: string; env: Record<string, string> } {
  const home = path.join(dir, 'home');
  fs.mkdirSync(home, { recursive: true });
  return { home, env: { HOME: home } };
}

/**
 * A notice's path line (design-spec 4: no middle elision): every character is shown, the line wraps only after a
 * separator (no folder or name is broken), the file name is whole on one line, and the line stays inside the notice.
 * Returns the number of lines.
 */
async function expectPathLine(notice: Locator, shown: string, base: string): Promise<number> {
  const line = notice.locator('.file');
  await expect(line).toHaveText(shown);
  await expect(line.locator('.file-base')).toHaveText(base);
  const m = await line.evaluate((el) => {
    const lh = parseFloat(getComputedStyle(el).lineHeight);
    const parts = [...el.querySelectorAll<HTMLElement>('.file-part')];
    const box = el.getBoundingClientRect();
    const notice = el.parentElement!.getBoundingClientRect();
    return {
      partsWhole: parts.every((p) => Math.round(p.getBoundingClientRect().height) === lh),
      noOverflow: el.scrollWidth <= el.clientWidth,
      inside: box.left >= notice.left - 0.5 && box.right <= notice.right + 0.5,
      selectable: getComputedStyle(el).userSelect === 'text',
      lines: Math.round(box.height / lh),
    };
  });
  expect({ ...m, lines: undefined }).toEqual({ partsWhole: true, noOverflow: true, inside: true, selectable: true, lines: undefined });
  return m.lines;
}

/** Final states sit directly under the 52 px unified toolbar: no 44 px title row in M3 (spec 2.1; fix round 1 M1). */
async function expectStageUnderToolbar(page: Page, stage: string): Promise<void> {
  await expect(page.getByTestId('reader-title-row')).toHaveCount(0);
  expect(Math.round((await page.locator(stage).boundingBox())!.y)).toBe(52);
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
    // The zoom select draws the 12 px chevron instead of the native arrow (m2); the page buttons are up/down (m3).
    expect(await s.page.getByTestId('pdf-zoom').evaluate((el) => getComputedStyle(el).appearance)).toBe('none');
    await expect(s.page.locator('.zoom-select .icon')).toBeVisible();
    await expect(s.page.getByTestId('pdf-prev').locator('svg')).toHaveClass(/lucide-chevron-up/);
    await expect(s.page.getByTestId('pdf-next').locator('svg')).toHaveClass(/lucide-chevron-down/);
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

test('a PDF that cannot be opened: the notice with the file and Finder에서 보기 · 기본 앱으로 열기, no reader controls (design-spec 6)', async ({}, testInfo) => {
  const src = testInfo.outputPath('src');
  fs.mkdirSync(src, { recursive: true });
  const broken = path.join(src, 'broken.pdf');
  fs.writeFileSync(broken, '%PDF-1.4\n% not a real document\n%%EOF\n'); // passes the import's type check, pdf.js rejects it
  const lib = testInfo.outputPath('library');
  const s = await launch(lib, testInfo.outputPath('userdata'));
  const warnings: string[] = [];
  s.page.on('console', (m) => {
    if (m.type() === 'warning') warnings.push(m.text());
  });
  try {
    await stubShell(s.app);
    await importPaths(s.page, [broken]);
    await openItem(s.page, 'broken');
    const notice = s.page.getByTestId('pdf-error');
    await expect(notice.locator('h2')).toHaveText('이 PDF를 열 수 없습니다');
    await expect(notice.locator('p')).toHaveText('파일 내용이 손상되어 쪽을 읽을 수 없습니다. 원본 파일은 그대로 보관됩니다. 다른 사본이 있으면 다시 가져오세요.');
    await expect(notice.locator('.file')).toHaveText('broken.pdf · 37 B');
    await expectStageUnderToolbar(s.page, '.reader-stage');
    // m1 / C-1 as amended: both file actions are notice buttons, through the registry.
    await expect(s.page.getByTestId('pdf-reveal')).toHaveText(REVEAL);
    await expect(s.page.getByTestId('pdf-open')).toHaveText('기본 앱으로 열기');
    await expectDisabledReason(s.page.getByTestId('pdf-reveal'), null);
    await s.page.getByTestId('pdf-reveal').click();
    await s.page.getByTestId('pdf-open').click();
    await expect.poll(async () => (await shellCalls(s.app)).map(([k]) => k)).toEqual(['reveal', 'open']);
    expect((await shellCalls(s.app)).every(([, p]) => p.startsWith(path.join(lib, 'assets')))).toBe(true);
    for (const id of ['pdf-prev', 'pdf-next', 'pdf-zoom', 'pdf-page-indicator', 'pdf-canvas', 'reader-toolbar']) await expect(s.page.getByTestId(id), id).toHaveCount(0);
    // pdf.js's own message is logged by name only and never shown.
    expect(warnings.some((w) => /^\[pdf\] open\/render failed: \w+$/.test(w))).toBe(true);
    await expect(s.page.getByTestId('pdf-error')).not.toContainText(/Invalid|PDF header|structure/i);
  } finally {
    await s.app.close();
  }
});

test('unplayable video: the notice on the unmoved stage, Finder에서 보기 and 기본 앱으로 열기 through the registry', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await stubShell(s.app);
    await importPaths(s.page, [MPEG4]);
    await openItem(s.page, 'sample-mpeg4part2');
    const notice = s.page.getByTestId('video-error');
    await expect(notice).toContainText('이 동영상은 재생할 수 없습니다');
    await expect(notice).toContainText('MP4(H.264/AAC)');
    await expect(notice.locator('.file')).toHaveText(/^sample-mpeg4part2\.mp4 · \d/);
    await expectStageUnderToolbar(s.page, '.video-stage'); // no row is inserted when the error arrives (no 44 px jump)
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

/**
 * Records, on every DOM change while a reader is open (the library's toolbar has gone), what the content column paints:
 * the background of its stage (the column's own when there is none yet), whether a <video> shows without a decoded
 * frame and no error (a bare player: grey with native controls), and whether a PDF canvas shows before its first page.
 * A MutationObserver sees every committed state, also one that lasted less than a frame.
 */
const recordOpening = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __opening: Array<{ empty: boolean; bg: string; bareVideo: boolean; blankCanvas: boolean }> };
    w.__opening = [];
    const content = document.querySelector('[data-testid="content"]')!;
    new MutationObserver(() => {
      if (!document.querySelector('[data-testid="viewer-back"]')) return; // still the library
      const stage = content.firstElementChild as HTMLElement | null;
      const video = content.querySelector('video');
      const canvas = content.querySelector('canvas');
      w.__opening.push({
        empty: stage === null,
        bg: getComputedStyle(stage ?? content).backgroundColor,
        bareVideo: video !== null && video.checkVisibility({ visibilityProperty: true }) && video.readyState < 2 && video.error === null,
        blankCanvas: canvas !== null && canvas.dataset['rendered'] === '0' && canvas.checkVisibility({ visibilityProperty: true }),
      });
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
const openingStates = (page: Page) =>
  page.evaluate(() => (window as unknown as { __opening: Array<{ empty: boolean; bg: string; bareVideo: boolean; blankCanvas: boolean }> }).__opening);
/** A CSS colour token as the page resolves it. */
const tokenColour = (page: Page, token: string) =>
  page.evaluate((token) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, token);

// T13-m6: opening a video was white (the reader waiting for its item) → grey (a bare player with its controls) → black.
test('opening a video paints the dark stage from the first state: no light column, no bare player before a frame', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, [MPEG4, MP4]);
    const stage = await tokenColour(s.page, '--video-stage');
    for (const [title, ready] of [['sample-mpeg4part2', 'video-error'], ['sample-h264-aac', 'video']] as const) {
      await recordOpening(s.page);
      await openItem(s.page, title);
      await expect(s.page.getByTestId(ready)).toBeVisible();
      const states = await openingStates(s.page);
      expect(states.length, title).toBeGreaterThan(0);
      expect(states.filter((x) => x.empty), `${title}: the column is never empty`).toEqual([]);
      expect(states.filter((x) => x.bg !== stage), `${title}: every state paints the video stage`).toEqual([]);
      expect(states.filter((x) => x.bareVideo), `${title}: no player before its first frame`).toEqual([]);
      await runMenuCommand(s.app, 'nav.back');
      await expect(s.page.getByTestId('library-table')).toBeVisible();
    }
  } finally {
    await s.app.close();
  }
});

// T13-m6: the PDF canvas showed at its default 300 × 150 (a small white box) until the first page had rendered.
test('opening a PDF shows no canvas before its first page, and the stage is the reader\'s from the first state', async ({}, testInfo) => {
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await importPaths(s.page, [PDF]);
    const sunken = await tokenColour(s.page, '--bg-sunken');
    await recordOpening(s.page);
    await openItem(s.page, 'sample');
    await expect(s.page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expect(s.page.getByTestId('pdf-canvas')).toBeVisible();
    const states = await openingStates(s.page);
    expect(states.length).toBeGreaterThan(0);
    expect(states.filter((x) => x.blankCanvas), 'no canvas before the first page').toEqual([]);
    // The reader's frame (its toolbar strip and the sunken stage) from the first state: the column is never empty white.
    expect(states.filter((x) => x.empty), 'the column is never empty').toEqual([]);
    expect(await s.page.locator('.pdf-stage').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(sunken);
  } finally {
    await s.app.close();
  }
});

test('missing linked original: 다시 연결… first in the context menu and in the notice; 라이브러리로 돌아가기 goes back', async ({}, testInfo) => {
  const { home, env } = testHome(testInfo.outputPath());
  const src = path.join(home, 'Downloads');
  fs.mkdirSync(src, { recursive: true });
  const file = path.join(src, 'linked.pdf');
  fs.copyFileSync(PDF, file);
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { env });
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
    await expectPathLine(notice, '~/Downloads/linked.pdf', 'linked.pdf'); // where it was, home as ~
    await expect(notice.locator('.file')).toHaveAttribute('title', file); // the full path
    await expectStageUnderToolbar(s.page, '.reader-stage');
    await expect(s.page.getByTestId('relink')).toHaveText('다시 연결…');
    await expectDisabledReason(s.page.getByTestId('relink'), null);
    await s.page.getByTestId('missing-back').click();
    await expect(s.page.getByTestId('library-table')).toBeVisible();
    await openItem(s.page, 'linked');
    await stubOpenDialog(s.app, [moved]);
    await s.page.getByTestId('relink').click();
    await expect(s.page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
    await expect(s.page.getByTestId('missing-notice')).toHaveCount(0);
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
    // The window is still named after the item (design-spec 2.1), not left at the library's title.
    await expect.poll(async () => (await mainWindow(s.app)).evaluate((w) => w.getTitle())).toBe('sample');
    await expect(notice.locator('.file')).toHaveCount(0); // the path inside the library means nothing to the user
    await expect(s.page.getByTestId('relink')).toHaveCount(0);
    await expectStageUnderToolbar(s.page, '.reader-stage');
  } finally {
    await s.app.close();
  }
});

test('reopening an item whose file vanished silently shows the missing notice, never the stale reader first', async ({}, testInfo) => {
  const src = testInfo.outputPath('src');
  fs.mkdirSync(src, { recursive: true });
  const file = path.join(src, 'linked.pdf');
  fs.copyFileSync(PDF, file);
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await s.page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'linked' }), file);
    await openItem(s.page, 'linked');
    await expect(s.page.getByTestId('pdf-canvas')).toHaveAttribute('data-rendered', /^[1-9]\d*$/); // cached as available
    await s.page.getByTestId('viewer-back').click();
    fs.renameSync(file, path.join(src, 'moved.pdf')); // main does not watch the disk: no libraryChanged
    // Record every reader state that appears from here on.
    await s.page.evaluate(() => {
      const g = window as unknown as { __seen: string[] };
      g.__seen = [];
      new MutationObserver(() => {
        for (const id of ['pdf-canvas', 'pdf-error', 'missing-notice']) {
          if (document.querySelector(`[data-testid="${id}"]`) && !g.__seen.includes(id)) g.__seen.push(id);
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await openItem(s.page, 'linked');
    await expect(s.page.getByTestId('missing-notice')).toBeVisible();
    expect(await s.page.evaluate(() => (window as unknown as { __seen: string[] }).__seen)).toEqual(['missing-notice']);
  } finally {
    await s.app.close();
  }
});

test('a library that cannot be opened: our own words, the newest real backup on a wrapping path line, every command disabled', async ({}, testInfo) => {
  // A folder as deep as the default macOS library (~/Library/Application Support/Learn/Library): the line must wrap.
  const { home, env } = testHome(testInfo.outputPath());
  const lib = path.join(home, 'Library', 'Application Support', 'Learn', 'Library');
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, 'library.sqlite'), 'not a database');
  const ud = testInfo.outputPath('userdata');
  let s = await launch(lib, ud, { env });
  try {
    // No pre-update backup: the sentence points at none and there is no file line (n5).
    const notice = s.page.getByTestId('fatal-notice');
    await expect(notice.locator('h2')).toHaveText('라이브러리를 열 수 없습니다');
    await expect(notice.locator('p')).toHaveText('데이터는 삭제되지 않았습니다. 앱을 다시 시작하세요.');
    await expect(notice.locator('.file')).toHaveCount(0);
    // main's message never reaches the screen (it can carry paths or engine text).
    const info = await s.page.evaluate(() => window.learn.app.info());
    if (!info.ok || !info.data.libraryError) throw new Error('expected a library error');
    expect(info.data.backupFile).toBeNull();
    expect(info.data.homeDir).toBe(home);
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
  // Two pre-update backups: the newest (highest version) is named, never a pattern (C-8, n5).
  for (const v of [2, 3]) fs.writeFileSync(path.join(lib, `library.sqlite.pre-v${v}.bak`), '');
  s = await launch(lib, ud, { env });
  try {
    const notice = s.page.getByTestId('fatal-notice');
    await expect(notice.locator('p')).toHaveText('데이터는 삭제되지 않았습니다. 아래 위치의 업데이트 전 백업 파일로 복구할 수 있습니다.');
    const full = path.join(lib, 'library.sqlite.pre-v3.bak');
    const lines = await expectPathLine(notice, '~/Library/Application Support/Learn/Library/library.sqlite.pre-v3.bak', 'library.sqlite.pre-v3.bak');
    expect(lines).toBe(2); // wrapped after the last separator, not cut
    await expect(notice.locator('.file')).toHaveAttribute('title', new RegExp(`^${full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\((INTERNAL|MIGRATION_FAILED|LIBRARY_UNAVAILABLE)\\)$`));
  } finally {
    await s.app.close();
  }
});
