// @perf — cold start (process start → app-ready) and renderer bundle size (ADR-0004: "recorded in M3"). Budget 1.5 s
// on the reference Mac (quality spec); runner values are reported only. Linux CI fails only beyond 2× the budget.
// Also the time from the menu command to the ⌘/ sheet or the settings window on screen (T13M-n4): reported, and on
// Linux CI failing only beyond 2× its 250 ms target; and the order of a theme switch (T13R4-m1), reported only.
//
// Marks (epoch ms, main/perf.ts): processStart (performance.timeOrigin of the main process), ready (app 'ready'),
// firstPaint (the main window's first 'ready-to-show': its page has painted, the window code shows it then),
// windowShown (its first 'show'), and the renderer's app-ready data-at (the first render with a settled list, R-18).
// M4: a library of 10,000 items against spec 9's budgets (library-perf.json; Linux CI fails beyond twice each), and the
// drop's long animation frames with the cause the fix for the stall is picked by (drop-import.json longFrames, stall).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, ROOT, closeSheet, drag, dropSource, expectWindow, importPaths, launch, runMenuCommand, seedRows } from '../e2e/helpers';
import { writeJson } from './capture';
import { stallCause, summarizeLongFrames, type LongFrame, type Mark } from './long-frames';
import { coldFirstOpens, openTimer } from './open-latency';
import { median, percentile } from './percentile';
import { searchSteps } from './search-steps';

interface Marks {
  processStart: number;
  ready: number;
  firstPaint: number;
  windowShown: number;
}

const LAUNCHES = 5;
const BUDGET_MS = 1500;

