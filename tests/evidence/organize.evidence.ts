// @organize — M5 collections, tags, drag and drop and context menus on macOS (the Mac suite `organize`); Linux runs the file
// too, with the macOS-only captures recorded as skipped.
//
// One shared session in serial mode. As in library.evidence.ts no check stops the run: each is recorded in m5-organize.json
// (`checks`) as it is measured, and the last test asserts them all with expect.soft. Later M5 tasks add their tests above
// the verdict and their measurements to `results`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, NativeInputNotPermitted, addToCollection, createCollection, importPaths, launch, rowAt, runMenuCommand, treeRow, type Session } from '../e2e/helpers';
import { IS_MAC, allShots, focusApp, fullScreenShot, movePointer, pressEscape, writeJson } from './capture';

const TAG = { tag: '@organize' };
const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const results: Record<string, unknown> = {};
/** Every check's verdict and the value it was judged on, in the order measured (asserted by the last test). */
const checks: Record<string, { ok: boolean; value: unknown }> = {};
const save = () => writeJson('m5-organize.json', { ...results, checks, platform: `${process.platform}-${process.arch}`, at: new Date().toISOString() }, 'M5 organize measurements');

/** Record one check (judged later, never here). */
function check(name: string, ok: boolean, value: unknown): void {
  checks[name] = { ok, value };
}
const errorText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message.split('\n')[0]}` : String(e));
/** Run a carried check; a throw becomes a failed check with the error (codes and messages only, never a path). */
async function guard(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (e) {
    check(name, false, { error: errorText(e), notPermitted: e instanceof NativeInputNotPermitted });
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The colour a token resolves to here (light-dark() resolved by the page's scheme), as getComputedStyle writes it. */
const tokenColor = (page: Page, token: string) =>
  page.evaluate((t) => {
    const probe = document.createElement('div');
    probe.style.background = `var(${t})`;
    document.body.append(probe);
    const c = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return c;
  }, token);
const setTheme = async (page: Page, theme: 'light' | 'dark') => {
  await page.evaluate((t) => window.learn.prefs.set({ theme: t }), theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
};

test.describe.configure({ mode: 'serial' });
let s: Session;
let tmp = '';
let bio = '';
let c6 = '';

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m5-organize-'));
  s = await launch(path.join(tmp, 'library'), path.join(tmp, 'userdata'), { colorScheme: null });
  const items = await importPaths(s.page, [PDF, KO_PDF, MP4]);
  bio = await createCollection(s.page, '분자생물학');
  c6 = await createCollection(s.page, '6장 · 신호 전달', bio);
  await createCollection(s.page, '학회 준비');
  await addToCollection(s.page, bio, items.map((i) => i.id));
  await addToCollection(s.page, c6, [items[0]!.id]);
  if (IS_MAC) await movePointer(512, 620);
});

test.afterAll(async () => {
  save();
  await s?.app.close().catch(() => {});
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('M5 sidebar: rows, gutter and chevron, selection neutral and accent — light and dark', TAG, async () => {
  await treeRow(s.page, bio).locator('.disclosure').click();
  await treeRow(s.page, c6).click();
  await rowAt(s.page, 0).click(); // the table has the focus: the sidebar's selection is the neutral one
  if (IS_MAC) await movePointer(512, 620);
  await guard('sidebar rows: 28 px high, a level indents 16 px, the chevron is 12 px in a 16 px gutter, a leaf has none', async () => {
    const v = await s.page.evaluate(({ a, b }) => {
      const row = (id: string) => document.querySelector(`[data-testid="nav-collection-${id}"]`)!;
      const label = (id: string) => row(id).querySelector('.label')!.getBoundingClientRect().left;
      return {
        rowHeight: row(a).getBoundingClientRect().height,
        levelDx: label(b) - label(a),
        chevron: row(a).querySelector('.disclosure svg')!.getBoundingClientRect().width,
        gutter: row(a).querySelector('.disclosure')!.getBoundingClientRect().width,
        leafChevrons: row(b).querySelectorAll('.disclosure').length,
      };
    }, { a: bio, b: c6 });
    results['tree'] = v;
    check('sidebar rows: 28 px high, a level indents 16 px, the chevron is 12 px in a 16 px gutter, a leaf has none', v.rowHeight === 28 && v.levelDx === 16 && v.chevron === 12 && v.gutter === 16 && v.leafChevrons === 0, v);
  });
  await guard('selection: the neutral fill while the table has the focus, the accent fill once the sidebar has it', async () => {
    const fill = () => treeRow(s.page, c6).evaluate((e) => getComputedStyle(e).backgroundColor);
    const neutral = await fill();
    await treeRow(s.page, c6).focus();
    const accent = await fill();
    const v = { neutral, accent, fillSelected: await tokenColor(s.page, '--fill-selected'), accentToken: await tokenColor(s.page, '--accent') };
    check('selection: the neutral fill while the table has the focus, the accent fill once the sidebar has it', v.neutral === v.fillSelected && v.accent === v.accentToken, v);
    await rowAt(s.page, 0).click();
    if (IS_MAC) await movePointer(512, 620);
  });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(s.page, theme);
    if (IS_MAC) await focusApp(s.app);
    await allShots(s.app, s.page, `m5-05-sidebar-tree-${theme}`, `sidebar: tree open with 6장 selected, table focused (${theme})`);
  }
  await setTheme(s.page, 'light');
});

test('M5 sidebar: the row being named — the field and the whole default name selected', TAG, async () => {
  await runMenuCommand(s.app, 'collection.new');
  const input = s.page.getByTestId('rename-input');
  await expect(input).toBeFocused();
  await guard('name field: 22 px high, the focus border and halo, the whole default name selected', async () => {
    const v = await input.evaluate((e: HTMLInputElement) => ({ height: e.getBoundingClientRect().height, shadow: getComputedStyle(e).boxShadow, from: e.selectionStart, to: e.selectionEnd, length: e.value.length }));
    const focus = await tokenColor(s.page, '--focus');
    results['field'] = { ...v, focus };
    check('name field: 22 px high, the focus border and halo, the whole default name selected', v.height === 22 && v.shadow.includes(focus) && v.from === 0 && v.to === v.length && v.length > 0, { ...v, focus });
  });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(s.page, theme);
    await expect(input).toBeFocused();
    if (IS_MAC) await focusApp(s.app);
    await allShots(s.app, s.page, `m5-05-sidebar-edit-${theme}`, `sidebar: a new collection being named, the default name selected (${theme})`);
  }
  await s.page.keyboard.press('Escape');
  await expect(input).toHaveCount(0);
  await setTheme(s.page, 'light');
});

test('M5 sidebar: the hint under 컬렉션 when there are none, and the special views', TAG, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m5-hint-'));
  const t = await launch(path.join(dir, 'library'), path.join(dir, 'userdata'), { colorScheme: null });
  try {
    await importPaths(t.page, [PDF]);
    await expect(t.page.getByTestId('sidebar-hint')).toBeVisible();
    await guard('hint: footnote in the tertiary colour, "새 컬렉션" on one line', async () => {
      const v = await t.page.getByTestId('sidebar-hint').evaluate((e) => ({ color: getComputedStyle(e).color, size: getComputedStyle(e).fontSize, text: e.textContent }));
      const tertiary = await t.page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.color = 'var(--text-tertiary)';
        document.body.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      });
      results['hint'] = { ...v, tertiary };
      check('hint: footnote in the tertiary colour, "새 컬렉션" on one line', v.color === tertiary && v.size === '12px' && (v.text ?? '').includes('새\u00a0컬렉션'), { ...v, tertiary });
    });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(t.page, theme);
      if (IS_MAC) await focusApp(t.app);
      await allShots(t.app, t.page, `m5-05-sidebar-hint-${theme}`, `sidebar: no collections, the hint (${theme})`);
    }
  } finally {
    await t.app.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M5 sidebar: the collection menu open and the delete sheet open (macOS only)', TAG, async () => {
  if (!IS_MAC) {
    results['menus'] = { skipped: 'native menus and sheets are macOS only' };
    return;
  }
  await focusApp(s.app);
  await treeRow(s.page, c6).click({ button: 'right' }); // a right click selects first, then the native menu opens
  await sleep(1200);
  const menuShot = await fullScreenShot('m5-05-menu-collection', 'the collection context menu open on 6장');
  await pressEscape();
  await sleep(500);
  // The sheet: the product's own ui.confirm with the words 컬렉션 삭제… sends, left open for the capture.
  const answer = s.page.evaluate(() => window.learn.ui.confirm({ message: '‘학회 준비’를 삭제하겠습니까?', detail: '자료는 내 라이브러리에 남습니다.', confirm: '삭제' }));
  await sleep(1500);
  const sheetShot = await fullScreenShot('m5-05-sheet-delete', '컬렉션 삭제… sheet over the main window');
  await pressEscape();
  const result = await answer;
  results['menus'] = { menu: menuShot.file, sheet: sheetShot.file };
  check('delete sheet: esc cancels it — the answer is no', result.ok && result.data === false, result);
});

test('M5 organize: verdict of every check above (m5-organize.json checks)', TAG, async () => {
  save();
  for (const [name, c] of Object.entries(checks)) expect.soft(c.ok, `${name}: ${JSON.stringify(c.value)}`).toBe(true);
});
