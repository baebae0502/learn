// @library — M4 library table, quick search and item panel on macOS (the Mac suite `library`); Linux CI runs it
// too, with the macOS-only captures recorded as skipped.
//
// One shared session in serial mode. As in shell.evidence.ts, no check stops the run: each is recorded in
// m4-library.json (`checks`) as it is measured, and the last test asserts them all with expect.soft. Later M4 tasks add
// their tests above the verdict and their measurements to `results`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  FIXTURES, KEY_CODE, NativeInputNotPermitted, bringAppToFront, bringFinderToFront, closeSheet, expectWindow, holdCopies, holdSaveDialog, importPaths, launch, mainWindow, menuItemEnabled, nativeKeyCode,
  nativeKeystroke, recordedPopups, releaseCopies, releaseSaveDialog, rowAt, rowByTitle, runMenuCommand, saveDialogCalls, saveDialogLog, seedLibrary, seedMetadata, selectRows, shellCalls, stubContextMenu,
  stubShell, type Session,
} from '../e2e/helpers';
import { LIBRARY_COLUMNS } from '../../packages/domain/src/library-columns';
import { EVIDENCE_ROOT, IS_MAC, allShots, captureOpenMenu, focusApp, fullScreenShot, menuItemNames, movePointer, nativeWindowShot, pngPixels, pressEscape, writeJson } from './capture';
import { decodePng } from './png';

const TAG = { tag: '@library' };
const PDF = path.join(FIXTURES, 'sample.pdf');
const KO_PDF = path.join(FIXTURES, '한글 경로 (테스트) #1.pdf');
const MP4 = path.join(FIXTURES, 'sample-h264-aac.mp4');
const MPEG4 = path.join(FIXTURES, 'sample-mpeg4part2.mp4');
const results: Record<string, unknown> = {};
/** The unfocused-selection window capture's path (relative to the evidence root), the drawn reference for the inactive check. */
let unfocusedWindowShot: string | null = null;
/** Every check's verdict and the value it was judged on, in the order measured (asserted by the last test). */
const checks: Record<string, { ok: boolean; value: unknown }> = {};
const save = () => writeJson('m4-library.json', { ...results, checks, platform: `${process.platform}-${process.arch}`, at: new Date().toISOString() }, 'M4 library measurements');

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

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-m4-library-'));
  s = await launch(path.join(tmp, 'library'), path.join(tmp, 'userdata'), { colorScheme: null });
  const [pdf] = await importPaths(s.page, [PDF, KO_PDF, MP4, MPEG4]);
  await seedLibrary(s.app, { count: 44, from: pdf! }); // 48 items, as the mockup's library
  await expect(s.page.getByTestId('toolbar-count')).toHaveText('48개');
  if (IS_MAC) await movePointer(512, 620);
});

test.afterAll(async () => {
  save();
  await s?.app.close().catch(() => {});
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('M4 table: header, default columns, sorted 추가일, row metrics and stripes, light and dark', TAG, async () => {
  await guard('header 28 px, rows 28 px at 보통, first row 4 px under the header', async () => {
    const head = (await s.page.locator('.table-head').boundingBox())!;
    const [r0, r1] = [(await rowAt(s.page, 0).boundingBox())!, (await rowAt(s.page, 1).boundingBox())!];
    const v = { header: head.height, row: r0.height, pitch: r1.y - r0.y, gap: r0.y - (head.y + head.height) };
    results['table'] = { ...(results['table'] as object), metrics: v };
    check('header 28 px, rows 28 px at 보통, first row 4 px under the header', v.header === 28 && v.row === 28 && v.pitch === 28 && v.gap === 4, v);
  });
  await guard('header labels follow the column catalogue: 제목 · 저자 · 연도 · 종류 · 추가일', async () => {
    const labels = await s.page.getByTestId('column-header').allTextContents();
    const want = LIBRARY_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.label);
    check('header labels follow the column catalogue: 제목 · 저자 · 연도 · 종류 · 추가일', JSON.stringify(labels) === JSON.stringify(want), { labels, want });
  });
  await guard('the sorted header (추가일, newest first) is primary 500 with a 12 px chevron', async () => {
    const h = s.page.locator('[data-testid="column-header"][data-col="createdAt"]');
    const v = {
      ariaSort: await h.getAttribute('aria-sort'),
      weight: await h.evaluate((e) => getComputedStyle(e).fontWeight),
      color: await h.evaluate((e) => getComputedStyle(e).color),
      primary: await tokenColor(s.page, '--text-primary'),
      arrow: (await h.locator('.icon').boundingBox())?.width ?? null,
    };
    check('the sorted header (추가일, newest first) is primary 500 with a 12 px chevron', v.ariaSort === 'descending' && v.weight === '500' && v.color === v.primary && v.arrow === 12, v);
  });
  await guard('stripes on every second row', async () => {
    await s.page.mouse.move(5, 5);
    const bg = (i: number) => rowAt(s.page, i).evaluate((e) => getComputedStyle(e).backgroundColor);
    const v = { row0: await bg(0), row1: await bg(1), row2: await bg(2), alt: await tokenColor(s.page, '--bg-content-alt') };
    check('stripes on every second row', v.row1 === v.alt && v.row0 === v.row2 && v.row0 !== v.row1, v);
  });
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(s.page, theme);
    if (IS_MAC) await focusApp(s.app);
    await allShots(s.app, s.page, `m4-01-table-${theme}`, `library table, 48 items, default columns, ${theme}`);
  }
  await setTheme(s.page, 'light');
});

