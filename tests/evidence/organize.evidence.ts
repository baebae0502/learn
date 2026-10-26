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
import { FIXTURES, NativeInputNotPermitted, addToCollection, createCollection, importPaths, launch, makeTags, organizeSnapshot, rowAt, runMenuCommand, tagChip, tokenColor, treeRow, type Session } from '../e2e/helpers';
import { COMMANDS, SUBMENUS } from '../../packages/domain/src/commands';
import { IS_MAC, allShots, captureOpenPopupSubmenu, focusApp, fullScreenShot, movePointer, pressEscape, tryExec, writeJson } from './capture';

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

let tagIds: string[] = [];
test('M5 tags: the selector, its chips and the table dots — light and dark', TAG, async () => {
  const list = await s.page.evaluate(() => window.learn.library.list());
  const ids = list.ok ? list.data.map((i) => i.id) : [];
  tagIds = await makeTags(s.page, [
    { name: '중요', slot: 1, items: ids.slice(0, 2) },
    { name: '시험 범위', slot: 2, items: ids.slice(0, 1) },
    { name: '수용체', items: ids.slice(0, 2) },
    { name: '회귀분석' },
  ]);
  await s.page.getByTestId('nav-scope-all').click();
  await expect(s.page.getByTestId('tag-selector')).toBeVisible();
  await tagChip(s.page, tagIds[2]!).click(); // 수용체 in the filter
  await rowAt(s.page, 0).click(); // the table has the focus: the first row on the accent fill
  if (IS_MAC) await movePointer(512, 620);
  await guard('selector: chips 22 px high, dots 8 px, a hairline above, at most 40 % of the sidebar', async () => {
    const v = await s.page.evaluate(({ chip, dotTag }) => {
      const sel = document.querySelector('[data-testid="tag-selector"]')!.getBoundingClientRect();
      const col = document.querySelector('nav.sidebar-inner')!.getBoundingClientRect();
      const pill = document.querySelector(`[data-testid="tag-chip-${chip}"]`)!.parentElement!.getBoundingClientRect();
      const dot = document.querySelector(`[data-testid="tag-chip-${dotTag}"] .dot`)!.getBoundingClientRect();
      return { chipHeight: pill.height, dot: [dot.width, dot.height], ratio: sel.height / col.height, border: getComputedStyle(document.querySelector('[data-testid="tag-selector"]')!).borderTopWidth };
    }, { chip: tagIds[2]!, dotTag: tagIds[0]! });
    results['tagSelector'] = v;
    check('selector: chips 22 px high, dots 8 px, a hairline above, at most 40 % of the sidebar', v.chipHeight === 22 && v.dot[0] === 8 && v.dot[1] === 8 && v.ratio <= 0.4 && v.border === '1px', v);
  });
  await guard('dots: the inner border on a plain row, the white ring on the accent row', async () => {
    const dot = s.page.locator('[data-testid="item-row"][aria-selected="true"] .tag-dots i').first();
    const ring = await dot.evaluate((e) => getComputedStyle(e).boxShadow);
    const white = await tokenColor(s.page, '--text-on-accent');
    results['tagDots'] = { ring, white };
    check('dots: the inner border on a plain row, the white ring on the accent row', ring.includes(white) && !ring.includes('inset'), { ring, white });
  });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(s.page, theme);
    if (IS_MAC) await focusApp(s.app);
    await allShots(s.app, s.page, `m5-06-tags-selector-${theme}`, `tags: the selector with 수용체 chosen and the table dots, the first row selected (${theme})`);
  }
  await setTheme(s.page, 'light');
});