test('cold start to app-ready, 5 launches, and the renderer bundle', { tag: '@perf' }, async () => {
  test.setTimeout(180_000);
  const runs: Array<Record<'wallIncludingPlaywright' | 'mainReady' | 'firstPaint' | 'windowShown' | 'appReady', number>> = [];
  for (let i = 0; i < LAUNCHES; i++) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-perf-'));
    try {
      const t0 = Date.now();
      const s = await launch(path.join(tmp, 'library'), path.join(tmp, 'userdata'));
      const wall = Date.now() - t0;
      try {
        const appReadyAt = Number(await s.page.getByTestId('app-ready').getAttribute('data-at'));
        const m = await s.app.evaluate(() => (globalThis as { __learnPerf?: Marks }).__learnPerf!);
        expect(m.ready * m.firstPaint * m.windowShown * appReadyAt, `every mark was reached: ${JSON.stringify({ ...m, appReadyAt })}`).toBeGreaterThan(0);
        runs.push({
          wallIncludingPlaywright: wall,
          mainReady: m.ready - m.processStart,
          firstPaint: m.firstPaint - m.processStart,
          windowShown: m.windowShown - m.processStart,
          appReady: appReadyAt - m.processStart,
        });
      } finally {
        await s.app.close();
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const assets = path.join(ROOT, 'apps/desktop/out/renderer/assets');
  const files = fs.readdirSync(assets).map((f) => ({ file: f, bytes: fs.statSync(path.join(assets, f)).size }));
  const sum = (re: RegExp) => files.filter((x) => re.test(x.file)).reduce((n, x) => n + x.bytes, 0);
  const of = (key: keyof (typeof runs)[number]) => median(runs.map((r) => r[key]));
  const result = {
    runs,
    medianMs: { appReady: of('appReady'), windowShown: of('windowShown'), firstPaint: of('firstPaint'), mainReady: of('mainReady'), wallIncludingPlaywright: of('wallIncludingPlaywright') },
    budgetMs: { coldStartToAppReady: BUDGET_MS, linuxCiLimit: 2 * BUDGET_MS },
    // The renderer as built (apps/desktop/out/renderer/assets): the app bundle, the PDF.js worker (loaded with the
    // first PDF), styles and the bundled Pretendard.
    bundleBytes: { js: sum(/\.js$/), pdfWorker: sum(/\.mjs$/), css: sum(/\.css$/), fonts: sum(/\.(woff2?|ttf|otf)$/) },
    bundleFiles: files,
    platform: `${process.platform}-${process.arch}`,
    ci: process.env['CI'] ?? null,
  };
  writeJson('perf.json', result, 'M3 cold start (process start → app-ready) and renderer bundle size');
  console.log('[measure] perf', JSON.stringify(result.medianMs), JSON.stringify(result.bundleBytes));
  if (process.platform === 'linux' && process.env['CI']) expect(result.medianMs.appReady).toBeLessThan(2 * BUDGET_MS);
});

const OPENS = 5;
/** Fresh app sessions per kind for the cold first open (critique mac2 m3). */
const COLD_SESSIONS = 3;

test('opening the ⌘/ sheet and the settings window: menu command → window shown, cold (a new session) and 5 times each', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(240_000);
  const cold = await coldFirstOpens(testInfo.outputPath('cold'), COLD_SESSIONS);
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    // What the prepared settings window costs while it waits — its renderer's working set — next to the main one's.
    const memory = await s.app.evaluate(({ app, BrowserWindow }) => {
      const pidOf = (kind: string) => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes(`window=${kind}`))?.webContents.getOSProcessId();
      const metrics = app.getAppMetrics();
      const kb = (pid: number | undefined) => metrics.find((m) => m.pid === pid)?.memory.workingSetSize ?? null;
      return { settingsRendererKB: kb(pidOf('settings')), mainRendererKB: kb(pidOf('main')) };
    });
    expect(memory.settingsRendererKB, 'the prepared settings window has a renderer of its own').not.toBeNull();
    const { click, elapsed } = await openTimer(s.app);
    const sheetMs: number[] = [];
    const settingsMs: number[] = [];
    for (let i = 0; i < OPENS; i++) {
      const sheet = await expectWindow(s.app, 'sheet', () => click('app.shortcuts'));
      sheetMs.push(await elapsed());
      await closeSheet(sheet, 'Escape');
      await s.page.waitForTimeout(300);
    }
    for (let i = 0; i < OPENS; i++) {
      const settings = await expectWindow(s.app, 'settings', () => click('app.settings'));
      settingsMs.push(await elapsed());
      await settings.close();
      await s.page.waitForTimeout(300);
    }
    const result = {
      runsMs: { sheet: sheetMs, settings: settingsMs },
      medianMs: { sheet: median(sheetMs), settings: median(settingsMs) },
      // The first open in a new session (report, not tune: checklist 7.1): the settings window shows the one main prepared.
      coldFirstMs: { runs: cold, median: { sheet: median(cold.sheet), settings: median(cold.settings) } },
      // The first open in this session: the sheet is made (sheets are never prepared), the settings window was prepared.
      firstOpenMs: { sheet: sheetMs[0]!, settings: settingsMs[0]! },
      // Targets, reported: the ⌘/ sheet's median, and the settings window's first open of a new session.
      targetMs: 250,
      firstOpenTargetMs: { settings: 300 },
      memory,
      platform: `${process.platform}-${process.arch}`,
      ci: process.env['CI'] ?? null,
    };
    writeJson('open-latency.json', result, 'M3 menu command → ⌘/ sheet or settings window on screen (T13M-n4); the first opens and the prepared window\'s memory');
    console.log('[measure] open latency', JSON.stringify(result.runsMs), JSON.stringify(result.medianMs), 'cold', JSON.stringify(result.coldFirstMs));
    // The plan's CI rule (re-review minor 3): runner values are reported; Linux CI fails only beyond 2× the target.
    if (process.platform === 'linux' && process.env['CI']) {
      expect(result.medianMs.sheet, 'the ⌘/ sheet: median open, ms').toBeLessThanOrEqual(2 * result.targetMs);
      expect(result.medianMs.settings, 'the settings window: median open, ms').toBeLessThanOrEqual(2 * result.targetMs);
    }
  } finally {
    await s.app.close();
  }
});

interface ThemeLogEntry {
  event: 'requested' | 'shown' | 'chrome' | 'source' | 'updated';
  window?: 'main' | 'settings' | null;
  reason?: string;
  theme?: string;
  at: number;
}