test('M4 table: selection — focused accent, unfocused neutral, the cursor rings, a real ⌘A, an inactive window', TAG, async () => {
  const fill = (i: number) => rowAt(s.page, i).evaluate((e) => getComputedStyle(e).backgroundColor);
  await guard('focused selection: accent fill and white text', async () => {
    await rowAt(s.page, 0).click();
    const v = {
      fill: await fill(0),
      accent: await tokenColor(s.page, '--accent'),
      text: await rowAt(s.page, 0).locator('[data-col="creators"]').evaluate((e) => getComputedStyle(e).color),
      onAccent: await s.page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.color = 'var(--text-on-accent)';
        document.body.append(probe);
        const c = getComputedStyle(probe).color;
        probe.remove();
        return c;
      }),
    };
    check('focused selection: accent fill and white text', v.fill === v.accent && v.text === v.onAccent, v);
  });
  await guard('multiple selection with the keyboard cursor: a 75 % white ring on the filled cursor row', async () => {
    const mod = IS_MAC ? 'Meta' : 'Control';
    await rowAt(s.page, 0).click();
    await rowAt(s.page, 2).click({ modifiers: [mod] });
    await rowAt(s.page, 5).click({ modifiers: [mod] });
    await s.page.keyboard.press('ArrowLeft'); // does nothing in the table, but it is a key: the cursor shows its ring
    const ring = await rowAt(s.page, 5).evaluate((e) => getComputedStyle(e).boxShadow);
    const selected = await s.page.locator('[data-testid="item-row"][aria-selected="true"]').count();
    check('multiple selection with the keyboard cursor: a 75 % white ring on the filled cursor row', selected === 3 && /inset/.test(ring) && ring !== 'none', { selected, ring });
    await allShots(s.app, s.page, 'm4-02-multi-light', 'three rows selected (1, 3, 6), the keyboard cursor on the sixth');
  });
  await guard('unfocused selection: neutral fill', async () => {
    await s.page.getByTestId('nav-scope-all').focus();
    const v = { fill: await fill(0), neutral: await tokenColor(s.page, '--fill-selected') };
    check('unfocused selection: neutral fill', v.fill === v.neutral, v);
    unfocusedWindowShot = (await allShots(s.app, s.page, 'm4-02-unfocused-light', 'the selection while the sidebar has the focus')).find((e) => e.kind === 'window')?.file ?? null;
  });
  if (IS_MAC) {
    // A real ⌘A meets the menu bar too (its 모두 선택 has ⌘A): either way the table takes it — every row, no page text.
    await guard('⌘A on the keyboard selects every row, not the page text', async () => {
      await rowAt(s.page, 2).click();
      await nativeKeystroke(s.app, 'a', ['command']);
      const drawn = s.page.getByTestId('item-row');
      await expect.poll(async () => s.page.locator('[data-testid="item-row"][aria-selected="true"]').count()).toBe(await drawn.count());
      const v = { drawn: await drawn.count(), pageText: await s.page.evaluate(() => getSelection()?.toString().length ?? 0) };
      check('⌘A on the keyboard selects every row, not the page text', v.drawn > 1 && v.pageText === 0, v);
    });
    await guard('inactive window: neutral selection and no cursor ring', async () => {
      await rowAt(s.page, 5).click();
      await s.page.keyboard.press('ArrowUp'); // the keyboard cursor (its ring) on row 5 again
      await s.page.keyboard.press('ArrowDown');
      // The ring must be on screen before the window loses key status, or the later "no ring" proves nothing.
      const before = await rowAt(s.page, 5).evaluate((e) => ({ focusVisible: e.hasAttribute('data-focus-visible'), ring: getComputedStyle(e).boxShadow }));
      // Points are CSS px read while the window is in front (its geometry does not change when inactive): a spot inside
      // row 5's fill away from its text and the inset ring, and the toolbar where it is empty.
      const geo = await s.page.evaluate((i) => {
        const r = document.querySelectorAll('[data-testid="item-row"]')[i]!.getBoundingClientRect();
        return { width: innerWidth, row: [r.right - 8, r.top + r.height / 2] as [number, number] };
      }, 5);
      await bringFinderToFront();
      await expect(s.page.locator('html')).toHaveAttribute('data-window-inactive', '', { timeout: 5_000 });
      await sleep(500); // the web content repaints as inactive; a capture taken sooner shows the last active frame
      const shot = await nativeWindowShot(s.app, 'm4-02-inactive-light', 'library table, window inactive (Finder in front)', { focus: false });
      const ring = await rowAt(s.page, 5).evaluate((e) => getComputedStyle(e).boxShadow);
      const neutral = await tokenColor(s.page, '--fill-selected');
      const chrome = await tokenColor(s.page, '--bg-chrome-inactive');
      const img = shot.file ? decodePng(fs.readFileSync(path.join(EVIDENCE_ROOT, shot.file))) : null;
      const scale = img ? img.width / geo.width : 1;
      const rowPoint = [Math.round(geo.row[0] * scale), Math.round(geo.row[1] * scale)] as const;
      const toolbarPoint = [Math.round(600 * scale), Math.round(26 * scale)] as const;
      const [rowPixel, toolbarPixel] = shot.file ? await pngPixels(s.page, shot.file, [rowPoint, toolbarPoint]) : [null, null];
      // --fill-selected is translucent, so its token string cannot be compared with a drawn pixel. The reference is the
      // neutral selection as drawn in the unfocused capture (same window, same rows selected, so the same spot).
      const referencePixel = shot.file && unfocusedWindowShot ? (await pngPixels(s.page, unfocusedWindowShot, [rowPoint]))[0] ?? null : null;
      const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const near = (px: number[] | null | undefined, want: readonly number[] | null) => !!px && !!want && want.length === 3 && px.every((v, k) => Math.abs(v - want[k]!) <= 3);
      const v = { before, ring, neutral, chrome, scale, rowPoint, toolbarPoint, rowPixel, toolbarPixel, referencePixel };
      const ringWasDrawn = before.focusVisible || before.ring !== 'none';
      check('inactive window: neutral selection and no cursor ring', ringWasDrawn && ring === 'none' && near(rowPixel, referencePixel) && near(toolbarPixel, rgb(chrome)), v);
      await bringAppToFront(s.app);
    });
  }
});

