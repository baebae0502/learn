// Measuring helpers for the M4 Task 1 table spike (branch m4-spike only): the page's probe (window.__spike), frame
// sampling and the checks every implementation shares. Budgets are spec 9's (the Mac's); Linux is judged at the CI
// fail line, 2× (spec 9).
import fs from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { SpikeMark } from '../../apps/desktop/src/renderer/src/spike/probe';
import { makeRows, sortRows, type SpikeSortColumn } from '../../apps/desktop/src/renderer/src/spike/rows';
import { ROOT } from '../e2e/helpers';
import { IS_MAC, pageShot, writeJson } from './capture';

export const N = 10_000;
/** The same rows the page makes (rows.ts is deterministic). */
export const ROWS = makeRows(N);
export const MOD = IS_MAC ? 'Meta' : 'Control';
export const BUDGET = { firstPaint: 500, frameP95: 16.7, sort: 100, select: 100, keyEnd: 100, filterP95: 50 } as const;
export const limit = (ms: number): number => (IS_MAC ? ms : 2 * ms);

export type CheckId =
  | 'mount' | 'scroll' | 'resize' | 'sort' | 'select' | 'selectAllNative' | 'contextMenu' | 'keyboard' | 'open' | 'typeAhead'
  | 'refresh' | 'filter' | 'density' | 'stripes' | 'focusTarget';
export interface Check {
  ok: boolean;
  /** `native` (as the library does it), `workaround: …` (public API around it), `record` (no pass line), `skipped: …`, `error`. */
  how: string;
  value: unknown;
}

/** One implementation's checks and their JSON (`table-spike.json` for RAC). Nothing here fails the run. */
export function createReport(impl: 'rac' | 'tanstack', file: string, description: string) {
  const checks: Partial<Record<CheckId, Check>> = {};
  let windowInfo: unknown = null;
  /** The frame rule's baseline: this machine's p95 with nothing moving. */
  let idleP95 = Number.NaN;
  const check = (id: CheckId, ok: boolean, how: string, value: unknown): void => void (checks[id] = { ok, how, value });
  return {
    check,
    /** A throw is a failed check, so every other check still runs and the JSON says what broke. */
    async guard(id: CheckId, run: () => Promise<void>): Promise<void> {
      try {
        await run();
      } catch (e) {
        check(id, false, 'error', { error: String(e).slice(0, 800) });
      }
    },
    setWindow: (info: unknown) => void (windowInfo = info),
    get idleP95() {
      return idleP95;
    },
    set idleP95(v: number) {
      idleP95 = v;
    },
    save(): void {
      const failed = Object.entries(checks).flatMap(([id, c]) => (c.ok ? [] : [id]));
      const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/desktop/package.json'), 'utf8')) as { devDependencies: Record<string, string> };
      writeJson(
        file,
        {
          impl, rac: pkg.devDependencies['react-aria-components'], tanstack: pkg.devDependencies['@tanstack/react-virtual'] ?? null, rows: N,
          platform: `${process.platform}-${process.arch}`, ci: process.env['CI'] ?? null, window: windowInfo, budgetsMs: BUDGET,
          limitsMs: Object.fromEntries(Object.entries(BUDGET).map(([k, v]) => [k, limit(v)])), checks, verdict: { ok: failed.length === 0, failed },
        },
        description,
      );
      console.log(`[spike] ${impl} verdict`, JSON.stringify({ failed }));
    },
  };
}
export type Report = ReturnType<typeof createReport>;

export const r1 = (x: number): number => Math.round(x * 10) / 10;
export const pct = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]!;
};
export const stats = (xs: readonly number[]) => ({ n: xs.length, p50: r1(pct(xs, 50)), p95: r1(pct(xs, 95)), p99: r1(pct(xs, 99)), max: r1(Math.max(...xs)) });
/** Frame rule (spec 9): p95 within the limit; a machine whose idle frames already miss it is judged against its own idle p95. */
export const framesOk = (idleP95: number, p95: number): boolean => p95 <= limit(BUDGET.frameP95) || (idleP95 > limit(BUDGET.frameP95) && p95 <= idleP95 + 1);