// Spec 8: a theme picked in the settings window. Both pages change on main's one prefsChanged broadcast (each
// says so right after its swap), each window's chrome follows its page, the app-wide native theme follows both, and
// nativeTheme's 'updated' comes last. Times from the click, per window; reported only.
test('theme switch order: click → each page shows it → its chrome → the native theme → nativeTheme updated', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(120_000);
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: null });
  try {
    const settings = await expectWindow(s.app, 'settings', () => runMenuCommand(s.app, 'app.settings'));
    await expect.poll(() => s.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().includes('window=settings') && w.isVisible()))).toBe(true);
    const switches: Array<Record<string, unknown>> = [];
    const apart: Array<number | null> = [];
    for (const theme of ['dark', 'light', 'dark'] as const) {
      await s.app.evaluate(() => void ((globalThis as { __learnThemeLog?: unknown[] }).__learnThemeLog = []));
      // Each page's first frame in the new theme (epoch ms, its own clock): both should come in one frame (±1).
      const watchPaint = (p: Page) =>
        p.evaluate((shade) => {
          const w = window as unknown as { __themePaintedAt?: number };
          w.__themePaintedAt = undefined;
          const tick = (t: number) => {
            if (document.documentElement.dataset['theme'] === shade) w.__themePaintedAt = performance.timeOrigin + t;
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }, theme);
      await Promise.all([watchPaint(s.page), watchPaint(settings)]);
      // The click, on the page's clock (epoch ms, as main's).
      const clickAt = await settings.evaluate((t) => {
        const at = performance.timeOrigin + performance.now();
        document.querySelector<HTMLElement>(`[data-testid="theme-tile-${t}"]`)!.click();
        return at;
      }, theme);
      await expect.poll(() => s.app.evaluate(() => ((globalThis as { __learnThemeLog?: ThemeLogEntry[] }).__learnThemeLog ?? []).some((e) => e.event === 'updated'))).toBe(true);
      await settings.waitForTimeout(400);
      const log = await s.app.evaluate(() => (globalThis as { __learnThemeLog?: ThemeLogEntry[] }).__learnThemeLog ?? []);
      const ms = (pick: (e: ThemeLogEntry) => boolean) => {
        const e = log.find(pick);
        return e ? Math.round(e.at - clickAt) : null;
      };
      const paintedAt = async (p: Page) => {
        const at = await p.evaluate(() => (window as unknown as { __themePaintedAt?: number }).__themePaintedAt ?? null);
        return at === null ? null : Math.round(at - clickAt);
      };
      const painted = { settings: await paintedAt(settings), main: await paintedAt(s.page) };
      const pagesApartMs = painted.settings !== null && painted.main !== null ? Math.abs(painted.settings - painted.main) : null;
      apart.push(pagesApartMs);
      switches.push({
        to: theme,
        msFromClick: {
          requested: ms((e) => e.event === 'requested'),
          shown: { settings: ms((e) => e.event === 'shown' && e.window === 'settings'), main: ms((e) => e.event === 'shown' && e.window === 'main') },
          chrome: { settings: ms((e) => e.event === 'chrome' && e.window === 'settings'), main: ms((e) => e.event === 'chrome' && e.window === 'main') },
          nativeApplied: ms((e) => e.event === 'source'),
          nativeThemeUpdated: ms((e) => e.event === 'updated'),
        },
        paintedMs: painted,
        pagesApartMs,
        nativeAppliedBecause: log.find((e) => e.event === 'source')?.reason ?? null,
        log: log.map((e) => ({ ...e, at: Math.round(e.at - clickAt) })),
      });
    }
    const result = {
      switches,
      maxPagesApartMs: apart.includes(null) ? null : Math.max(...(apart as number[])),
      followMs: 250,
      platform: `${process.platform}-${process.arch}`,
      ci: process.env['CI'] ?? null,
    };
    writeJson('theme-switch.json', result, 'M3 theme switch: click → each page shows it → its chrome → native theme → nativeTheme updated (T13R4-m1)');
    console.log('[measure] theme switch', JSON.stringify(switches.map((w) => ({ to: w['to'], ...(w['msFromClick'] as object), because: w['nativeAppliedBecause'], apart: w['pagesApartMs'] }))));
  } finally {
    await s.app.close();
  }
});

/** A drop's marks (ui/perfMarks.ts), in ms after `learn:drop`; null for one that did not come. */
const DROP_MARKS = ['drop:clear', 'import:start', 'import:sent', 'import:answered', 'import:listed', 'import:busy-text', 'toast:import-done', 'import:end'] as const;

