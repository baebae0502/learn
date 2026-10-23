// @perf — M4 Task 1 table spike (branch m4-spike only, never merged): RAC Table + Virtualizer + TableLayout over
// 10,000 synthetic rows (?window=spike). Every behaviour of spec 3.3 and the budgets of spec 3.4 / 9 that the table
// alone decides, on this machine, into table-spike.json for ADR-0004 "M4 표". Report only: no check fails the run;
// the verdict is the JSON's.
import { expect, test } from '@playwright/test';
import type { SpikeSortColumn } from '../../apps/desktop/src/renderer/src/spike/rows';
import { NativeInputNotPermitted, launch, nativeKeystroke, type Session } from '../e2e/helpers';
import { IS_MAC, pageShot } from './capture';
import {
  BUDGET, MOD, N, ROWS, armVisible, createReport, focusedIndex, frames, framesOk, grid, header, limit, markAfter, measureFilter, measureMount, measureRefresh,
  measureScroll, measureSort, openSpike, pct, r1, rowAt, selectedIds, startFrames, stats, stopFrames, timed, visibleAfterInput,
} from './spike-measure';

const TAG = { tag: '@perf' };
const report = createReport('rac', 'table-spike.json', 'M4 Task 1 table spike: RAC Table + Virtualizer, 10,000 rows (ADR-0004 M4 표)');

test.describe.configure({ mode: 'serial' });
let s: Session;
test.beforeAll(async ({}, testInfo) => {
  s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
});
test.afterAll(async () => {
  report.save();
  await s?.app.close();
});

test('spike rac: 10,000 rows mount virtualized; list arrives → first row painted', TAG, async () => {
  test.setTimeout(120_000);
  await measureMount(s.page, report, '', 'm4-spike-01-rows');
});

test('spike rac: scroll frames (idle, 3 rows a frame, empty row slots, a jump)', TAG, async () => {
  test.setTimeout(120_000);
  await measureScroll(s.page, report, '');
});

test('spike rac: column resize — follows the pointer, one onResizeEnd on release, minimum width', TAG, async () => {
  test.setTimeout(120_000);
  await report.guard('resize', async () => {
    await openSpike(s.page);
    const width = async (col: SpikeSortColumn) => (await header(s.page, col).boundingBox())!.width;
    const before = { creators: await width('creators'), title: await width('title') };
    const drag = async (dx: number) => {
      const h = (await s.page.locator('[data-testid="column-resizer"][data-col="creators"]').boundingBox())!;
      const x = h.x + h.width / 2;
      const y = h.y + h.height / 2;
      await s.page.mouse.move(x, y);
      await s.page.mouse.down();
      await s.page.mouse.move(x + dx, y, { steps: 12 });
      const during = await s.page.evaluate(() => ({ ends: window.__spike!.resizeEnds.length, moves: window.__spike!.resizeMoves }));
      await s.page.mouse.up();
      await frames(s.page, 3);
      return during;
    };
    await startFrames(s.page);
    const during = await drag(60);
    const dragFrames = stats(await stopFrames(s.page));
    const ends = await s.page.evaluate(() => window.__spike!.resizeEnds);
    const cell = (await rowAt(s.page, 0).locator('[data-col="creators"]').boundingBox())!.width;
    const after = { creators: await width('creators'), title: await width('title'), cell };
    const overflowX = await grid(s.page).evaluate((el) => el.scrollWidth > el.clientWidth);
    await pageShot(s.page, 'm4-spike-04-resized', 'M4 spike: 저자 column 60 px wider');
    await drag(-400);
    const clamped = await width('creators');
    const ok =
      Math.abs(after.creators - before.creators - 60) <= 2 && Math.abs(after.cell - after.creators) <= 1 && during.ends === 0 && during.moves > 0 &&
      ends.length === 1 && Math.abs(clamped - 96) <= 1 && framesOk(report.idleP95, dragFrames.p95);
    report.check('resize', ok, 'native', { before, after, overflowX, during, endsAfterRelease: ends.length, firstEnd: ends[0], clampedTo: clamped, dragFrames });
  });
});

test('spike rac: header sort — order, aria-sort, header click → painted', TAG, async () => {
  test.setTimeout(120_000);
  await measureSort(s.page, report, '', 'm4-spike-02-sorted');
});