test('M4 table: the column header menu — every column, the shown ones checked, 제목 fixed, then 열 구성 되돌리기', TAG, async () => {
  const yearHeader = s.page.locator('[data-testid="column-header"][data-col="year"]');
  if (IS_MAC) {
    // The real native menu (no stub): open it, capture the screen, close it with esc.
    await guard('column menu: the real native menu was captured', async () => {
      await focusApp(s.app);
      const box = (await yearHeader.boundingBox())!;
      await s.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
      await sleep(1200);
      const shot = await fullScreenShot('m4-03-column-menu', 'the column header menu (native, check marks)');
      await pressEscape();
      check('column menu: the real native menu was captured', shot.file !== null, shot);
    });
  }
  await guard('column menu: every catalogue column, the shown ones checked, 제목 fixed, then 열 구성 되돌리기', async () => {
    await stubContextMenu(s.app, null);
    await yearHeader.click({ button: 'right' });
    await expect.poll(async () => (await recordedPopups(s.app)).length).toBe(1);
    const items = (await recordedPopups(s.app))[0]!.map((i) => [i.type === 'separator' ? '-' : i.label, i.checked, i.enabled]);
    const want = [
      ...LIBRARY_COLUMNS.map((c) => [c.label, c.defaultVisible, c.required !== true]),
      ['-', false, true],
      ['열 구성 되돌리기', false, true],
    ];
    results['columnMenu'] = items;
    check('column menu: every catalogue column, the shown ones checked, 제목 fixed, then 열 구성 되돌리기', JSON.stringify(items) === JSON.stringify(want), { items, want });
  });
});

