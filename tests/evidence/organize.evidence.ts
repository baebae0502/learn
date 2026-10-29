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
  FIXTURES, NativeInputNotPermitted, addToCollection, bringAppToFront, bringFinderToFront, assignTag, createCollection, createTag, drag, importPaths, ipcCalls, launch, mainWindow, makeTags, menuItemEnabled, organizeSnapshot, rowAt, rowByTitle, nativeKeystroke, runMenuCommand, seedLibrary, seedMetadata, selectRows,
  setTagColor, showItemPanel, tagChip, tokenColor, treeRow, type Session,
} from '../e2e/helpers';
import { COMMANDS, SUBMENUS, itemTarget, type CommandContextState } from '../../packages/domain/src/commands';
import { contextMenuEntries } from '../../apps/desktop/src/main/menu/context-entries';
import { Channels } from '../../packages/domain/src/ipc-channels';
import { contrast, type Rgba } from '../../apps/desktop/src/renderer/src/design/color';
import { finderDrag } from '../e2e/dnd-helpers';
import { EVIDENCE_ROOT, IS_MAC, allShots, captureOpenSubmenu, captureOpenPopupSubmenu, focusApp, fullScreenShot, movePointer, nativeWindowShot, pngPixels, pressEscape, tryExec, writeJson, type ManifestEntry } from './capture';
import { decodePng } from './png';

const TAG = { tag: '@organize' };
const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const results: Record<string, unknown> = {};
/** Captures that could not be taken (macOS only): data for the reader of the results, never a failed check. */
const shotFailures: Array<{ name: string; kind: string; description: string; error: string }> = [];
results['shotFailures'] = shotFailures;
const noted = (name: string, entries: ManifestEntry[]): ManifestEntry[] => {
  for (const e of entries) if (e.file === null && e.error) shotFailures.push({ name, kind: e.kind, description: e.description, error: e.error });
  return entries;
};
/** page + window + screen shots, the failed ones listed in `shotFailures`. */
const shots = async (app: Parameters<typeof allShots>[0], page: Page, name: string, description: string): Promise<ManifestEntry[]> => noted(name, await allShots(app, page, name, description));
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
    await shots(s.app, s.page, `m5-05-sidebar-tree-${theme}`, `sidebar: tree open with 6장 selected, table focused (${theme})`);
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
    await shots(s.app, s.page, `m5-05-sidebar-edit-${theme}`, `sidebar: a new collection being named, the default name selected (${theme})`);
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
      await shots(t.app, t.page, `m5-05-sidebar-hint-${theme}`, `sidebar: no collections, the hint (${theme})`);
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
  const answer = s.page.evaluate(() => window.learn.ui.confirm({ message: '‘학회 준비’\u2060를 삭제하겠습니까?', detail: '자료는 내 라이브러리에 남습니다.', confirm: '삭제' }));
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
    await shots(s.app, s.page, `m5-06-tags-selector-${theme}`, `tags: the selector with 수용체 chosen and the table dots, the first row selected (${theme})`);
  }
  await setTheme(s.page, 'light');
});