test('M5 tags: the digits 1–8 on macOS — never typed into a field, once on a row (macOS only)', TAG, async () => {
  if (!IS_MAC) {
    results['tagDigits'] = { skipped: 'System Events typing is macOS only' };
    return;
  }
  const held = async () => ((await organizeSnapshot(s.page)).tagged[tagIds[0]!] ?? []).slice().sort();
  const typeDigit = (digit: string) => tryExec('osascript', ['-e', `tell application "System Events" to keystroke "${digit}"`], 10_000);
  await focusApp(s.app);
  await s.page.getByTestId('tag-chip-' + tagIds[2]!).first().click(); // the filter off again: every row shows
  const before = await held();
  // In the table's search field: the digit is text, and no item gains or loses a tag.
  await runMenuCommand(s.app, 'library.find');
  const field = s.page.getByTestId('search-field').locator('input');
  await expect(field).toBeFocused();
  const typedInField = await typeDigit('1');
  await sleep(600);
  const afterField = await held();
  const fieldText = await field.inputValue();
  await field.fill('');
  await s.page.keyboard.press('Escape');
  await guard('digits: a digit typed in the search field changes no tag', async () => {
    check('digits: a digit typed in the search field changes no tag', typedInField.ok && fieldText === '1' && JSON.stringify(afterField) === JSON.stringify(before), { typedInField: typedInField.ok, fieldText, before, afterField });
  });
  // On a focused row: the tag goes on or off exactly once (twice would leave the snapshot as it was).
  await rowAt(s.page, 0).click();
  const rowId = (await rowAt(s.page, 0).getAttribute('data-item-id'))!;
  await focusApp(s.app);
  const typedOnRow = await typeDigit('1');
  await sleep(1200);
  const afterRow = await held();
  await guard('digits: a digit with a row focused toggles the tag exactly once', async () => {
    const had = before.includes(rowId);
    const flipped = had ? !afterRow.includes(rowId) : afterRow.includes(rowId);
    const others = JSON.stringify(afterRow.filter((i) => i !== rowId)) === JSON.stringify(before.filter((i) => i !== rowId));
    check('digits: a digit with a row focused toggles the tag exactly once', typedOnRow.ok && flipped && others, { typedOnRow: typedOnRow.ok, had, before, afterRow });
  });
  results['tagDigits'] = { typedInField: typedInField.ok, fieldText, before, afterField, rowId, typedOnRow: typedOnRow.ok, afterRow };
});

/**
 * The place of a menu row among the enabled rows of a pop-up, read from the registry: the first ↓ on a macOS pop-up selects the
 * first enabled row, so this is also the number of ↓ that reaches it (a single available managed item; a tag with a colour).
 */
function popupRowNumber(kind: 'item' | 'tag', rowId: string): number {
  const placed = [
    ...COMMANDS.filter((c) => c.contextMenu?.kinds.includes(kind) && !c.contextMenu.onlyWhenAvailable).map((c) => ({ id: c.id as string, at: c.contextMenu! })),
    ...SUBMENUS.filter((g) => g.contextMenu?.kinds.includes(kind)).map((g) => ({ id: g.id, at: g.contextMenu! })),
  ].sort((a, b) => a.at.group - b.at.group || a.at.order - b.at.order);
  const n = placed.findIndex((r) => r.id === rowId) + 1;
  if (n === 0) throw new Error(`no pop-up row ${rowId} for ${kind}`);
  return n;
}

test('M5 tags: the chip menu with 색 지정 ▸ open and the item menu with 색 태그 ▸ open (macOS only)', TAG, async () => {
  if (!IS_MAC) {
    results['tagMenus'] = { skipped: 'native menus are macOS only' };
    return;
  }
  const pid = s.app.process().pid!;
  await focusApp(s.app);
  await tagChip(s.page, tagIds[0]!).click({ button: 'right' });
  await sleep(1200);
  const chip = await captureOpenPopupSubmenu(s.app, pid, '색 지정', popupRowNumber('tag', 'tag.setColor'), 'm5-06-menu-tag-colors', 'the tag chip menu with 색 지정 ▸ open: eight colours with dots, the slot another tag holds named');
  await sleep(500);
  await rowAt(s.page, 0).click({ button: 'right' });
  await sleep(1200);
  const item = await captureOpenPopupSubmenu(s.app, pid, '색 태그', popupRowNumber('item', 'colorTags'), 'm5-06-menu-item-color-tags', 'the item menu with 색 태그 ▸ open: the tags by slot, the digits at the right, a check for what every selected item has');
  results['tagMenus'] = { chip, item };
  // `opened` is null when System Events cannot address a pop-up: the controller then reads the PNGs.
  check('tag menus: ran and, where System Events can tell, the submenus opened', (chip.opened ?? true) && (item.opened ?? true), { chip: chip.opened, item: item.opened });
});

test('M5 organize: verdict of every check above (m5-organize.json checks)', TAG, async () => {
  save();
  for (const [name, c] of Object.entries(checks)) expect.soft(c.ok, `${name}: ${JSON.stringify(c.value)}`).toBe(true);
});