// The selection's commands. On macOS: the 파일 menu with one selected row and with none, a real ⇧⌘R
// (System Events), the ⌘/ sheet's 자료 group. Elsewhere the same states through the menu path, captures skipped.
test('M4 library: 파일 › Finder에서 보기 ⇧⌘R and 기본 앱으로 열기 with one selected row and with none; a real ⇧⌘R; ⌘/ lists it under 자료', TAG, async () => {
  test.setTimeout(180_000);
  const v: Record<string, unknown> = {};
  results['selection'] = v;
  await s.app.evaluate(({ shell }) => {
    const g = globalThis as { __learnShell?: Array<[string, string]> };
    g.__learnShell = [];
    shell.showItemInFolder = (p: string) => void g.__learnShell!.push(['reveal', p]);
    shell.openPath = async (p: string) => {
      g.__learnShell!.push(['open', p]);
      return '';
    };
  });
  const shellCalls = () => s.app.evaluate(() => (globalThis as { __learnShell?: Array<[string, string]> }).__learnShell ?? []);
  const fileItems = async () => [await menuItemEnabled(s.app, 'item.showInFolder'), await menuItemEnabled(s.app, 'item.openExternally')];
  // A row of its own, whatever the session already holds (same content: allowDuplicate).
  const imported = await s.page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'managed', allowDuplicate: true }), PDF);
  const id = imported.ok && imported.data[0]?.status === 'imported' ? imported.data[0].item.id : null;
  check('selection: a row to select was imported', id !== null, imported.ok ? imported.data.map((o) => o.status) : imported.code);
  if (id === null) return void save();
  const row = s.page.locator(`[data-testid="item-row"][data-item-id="${id}"]`);
  const pid = s.app.process().pid!;

  await guard('selection: one selected row enables both 파일 items', async () => {
    await row.click();
    await expect.poll(() => menuItemEnabled(s.app, 'item.showInFolder')).toBe(true);
    v['enabledWithOne'] = await fileItems();
    check('selection: one selected row enables both 파일 items', (v['enabledWithOne'] as boolean[]).every(Boolean), v['enabledWithOne']);
  });
  if (IS_MAC) {
    await guard('selection: the 파일 menu with one selected row', async () => {
      await bringAppToFront(s.app);
      const captured = await captureOpenMenu(s.app, pid, 3, 'm4-04-menu-file-one', '파일 menu, one selected row');
      const names = captured.keyboard.open.names ?? [];
      // The capture closes the menu with Escape keys; one that reaches the page clears the table selection.
      const selectedAfterMenu = (await row.getAttribute('aria-selected')) === 'true';
      v['fileMenuOne'] = { names, selectedAfterMenu, shots: [captured.click.shot, captured.keyboard.shot] };
      check('selection: 파일 lists Finder에서 보기 and 기본 앱으로 열기', names.includes('Finder에서 보기') && names.includes('기본 앱으로 열기'), v['fileMenuOne']);
    });
    await guard('selection: a real ⇧⌘R reveals the selected row', async () => {
      // Own precondition: the previous guard's menu capture may have cleared the selection.
      await row.click();
      await expect(row).toHaveAttribute('aria-selected', 'true');
      const before = (await shellCalls()).length;
      let note: string | undefined;
      try {
        await bringAppToFront(s.app);
        await nativeKeystroke(s.app, 'r', ['shift', 'command']);
      } catch (e) {
        if (!(e instanceof NativeInputNotPermitted)) throw e;
        note = 'keystroke not permitted: ran from the menu instead';
        await runMenuCommand(s.app, 'item.showInFolder');
      }
      await expect.poll(async () => (await shellCalls()).length, { timeout: 5_000 }).toBeGreaterThan(before);
      const call = (await shellCalls())[before];
      v['realShiftCmdR'] = { native: note === undefined, kind: call?.[0] ?? null, namedCopy: /[\\/]sample\.pdf$/.test(call?.[1] ?? ''), ...(note ? { note } : {}) };
      check('selection: ⇧⌘R reveals the selected row', call?.[0] === 'reveal' && /[\\/]sample\.pdf$/.test(call[1]), v['realShiftCmdR']);
    });
  } else {
    await runMenuCommand(s.app, 'item.showInFolder');
    await expect.poll(async () => (await shellCalls()).length).toBeGreaterThan(0);
  }
  await guard('selection: no selected row greys both 파일 items', async () => {
    // Own precondition: a selected row, so the modifier-click below toggles it off rather than on.
    if ((await row.getAttribute('aria-selected')) !== 'true') await row.click();
    await expect(row).toHaveAttribute('aria-selected', 'true');
    await row.click({ modifiers: [IS_MAC ? 'Meta' : 'Control'] }); // toggles the one selected row off
    await expect(row).not.toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => menuItemEnabled(s.app, 'item.showInFolder')).toBe(false);
    v['enabledWithNone'] = await fileItems();
    check('selection: no selected row greys both 파일 items', (v['enabledWithNone'] as boolean[]).every((e) => !e), v['enabledWithNone']);
    if (IS_MAC) {
      const captured = await captureOpenMenu(s.app, pid, 3, 'm4-04b-menu-file-none', '파일 menu, nothing selected');
      v['fileMenuNone'] = { names: captured.keyboard.open.names, shots: [captured.click.shot, captured.keyboard.shot] };
    }
  });
  await guard('selection: ⌘/ lists ⇧⌘R under 자료', async () => {
    const sheet = await expectWindow(s.app, 'sheet', () => runMenuCommand(s.app, 'app.shortcuts'));
    const rows = await sheet.locator('section[aria-label="자료"] [data-testid="shortcut-row"]').evaluateAll((els) => els.map((e) => e.textContent ?? ''));
    v['sheetItemGroup'] = rows;
    check('selection: ⌘/ lists ⇧⌘R under 자료', rows.length === 1 && rows[0]!.startsWith(IS_MAC ? 'Finder에서 보기' : '폴더에서 보기'), rows);
    // Two columns, groups whole, and a natural height that fits a 1440 × 900 Mac's ≈ 806 pt parent (room 774).
    const layout = await sheet.evaluate(() => ({
      columns: [...document.querySelectorAll('.shortcut-column')].map((c) => [...c.querySelectorAll('section')].map((g) => g.getAttribute('aria-label'))),
      natural: Math.ceil(document.querySelector('[data-sheet-root]')!.getBoundingClientRect().height),
    }));
    v['sheetLayout'] = layout;
    check('selection: the ⌘/ sheet has two columns and fits the 806 pt room', layout.columns.length === 2 && layout.natural <= 774, layout);
    if (IS_MAC) await fullScreenShot('m4-04c-sheet-shortcuts', '⌘/ sheet: two columns, the 자료 group after 라이브러리');
    await closeSheet(sheet, 'Escape');
  });
  save();
});