test('M5 sidebar: header buttons and tag filter dim when not main — light and dark', TAG, async () => {
  const NAME = 'not main: 새 컬렉션 and "…" dim as the toolbar toggle, the 태그 필터 glass and placeholder as the launcher\'s';
  await expect(s.page.getByTestId('tag-selector')).toBeVisible();
  await expect(s.page.getByTestId('new-collection')).toBeVisible();
  const read = () =>
    s.page.evaluate(() => {
      const style = (sel: string, pseudo?: string) => {
        const e = document.querySelector(sel);
        return e ? getComputedStyle(e, pseudo) : null;
      };
      const glyph = (sel: string) => {
        const c = style(sel);
        return c ? { color: c.color, opacity: c.opacity } : null;
      };
      return {
        notMain: document.documentElement.hasAttribute('data-window-not-main'),
        toggle: glyph('[data-testid="sidebar-top"] .icon-btn > .icon'),
        launcherGlyph: glyph('[data-testid="launcher"] > .icon'),
        launcherPlaceholder: style('[data-testid="launcher"] .placeholder')?.color ?? null,
        newCollection: glyph('[data-testid="new-collection"] > .icon'),
        more: glyph('[data-testid="tag-selector-more"] > .icon'),
        filterGlass: glyph('[data-testid="tag-filter-field"] > .icon'),
        filterPlaceholder: style('[data-testid="tag-filter-field"] .field-input', '::placeholder')?.color ?? null,
      };
    });
  const same = (a: unknown, b: unknown) => a !== null && JSON.stringify(a) === JSON.stringify(b);
  const value: Record<string, unknown> = {};
  results['notMainSidebar'] = value;
  try {
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(s.page, theme);
      const key = await read();
      // Another window of ours takes the key: this one is neither key nor main (as in the tour's table-inactive).
      await s.app.evaluate(({ BrowserWindow }) => {
        const w = new BrowserWindow({ width: 300, height: 200, show: true });
        void w.loadURL('about:blank');
        w.focus();
        (globalThis as { __probeWindow?: unknown }).__probeWindow = w;
      });
      await expect(s.page.locator('html')).toHaveAttribute('data-window-not-main', '', { timeout: 5_000 }).catch(() => {});
      const v = await read();
      value[theme] = { key, notMain: v };
      // The toggle's glyph fading is what proves the rule applied: without it every value below would match at full strength.
      const ok =
        v.notMain && v.toggle !== null && Number(v.toggle.opacity) < 1 &&
        same(v.newCollection, v.toggle) && same(v.more, v.toggle) &&
        same(v.filterGlass, v.launcherGlyph) && v.filterPlaceholder !== null && v.filterPlaceholder === v.launcherPlaceholder;
      check(`${NAME} (${theme})`, ok, value[theme]);
      await s.app.evaluate(() => (globalThis as { __probeWindow?: { close(): void } }).__probeWindow?.close());
      await (await mainWindow(s.app)).evaluate((w) => w.focus());
      await expect(s.page.locator('html')).not.toHaveAttribute('data-window-not-main', '', { timeout: 5_000 });
    }
  } finally {
    await setTheme(s.page, 'light');
    if (IS_MAC) await focusApp(s.app);
  }
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
    await shots(s.app, s.page, `m5-07-panel-item-${theme}`, `item panel: tags and collections of one item (${theme})`);
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
    await shots(s.app, s.page, `m5-07-panel-tag-add-${theme}`, `item panel: the add field with suggestions, the first chosen (${theme})`);
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
    await shots(s.app, s.page, `m5-07-panel-multi-menu-${theme}`, `item panel: three items with 컬렉션에 추가 ▾ open (${theme})`);
    await s.page.keyboard.press('Escape');
    await expect(s.page.getByTestId(`add-to-collection-${bio}`)).toHaveCount(0);
  }
  await setTheme(s.page, 'light');
});

/** One row of a native pop-up (as main built it, or as the same entries give it). */
interface PopupRow {
  label: string;
  type: string;
  enabled: boolean;
  visible: boolean;
}
/**
 * The ↓ presses that reach `label` in a pop-up: AppKit's keyboard navigation highlights a row that is visible and enabled and
 * passes over separators, disabled rows and rows that are not drawn (hidden items are not in the NSMenu at all), and the first ↓
 * on a pop-up highlights the first such row. So it is the row's place among those rows. Null when the rows are not known (an
 * empty list) or the row is not among the reachable ones: that is "could not tell", never a failure.
 */