test('spike rac: multiple selection — click, ⇧click, ⌘click, ⌘A, and click → painted', TAG, async () => {
  test.setTimeout(120_000);
  await report.guard('select', async () => {
    await openSpike(s.page);
    const clickMs: number[] = [];
    for (const i of [3, 10, 15, 20, 1]) clickMs.push(await timed(s.page, 'selection', () => rowAt(s.page, i).click()));
    const counts: number[] = [];
    await rowAt(s.page, 3).click();
    counts.push((await selectedIds(s.page)).length);
    await rowAt(s.page, 8).click({ modifiers: ['Shift'] });
    counts.push((await selectedIds(s.page)).length);
    await rowAt(s.page, 12).click({ modifiers: [MOD] });
    counts.push((await selectedIds(s.page)).length);
    await rowAt(s.page, 5).click({ modifiers: [MOD] });
    counts.push((await selectedIds(s.page)).length);
    const range = await selectedIds(s.page);
    const allMs = await timed(s.page, 'selection', () => s.page.keyboard.press(`${MOD}+A`));
    counts.push((await selectedIds(s.page)).length);
    await pageShot(s.page, 'm4-spike-03-selected', 'M4 spike: every row selected (⌘A), focus in the table');
    await rowAt(s.page, 2).click();
    counts.push((await selectedIds(s.page)).length);
    const expectedRange = [3, 4, 6, 7, 8, 12].map((i) => ROWS[i]!.id);
    const clickMedian = pct(clickMs, 50);
    // The same ⇧click with the selection copied into a plain Set (a store of ids): RAC's range anchor is gone.
    await openSpike(s.page, '&selection=copy');
    await rowAt(s.page, 3).click();
    await rowAt(s.page, 8).click({ modifiers: ['Shift'] });
    const shiftWithCopiedSet = (await selectedIds(s.page)).length;
    report.check(
      'select',
      JSON.stringify(counts) === JSON.stringify([1, 6, 7, 6, N, 1]) && JSON.stringify(range) === JSON.stringify(expectedRange) && clickMedian <= limit(BUDGET.select) && allMs <= limit(BUDGET.select),
      'native',
      { counts, clickMs, clickMedianMs: clickMedian, selectAllMs: allMs, shiftClickWithCopiedSet: shiftWithCopiedSet },
    );
  });
  await report.guard('selectAllNative', async () => {
    if (!IS_MAC) return report.check('selectAllNative', true, 'skipped: macOS only (CDP keys never reach the native menu)', null);
    await rowAt(s.page, 2).click();
    try {
      await nativeKeystroke(s.app, 'a', ['command']);
    } catch (e) {
      if (e instanceof NativeInputNotPermitted) return report.check('selectAllNative', true, 'skipped: System Events refused', String(e));
      throw e;
    }
    await expect.poll(async () => (await selectedIds(s.page)).length).toBe(N);
    const pageText = await s.page.evaluate(() => getSelection()?.toString().length ?? 0);
    report.check('selectAllNative', pageText === 0, 'native', { selected: N, pageTextSelected: pageText });
  });
});

test('spike rac: right-click selects first; the menu acts on the whole selection, in table order', TAG, async () => {
  test.setTimeout(60_000);
  await report.guard('contextMenu', async () => {
    await openSpike(s.page);
    const lastMenu = () => s.page.evaluate(() => window.__spike!.menus.at(-1) ?? null);
    await rowAt(s.page, 3).click();
    await rowAt(s.page, 20).click({ button: 'right' });
    const outside = { selected: await selectedIds(s.page), menu: await lastMenu() };
    await rowAt(s.page, 3).click();
    await rowAt(s.page, 5).click({ modifiers: ['Shift'] });
    await rowAt(s.page, 4).click({ button: 'right' });
    const inside = { selected: await selectedIds(s.page), menu: await lastMenu() };
    const id = (i: number) => ROWS[i]!.id;
    report.check(
      'contextMenu',
      JSON.stringify(outside) === JSON.stringify({ selected: [id(20)], menu: [id(20)] }) && JSON.stringify(inside) === JSON.stringify({ selected: [id(3), id(4), id(5)], menu: [id(3), id(4), id(5)] }),
      'workaround: Row onContextMenu selects first (RAC presses ignore the right button)',
      { outside, inside },
    );
  });
});