// Mac run 3, critique n6: a drop of 8 files into an empty library held the screen 0.55 s (the overlay stayed, the
// caption froze), then "자료 8개를 가져오는 중…" flashed for about 100 ms. Where the time goes, reported only: the
// page's marks from the drop (ui/perfMarks.ts), the main process's longest stall (a 5 ms ticker: a longer gap is time
// main's event loop was held) and the page's longest gap between frames, both from the drop to the toast; and every long animation frame (LoAF, 50 ms or more) with its scripts and phases, next to the
// app's learn: marks, for the cause of the longest (long-frames.ts).
test('a drop of 8 files into an empty library: drop → overlay gone → import → list → toast (marks, n6)', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(120_000);
  // Eight distinct files, like the demo's (none a duplicate, so no question): the fixtures, each made unique.
  const dir = testInfo.outputPath('drop-files');
  fs.mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  for (const [name, n] of [['sample.pdf', 5], ['sample-h264-aac.mp4', 1], ['sample-hevc.mp4', 1], ['sample-mpeg4part2.mp4', 1]] as const) {
    for (let i = 0; i < n; i++) {
      const file = path.join(dir, `${i + 1} ${name}`);
      fs.copyFileSync(path.join(FIXTURES, name), file);
      fs.appendFileSync(file, `\n% ${i}\n`);
      files.push(file);
    }
  }
  const bytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'), { colorScheme: null });
  try {
    await expect(s.page.getByTestId('empty-state')).toBeVisible();
    await s.app.evaluate(() => {
      const g = globalThis as { __learnStall?: { max: number; last: number; on: boolean } };
      const stall = { max: 0, last: performance.now(), on: false };
      g.__learnStall = stall;
      setInterval(() => {
        const now = performance.now();
        if (stall.on) stall.max = Math.max(stall.max, now - stall.last);
        stall.last = now;
      }, 5);
    });
    await s.page.evaluate(() => {
      const w = window as unknown as { __learnFrames: { max: number; last: number; on: boolean } };
      const frames = { max: 0, last: 0, on: false };
      w.__learnFrames = frames;
      const tick = (t: number) => {
        if (frames.on && frames.last) frames.max = Math.max(frames.max, t - frames.last);
        frames.last = t;
        if (!document.querySelector('[data-testid="import-done"]')) requestAnimationFrame(tick);
        else frames.on = false;
      };
      requestAnimationFrame(tick);
      addEventListener('drop', () => (frames.on = true), true);
    });
    // Long animation frames with their scripts and phases, and every learn: mark as it is made (the table's and the item
    // panel's keep only their newest in the timeline): what the stall cause reads.
    await s.page.evaluate(() => {
      type Script = {
        invoker: string;
        invokerType: string;
        sourceFunctionName: string;
        sourceURL: string;
        sourceCharPosition: number;
        startTime: number;
        duration: number;
        forcedStyleAndLayoutDuration: number;
      };
      type Loaf = PerformanceEntry & { renderStart: number; styleAndLayoutStart: number; blockingDuration: number; scripts: Script[] };
      const w = window as unknown as { __learnLongFrames: unknown[]; __learnMarks: Array<{ name: string; at: number }>; __learnLoaf: boolean };
      w.__learnLongFrames = [];
      w.__learnMarks = [];
      w.__learnLoaf = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame');
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.name.startsWith('learn:')) w.__learnMarks.push({ name: e.name, at: e.startTime });
      }).observe({ type: 'mark' });
      if (!w.__learnLoaf) return;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as Loaf[]) {
          w.__learnLongFrames.push({
            startTime: e.startTime,
            duration: e.duration,
            renderStart: e.renderStart,
            styleAndLayoutStart: e.styleAndLayoutStart,
            blockingDuration: e.blockingDuration,
            scripts: e.scripts.map((x) => ({
              invoker: x.invoker,
              invokerType: x.invokerType,
              sourceFunctionName: x.sourceFunctionName,
              sourceURL: x.sourceURL,
              sourceCharPosition: x.sourceCharPosition,
              startTime: x.startTime,
              duration: x.duration,
              forcedStyleAndLayoutDuration: x.forcedStyleAndLayoutDuration,
            })),
          });
        }
      }).observe({ type: 'long-animation-frame' });
    });
    await dropSource(s.page, files);
    await drag(s.page, 'dragenter', 'source');
    await drag(s.page, 'dragover', 'source');
    await expect(s.page.getByTestId('drop-overlay')).toBeVisible();
    await s.app.evaluate(() => {
      const stall = (globalThis as { __learnStall?: { max: number; last: number; on: boolean } }).__learnStall!;
      stall.on = true;
      stall.max = 0;
      stall.last = performance.now();
    });
    await drag(s.page, 'drop', 'source');
    await expect(s.page.getByTestId('item-row')).toHaveCount(8, { timeout: 30_000 });
    await expect.poll(() => s.page.evaluate(() => performance.getEntriesByName('learn:import:end').length + performance.getEntriesByName('learn:toast:import-done').length), { timeout: 15_000 }).toBe(2);
    const mainStallMs = await s.app.evaluate(() => {
      const stall = (globalThis as { __learnStall?: { max: number; on: boolean } }).__learnStall!;
      stall.on = false;
      return Math.round(stall.max - 5);
    });
    await s.page.waitForTimeout(300); // observers deliver a frame's entries after it: let the last ones in
    const page = await s.page.evaluate((names) => {
      const at = (n: string) => performance.getEntriesByName(`learn:${n}`).at(-1)?.startTime ?? null;
      const drop = at('drop')!;
      const marks = Object.fromEntries(names.map((n) => [n, at(n) === null ? null : Math.round(at(n)! - drop)]));
      const w = window as unknown as { __learnFrames: { max: number }; __learnLongFrames: unknown[]; __learnMarks: Array<{ name: string; at: number }>; __learnLoaf: boolean };
      return { drop, marks, all: w.__learnMarks, longFrames: w.__learnLongFrames, loaf: w.__learnLoaf, longestFrameGapMs: Math.round(w.__learnFrames.max) };
    }, [...DROP_MARKS]);
    const longFrames = summarizeLongFrames(page.longFrames as LongFrame[], page.all as Mark[], page.drop);
    const stall = stallCause(page.longestFrameGapMs, longFrames, page.all as Mark[], page.drop);
    const result = {
      files: files.length,
      bytes,
      marksMsAfterDrop: page.marks,
      busyTextShown: page.marks['import:busy-text'] !== null,
      longestFrameGapMs: page.longestFrameGapMs,
      mainLongestStallMs: mainStallMs,
      // spec 8: at most 100 ms on the Mac. The five longest frames after the drop and the cause of the longest.
      longFrameApi: page.loaf,
      longFrames: longFrames.slice(0, 5),
      stall,
      platform: `${process.platform}-${process.arch}`,
      ci: process.env['CI'] ?? null,
    };
    writeJson('drop-import.json', result, 'M3 drop of 8 files into an empty library: marks from the drop, longest main stall and frame gap (Mac run 3 n6), long frames and the stall cause (spec 8)');
    console.log('[measure] drop import', JSON.stringify(result));
    expect(page.marks['drop:clear'], 'the overlay-less frame was painted').not.toBeNull();
  } finally {
    await s.app.close();
  }
});