function downsTo(rows: readonly PopupRow[], label: string): number | null {
  const at = rows.filter((r) => r.type !== 'separator' && r.visible && r.enabled).findIndex((r) => r.label === label);
  return at < 0 ? null : at + 1;
}
/** `run` or, when it does not answer in `ms` (main is busy under a native menu, say), `fallback`. */
const within = <T>(run: Promise<T>, ms: number, fallback: T): Promise<T> =>
  Promise.race([run.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);

test('downsTo: counts the rows a key reaches — not separators, disabled rows or rows that are not drawn — and says null when it cannot tell', () => {
  const row = (label: string, over: Partial<PopupRow> = {}): PopupRow => ({ label, type: 'normal', enabled: true, visible: true, ...over });
  const sep: PopupRow = row('', { type: 'separator' });
  const rows = [row('다시 연결…', { visible: false }), row('열기'), sep, row('Finder에서 보기', { enabled: false }), row('사본 내보내기…'), sep, row('컬렉션에 추가', { type: 'submenu' }), row('색 태그', { type: 'submenu' })];
  expect(downsTo(rows, '컬렉션에 추가')).toBe(3);
  expect(downsTo(rows, '색 태그')).toBe(4);
  expect(downsTo(rows, 'Finder에서 보기')).toBeNull();
  expect(downsTo([], '컬렉션에 추가')).toBeNull();
});

test('the item menu main builds for one available item: the entries the macOS capture counts its ↓ presses on (runs everywhere)', async () => {
  const rows = await itemMenuRows('darwin');
  expect(rows.map((r) => r.label)).toContain('컬렉션에 추가');
  const downs = downsTo(rows, '컬렉션에 추가');
  expect(downs).not.toBeNull();
  expect(downsTo(rows, '열기')).toBe(1);
  expect(downs!).toBeGreaterThan(1);
});

/**
 * The item menu for the item `sample` as main builds it (contextMenuEntries, the same pure function and inputs: the registry, the
 * reported context, the item's target, the library read), as rows. Nothing here talks to a native menu, so it is safe to run
 * before the right click; a read that does not answer in 3 s gives no rows.
 */
async function itemMenuRows(platform: string): Promise<PopupRow[]> {
  const read = async (): Promise<PopupRow[]> => {
    const ctx = await s.app.evaluate(() => (globalThis as { __learnMenuContext?: CommandContextState }).__learnMenuContext ?? null);
    const listed = await s.page.evaluate(async () => {
      const r = await window.learn.library.list();
      return r.ok ? r.data.map((i) => ({ id: i.id, title: i.title, storageMode: i.storageMode, availability: i.availability })) : [];
    });
    const item = listed.find((i) => i.title === 'sample');
    if (!ctx || !item) return [];
    const entries = contextMenuEntries('item', COMMANDS, ctx, [itemTarget(item)], platform, { organize: await organizeSnapshot(s.page), itemIds: [item.id] });
    return entries.map((e): PopupRow => (e === 'separator' ? { label: '', type: 'separator', enabled: true, visible: true } : { label: e.label, type: 'submenu' in e ? 'submenu' : 'normal', enabled: e.enabled, visible: true }));
  };
  return within(read(), 3000, []);
}

test('M5 item context menu: 컬렉션에 추가 ▸ open on a row (macOS only)', TAG, async () => {
  if (!IS_MAC) {
    results['itemMenu'] = { skipped: 'native menus are macOS only' };
    return;
  }
  await focusApp(s.app);
  // The menu is for `sample` alone: an earlier test leaves several rows selected, and a right click inside a selection keeps it, which
  // disables 열기, Finder에서 보기 and 사본 내보내기 — macOS skips disabled rows, so the ↓ count would land elsewhere. A plain
  // click first makes it the only selection; main's reported context must say so before the rows are derived from it.
  await rowByTitle(s.page, 'sample').click();
  let selectedRows = -1;
  for (let i = 0; i < 20 && selectedRows !== 1; i++) {
    selectedRows = await s.page.locator('[data-testid="item-row"][aria-selected="true"]').count();
    if (selectedRows !== 1) await sleep(150);
  }
  check('item menu: a plain click leaves `sample` as the only selected row', selectedRows === 1, { selectedRows });
  const reportedSelection = await within(
    (async () => {
      for (let i = 0; i < 20; i++) {
        const ctx = await s.app.evaluate(() => (globalThis as { __learnMenuContext?: CommandContextState }).__learnMenuContext ?? null);
        if (ctx?.selectionCount === 1) return 1;
        await sleep(150);
      }
      return null;
    })(),
    5000,
    null,
  );
  results['itemMenuSelection'] = { selectedRows, reportedSelection };
  // The ↓ count comes first, from the entries main builds for this menu, before any native menu is open (a pop-up runs a nested
  // menu-tracking loop in main, and whether main answers Playwright during it is not known). Last resort: the registry's order.
  const derivedRows = await itemMenuRows('darwin');
  const derived = downsTo(derivedRows, '컬렉션에 추가');
  const downs = derived ?? popupRowNumber('item', 'collection.addItems');
  // Record what main really shows (read only after the pop-up is closed), and put the real popup back afterwards.
  const patched = await within(
    s.app.evaluate(({ Menu }) => {
      const g = globalThis as { __learnShownPopups?: PopupRow[][]; __learnRealPopup?: typeof Menu.prototype.popup };
      g.__learnShownPopups = [];
      if (g.__learnRealPopup) return true;
      const real = Menu.prototype.popup;
      g.__learnRealPopup = real;
      Menu.prototype.popup = function popup(this: { items: Array<{ label: string; type: string; enabled: boolean; visible: boolean }> }, ...args: unknown[]) {
        g.__learnShownPopups!.push(this.items.map((i) => ({ label: i.label, type: i.type, enabled: i.enabled, visible: i.visible })));
        return (real as (...a: unknown[]) => unknown).apply(this, args);
      } as typeof Menu.prototype.popup;
      return true;
    }),
    3000,
    false,
  );
  await rowByTitle(s.page, 'sample').click({ button: 'right' });
  await sleep(1200);
  // System Events confirms by the row's AXSelected which row is highlighted before →; where it cannot (the pop-up cannot be
  // addressed, or the highlight cannot be read) the derived count is pressed and the capture says so (`fallback`).
  const opened = await captureOpenPopupSubmenu(s.app, s.app.process().pid!, '컬렉션에 추가', downs, 'm5-07-menu-item-add', 'item context menu on sample: 컬렉션에 추가 ▸ open (새 컬렉션, the tree as submenus)');
  await sleep(300);
  // The pop-up is closed: now main can be asked what it showed.
  const shown = await within(
    s.app.evaluate(({ Menu }) => {
      const g = globalThis as { __learnShownPopups?: PopupRow[][]; __learnRealPopup?: typeof Menu.prototype.popup };
      if (g.__learnRealPopup) Menu.prototype.popup = g.__learnRealPopup;
      delete g.__learnRealPopup;
      return g.__learnShownPopups ?? [];
    }),
    3000,
    null,
  );
  const shownRows = shown?.at(-1) ?? [];
  const shownDowns = downsTo(shownRows, '컬렉션에 추가');
  const mismatch = shownDowns !== null && derived !== null && shownDowns !== derived;
  if (mismatch || shownDowns === null || derived === null) console.warn(`[evidence] item menu ↓ count: derived ${derived}, shown ${shownDowns}, pressed ${opened.downs}, patched ${patched}`);
  results['itemMenu'] = { ...opened, derivedDowns: derived, shownDowns, mismatch, derivedRows, shownRows };
  // A check fails only for a menu that is really wrong: the highlight was read and it never was this row, or the submenu listed
  // nothing. Anything that could not be read is data (opened: null, fallback: true), not a failure.
  check('item menu: the 컬렉션에 추가 ▸ submenu opened (where System Events can tell)', opened.opened !== false, { opened: opened.opened, downs: opened.downs, derivedDowns: derived, shownDowns, fallback: opened.fallback });
  check(
    'item menu: the submenu that opened lists 새 컬렉션 first (where System Events can read it)',
    opened.rows === null || opened.rows[0]?.replace(/\s/g, '') === '새컬렉션',
    opened.rows,
  );
});

test('M5 drag and drop: the overlay stops at the sidebar — light and dark', TAG, async () => {
  const files: Array<[string, string]> = [
    ['a.pdf', 'application/pdf'],
    ['b.pdf', 'application/pdf'],
    ['c.mp4', 'video/mp4'],
  ];
  const overlay = s.page.getByTestId('drop-overlay');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(s.page, theme);
    await drag(s.page, 'dragenter', files); // the helper repeats the dragover, so the overlay stays for the captures
    await expect(overlay).toBeVisible();
    if (theme === 'light') {
      await guard('overlay: from the sidebar\'s right edge, under the 52 px bar, to the right edge of the window', async () => {
        const v = await s.page.evaluate(() => {
          const o = document.querySelector('[data-testid="drop-overlay"]')!.getBoundingClientRect();
          const side = document.querySelector('[data-sidebar-area]')!.getBoundingClientRect();
          return { left: o.left, top: o.top, right: o.right, sideRight: side.right, width: innerWidth };
        });
        results['overlay'] = v;
        check('overlay: from the sidebar\'s right edge, under the 52 px bar, to the right edge of the window', Math.abs(v.left - v.sideRight) <= 1 && v.top === 52 && Math.abs(v.right - v.width) <= 1, v);
      });
    }
    if (IS_MAC) await focusApp(s.app);
    await shots(s.app, s.page, `m5-08-drop-overlay-${theme}`, `drop overlay beside the sidebar (${theme})`);
    await drag(s.page, 'dragleave', files);
    await expect(overlay).toHaveCount(0);
    // A probe that cannot run (a tree row that is not there, a drag the helper cannot hold) is data; only what it measures can fail.
    await rowDropShots(theme).catch((e: unknown) => {
      results[`rowDrop-${theme}-error`] = errorText(e);
    });
  }
  await setTheme(s.page, 'light');
});