// Quick search. On macOS a real ⌘F (System Events), the 편집 menu with 빠른 검색; on every platform the 초성
// result with its count and mark, and the no-results state in dark (page shots; window and screen shots on macOS).
test('M4 library: quick search — a real ⌘F, 초성 ㅅㅎ with the count and the mark, 편집 › 빠른 검색, no results in dark', TAG, async () => {
  test.setTimeout(180_000);
  const v: Record<string, unknown> = {};
  results['search'] = v;
  const field = s.page.getByTestId('search-field').locator('input');
  const imported = await s.page.evaluate((p) => window.learn.library.import({ paths: [p], mode: 'managed', allowDuplicate: true }), PDF);
  const id = imported.ok && imported.data[0]?.status === 'imported' ? imported.data[0].item.id : null;
  check('search: a row to find was imported', id !== null, imported.ok ? imported.data.map((o) => o.status) : imported.code);
  if (id === null) return void save();
  await seedMetadata(s.page, id, { creators: [{ name: '김철수', role: 'author' }], date: '2024' }, '세포 신호 전달 개요');
  const row = s.page.locator(`[data-testid="item-row"][data-item-id="${id}"]`);
  await expect(row).toBeVisible();
  const theme = (shade: 'light' | 'dark') => s.page.evaluate((t) => window.learn.prefs.set({ theme: t }), shade).then(() => expect.poll(() => s.page.evaluate(() => document.documentElement.dataset['theme'])).toBe(shade));

  await guard('search: ⌘F focuses the quick search field', async () => {
    let note: string | undefined;
    if (IS_MAC) {
      try {
        await bringAppToFront(s.app);
        await nativeKeystroke(s.app, 'f', ['command']);
      } catch (e) {
        if (!(e instanceof NativeInputNotPermitted)) throw e;
        note = 'keystroke not permitted: ran from the menu instead';
        await runMenuCommand(s.app, 'library.find');
      }
    } else await runMenuCommand(s.app, 'library.find');
    await expect(field).toBeFocused({ timeout: 5_000 });
    v['cmdF'] = { native: IS_MAC && note === undefined, ...(note ? { note } : {}) };
    check('search: ⌘F focuses the quick search field', true, v['cmdF']);
  });
  await guard('search: 초성 ㅅㅎ finds the row and marks 신호', async () => {
    await field.fill('ㅅㅎ');
    await expect(row.locator('mark')).toHaveText('신호');
    const count = await s.page.getByTestId('toolbar-count').textContent();
    v['initials'] = { count, mark: await row.locator('mark').textContent() };
    await allShots(s.app, s.page, 'm4-05-search-initials', 'quick search: 초성 ㅅㅎ, the count and the title mark');
    check('search: 초성 ㅅㅎ finds the row and marks 신호', /^\d+개 \/ \d+개$/.test(count ?? ''), v['initials']);
  });
  if (IS_MAC) {
    await guard('search: 편집 lists 빠른 검색', async () => {
      const captured = await captureOpenMenu(s.app, s.app.process().pid!, 4, 'm4-05b-menu-edit', '편집 menu: 빠른 검색 after the system items');
      const names = captured.keyboard.open.names ?? [];
      v['editMenu'] = { names, shots: [captured.click.shot, captured.keyboard.shot] };
      check('search: 편집 lists 빠른 검색', names.includes('빠른 검색'), v['editMenu']);
    });
  }
  await guard('search: no results in dark says which query', async () => {
    await theme('dark');
    await field.fill('효소 억제제');
    await expect(s.page.getByTestId('search-empty')).toBeVisible();
    const title = await s.page.getByTestId('search-empty').locator('.pe-title').textContent();
    v['none'] = { title };
    await allShots(s.app, s.page, 'm4-05c-search-none-dark', 'quick search: no results, dark');
    check('search: no results in dark says which query', title === '‘효소 억제제’\u2060와 일치하는 자료가 없습니다', v['none']);
  });
  await field.fill('');
  await theme('light');
  save();
});

// Later M4 tasks add their tests here, above the verdict.

test('M4 library: the item panel — its fold at this width, ⌥⌘I from a real keystroke, one item, none, several; the 보기 menu', TAG, async () => {
  const page = s.page;
  const state = () => page.getByTestId('shell').getAttribute('data-inspector');
  const inspector: Record<string, unknown> = {};
  results['inspector'] = inspector;
  // Its own PDF (unique bytes after %%EOF, as perf.evidence does): the session may hold sample.pdf already.
  const src = path.join(os.tmpdir(), `learn-m4-inspector-${process.pid}.pdf`);
  fs.writeFileSync(src, Buffer.concat([fs.readFileSync(PDF), Buffer.from('\n% inspector evidence\n')]));
  const [item] = await importPaths(page, [src]);
  await seedMetadata(page, item!.id, { creators: [{ name: '한서진', role: 'author' }], date: '2024', publisher: '학습출판' });
  const width = await page.evaluate(() => innerWidth);
  const fits = width >= 240 + 520 + 320;
  await expect.poll(state).toBe(fits ? 'shown' : 'hidden');
  inspector['innerWidth'] = width;
  inspector['defaultState'] = await state();
  check('inspector: shown exactly when 240 + 520 + 320 fit (it folds before the sidebar)', (await state()) === (fits ? 'shown' : 'hidden'), { width, state: await state() });

  await guard('inspector: ⌥⌘I reaches the 보기 item and toggles the panel', async () => {
    const before = await state();
    let native = true;
    if (IS_MAC) {
      try {
        await nativeKeystroke(s.app, 'i', ['option', 'command']);
      } catch (e) {
        if (!(e instanceof NativeInputNotPermitted)) throw e;
        native = false;
        await runMenuCommand(s.app, 'view.toggleInspector');
      }
    } else {
      native = false;
      await runMenuCommand(s.app, 'view.toggleInspector');
    }
    await expect.poll(state).not.toBe(before);
    const after = await state();
    inspector['keystroke'] = { native, before, after };
    check('inspector: ⌥⌘I reaches the 보기 item and toggles the panel', before !== after && (before === 'shown' || before === 'hidden') && (after === 'shown' || after === 'hidden'), inspector['keystroke']);
  });
  if ((await state()) !== 'shown') await runMenuCommand(s.app, 'view.toggleInspector'); // on demand at 1024 px
  await expect.poll(state).toBe('shown');

  // The new item is the newest row (index 0): the table (its own scroll view) back at the top, where the virtualizer draws it.
  await page.getByTestId('library-scroller').evaluate((grid) => grid.scrollTo(0, 0));
  await selectRows(page, [path.parse(src).name]);
  await expect(page.getByTestId('inspector-kind')).toHaveText('PDF · 3쪽');
  const vw = await page.evaluate(() => innerWidth);
  const panel = (await page.getByTestId('inspector-panel').boundingBox())!;
  const toolbar = (await page.getByTestId('toolbar').boundingBox())!;
  inspector['geometry'] = { panel, toolbarRight: toolbar.x + toolbar.width, vw };
  check('inspector: under the 52 px toolbar, flush with the right edge, the toolbar over both', Math.round(panel.y) === 52 && Math.round(panel.x + panel.width) === vw && Math.round(toolbar.x + toolbar.width) === vw, inspector['geometry']);
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await allShots(s.app, page, `m4-inspector-item-${theme}`, `item panel, one PDF with info (${theme})`);
  }
  await setTheme(page, 'light');
  // esc on the table clears the selection, the cursor stays: the key goes to the cursor row (the roving stop).
  const cursorRow = page.locator('[data-testid="item-row"][tabindex="0"]');
  await cursorRow.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('inspector-none')).toBeVisible();
  await allShots(s.app, page, 'm4-inspector-none-light', 'item panel, nothing selected (light)');
  // The first three rows in the table's order (data-index; the DOM order of a virtualized body is not the visual one).
  const titles = (await Promise.all([0, 1, 2].map((i) => rowAt(page, i).getAttribute('data-title')))).filter((x): x is string => x !== null);
  // By position, not title: the session's seeded rows share titles.
  await rowAt(page, 0).click();
  for (const i of [1, 2]) await rowAt(page, i).click({ modifiers: [IS_MAC ? 'Meta' : 'Control'] });
  await expect(page.getByTestId('multi-row')).toHaveCount(titles.length);
  await allShots(s.app, page, 'm4-inspector-multi-light', `item panel, ${titles.length} selected (light)`);

  if (IS_MAC) {
    await guard('inspector: 보기 lists 항목 패널 가리기 with ⌥⌘I, and no 개발자 도구', async () => {
      const pid = s.app.process().pid!;
      inspector['menuView'] = { ...(await captureOpenMenu(s.app, pid, 5, 'm4-inspector-menu-view', '보기 open: 항목 패널 가리기 ⌥⌘I after 사이드바 가리기')), names: await menuItemNames(pid, 5) };
      const names = (inspector['menuView'] as { names: string[] | null }).names ?? [];
      check('inspector: 보기 lists 항목 패널 가리기 with ⌥⌘I, and no 개발자 도구', names.includes('항목 패널 가리기') && !names.includes('개발자 도구'), names);
    });
  }
  // Leave the session as it was for the tests after this one: default panel state, nothing selected (esc on the table).
  await cursorRow.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-testid="item-row"][aria-selected="true"]')).toHaveCount(0);
  if ((await state()) !== inspector['defaultState']) await runMenuCommand(s.app, 'view.toggleInspector');
  fs.rmSync(src, { force: true });
  save();
});