/** spec 9, ms. Linux CI fails beyond twice each; every other run reports. */
const LIBRARY_BUDGET_MS = { listIpc: 150, firstPaint: 500, inputToPaintP95: 50, searchP95: 300, scrollFrameP95: 16.7, sortToPaint: 100, inspectorToPaint: 100 } as const;
const LIBRARY_ITEMS = 10_000;
/** Each single-shot timing five times (spec 9: five or more). */
const LIBRARY_RUNS = 5;
/** The columns shown by default (spec 3.1), each sorted once. */
const SORT_COLUMNS = ['title', 'creators', 'year', 'type', 'createdAt'] as const;
/** What the page records while the warm session runs (PerformanceObserver and the search field's input events). */
interface PerfLog {
  marks: Array<{ name: string; at: number }>;
  measures: Array<{ name: string; ms: number }>;
  inputs: number[];
}
const tenth = (x: number) => Math.round(x * 10) / 10;

test('10,000 items: list, first rows, quick search, scroll, sort and the item panel against spec 9 (library-perf.json)', { tag: '@perf' }, async ({}, testInfo) => {
  const linuxCi = process.platform === 'linux' && Boolean(process.env['CI']);
  // On Linux CI the whole test, the seeding and five launches included, ends within a minute.
  test.setTimeout(linuxCi ? 60_000 : 180_000);
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');
  const shownTotal = async (page: Page) => Number(/^(\d+)개$/.exec((await page.getByTestId('toolbar-count').textContent()) ?? '')?.[1] ?? 0);

  // 1. One real PDF, then 10,000 items that share its asset: one transaction, one libraryChanged. The rows are made
  //    here (seedRows; main keeps no sample data), and the search inputs below come from them.
  const libraryRows = seedRows(LIBRARY_ITEMS);
  const seeded = await launch(lib, ud);
  try {
    const [from] = await importPaths(seeded.page, [path.join(FIXTURES, 'sample.pdf')]);
    const added = await seeded.app.evaluate(
      (_electron, input) => (globalThis as unknown as { __learnTest: { seedItems(i: typeof input): number } }).__learnTest.seedItems(input),
      { fromItemId: from!.id, rows: libraryRows },
    );
    expect(added, 'main added every seeded row, in one transaction').toBe(LIBRARY_ITEMS);
    await expect.poll(() => shownTotal(seeded.page), { timeout: 30_000 }).toBeGreaterThanOrEqual(LIBRARY_ITEMS);
  } finally {
    await seeded.app.close();
  }

  // 2. Cold: five launches of that library. The list is there at app-ready's data-at (the first render with it);
  //    the first rows' frame is learn:table:first-paint. Both epoch ms.
  const firstPaintMs: number[] = [];
  for (let i = 0; i < LIBRARY_RUNS; i++) {
    const c = await launch(lib, ud);
    try {
      const listAt = Number(await c.page.getByTestId('app-ready').getAttribute('data-at'));
      await expect.poll(() => c.page.evaluate(() => performance.getEntriesByName('learn:table:first-paint').length)).toBe(1);
      const paintedAt = await c.page.evaluate(() => performance.timeOrigin + performance.getEntriesByName('learn:table:first-paint')[0]!.startTime);
      // An empty or placeholder table must not pass: the paint came after the list, and rows are in it (the mark is set in
      // the frame of the commit that drew them, and rows are never removed after).
      expect(paintedAt - listAt, 'the first rows were painted after the list arrived').toBeGreaterThan(0);
      expect(await c.page.getByTestId('item-row').count(), 'the table shows rows at its first paint').toBeGreaterThan(0);
      firstPaintMs.push(Math.round(paintedAt - listAt));
    } finally {
      await c.app.close();
    }
  }

  // 3. A warm session for the rest.
  const s = await launch(lib, ud);
  try {
    const page = s.page;
    // The list's search index is built at the window's first idle moment (useSearch; timed() records it): wait for it,
    // so that long task lands in none of the measurements below (useSearch gives its idle callback a one-second timeout).
    const indexBuilt = () => page.evaluate(() => performance.getEntriesByName('learn:search:index', 'measure').length);
    const deadline = Date.now() + 15_000;
    while ((await indexBuilt()) === 0) {
      if (Date.now() > deadline) {
        const state = await page.evaluate(async () => {
          const listed = await window.learn.library.list();
          const entries = performance
            .getEntries()
            .filter((e) => e.name.startsWith('learn:'))
            .slice(-10)
            .map((e) => `${e.name} (${e.entryType}) at ${Math.round(e.startTime)} ms, ${Math.round(e.duration)} ms`);
          return {
            rows: document.querySelectorAll('[data-testid="item-row"]').length,
            appReady: document.querySelector('[data-testid="app-ready"]') !== null,
            listLength: listed.ok ? listed.data.length : `list failed: ${listed.code}`,
            entries,
          };
        });
        throw new Error(
          `the search index was built at an idle moment: no learn:search:index measure in 15 s; item-row shown ${state.rows}, app-ready present ${state.appReady}, ` +
            `library.list length ${state.listLength}; last learn:* entries: ${state.entries.join('; ') || 'none'}`,
        );
      }
      await page.waitForTimeout(100);
    }
    const listed = await page.evaluate(async (runs) => {
      const out: number[] = [];
      let count = 0;
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        const r = await window.learn.library.list();
        if (!r.ok) throw new Error(`library.list failed: ${r.code}`);
        out.push(Math.round(performance.now() - t0));
        count = r.data.length;
      }
      return { out, count };
    }, LIBRARY_RUNS);
    const listIpcMs = listed.out;
    await page.evaluate(() => {
      const log: PerfLog = { marks: [], measures: [], inputs: [] };
      (window as unknown as { __learnPerfLog: PerfLog }).__learnPerfLog = log;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.name.startsWith('learn:')) continue;
          if (e.entryType === 'mark') log.marks.push({ name: e.name, at: e.startTime });
          else log.measures.push({ name: e.name, ms: e.duration });
        }
      }).observe({ entryTypes: ['mark', 'measure'] });
      document.addEventListener('input', (e) => {
        if ((e.target as Element | null)?.closest('[data-testid="search-field"]')) log.inputs.push(e.timeStamp);
      }, true);
    });
    const inputCount = () => page.evaluate(() => (window as unknown as { __learnPerfLog: PerfLog }).__learnPerfLog.inputs.length);
    /** The first learn:table:painted after `t0` (the page's clock), or null after 3 s. */
    const paintedAfter = (t0: number) =>
      page.evaluate(async (t0) => {
        const log = (window as unknown as { __learnPerfLog: PerfLog }).__learnPerfLog;
        const until = performance.now() + 3000;
        while (performance.now() < until) {
          const m = log.marks.find((x) => x.name === 'learn:table:painted' && x.at > t0);
          if (m) return m.at;
          await new Promise((r) => setTimeout(r, 5));
        }
        return null;
      }, t0);

    // Quick search, one character at a time, typed then erased.
    await runMenuCommand(s.app, 'library.find');
    await expect(page.getByTestId('search-field').locator('input')).toBeFocused();
    // The first query also brings the abstracts and memos, which re-draws the rows once more: not timed.
    await page.keyboard.insertText('a');
    await page.waitForTimeout(1000);
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
    const inputToPaintMs: number[] = [];
    let unpainted = 0;
    const timeInput = async (act: () => Promise<void>) => {
      const before = await inputCount();
      await act();
      await expect.poll(inputCount).toBe(before + 1);
      const t0 = await page.evaluate((i) => (window as unknown as { __learnPerfLog: PerfLog }).__learnPerfLog.inputs[i]!, before);
      const painted = await paintedAfter(t0);
      if (painted === null) unpainted++;
      else inputToPaintMs.push(Math.round(painted - t0));
    };
    // The quick search measures of the timed inputs only: the warm-up query above is left out.
    const measuresBefore = (await page.evaluate(() => (window as unknown as { __learnPerfLog: PerfLog }).__learnPerfLog.measures)).filter((m) => m.name === 'learn:search').length;
    const steps = searchSteps(libraryRows);
    for (const step of steps) {
      for (const ch of step.chars) await timeInput(() => page.keyboard.insertText(ch));
      for (let i = 0; i < step.chars.length; i++) await timeInput(() => page.keyboard.press('Backspace'));
    }
    expect(unpainted, 'every search input re-drew the rows (usePaintMark on the rows useLibraryRows memoises)').toBe(0);
    expect(inputToPaintMs.length, `enough inputs for a p95 (search-steps.ts found ${JSON.stringify(steps.map((x) => x.group))}; seedRows gives Korean and Latin titles and creators)`).toBeGreaterThanOrEqual(20);
    const searchMs = (await page.evaluate(() => (window as unknown as { __learnPerfLog: PerfLog }).__learnPerfLog.measures))
      .filter((m) => m.name === 'learn:search')
      .slice(measuresBefore)
      .map((m) => tenth(m.ms));
    expect(searchMs.length, "quick search is timed (timed() in search.ts' searchCached)").toBeGreaterThan(0);

    // Scroll: the grid is the table's own scroll view (a sticky header, the rows placed by the virtualizer), 40 px every
    // frame for 150 frames.
    const scroll = await page.evaluate(async () => {
      const target = document.querySelector<HTMLElement>('[data-testid="library-table"]')!;
      if (target.scrollHeight <= target.clientHeight + 1) throw new Error('the table does not scroll');
      const deltas: number[] = [];
      await new Promise<void>((done) => {
        let last = 0;
        let n = 0;
        const step = (t: number) => {
          if (last) deltas.push(t - last);
          last = t;
          target.scrollTop += 40;
          if (++n < 150) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
      return { deltas: deltas.slice(2), scrolledTo: Math.round(target.scrollTop) };
    });
    expect(scroll.scrolledTo, 'the table scrolled').toBeGreaterThan(0);
    const frameMs = scroll.deltas.map(tenth);

    // Sort: a press on a column header's sort button → the first frame with the re-sorted rows. The button's onClick sorts
    // (a button's click() runs it, unlike a row's), the settings write is optimistic.
    const sortToPaintMs: number[] = [];
    for (const col of SORT_COLUMNS) {
      const t0 = await page.evaluate((col) => {
        const t0 = performance.now();
        document.querySelector<HTMLElement>(`[data-testid="column-header"][data-col="${col}"] .th-sort`)!.click();
        return t0;
      }, col);
      const painted = await paintedAfter(t0);
      expect(painted, `sorting by ${col} re-drew the rows`).not.toBeNull();
      sortToPaintMs.push(Math.round(painted! - t0));
    }

    // The item panel: a press on a row → the first frame whose head names that row and has its info section. The table
    // selects on mousedown (one delegated handler on its body); a programmatic click() selects nothing. A folded panel
    // would draw nothing, and the Mac runner's 1024 px window folds it (240 + 520 + 320 = 1080): there it is shown on
    // demand as a user would, with ⌥⌘I (view.toggleInspector), before it is timed. Whether it is shown is kept with the
    // values and checked below.
    const forcedShown = (await page.getByTestId('shell').getAttribute('data-inspector')) !== 'shown';
    if (forcedShown) {
      await runMenuCommand(s.app, 'view.toggleInspector');
      await expect(page.getByTestId('shell'), 'the folded item panel shown on demand (view.toggleInspector)').toHaveAttribute('data-inspector', 'shown');
    }
    const panel = await page.getByTestId('shell').getAttribute('data-inspector');
    const inspectorToPaintMs: number[] = [];
    for (let i = 0; i < LIBRARY_RUNS; i++) {
      const ms = await page.evaluate(async (index) => {
        const head = () => document.querySelector('[data-testid="inspector-head"] h2')?.textContent ?? '';
        const candidates = [...document.querySelectorAll<HTMLElement>('[data-testid="item-row"]')].filter((r) => r.dataset['title'] && r.dataset['title'] !== head());
        const row = candidates[index % candidates.length]!;
        const title = row.dataset['title']!;
        const t0 = performance.now();
        row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
        return new Promise<number>((resolve, reject) => {
          const check = (t: number) => {
            if (head() === title && document.querySelector('[data-testid="inspector"] [data-testid="info-section"]')) resolve(Math.max(0, t - t0));
            else if (performance.now() - t0 > 3000) reject(new Error(`the item panel never showed ${title}`));
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });
      }, i);
      inspectorToPaintMs.push(Math.round(ms));
    }

    const result = {
      items: listed.count,
      runs: LIBRARY_RUNS,
      budgetMs: LIBRARY_BUDGET_MS,
      linuxCiLimitMs: Object.fromEntries(Object.entries(LIBRARY_BUDGET_MS).map(([k, v]) => [k, 2 * v])),
      listIpcMs: { runs: listIpcMs, median: median(listIpcMs) },
      firstPaintMs: { runs: firstPaintMs, median: median(firstPaintMs) },
      inputToPaintMs: { inputs: inputToPaintMs.length, groups: steps.map((x) => x.group), runs: inputToPaintMs, median: median(inputToPaintMs), p95: percentile(inputToPaintMs, 95) },
      searchMs: { runs: searchMs, p95: percentile(searchMs, 95) },
      scrollFrameMs: { frames: frameMs.length, p95: percentile(frameMs, 95), max: Math.max(...frameMs), scrolledPx: scroll.scrolledTo },
      sortToPaintMs: { columns: SORT_COLUMNS, runs: sortToPaintMs, median: median(sortToPaintMs), max: Math.max(...sortToPaintMs) },
      inspectorToPaintMs: { panel, forcedShown, runs: inspectorToPaintMs, median: median(inspectorToPaintMs), max: Math.max(...inspectorToPaintMs) },
      platform: `${process.platform}-${process.arch}`,
      ci: process.env['CI'] ?? null,
    };
    writeJson('library-perf.json', result, 'M4 library of 10,000 items: list, first rows, quick search, scroll, sort, item panel (spec 9)');
    console.log(
      '[measure] library',
      JSON.stringify({
        list: result.listIpcMs.median, firstPaint: result.firstPaintMs.median, inputP95: result.inputToPaintMs.p95, searchP95: result.searchMs.p95,
        scrollP95: result.scrollFrameMs.p95, sort: result.sortToPaintMs.median, inspector: result.inspectorToPaintMs.median,
      }),
    );
    // The item panel's timing is the panel's only while it is on screen (written above either way, then checked).
    expect.soft(panel, 'the item panel was shown while it was timed (data-inspector on the shell)').toBe('shown');
    // spec 1 cond. 2 and 9: Linux CI fails beyond twice each budget (all checked, then the test fails); Mac values are reported.
    if (linuxCi) {
      const gate = (value: number, budget: number, what: string) =>
        expect.soft(value, `${what}: ${value} ms against the Linux CI limit ${2 * budget} ms (spec 9 budget ${budget} ms)`).toBeLessThanOrEqual(2 * budget);
      gate(result.listIpcMs.median, LIBRARY_BUDGET_MS.listIpc, 'library.list of 10,000 items, median');
      gate(result.firstPaintMs.median, LIBRARY_BUDGET_MS.firstPaint, 'list arrived → first rows painted, median');
      gate(result.inputToPaintMs.p95, LIBRARY_BUDGET_MS.inputToPaintP95, 'search input → rows painted, p95');
      gate(result.searchMs.p95, LIBRARY_BUDGET_MS.searchP95, 'metadata search, p95');
      gate(result.scrollFrameMs.p95, LIBRARY_BUDGET_MS.scrollFrameP95, 'scroll frame interval, p95');
      gate(result.sortToPaintMs.median, LIBRARY_BUDGET_MS.sortToPaint, 'sort column change → rows painted, median');
      gate(result.inspectorToPaintMs.median, LIBRARY_BUDGET_MS.inspectorToPaint, 'row selected → item panel painted, median');
    }
  } finally {
    await s.app.close();
  }
});