const toRgba = ([r, g, b]: readonly number[]): Rgba => ({ r: r! / 255, g: g! / 255, b: b! / 255, a: 1, clamped: false });
const ratioOf = (fg: readonly number[], bg: readonly number[]) => Math.round(contrast(toRgba(fg), toRgba(bg)) * 100) / 100;

/**
 * A Finder file held over a collection row, on the sidebar's real material: first in the key window, then with Finder in front
 * (the state a Finder drop is always seen in: the window is neither key nor main). The pixels are judged only where the capture
 * exists — a shot that could not be taken is in `shotFailures`, not a failed check.
 */
async function rowDropShots(theme: 'light' | 'dark'): Promise<void> {
  const row = treeRow(s.page, c6);
  const onRow = await finderDrag(s.page, PDF);
  const measure = async (label: string, shot: ManifestEntry | undefined): Promise<void> => {
    if (!shot?.file) {
      results[`rowDrop-${theme}-${label}`] = null;
      return;
    }
    const geo = await row.evaluate((e) => {
      const r = e.getBoundingClientRect();
      const count = e.querySelector('.count');
      const probe = document.createElement('canvas').getContext('2d')!;
      probe.canvas.width = probe.canvas.height = 1;
      let colour: number[] | null = null;
      if (count) {
        probe.fillStyle = getComputedStyle(count).color;
        probe.fillRect(0, 0, 1, 1);
        colour = [...probe.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      }
      return { x: r.left, y: r.top, w: r.width, h: r.height, width: innerWidth, count: colour };
    });
    const scale = decodePng(fs.readFileSync(path.join(EVIDENCE_ROOT, shot.file))).width / geo.width;
    const at = (x: number, y: number) => [Math.round(x * scale), Math.round(y * scale)] as const;
    const [ring, material, fill] = await pngPixels(s.page, shot.file, [at(geo.x + 1, geo.y + geo.h / 2), at(geo.x - 4, geo.y + geo.h / 2), at(geo.x + geo.w / 2, geo.y + 4)]);
    const v = { ring, material, fill, count: geo.count, ringOnMaterial: ratioOf(ring!, material!), countOnFill: geo.count ? ratioOf(geo.count, fill!) : null, scale };
    results[`rowDrop-${theme}-${label}`] = v;
    check(`row drop ${theme}, ${label}: the ring reads 3:1 on the sidebar material`, v.ringOnMaterial >= 3, v);
    if (v.countOnFill !== null) check(`row drop ${theme}, ${label}: the count reads 4.5:1 on the drop fill`, v.countOnFill >= 4.5, v);
  };
  try {
    await onRow.send('dragEnter', s.page.getByTestId('content'));
    await onRow.send('dragOver', row);
    // No marker on a row a file is held over is the defect this part looks for.
    check(`row drop ${theme}: a Finder file held over a collection row marks it`, await row.getAttribute('data-drop-target').then((v) => v !== null), null);
    if (IS_MAC) await focusApp(s.app);
    const key = await shots(s.app, s.page, `m5-08-row-drop-${theme}`, `a Finder file over a collection row on the material, key window (${theme})`);
    await measure('key window', key[1]);
    if (IS_MAC) {
      await bringFinderToFront();
      // Whether the window really went inactive is observed, not assumed: when it did not, the shot is still taken and says so.
      const inactive = await within(
        expect(s.page.locator('html')).toHaveAttribute('data-window-not-main', '', { timeout: 5_000 }).then(() => true),
        6000,
        false,
      );
      await onRow.send('dragOver', row); // the marker held after the switch
      await sleep(500); // the inactive repaint
      const entries = noted(
        `m5-08-row-drop-notmain-${theme}`,
        [await nativeWindowShot(s.app, `m5-08-row-drop-notmain-${theme}`, `the same with Finder in front (${theme})`, { focus: false }), await fullScreenShot(`m5-08-row-drop-notmain-${theme}`, `the same, full screen (${theme})`)],
      );
      results[`rowDrop-${theme}-notMain`] = { windowNotMain: inactive };
      await measure('Finder in front', entries[0]);
      await focusApp(s.app);
    }
  } finally {
    await onRow.cancel().catch(() => {});
    await onRow.close().catch(() => {});
    // The cancel tells the page nothing (CDP) or something it may not act on; the user's next pointer is what clears the marker.
    // A stale one would be in every later shot and would make the next theme's "marks it" check pass without a new drag.
    const stillMarked = await row.getAttribute('data-drop-target').then((v) => v !== null).catch(() => null);
    await s.page.mouse.move(400, 300).catch(() => {});
    const cleared = await within(
      expect(row).not.toHaveAttribute('data-drop-target', /.*/, { timeout: 2_000 }).then(() => true),
      3000,
      false,
    );
    results[`rowDrop-${theme}-cancel`] = { markedRightAfterCancel: stillMarked, clearedByNextPointer: cleared };
    check(`row drop ${theme}: after the Finder drag is cancelled the next pointer leaves no marker`, cleared, null);
  }
}

test('M5 drag and drop: the drop rows and the drag image on the state board (part 5) — light and dark', TAG, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m5-board-'));
  const t = await launch(path.join(dir, 'library'), path.join(dir, 'userdata'), { colorScheme: null });
  try {
    for (const theme of ['light', 'dark'] as const) {
      // The board window carries no data-theme (only the main window does): the theme is read where the page paints it.
      await t.page.evaluate((th) => window.learn.prefs.set({ theme: th }), theme);
      await expect.poll(() => t.page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark');
      await t.page.goto(`learn://app/index.html?window=gallery&part=5&platform=${process.platform}`);
      await t.page.getByTestId('gallery').waitFor();
      await guard('board: the three drop targets are the --accent-ring ring over the soft accent fill; the badge is white on the accent', async () => {
        const accent = await tokenColor(t.page, '--accent');
        const ringColor = await tokenColor(t.page, '--accent-ring');
        const soft = await tokenColor(t.page, '--accent-soft');
        const on = await tokenColor(t.page, '--text-on-accent');
        const v = await t.page.evaluate(() => {
          const style = (id: string) => getComputedStyle(document.querySelector(`[data-testid="${id}"]`)!);
          const badge = getComputedStyle(document.querySelector('.dnd-preview-badge')!);
          const title = document.querySelector('.dnd-preview-title')!.getBoundingClientRect();
          return {
            row: { shadow: style('g-drop-row').boxShadow, fill: style('g-drop-row').backgroundColor },
            heading: { shadow: style('g-drop-heading').boxShadow, fill: style('g-drop-heading').backgroundColor },
            table: { shadow: style('g-drop-table-row').boxShadow, fill: style('g-drop-table-row').backgroundColor },
            badge: { fill: badge.backgroundColor, color: badge.color, size: badge.fontSize },
            titleWidth: title.width,
          };
        });
        results[`board-${theme}`] = { ...v, accent, soft, on };
        const ring = (x: { shadow: string; fill: string }) => x.shadow.includes(ringColor) && x.fill === soft;
        check(`board ${theme}: the drop rows and the badge`, ring(v.row) && ring(v.heading) && ring(v.table) && v.badge.fill === accent && v.badge.color === on && v.titleWidth <= 240, { ...v, accent, soft, on });
      });
      if (IS_MAC) await focusApp(t.app);
      await shots(t.app, t.page, `m5-08-board-${theme}`, `state board part 5: drag image and drop targets (${theme})`);
    }
  } finally {
    await t.app.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('M5 table: a legacy scroll bar starts under the header (스크롤 막대 항상 보기), and a header cell mid-drag with its line', TAG, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m5-table-'));
  const t = await launch(path.join(dir, 'library'), path.join(dir, 'userdata'), { colorScheme: null });
  const header: Record<string, unknown> = {};
  results['tableHeader'] = header;
  let pressed = false;
  try {
    const [pdf] = await importPaths(t.page, [PDF]);
    await seedLibrary(t.app, { count: 149, from: pdf! }); // 150 rows: the scroller overflows, so its bar is drawn
    await expect(t.page.getByTestId('toolbar-count')).toHaveText('150개');
    if (IS_MAC) await movePointer(512, 620);
    const geometry = () =>
      t.page.evaluate(() => {
        const clip = document.querySelector('[data-testid="table-head-clip"]')!.getBoundingClientRect();
        const view = document.querySelector<HTMLElement>('[data-testid="library-scroller"]')!;
        const box = view.getBoundingClientRect();
        const row = document.querySelector('[data-testid="item-row"][data-index="0"]')!;
        const off = [...document.querySelectorAll<HTMLElement>('[data-testid="column-header"]')].map((h) => {
          const a = h.getBoundingClientRect();
          const b = row.querySelector<HTMLElement>(`[data-col="${h.dataset['col']}"]`)!.getBoundingClientRect();
          return Math.max(Math.abs(a.left - b.left), Math.abs(a.right - b.right));
        });
        return { gutter: view.offsetWidth - view.clientWidth, clipBottom: clip.bottom, scrollerTop: box.top, clipRight: clip.right, clientRight: box.left + view.clientWidth, worstColumnOffset: Math.max(...off) };
      });
    const g = await geometry();
    header['geometry'] = g;
    // The measured bar, not the setting: a width of 0 means no classic bar was drawn and nothing below was looked at on one.
    check('table scroll bar: the runner draws a classic bar (the defaults write for 스크롤 막대 항상 보기 took effect)', g.gutter > 0, { gutter: g.gutter });
    check('table scroll bar: the bar starts under the header (the scroller begins at the header\'s bottom edge)', Math.abs(g.clipBottom - g.scrollerTop) < 0.5, { clipBottom: g.clipBottom, scrollerTop: g.scrollerTop });
    check('table scroll bar: the header ends where the bar\'s column begins', Math.abs(g.clipRight - g.clientRight) < 0.5, { clipRight: g.clipRight, clientRight: g.clientRight });
    check('table scroll bar: every header cell lines up with its column in the rows', g.worstColumnOffset < 0.5, { worst: g.worstColumnOffset });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(t.page, theme);
      if (IS_MAC) await focusApp(t.app);
      await shots(t.app, t.page, `m5-09-table-legacy-scrollbar-${theme}`, `table of 150 rows with a legacy scroll bar, header above it (${theme})`);
    }
    await setTheme(t.page, 'light');

    // A header cell mid-drag: the line, the pressed fill, and nothing saved until the release.
    const cell = (col: string) => t.page.locator(`[data-testid="column-header"][data-col="${col}"]`);
    const [from, to] = [(await cell('createdAt').boundingBox())!, (await cell('creators').boundingBox())!];
    const y = from.y + from.height / 2;
    await t.page.mouse.move(from.x + from.width / 2, y);
    await t.page.mouse.down();
    pressed = true;
    await t.page.mouse.move(to.x + 6, y, { steps: 8 });
    // A drag that shows no line is the defect; the page is left as it is for the shots below.
    await guard('column drag: one 2 px accent line, 28 px tall, on the boundary before 저자', async () => {
      await expect(t.page.getByTestId('column-drop-line')).toBeVisible();
      const line = (await t.page.getByTestId('column-drop-line').boundingBox())!;
      const colour = await t.page.getByTestId('column-drop-line').evaluate((e) => getComputedStyle(e).backgroundColor);
      const accent = await tokenColor(t.page, '--accent-ring');
      const pressedFill = await cell('createdAt').evaluate((e) => getComputedStyle(e).backgroundColor);
      const fill = await tokenColor(t.page, '--fill-pressed');
      header['drag'] = { line, colour, accent, pressed: pressedFill, fill, boundary: to.x };
      check('column drag: one 2 px accent line, 28 px tall, on the boundary before 저자', line.width === 2 && line.height === 28 && Math.abs(line.x + 1 - to.x) < 1 && colour === accent && pressedFill === fill, header['drag']);
    });
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(t.page, theme);
      await shots(t.app, t.page, `m5-09-column-drag-${theme}`, `header cell 추가일 dragged before 저자 with its insertion line (${theme})`);
    }
    await t.page.keyboard.press('Escape');
    await t.page.mouse.up();
    pressed = false;
    check('column drag: esc cancelled it — the headers are as they were and no line is left', JSON.stringify(await t.page.getByTestId('column-header').allTextContents()) === JSON.stringify(['제목', '저자', '연도', '종류', '추가일']) && (await t.page.getByTestId('column-drop-line').count()) === 0, null);
  } finally {
    if (pressed) await t.page.mouse.up().catch(() => {});
    await t.app.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true });
  }
  save();
});