test('M4 library: 정보 편집 — the form in place, ⌘↩ from a real keystroke, a marked field; ⌘W and ⌘Q refused over it', TAG, async () => {
  const page = s.page;
  const state = () => page.getByTestId('shell').getAttribute('data-inspector');
  const edit: Record<string, unknown> = {};
  results['inspectorEdit'] = edit;
  const src = path.join(os.tmpdir(), `learn-m4-edit-${process.pid}.pdf`);
  fs.writeFileSync(src, Buffer.concat([fs.readFileSync(PDF), Buffer.from('\n% edit evidence\n')]));
  const [item] = await importPaths(page, [src]);
  const title = path.parse(src).name;
  const publisher = async () =>
    page.evaluate(async (id) => {
      const r = await window.learn.library.detail({ itemId: id });
      return r.ok ? (r.data.metadata.publisher ?? null) : null;
    }, item!.id);
  // The new item is the newest row (index 0): the table (its own scroll view) at the top, where the virtualizer draws it.
  await page.getByTestId('library-scroller').evaluate((grid) => grid.scrollTo(0, 0));
  await selectRows(page, [title]);
  const shownBefore = (await state()) === 'shown';
  if (!shownBefore) await runMenuCommand(s.app, 'view.toggleInspector'); // the 1024 px runner folds it
  await page.getByTestId('info-edit').click();
  await page.locator('[data-testid="editor-field"][data-field="publisher"] input').fill('학습출판');
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await allShots(s.app, page, `m4-inspector-edit-${theme}`, `정보 편집, the form in place (${theme})`);
  }
  await setTheme(page, 'light');

  await guard('edit: ⌘↩ saves', async () => {
    let native = false;
    if (IS_MAC) {
      try {
        await nativeKeyCode(s.app, KEY_CODE.return, ['command']);
        native = true;
      } catch (e) {
        if (!(e instanceof NativeInputNotPermitted)) throw e;
        await page.keyboard.press('Meta+Enter');
      }
    } else {
      await page.keyboard.press('Control+Enter');
    }
    await expect(page.getByTestId('info-editor')).toHaveCount(0);
    edit['saveKey'] = { native, publisher: await publisher() };
    check('edit: ⌘↩ saves', (await publisher()) === '학습출판', edit['saveKey']);
  });

  await page.getByTestId('info-edit').click();
  await page.locator('[data-testid="editor-field"][data-field="date"] input').fill('2024-13');
  // Another row: the one beside the edited item in the table's order (data-index, not the DOM order); its press asks
  // the edit, which refuses and brings the selection back.
  const besideMine = (await rowAt(page, 0).getAttribute('data-title')) === title ? 1 : 0;
  await rowAt(page, besideMine).click();
  await expect(page.getByTestId('editor-unsaved')).toBeVisible();
  await allShots(s.app, page, 'm4-inspector-edit-invalid-light', '정보 편집, a marked date and the unsaved line (light)');

  await guard('edit: closing the window over a marked field keeps it open', async () => {
    let native = false;
    if (IS_MAC) {
      try {
        await nativeKeystroke(s.app, 'w', ['command']); // 윈도우 닫기 ⌘W
        native = true;
      } catch (e) {
        if (!(e instanceof NativeInputNotPermitted)) throw e;
        await (await mainWindow(s.app)).evaluate((w) => w.close());
      }
    } else {
      await (await mainWindow(s.app)).evaluate((w) => w.close());
    }
    await page.waitForTimeout(500);
    const open = await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().includes('window=main')));
    edit['closeGuard'] = { native, open };
    check('edit: closing the window over a marked field keeps it open', open, edit['closeGuard']);
  });
  // ⌘Q over the marked field: main's flush calls the quit off (edit-flush.ts). Were it to quit, this session ends here —
  // the failed check then explains the tests that fail after it.
  await guard('edit: quitting over a marked field is called off (the app stays)', async () => {
    let native = false;
    if (IS_MAC) {
      try {
        await nativeKeystroke(s.app, 'q', ['command']); // Learn 종료 ⌘Q
        native = true;
      } catch (e) {
        if (!(e instanceof NativeInputNotPermitted)) throw e;
        await s.app.evaluate(({ app: electronApp }) => electronApp.quit());
      }
    } else {
      await s.app.evaluate(({ app: electronApp }) => electronApp.quit());
    }
    await page.waitForTimeout(500);
    const alive = await s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.webContents.getURL().includes('window=main')));
    edit['quitGuard'] = { native, alive, flushLog: await s.app.evaluate(() => (globalThis as { __learnEditFlushLog?: unknown[] }).__learnEditFlushLog ?? []) };
    check('edit: quitting over a marked field is called off (the app stays)', alive, edit['quitGuard']);
  });
  await page.getByTestId('editor-discard').click();
  await expect(page.getByTestId('info-editor')).toHaveCount(0);
  if (!shownBefore) await runMenuCommand(s.app, 'view.toggleInspector');
  fs.rmSync(src, { force: true });
  save();
});