export const frames = (page: Page, n: number): Promise<void> =>
  page.evaluate((count) => new Promise<void>((resolve) => {
    let left = count;
    const tick = () => (--left <= 0 ? resolve() : void requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);
/** A fresh page (a new document: new rows, an empty probe), once its first row is on screen. */
export async function openSpike(page: Page, query = ''): Promise<void> {
  await page.goto(`learn://app/index.html?window=spike&platform=${process.platform}${query}`);
  await expect(page.locator('[data-testid="item-row"]').first()).toBeVisible({ timeout: 30_000 });
  await frames(page, 3);
}
export const marks = (page: Page): Promise<SpikeMark[]> => page.evaluate(() => window.__spike!.marks);
const now = (page: Page): Promise<number> => page.evaluate(() => performance.now());
/** The first mark `name` taken after `after` (page clock). */
export async function markAfter(page: Page, name: string, after: number): Promise<SpikeMark> {
  let found: SpikeMark | undefined;
  await expect.poll(async () => (found = (await marks(page)).find((m) => m.name === name && m.at > after)), { timeout: 15_000 }).toBeTruthy();
  return found!;
}
/** ms from the (last) input that `act` performs to the first `name` mark after it. */
export async function timed(page: Page, name: string, act: () => Promise<void>): Promise<number> {
  const before = await now(page);
  await act();
  let input = 0;
  await expect.poll(async () => (input = await page.evaluate(() => window.__spike!.inputAt))).toBeGreaterThan(before);
  return r1((await markAfter(page, name, input)).at - input);
}
export const grid = (page: Page) => page.getByTestId('library-table');
/** A body row by its position in the table (aria-rowindex counts the header row: body row 0 is 2). */
export const rowAt = (page: Page, index: number) => page.locator(`[data-testid="item-row"][aria-rowindex="${index + 2}"]`);
export const header = (page: Page, col: SpikeSortColumn) => page.locator(`[data-testid="column-header"][data-col="${col}"]`);
export const selectedIds = (page: Page): Promise<string[]> => page.evaluate(() => window.__spike!.selectedIds());
export const idAt = async (page: Page, index: number): Promise<string> => (await rowAt(page, index).getAttribute('data-item-id'))!;
/** The focused row's position, or null when no row (or a cell) has the focus. */
export const focusedIndex = (page: Page): Promise<number | null> =>
  page.evaluate(() => {
    const row = document.activeElement?.closest('[data-testid="item-row"]');
    return row ? Number(row.getAttribute('aria-rowindex')) - 2 : null;
  });
/** Arms a watch: the page notes (page clock, just after the paint) when row `index` is wholly inside the grid's body. */
export const armVisible = (page: Page, index: number): Promise<void> =>
  page.evaluate((i) => {
    const w = window as unknown as { __visibleAt: number | null };
    w.__visibleAt = null;
    const box = document.querySelector('[data-testid="library-table"]')!;
    const tick = () => {
      const el = document.querySelector(`[data-testid="item-row"][aria-rowindex="${i + 2}"]`);
      const g = box.getBoundingClientRect();
      const r = el?.getBoundingClientRect();
      // clientHeight: the body without a horizontal scrollbar.
      if (r && r.top >= g.top + 28 - 0.5 && r.bottom <= g.top + box.clientHeight + 0.5) requestAnimationFrame(() => (w.__visibleAt = performance.now()));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, index);
/** ms from the last input to the visibility armVisible watched for. */
export async function visibleAfterInput(page: Page): Promise<number> {
  let at: number | null = null;
  await expect.poll(async () => (at = await page.evaluate(() => (window as unknown as { __visibleAt: number | null }).__visibleAt)), { timeout: 15_000 }).not.toBeNull();
  return r1(at! - (await page.evaluate(() => window.__spike!.inputAt)));
}
/**
 * rAF frame intervals while the grid scrolls `px` per frame for `count` frames; with `probeBlank`, frames in which no
 * row covers the body's top or bottom line. By geometry, not elementFromPoint: a scrolling virtualizer may turn its
 * content's pointer events off.
 */
export const sampleScroll = (page: Page, count: number, px: number, probeBlank = false): Promise<{ intervals: number[]; blank: number; scrollTop: number }> =>
  page.evaluate(({ count, px, probeBlank }) => new Promise((resolve) => {
    const el = document.querySelector<HTMLElement>('[data-testid="library-table"]')!;
    const g = el.getBoundingClientRect();
    const covered = (y: number) => [...el.querySelectorAll('[data-testid="item-row"]')].some((r) => {
      const b = r.getBoundingClientRect();
      return b.top <= y && b.bottom >= y;
    });
    const intervals: number[] = [];
    let blank = 0;
    let last = 0;
    let n = 0;
    const tick = (t: number) => {
      if (last) intervals.push(t - last);
      last = t;
      if (probeBlank && n > 0 && !(covered(g.top + 28 + 2) && covered(g.top + el.clientHeight - 4))) blank++;
      if (n++ >= count) return resolve({ intervals, blank, scrollTop: el.scrollTop });
      el.scrollTop += px;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { count, px, probeBlank });
export const startFrames = (page: Page): Promise<void> =>
  page.evaluate(() => {
    const f = { on: true, last: 0, intervals: [] as number[] };
    (window as unknown as { __frames: typeof f }).__frames = f;
    const tick = (t: number) => {
      if (!f.on) return;
      if (f.last) f.intervals.push(t - f.last);
      f.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
export const stopFrames = (page: Page): Promise<number[]> =>
  page.evaluate(() => {
    const f = (window as unknown as { __frames: { on: boolean; intervals: number[] } }).__frames;
    f.on = false;
    return f.intervals;
  });

/** Our code's share of a change (Step 5's attribution): row elements built by TableBody's function, memoised cells rendered. */
export interface Counts {
  rowElements: number;
  cellRenders: number;
}
export const counts = (page: Page): Promise<Counts> => page.evaluate(() => ({ rowElements: window.__spike!.rowElements, cellRenders: window.__spike!.cellRenders }));
export const minus = (a: Counts, b: Counts): Counts => ({ rowElements: a.rowElements - b.rowElements, cellRenders: a.cellRenders - b.cellRenders });
export const perChange = (c: Counts, n: number): Counts => ({ rowElements: r1(c.rowElements / n), cellRenders: r1(c.cellRenders / n) });

// Checks every implementation shares (the budgets of spec 3.4 / 9 that the table alone decides).

/** `mount`: the list arrives → its first row painted, 3 fresh pages; the grid says it has 10,000 rows and keeps few in the DOM. */
export async function measureMount(page: Page, report: Report, query: string, shot: string): Promise<void> {
  await report.guard('mount', async () => {
    const runs: number[] = [];
    for (let i = 0; i < 3; i++) {
      await openSpike(page, query);
      const m = await marks(page);
      runs.push(r1(m.find((x) => x.name === 'first-row')!.at - m.find((x) => x.name === 'rows:set')!.at));
    }
    // Our code's share on the last fresh page, up to the probe's read (Step 6's retry rule).
    const oursAtMount = await counts(page);
    report.setWindow(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, cores: navigator.hardwareConcurrency })));
    const aria = await grid(page).evaluate((el) => ({ rowcount: el.getAttribute('aria-rowcount'), multiselectable: el.getAttribute('aria-multiselectable') }));
    const domRows = await page.locator('[data-testid="item-row"]').count();
    await pageShot(page, shot, 'M4 spike: 10,000 rows');
    const firstPaintMs = pct(runs, 50);
    report.check('mount', aria.rowcount === String(N + 1) && aria.multiselectable === 'true' && domRows < 100 && firstPaintMs <= limit(BUDGET.firstPaint), 'native', { runsMs: runs, firstPaintMs, aria, domRows, oursAtMount });
  });
}

/** `scroll`: idle frames (the baseline), 3 rows a frame, empty row slots while scrolling, a jump of half the list. */
export async function measureScroll(page: Page, report: Report, query: string): Promise<void> {
  await report.guard('scroll', async () => {
    await openSpike(page, query);
    const idle = await sampleScroll(page, 120, 0);
    report.idleP95 = pct(idle.intervals, 95);
    const c0 = await counts(page);
    const run = await sampleScroll(page, 240, 84);
    const scrollOurs = minus(await counts(page), c0);
    await grid(page).evaluate((el) => (el.scrollTop = 0));
    await frames(page, 3);
    const probed = await sampleScroll(page, 240, 84, true);
    // A scrollbar drag: half the list in one frame, then the frames until the row due at the top is there.
    const jump = await page.evaluate(() => new Promise<{ ms: number; frames: number }>((resolve) => {
      const el = document.querySelector<HTMLElement>('[data-testid="library-table"]')!;
      const g = el.getBoundingClientRect();
      const t0 = performance.now();
      el.scrollTop = 140_000;
      const due = Math.floor(140_000 / 28);
      let n = 0;
      const tick = () => {
        n++;
        const top = [...el.querySelectorAll('[data-testid="item-row"]')].find((r) => {
          const b = r.getBoundingClientRect();
          return b.top <= g.top + 30 && b.bottom >= g.top + 30;
        });
        const at = top ? Number(top.getAttribute('aria-rowindex')) - 2 : -1;
        if (Math.abs(at - due) <= 2 || n > 120) requestAnimationFrame(() => resolve({ ms: performance.now() - t0, frames: n }));
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    const scrolled = stats(run.intervals);
    report.check('scroll', framesOk(report.idleP95, scrolled.p95) && probed.blank / 240 <= 0.02, 'native', {
      idle: stats(idle.intervals), scroll3RowsPerFrame: scrolled, blankFrames: probed.blank, blankOf: 240, jump: { ms: r1(jump.ms), frames: jump.frames }, scrollTopAfter: run.scrollTop, scrollOurs,
    });
  });
}

/** `sort`: five header clicks; the shown order is sortRows', aria-sort follows, and the render part (click → painted, less the sort itself) is within budget. */
export async function measureSort(page: Page, report: Report, query: string, shot: string | null): Promise<void> {
  await report.guard('sort', async () => {
    await openSpike(page, query);
    const runs: Array<{ column: SpikeSortColumn; direction: string; totalMs: number; computeMs: number; renderMs: number; ours: Counts; orderOk: boolean; ariaSort: string | null }> = [];
    for (const [column, direction] of [['title', 'ascending'], ['title', 'descending'], ['year', 'ascending'], ['createdAt', 'ascending'], ['createdAt', 'descending']] as const) {
      const computed = await page.evaluate(() => window.__spike!.sortComputeMs.length);
      const before = await counts(page);
      const totalMs = await timed(page, 'sort', () => header(page, column).click());
      await frames(page, 2);
      const ours = minus(await counts(page), before);
      const computeMs = r1(await page.evaluate((i) => window.__spike!.sortComputeMs[i]!, computed));
      const expected = sortRows(ROWS, column, direction).slice(0, 3).map((r) => r.id);
      const shown = [await idAt(page, 0), await idAt(page, 1), await idAt(page, 2)];
      runs.push({ column, direction, totalMs, computeMs, renderMs: r1(totalMs - computeMs), ours, orderOk: JSON.stringify(shown) === JSON.stringify(expected), ariaSort: await header(page, column).getAttribute('aria-sort') });
    }
    if (shot) await pageShot(page, shot, 'M4 spike: sorted by 추가일, descending');
    const renderMedian = pct(runs.map((r) => r.renderMs), 50);
    report.check('sort', runs.every((r) => r.orderOk && r.ariaSort === r.direction) && renderMedian <= limit(BUDGET.sort), 'native', {
      runs, renderMedianMs: renderMedian, totalMedianMs: pct(runs.map((r) => r.totalMs), 50), computeMedianMs: pct(runs.map((r) => r.computeMs), 50),
    });
  });
}

/** `refresh`: the list again with one item a new object — only that row's cells render (5 columns), and the change shows. */
export async function measureRefresh(page: Page, report: Report, query: string): Promise<void> {
  await report.guard('refresh', async () => {
    await openSpike(page, query);
    const before = await page.evaluate(() => window.__spike!.cellRenders);
    const at = await page.evaluate(() => window.__spike!.setRows('refresh-one'));
    const ms = r1((await markAfter(page, 'rows', at)).at - at);
    await frames(page, 3);
    const renders = (await page.evaluate(() => window.__spike!.cellRenders)) - before;
    const title = await rowAt(page, 2).getAttribute('data-title');
    report.check('refresh', renders >= 1 && renders <= 5 && (title ?? '').endsWith('(고침)'), 'native', { ms, cellRenders: renders, title });
  });
}

/** `filter`: the rows of a search and back, 10 times each way → painted (the table's share of spec 9's 50 ms). */
export async function measureFilter(page: Page, report: Report, query: string): Promise<void> {
  await report.guard('filter', async () => {
    await openSpike(page, query);
    const ms: number[] = [];
    let shown = 0;
    const before = await counts(page);
    for (let i = 0; i < 10; i++) {
      for (const kind of ['filter', 'all'] as const) {
        const at = await page.evaluate((k) => window.__spike!.setRows(k), kind);
        ms.push(r1((await markAfter(page, 'rows', at)).at - at));
        if (kind === 'filter') shown = await grid(page).evaluate((el) => Number(el.getAttribute('aria-rowcount')) - 1);
      }
    }
    await frames(page, 2);
    report.check('filter', pct(ms, 95) <= limit(BUDGET.filterP95), 'native', { ...stats(ms), filteredRows: shown, oursPerChange: perChange(minus(await counts(page), before), 20) });
  });
}