// ⌘K lists 컬렉션 between 자료 and 명령, and the quick search of a collection names its view (M5, spec 7.1, 7.2), in
// the shared session: 형광 is a word of its own in three titles and one collection, so the palette finds all three groups.
// A capture or a keystroke that cannot be made is data (`via`, shotFailures), never a failed check.
test("M5 organize: ⌘K lists 컬렉션 between 자료 and 명령; a collection view's no-results names the view and offers 내 라이브러리 전체에서 찾기", TAG, async () => {
  const value: Record<string, unknown> = {};
  results['searchAndPalette'] = value;
  const palette = s.page.getByTestId('palette');
  const field = s.page.getByTestId('search-field').locator('input');
  const theme = await s.page.locator('html').getAttribute('data-theme');
  await setTheme(s.page, 'light');
  try {
    const listed = await s.page.evaluate(() => window.learn.library.list());
    if (!listed.ok) throw new Error(`library.list failed: ${listed.code}`);
    const titles = ['현미경 6장 · 형광 영상', '세포 형광 그림 모음', '형광 증폭의 정량 모델'];
    for (const [i, title] of titles.entries()) await seedMetadata(s.page, listed.data[i]!.id, { creators: [] }, title);
    const lab = await createCollection(s.page, '형광 현미경', bio);
    await addToCollection(s.page, lab, [listed.data[0]!.id]);
    await s.page.getByTestId('nav-scope-all').click();
    await expect(s.page.getByTestId('toolbar-title')).toHaveText('내 라이브러리');

    await guard('search: the placeholder names the tags', async () => {
      const placeholder = await field.getAttribute('placeholder');
      value['placeholder'] = placeholder;
      check('search: the placeholder names the tags', placeholder === '제목, 저자, 태그 검색', { placeholder });
    });
    let via = 'menu';
    if (IS_MAC) {
      try {
        await bringAppToFront(s.app);
        await nativeKeystroke(s.app, 'k', ['command']);
        via = 'keystroke';
      } catch {
        await runMenuCommand(s.app, 'app.palette');
      }
    } else await runMenuCommand(s.app, 'app.palette');
    await expect(palette).toBeVisible({ timeout: 5_000 });
    await expect(s.page.getByTestId('palette-input')).toBeFocused({ timeout: 5_000 });
    await s.page.keyboard.insertText('형광');
    await guard('palette: 자료 → 컬렉션 → 명령, the folder row with its path', async () => {
      await expect(s.page.getByTestId('palette-collection')).toHaveCount(1, { timeout: 5_000 });
      const row = s.page.getByTestId('palette-collection');
      const v = {
        via,
        groups: await s.page.locator('.palette .p-group').allTextContents(),
        path: await row.locator('.p-sub').textContent(),
        marked: await row.locator('.p-title mark').textContent(),
        icon: await row.locator('svg').first().getAttribute('class'),
        font: await row.locator('.p-title').evaluate((el) => getComputedStyle(el).fontFamily),
      };
      value['group'] = v;
      check('palette: 자료 → 컬렉션 → 명령, the folder row with its path', v.groups.join('|') === '자료|컬렉션|명령' && v.path === '분자생물학 안 · 1개' && v.marked === '형광' && /lucide-folder\b/.test(v.icon ?? ''), v);
    });
    await shots(s.app, s.page, 'm5-10-palette-collections', '⌘K 형광: 자료 → 컬렉션 → 명령 (light)');
    if (IS_MAC) {
      await setTheme(s.page, 'dark');
      noted('m5-10-palette-collections-dark', [await nativeWindowShot(s.app, 'm5-10-palette-collections-dark', '⌘K 형광: 자료 → 컬렉션 → 명령 (dark)')]);
      await setTheme(s.page, 'light');
    }
    // The cursor starts on the first 자료 row; the collection row is the one right after the last of them.
    const itemRows = await s.page.getByTestId('palette-result').count();
    for (let i = 0; i < itemRows; i++) await s.page.keyboard.press('ArrowDown');
    await s.page.keyboard.press('Enter');
    await guard('palette: ↩ on the collection row shows it', async () => {
      await expect(palette).toBeHidden({ timeout: 5_000 });
      const title = await s.page.getByTestId('toolbar-title').textContent();
      value['shown'] = title;
      check('palette: ↩ on the collection row shows it', title === '형광 현미경', { title, itemRows });
    });
    await guard("search: the collection view's no-results names the view and has both actions", async () => {
      await runMenuCommand(s.app, 'library.find');
      await field.fill('쥐똥나무 열매');
      const empty = s.page.getByTestId('search-empty');
      await expect(empty).toBeVisible({ timeout: 5_000 });
      const v = {
        body: await empty.locator('.pe-text').textContent(),
        buttons: await empty.locator('.btn').allTextContents(),
      };
      value['noResults'] = v;
      check("search: the collection view's no-results names the view and has both actions", v.body?.startsWith('‘형광 현미경’\u2060의 제목⁠·저자⁠·태그') === true && v.buttons.join('|') === '검색어 지우기|내 라이브러리 전체에서 찾기', v);
    });
    await shots(s.app, s.page, 'm5-10-search-none-collection', '‘쥐똥나무 열매’: no results in a collection, two actions (light)');
    await s.page.getByTestId('search-empty-everywhere').click();
    await guard('search: 내 라이브러리 전체에서 찾기 returns the view and keeps the query', async () => {
      const v = {
        title: await s.page.getByTestId('toolbar-title').textContent(),
        query: await field.inputValue(),
      };
      value['everywhere'] = v;
      check('search: 내 라이브러리 전체에서 찾기 returns the view and keeps the query', v.title === '내 라이브러리' && v.query === '쥐똥나무 열매', v);
    });
    await s.page.getByTestId('search-empty-clear').click();
  } finally {
    save();
    if (theme === 'dark') await setTheme(s.page, 'dark');
  }
});

test('M5 organize: verdict of every check above (m5-organize.json checks)', TAG, async () => {
  save();
  for (const [name, c] of Object.entries(checks)) expect.soft(c.ok, `${name}: ${JSON.stringify(c.value)}`).toBe(true);
});