// 사본 내보내기 (spec 7) and the busy toast, in a session of its own: the save panel is held, then the copy.
test('M4 library: 사본 내보내기… — the default name, nothing partial at the chosen path, no busy toast under the panel, 내보내는 중… after it', TAG, async ({}, testInfo) => {
  const dir = testInfo.outputPath('export');
  // A second profile beside the shared session (as shell.evidence.ts does): the shared window is hidden meanwhile — both
  // open at the same place, and Chromium stops drawing the occluded one (a blank capture).
  const shared = await mainWindow(s.app);
  await shared.evaluate((w) => w.hide());
  const x = await launch(path.join(dir, 'library'), path.join(dir, 'userdata'), { colorScheme: null });
  const value: Record<string, unknown> = {};
  results['export'] = value;
  try {
    await setTheme(x.page, 'light'); // the captures below are named light
    const [item] = await importPaths(x.page, [path.join(FIXTURES, 'sample.pdf')]);
    await x.page.evaluate((itemId) => window.learn.library.updateMetadata({ itemId, title: '세포 신호: 개요' }), item!.id);
    const out = path.join(dir, 'exports');
    fs.mkdirSync(out, { recursive: true });
    const chosen = path.join(out, '세포 신호 개요.pdf');
    await stubShell(x.app);
    await holdSaveDialog(x.app, chosen);
    await rowByTitle(x.page, '세포 신호: 개요').click();
    await runMenuCommand(x.app, 'item.exportCopy');
    await guard('export: the save panel opens as a sheet on the title-named default in Downloads', async () => {
      await expect.poll(() => saveDialogCalls(x.app)).toBe(1);
      const [call] = await saveDialogLog(x.app);
      const downloads = await x.app.evaluate(({ app }) => app.getPath('downloads'));
      const v = { name: call?.defaultPath ? path.basename(call.defaultPath) : null, inDownloads: call?.defaultPath ? path.dirname(call.defaultPath) === downloads : false, sheet: call?.parent ?? false };
      value['panel'] = v;
      check('export: the save panel opens as a sheet on the title-named default in Downloads', v.name === '세포 신호 개요.pdf' && v.inDownloads && v.sheet, v);
    });
    await guard('export: no busy toast while the save panel is up', async () => {
      await x.page.waitForTimeout(800);
      const shown = await x.page.getByTestId('file-busy').count();
      value['busyUnderPanel'] = shown;
      check('export: no busy toast while the save panel is up', shown === 0, { shown });
    });
    await holdCopies(x.app);
    const released = Date.now();
    await releaseSaveDialog(x.app);
    await guard('export: 내보내는 중… from 300 ms after the panel closed, while the copy runs', async () => {
      await expect(x.page.getByTestId('file-busy')).toBeVisible({ timeout: 5_000 });
      const ms = Date.now() - released;
      value['busyShownMs'] = ms;
      check('export: 내보내는 중… from 300 ms after the panel closed, while the copy runs', ms >= 280 && ms <= 2_000, { ms });
    });
    await allShots(x.app, x.page, 'm4-08-export-busy', '사본 내보내기: 내보내는 중… while the copy runs (light)');
    await guard('export: nothing at the chosen path before the copy is whole', async () => {
      const there = fs.existsSync(chosen);
      value['partialAtChosenPath'] = there;
      check('export: nothing at the chosen path before the copy is whole', !there, { there });
    });
    await releaseCopies(x.app);
    await guard('export: 사본을 저장했습니다, and its Finder에서 보기 reveals the saved copy', async () => {
      const done = x.page.getByTestId('export-done');
      await expect(done).toBeVisible({ timeout: 10_000 });
      await allShots(x.app, x.page, 'm4-08-export-done', '사본 내보내기: 사본을 저장했습니다 with Finder에서 보기 (light)');
      const label = await done.getByTestId('export-reveal').textContent();
      await done.getByTestId('export-reveal').click();
      await expect.poll(async () => (await shellCalls(x.app)).length).toBe(1);
      const [reveal] = await shellCalls(x.app);
      const v = { left: fs.readdirSync(out), label, revealedTheCopy: reveal?.[0] === 'reveal' && reveal[1] === chosen };
      value['saved'] = v;
      check('export: 사본을 저장했습니다, and its Finder에서 보기 reveals the saved copy', v.left.length === 1 && v.left[0] === '세포 신호 개요.pdf' && v.revealedTheCopy, v);
    });
  } finally {
    save();
    await x.app.close();
    await shared.evaluate((w) => w.show()); // the shared session goes on for the tests after this one
  }
});

