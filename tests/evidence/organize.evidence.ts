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
import {
  FIXTURES, NativeInputNotPermitted, addToCollection, assignTag, createCollection, createTag, importPaths, ipcCalls, launch, makeTags, menuItemEnabled, organizeSnapshot, rowAt, rowByTitle, runMenuCommand, selectRows,
  setTagColor, showItemPanel, tagChip, tokenColor, treeRow, type Session,
} from '../e2e/helpers';
import { COMMANDS, SUBMENUS } from '../../packages/domain/src/commands';
import { Channels } from '../../packages/domain/src/ipc-channels';
import { IS_MAC, allShots, captureOpenSubmenu, captureOpenPopupSubmenu, focusApp, fullScreenShot, movePointer, pressEscape, tryExec, writeJson } from './capture';

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
  // key code 18 is the main-row 1 (Digit1) on ANSI and JIS layouts; `keystroke "1"` may send the keypad's 1 (Numpad1) instead.
  const typeDigit = () => tryExec('osascript', ['-e', 'tell application "System Events" to key code 18'], 10_000);
  type Down = { key: string; code: string; target: string };
  const recordKeys = () => s.page.evaluate(() => {
    const w = window as unknown as { __digitKeys?: Down[] };
    w.__digitKeys = [];
    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement | null;
      w.__digitKeys!.push({ key: e.key, code: e.code, target: t?.getAttribute?.('data-testid') ?? t?.tagName ?? '' });
    }, true);
  });
  const readKeys = () => s.page.evaluate(() => (window as unknown as { __digitKeys?: Down[] }).__digitKeys ?? []);
  const clearKeys = () => s.page.evaluate(() => { (window as unknown as { __digitKeys?: Down[] }).__digitKeys = []; });
  const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);
  await focusApp(s.app);
  await s.page.getByTestId('tag-chip-' + tagIds[2]!).first().click(); // the filter off again: every row shows
  const before = await held();
  // A row is selected first: the menu bar's 파일 › 색 태그 ▸ rows are then enabled, which is when macOS used to take the digit.
  await rowAt(s.page, 0).click();
  const rowId = (await rowAt(s.page, 0).getAttribute('data-item-id'))!;
  const menuRowEnabled = await menuItemEnabled(s.app, 'tag.color1');
  await recordKeys();
  // In the table's search field: the digit is text, and no item gains or loses a tag.
  await runMenuCommand(s.app, 'library.find');
  const field = s.page.getByTestId('search-field').locator('input');
  await expect(field).toBeFocused();
  const typedInField = await typeDigit();
  await sleep(600);
  const fieldKeys = await readKeys();
  await clearKeys();
  const afterField = await held();
  const fieldText = await field.inputValue();
  await field.fill('');
  await s.page.keyboard.press('Escape');
  await guard('digits: a digit typed in the search field changes no tag', async () => {
    check('digits: a digit typed in the search field changes no tag', typedInField.ok && fieldText === '1' && same(afterField, before), { typedInField: typedInField.ok, fieldText, fieldKeys, menuRowEnabled, before, afterField });
  });
  // In the item panel's date field (the metadata editor), then cancelled so the item is not saved.
  let yearText: string | null = null;
  let yearKeys: Down[] = [];
  let editorGone: boolean | null = null;
  let afterYear: string[] = before;
  let typedInYear: boolean | null = null;
  await guard('digits: a digit typed in the item panel\'s date field changes no tag', async () => {
    await rowAt(s.page, 0).click();
    await showItemPanel(s.app, s.page);
    await s.page.getByTestId('info-edit').click();
    const year = s.page.locator('[data-testid="editor-field"][data-field="date"] :is(input, textarea)');
    await year.fill('');
    await year.click();
    await clearKeys();
    await focusApp(s.app);
    typedInYear = (await typeDigit()).ok;
    await sleep(600);
    yearText = await year.inputValue();
    yearKeys = await readKeys();
    afterYear = await held();
    await s.page.keyboard.press('Escape'); // cancel: nothing is saved
    await expect(s.page.getByTestId('info-edit')).toBeVisible();
    editorGone = (await s.page.getByTestId('info-editor').count()) === 0;
    check('digits: a digit typed in the item panel\'s date field changes no tag', typedInYear === true && yearText === '1' && same(afterYear, before) && editorGone === true, { typedInYear, yearText, yearKeys, editorGone, menuRowEnabled, before, afterYear });
  });
  // On the focused row: the tag goes on or off exactly once (twice would leave the snapshot as it was).
  await rowAt(s.page, 0).click();
  await clearKeys();
  const toggles = async () => (await ipcCalls(s.app))[Channels.tags.togglePosition] ?? 0;
  const togglesBefore = await toggles();
  await focusApp(s.app);
  const typedOnRow = await typeDigit();
  await sleep(1200);
  const afterRow = await held();
  const keys = await readKeys();
  const togglesAfter = await toggles();
  const digit1Keydowns = keys.filter((k) => k.code === 'Digit1').length;
  const toggleCalls = togglesAfter - togglesBefore;
  await guard('digits: a digit with a row focused toggles the tag exactly once', async () => {
    const had = before.includes(rowId);
    const flipped = had ? !afterRow.includes(rowId) : afterRow.includes(rowId);
    const others = same(afterRow.filter((i) => i !== rowId), before.filter((i) => i !== rowId));
    check('digits: a digit with a row focused toggles the tag exactly once', typedOnRow.ok && flipped && others && digit1Keydowns === 1 && toggleCalls === 1, {
      typedOnRow: typedOnRow.ok, had, flipped, others, digit1Keydowns, toggleCalls, keys, menuRowEnabled, before, afterRow,
    });
  });
  // The menu bar's 파일 › 색 태그 ▸ with a row selected: the tag rows with no digits at the right (the PNG is read by eye).
  await focusApp(s.app);
  const menubar = await captureOpenSubmenu(s.app, s.app.process().pid!, 3, '색 태그', 'm5-06-menubar-color-tags', '파일 › 색 태그 ▸ open with a row selected: the tag rows, no digit at the right edge');
  results['tagDigits'] = { typedInField: typedInField.ok, fieldText, menuRowEnabled, before, afterField, fieldKeys, typedInYear, yearText, yearKeys, editorGone, afterYear, rowId, typedOnRow: typedOnRow.ok, afterRow, digit1Keydowns, toggleCalls, keys, menubarOpened: menubar.opened };
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