test('spike rac: keyboard cursor — arrows, ⇧arrows, End (→ painted), Home, PageDown', TAG, async () => {
  test.setTimeout(60_000);
  await report.guard('keyboard', async () => {
    await openSpike(s.page);
    await rowAt(s.page, 0).click();
    for (let i = 0; i < 3; i++) await s.page.keyboard.press('ArrowDown');
    const down = { focused: await focusedIndex(s.page), selected: await selectedIds(s.page) };
    await s.page.keyboard.press('Shift+ArrowDown');
    await s.page.keyboard.press('Shift+ArrowDown');
    const extended = (await selectedIds(s.page)).length;
    // RAC as is: a click focused a cell, and from a cell Home / End stay in the row.
    await s.page.keyboard.press('End');
    await frames(s.page, 3);
    const nativeEnd = await s.page.evaluate(() => ({ row: Number(document.activeElement?.closest('[data-testid="item-row"]')?.getAttribute('aria-rowindex') ?? 0) - 2, col: document.activeElement?.getAttribute('data-col') ?? null }));
    await s.page.evaluate(() => (window.__spike!.globalHomeEnd = true));
    await armVisible(s.page, N - 1);
    await s.page.keyboard.press('End');
    const endMs = await visibleAfterInput(s.page);
    const end = { focused: await focusedIndex(s.page), selected: (await selectedIds(s.page)).length };
    await s.page.keyboard.press('Home');
    await frames(s.page, 3);
    const home = await focusedIndex(s.page);
    await s.page.keyboard.press('PageDown');
    await frames(s.page, 3);
    const pageDown = await focusedIndex(s.page);
    const pageDownVisible = pageDown !== null && (await rowAt(s.page, pageDown).isVisible());
    await s.page.keyboard.press('ArrowRight');
    const right = await s.page.evaluate(() => ({ role: document.activeElement?.getAttribute('role') ?? null, col: document.activeElement?.getAttribute('data-col') ?? null }));
    const ok =
      down.focused === 3 && JSON.stringify(down.selected) === JSON.stringify([ROWS[3]!.id]) && extended === 3 && end.focused === N - 1 && endMs <= limit(BUDGET.keyEnd) &&
      home === 0 && (pageDown ?? 0) > 1 && pageDownVisible;
    const how = nativeEnd.row === N - 1 ? 'native' : 'workaround: plain Home / End are sent on as ⌘/Ctrl+Home / End (a click focuses a cell)';
    report.check('keyboard', ok, how, { down, extended, nativeEnd, end, endMs, home, pageDown, pageDownVisible, arrowRightFocus: right });
  });
});

test('spike rac: double-click and ↩ open one row; a single click opens nothing', TAG, async () => {
  test.setTimeout(60_000);
  await report.guard('open', async () => {
    await openSpike(s.page);
    const opened = () => s.page.evaluate(() => [...window.__spike!.opened]);
    await rowAt(s.page, 9).click();
    const afterClick = (await opened()).length;
    await rowAt(s.page, 5).dblclick();
    const afterDouble = await opened();
    await s.page.keyboard.press('Enter');
    const afterEnter = await opened();
    await rowAt(s.page, 6).click();
    await rowAt(s.page, 8).click({ modifiers: ['Shift'] });
    await s.page.keyboard.press('Enter');
    const withMany = (await opened()).length - afterEnter.length;
    const id5 = ROWS[5]!.id;
    report.check('open', afterClick === 0 && JSON.stringify(afterDouble) === JSON.stringify([id5]) && JSON.stringify(afterEnter) === JSON.stringify([id5, id5]), 'native', {
      afterClick, afterDouble, afterEnter, enterWithThreeSelectedCalls: withMany,
    });
  });
});

test('spike rac: no type-ahead (RAC 1.22.1 Table drops disallowTypeAhead) — native behaviour and the capture guard', TAG, async () => {
  test.setTimeout(60_000);
  await report.guard('typeAhead', async () => {
    await openSpike(s.page);
    await rowAt(s.page, 0).click();
    await s.page.keyboard.press('z');
    await frames(s.page, 3);
    const nativeFocus = await focusedIndex(s.page);
    await s.page.evaluate(() => (window.__spike!.guardTypeAhead = true));
    await rowAt(s.page, 0).click();
    await s.page.keyboard.press('z');
    await frames(s.page, 3);
    const guardedFocus = await focusedIndex(s.page);
    await s.page.keyboard.press('ArrowDown');
    const arrowsStill = await focusedIndex(s.page);
    const nativeMoved = nativeFocus !== 0;
    report.check('typeAhead', guardedFocus === 0 && arrowsStill === 1, nativeMoved ? 'workaround: an onKeyDownCapture guard stops plain printable keys before the grid' : 'native: no type-ahead', {
      nativeMoved, nativeFocus, guardedFocus, arrowsStill,
    });
  });
});