// ⌘K finds items (spec §4.4, design-spec 10.5), in the shared session: a second app could not be brought to the front on
// the Mac (both processes are the same bundle, the shared one stayed frontmost). The seeded titles hold
// 신호 too, so three PDFs with a word of their own (형광) are imported and searched; the last one heads the list, which
// is what the hint's 초성 example comes from (palette/items.ts initialsExample).
test('M4 library: ⌘K finds items — 자료 above 명령, 라이브러리에서 검색 last, the launcher says 검색 및 명령', TAG, async ({}, testInfo) => {
  const dir = testInfo.outputPath('palette');
  const value: Record<string, unknown> = {};
  results['paletteItems'] = value;
  const palette = s.page.getByTestId('palette');
  const theme = await s.page.locator('html').getAttribute('data-theme');
  await setTheme(s.page, 'light');
  try {
    const media = path.join(dir, 'media');
    fs.mkdirSync(media, { recursive: true });
    const files = ['현미경 6장 · 형광 영상', '세포 형광 그림 모음', '형광 증폭의 정량 모델'].map((title) => {
      const p = path.join(media, `${title}.pdf`);
      fs.writeFileSync(p, `%PDF-1.4\n% ${title}\n%%EOF\n`);
      return p;
    });
    await importPaths(s.page, files);
    await guard('palette: the launcher says 검색 및 명령', async () => {
      const text = (await s.page.getByTestId('launcher').textContent()) ?? '';
      value['launcher'] = text;
      check('palette: the launcher says 검색 및 명령', text.includes('검색 및 명령'), { text });
    });
    let via = 'menu';
    if (IS_MAC) {
      await bringAppToFront(s.app).catch(() => {});
      try {
        await nativeKeystroke(s.app, 'k', ['command']);
        via = 'keystroke';
      } catch (e) {
        if (!(e instanceof NativeInputNotPermitted)) throw e;
        await runMenuCommand(s.app, 'app.palette');
      }
    } else await runMenuCommand(s.app, 'app.palette');
    await expect(palette).toBeVisible({ timeout: 5_000 });
    await expect(s.page.getByTestId('palette-input')).toBeFocused({ timeout: 5_000 });
    await s.page.keyboard.insertText('형광');
    await guard('palette: 자료 above 명령, the cursor on the first item, 라이브러리에서 ‘신호’ 검색 last', async () => {
      await expect(s.page.getByTestId('palette-result')).toHaveCount(3, { timeout: 5_000 });
      const v = {
        via,
        groups: await s.page.locator('.palette .p-group').allTextContents(),
        cursorOnItem: (await s.page.locator('.palette [role="option"][data-focused]').getAttribute('data-testid')) === 'palette-result',
        lastIsSearch: (await s.page.locator('.palette [role="option"]').last().getAttribute('data-testid')) === 'palette-search-library',
        hint: (await s.page.locator('.p-foot').textContent()) ?? '',
      };
      value['results'] = v;
      check('palette: 자료 above 명령, the cursor on the first item, 라이브러리에서 ‘신호’ 검색 last', v.groups.join('|') === '자료|명령' && v.cursorOnItem && v.lastIsSearch, v);
      check('palette: the 초성 hint comes from the library (ㅅㅎ → 신호)', v.hint.includes('ㅎㄱ → 형광'), { hint: v.hint });
    });
    await allShots(s.app, s.page, 'm4-09-palette-items', '⌘K 형광: 자료 above 명령 (light)');
    if (IS_MAC) {
      await setTheme(s.page, 'dark');
      await nativeWindowShot(s.app, 'm4-09-palette-items-dark', '⌘K 형광: 자료 above 명령 (dark)');
      await setTheme(s.page, 'light');
    }
    await s.page.getByTestId('palette-input').fill('쥐똥나무 열매');
    await guard('palette: with no match the notice and the search row stay', async () => {
      await expect(s.page.getByTestId('palette-empty')).toBeVisible({ timeout: 5_000 });
      const v = { searchRow: await s.page.getByTestId('palette-search-library').count(), foot: await s.page.locator('.p-foot .row').allTextContents() };
      value['none'] = v;
      check('palette: with no match the notice and the search row stay', v.searchRow === 1 && v.foot.length === 2, v);
    });
    await allShots(s.app, s.page, 'm4-09-palette-none', '⌘K 쥐똥나무 열매: the notice above 라이브러리에서 검색 (light)');
    await s.page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  } finally {
    save();
    if (theme === 'dark') await setTheme(s.page, 'dark');
  }
});

test('M4 library: verdict of every check above (m4-library.json checks)', TAG, async () => {
  save();
  for (const [name, c] of Object.entries(checks)) expect.soft(c.ok, `${name}: ${JSON.stringify(c.value)}`).toBe(true);
});