test('M5 item panel: 태그 and 컬렉션 sections, the add field with suggestions, several items with the open 컬렉션에 추가 ▾ — light and dark', TAG, async () => {
  const listed = await s.page.evaluate(async () => {
    const r = await window.learn.library.list();
    return r.ok ? r.data.map((i) => ({ id: i.id, title: i.title })) : [];
  });
  const idOf = (title: string) => listed.find((i) => i.title === title)!.id;
  const important = await createTag(s.page, '중요');
  await setTagColor(s.page, important, 'yellow', 1);
  const exam = await createTag(s.page, '시험 범위');
  await setTagColor(s.page, exam, 'red', 2);
  const receptor = await createTag(s.page, '수용체');
  for (const name of ['수용체 억제제', '수용체 작용제', '수용기']) await createTag(s.page, name);
  for (const id of [important, exam, receptor]) await assignTag(s.page, id, [idOf('sample')]);
  await showItemPanel(s.app, s.page);
  await rowByTitle(s.page, 'sample').click();
  const section = s.page.getByTestId('tags-section');
  await expect(section.getByTestId(`tag-chip-${important}`)).toBeVisible();
  if (IS_MAC) await movePointer(512, 620);
  await guard('panel: chips are 22 px pills with an 8 px dot, the add chip is a 22 px outline, a path row is 24 px with a 14 px folder', async () => {
    const v = await s.page.evaluate((id) => {
      const chip = document.querySelector(`[data-testid="tags-section"] [data-testid="tag-chip-${id}"]`)!;
      const add = document.querySelector('[data-testid="tag-add-chip"]')!;
      const path = document.querySelector('[data-testid="collection-path"]')!;
      return {
        chip: chip.getBoundingClientRect().height,
        dot: chip.querySelector('.dot')?.getBoundingClientRect().width ?? null,
        add: add.getBoundingClientRect().height,
        addRing: getComputedStyle(add).boxShadow,
        path: path.getBoundingClientRect().height,
        folder: path.querySelector('svg')!.getBoundingClientRect().width,
      };
    }, important);
    results['panel'] = v;
    check('panel: chips are 22 px pills with an 8 px dot, the add chip is a 22 px outline, a path row is 24 px with a 14 px folder', v.chip === 22 && v.dot === 8 && v.add === 22 && v.addRing !== 'none' && v.path === 24 && v.folder === 14, v);
  });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(s.page, theme);
    if (IS_MAC) await focusApp(s.app);
    await allShots(s.app, s.page, `m5-07-panel-item-${theme}`, `item panel: tags and collections of one item (${theme})`);
  }

  await setTheme(s.page, 'light');
  await s.page.getByTestId('tag-add-chip').click();
  await s.page.getByTestId('tag-input').fill('수용');
  await s.page.keyboard.press('ArrowDown');
  await expect(s.page.getByTestId('tag-suggestion')).toHaveCount(3);
  await guard('add field: a 22 px pill with the focus border and halo, suggestion rows 24 px, the chosen row in the accent', async () => {
    const focus = await tokenColor(s.page, '--focus');
    const accent = await tokenColor(s.page, '--accent');
    const v = await s.page.evaluate(() => {
      const wrap = document.querySelector('.tag-input-wrap')!;
      const rows = [...document.querySelectorAll('[data-testid="tag-suggestion"]')];
      return { field: wrap.getBoundingClientRect().height, shadow: getComputedStyle(wrap).boxShadow, rows: rows.map((r) => r.getBoundingClientRect().height), chosen: rows.map((r) => getComputedStyle(r).backgroundColor) };
    });
    results['field'] = { ...v, focus, accent };
    check('add field: a 22 px pill with the focus border and halo, suggestion rows 24 px, the chosen row in the accent', v.field === 22 && v.shadow.includes(focus) && v.rows.every((h) => h === 24) && v.chosen[0] === accent, { ...v, focus, accent });
  });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(s.page, theme);
    await expect(s.page.getByTestId('tag-input')).toBeFocused();
    if (IS_MAC) await focusApp(s.app);
    await allShots(s.app, s.page, `m5-07-panel-tag-add-${theme}`, `item panel: the add field with suggestions, the first chosen (${theme})`);
  }
  await s.page.keyboard.press('Escape');

  await selectRows(s.page, ['sample', '한글 경로 (테스트) #1', 'sample-h264-aac'], { modifier: 'Meta' });
  await expect(s.page.getByTestId('inspector-multi')).toBeVisible();
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(s.page, theme);
    await s.page.getByTestId('add-to-collection').click();
    await expect(s.page.getByTestId(`add-to-collection-${bio}`)).toBeVisible();
    await guard('컬렉션에 추가 ▾: a level indents 16 px, the collection holding all three is marked and off', async () => {
      const v = await s.page.evaluate(({ a, b }) => {
        const label = (id: string) => {
          const el = document.querySelector(`[data-testid="add-to-collection-${id}"] .mi-label`)!;
          return el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft); // the indent is the label's padding: where its text starts
        };
        const item = document.querySelector(`[data-testid="add-to-collection-${a}"]`)!;
        return { step: label(b) - label(a), checked: item.getAttribute('aria-checked'), disabled: item.getAttribute('aria-disabled') };
      }, { a: bio, b: c6 });
      results['menu'] = v;
      check('컬렉션에 추가 ▾: a level indents 16 px, the collection holding all three is marked and off', v.step === 16 && v.checked === 'true' && v.disabled === 'true', v);
    });
    if (IS_MAC) await focusApp(s.app);
    await allShots(s.app, s.page, `m5-07-panel-multi-menu-${theme}`, `item panel: three items with 컬렉션에 추가 ▾ open (${theme})`);
    await s.page.keyboard.press('Escape');
    await expect(s.page.getByTestId(`add-to-collection-${bio}`)).toHaveCount(0);
  }
  await setTheme(s.page, 'light');
});