test('spike rac: a refreshed list with one changed item re-renders that row only', TAG, async () => {
  test.setTimeout(60_000);
  await measureRefresh(s.page, report, '');
});

test('spike rac: filtering rows (a search stand-in) → painted, 10 times each way', TAG, async () => {
  test.setTimeout(60_000);
  await measureFilter(s.page, report, '');
});

test('spike rac: density — the layout takes a new row height', TAG, async () => {
  test.setTimeout(60_000);
  await report.guard('density', async () => {
    await openSpike(s.page);
    const results: Record<number, { top: number; height: number }> = {};
    for (const px of [32, 24, 28] as const) {
      const at = await s.page.evaluate((h) => window.__spike!.setRowHeight(h), px);
      await markAfter(s.page, 'density', at);
      await frames(s.page, 2);
      const g = (await grid(s.page).boundingBox())!;
      const r = (await rowAt(s.page, 10).boundingBox())!;
      results[px] = { top: r1(r.y - g.y - 28), height: r1(r.height) };
    }
    report.check('density', [32, 24, 28].every((px) => Math.abs(results[px]!.top - 10 * px) <= 1 && Math.abs(results[px]!.height - px) <= 0.5), 'native', results);
  });
});

test('spike rac: stripes — row parity from the className render prop, and data-index with TableBody dependencies', TAG, async () => {
  test.setTimeout(120_000);
  await report.guard('stripes', async () => {
    const value: Record<string, unknown> = {};
    let classOk = false;
    for (const mode of ['class', 'index'] as const) {
      await openSpike(s.page, mode === 'index' ? '&stripes=index' : '');
      const sortMs: number[] = [];
      for (const column of ['title', 'title', 'createdAt'] as const) {
        const total = await timed(s.page, 'sort', () => header(s.page, column).click());
        sortMs.push(r1(total - (await s.page.evaluate(() => window.__spike!.sortComputeMs.at(-1)!))));
      }
      await frames(s.page, 3);
      const rows = await s.page.locator('[data-testid="item-row"]').evaluateAll((els) =>
        els.map((e) => ({ index: Number(e.getAttribute('aria-rowindex')) - 2, odd: e.classList.contains('is-odd'), dataIndex: e.getAttribute('data-index') })),
      );
      const parityOk = rows.every((r) => r.odd === (r.index % 2 === 1));
      const dataIndexOk = mode === 'index' ? rows.every((r) => r.dataIndex === String(r.index)) : null;
      const before = await s.page.evaluate(() => window.__spike!.cellRenders);
      const at = await s.page.evaluate(() => window.__spike!.setRows('refresh-one'));
      const refreshMs = r1((await markAfter(s.page, 'rows', at)).at - at);
      await frames(s.page, 3);
      const refreshRenders = (await s.page.evaluate(() => window.__spike!.cellRenders)) - before;
      value[mode] = { rendered: rows.length, parityOk, dataIndexOk, sortRenderMs: sortMs, sortRenderMedianMs: pct(sortMs, 50), refreshMs, refreshRenders };
      if (mode === 'class') classOk = parityOk;
    }
    const index = value['index'] as { dataIndexOk: boolean; sortRenderMedianMs: number };
    const useIndex = index.dataIndexOk && index.sortRenderMedianMs <= limit(BUDGET.sort);
    report.check('stripes', classOk, useIndex ? 'native: data-index with TableBody dependencies is within the sort budget' : 'workaround: parity from the Row className render prop (data-index rebuilds every row)', { ...value, useIndex });
  });
});

test('spike rac: what the table puts in the tab order (F6 lands there, P-31)', TAG, async () => {
  await report.guard('focusTarget', async () => {
    await openSpike(s.page);
    const info = await grid(s.page).evaluate((el) => ({
      gridTabIndex: el.getAttribute('tabindex'),
      tabbable: [...el.querySelectorAll('[tabindex="0"]')].map((e) => ({ role: e.getAttribute('role'), rowindex: e.getAttribute('aria-rowindex'), col: e.getAttribute('data-col') })),
    }));
    report.check('focusTarget', true, 'record', info);
  });
  report.save();
});
