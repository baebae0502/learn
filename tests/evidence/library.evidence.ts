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
  FIXTURES, NativeInputNotPermitted, bringAppToFront, bringFinderToFront, closeSheet, expectWindow, importPaths, launch, menuItemEnabled, nativeKeystroke,
  recordedPopups, rowAt, runMenuCommand, seedLibrary, stubContextMenu, type Session,
} from '../e2e/helpers';
import { LIBRARY_COLUMNS } from '../../packages/domain/src/library-columns';
import { EVIDENCE_ROOT, IS_MAC, allShots, captureOpenMenu, focusApp, fullScreenShot, movePointer, nativeWindowShot, pngPixels, pressEscape, writeJson } from './capture';
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
    await s.page.getByTestId('nav-library').focus();
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

// Later M4 tasks add their tests here, above the verdict.

test('M4 library: verdict of every check above (m4-library.json checks)', TAG, async () => {
  save();
  for (const [name, c] of Object.entries(checks)) expect.soft(c.ok, `${name}: ${JSON.stringify(c.value)}`).toBe(true);
});