test('M5 item context menu: 컬렉션에 추가 ▸ open on a row (macOS only)', TAG, async () => {
  if (!IS_MAC) {
    results['itemMenu'] = { skipped: 'native menus are macOS only' };
    return;
  }
  await focusApp(s.app);
  await rowByTitle(s.page, 'sample').click({ button: 'right' });
  await sleep(1200);
  // 열기 · Finder에서 보기 · 사본 내보내기… | 컬렉션에 추가 ▸: four rows a key reaches (a separator is skipped), then → opens the submenu.
  const keys = ['tell application "System Events"', 'delay 0.3', ...Array.from({ length: 4 }, () => ['key code 125', 'delay 0.15']).flat(), 'delay 0.3', 'key code 124', 'end tell'];
  const typed = await tryExec('osascript', keys.flatMap((line) => ['-e', line]), 20_000);
  await sleep(1000);
  const shot = await fullScreenShot('m5-07-menu-item-add', 'item context menu on sample: 컬렉션에 추가 ▸ open (새 컬렉션, the tree as submenus)');
  await pressEscape();
  await pressEscape();
  await sleep(300);
  results['itemMenu'] = { shot: shot.file, keysOk: typed.ok };
  check('item menu: the keys reached the submenu (System Events accepted them)', typed.ok, typed.stderr);
});

test('M5 organize: verdict of every check above (m5-organize.json checks)', TAG, async () => {
  save();
  for (const [name, c] of Object.entries(checks)) expect.soft(c.ok, `${name}: ${JSON.stringify(c.value)}`).toBe(true);
});
