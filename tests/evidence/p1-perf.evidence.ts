// @perf — M6 spec 14 (p1-perf.json): the import queue's answer for 1,000 files and the progress it reports; cold start of
// an empty library against the M5 value; a library of 10,000 items that each have a file — its startup check after the
// window, 1,000 to the trash → the table, the trash view, 1,000 purged; backup and restore throughput; and what one
// import's fsync costs (Q-2c). Linux CI fails beyond twice each budget (budget.ts); throughputs and fsync are reported only.
//
// "Painted" is a state of the page, as in organize-perf.evidence.ts: a timing ends at the first animation frame whose
// callback finds the DOM in the state the action leads to. A start is the event's own timeStamp in the page, or — for a
// menu key, which main turns into the command — main's clock at the menu item's click; both are epoch-based, as the
// context menu's timing in organize-perf compares them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { ImportReport, LibraryCheck } from '../../packages/domain/src/library';
import type { BackupDoneSheet } from '../../packages/domain/src/sheets';
import {
  FIXTURES, clickToCloseSheet, closeSheet, drag, dropSource, expectWindow, fsyncProbe, importFiles, importPause, importPaths, importQueueState,
  importResume, importWaiting, launch, libraryCheckState, rowAt, runMenuAccelerator, runMenuCommand, seedAssets, seedRows, specialRow,
  stubFolderPicker, stubFolderPicks, trashItems, waitImportIdle, type Session,
} from '../e2e/helpers';
import type { lastMs as mainLastMs } from '../../apps/desktop/src/main/perf';
import { limitFailures } from './budget';
import { EVIDENCE_ROOT, writeJson } from './capture';
import { M5_APP_READY_MS, MIN_PAINTS, P1_BUDGET, jobSpan, maxInWindow, mbPerSecond, meanRate, p1Limits, paintVerdict, spread, summary, tenth, twoClockSpan, type JobNotice } from './p1-perf-math';
import { settleCalls, settleIndex, settleIndexSince } from './settle';

const linuxCi = process.platform === 'linux' && Boolean(process.env['CI']);
/** Every single-shot timing at least five times (M5 spec 12's rule, kept). */
const RUNS = 5;
const LAUNCHES = 5;
/** spec 14 "1,000 경로". */
const PATHS = 1_000;
/** Dropped while the 1,000 import: the run's total grows (spec 3.1, 7 / 12 → 7 / 15). */
const JOINED = 500;
const SMALL_BYTES = 64 * 1024;
const ITEMS = 10_000;
/** Of ITEMS, the oldest are linked to files outside: the startup check stats each of them. */
const LINKED = 1_000;
const TRASHED = 1_000;
const PURGES = 3;
const BIG_FILES = 16;
const BIG_BYTES = 4 * 1024 * 1024;
const FSYNC_FILES = 20;
const FSYNC_BYTES = 1024 * 1024;
const RESULT = 'p1-perf.json';

// ---- p1-perf.json ------------------------------------------------------------------------------------------------------

/** The sections written so far in this run (the runner's pid tells a file of this run from one left by an earlier run). */
function readP1Perf(): Record<string, unknown> {
  try {
    const old = JSON.parse(fs.readFileSync(path.join(EVIDENCE_ROOT, RESULT), 'utf8')) as Record<string, unknown>;
    return old['run'] === process.ppid ? old : {};
  } catch {
    return {};
  }
}
/** Merged into p1-perf.json after each test: a worker restarted after a failure keeps the sections before it. */
function saveP1Perf(patch: Record<string, unknown>): void {
  writeJson(
    RESULT,
    {
      ...readP1Perf(), ...patch, run: process.ppid, budget: P1_BUDGET, linuxCiFactor: 2, m5AppReadyMs: M5_APP_READY_MS,
      platform: `${process.platform}-${process.arch}`, ci: process.env['CI'] ?? null, updatedAt: new Date().toISOString(),
    },
    'M6 spec 14: the import queue answer and progress, cold start vs M5, the startup check and the trash over 10,000 assets, backup and restore throughput, fsync cost',
  );
}

// ---- fixtures and small reads ------------------------------------------------------------------------------------------

/** `count` distinct PDFs of `bytes` each: the sample's bytes, a line naming the file, then spaces after %%EOF. */
function paddedPdfs(dir: string, count: number, bytes: number, tag: string): string[] {
  fs.mkdirSync(dir, { recursive: true });
  const head = fs.readFileSync(path.join(FIXTURES, 'sample.pdf'));
  return Array.from({ length: count }, (_, i) => {
    const file = path.join(dir, `${tag}-${String(i + 1).padStart(4, '0')}.pdf`);
    const mark = Buffer.from(`\n% ${tag} ${i + 1}\n`);
    fs.writeFileSync(file, Buffer.concat([head, mark, Buffer.alloc(Math.max(0, bytes - head.length - mark.length), 0x20)]));
    return file;
  });
}
const folder = (dir: string) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
const shownTotal = async (page: Page): Promise<number> =>
  Number(/^[\d,]+/.exec((await page.getByTestId('toolbar-count').textContent()) ?? '')?.[0]?.replace(/,/g, '') ?? 0);
type WithReports = { __learnTest: { importReports(): ImportReport[] } };
const importReports = (app: ElectronApplication): Promise<ImportReport[]> => app.evaluate(() => (globalThis as unknown as WithReports).__learnTest.importReports());
type LastMs = typeof mainLastMs;
const lastMs = (app: ElectronApplication): Promise<LastMs> => app.evaluate(() => ({ ...((globalThis as { __learnLastMs?: LastMs }).__learnLastMs ?? {}) }));
const forgetPurgeTimes = (app: ElectronApplication) =>
  app.evaluate(() => {
    const l = (globalThis as { __learnLastMs?: LastMs }).__learnLastMs;
    if (l) {
      delete l.purge;
      delete l.purgeFiles;
    }
  });
const selectionCount = (app: ElectronApplication): Promise<number> =>
  app.evaluate(() => (globalThis as { __learnMenuContext?: { selectionCount: number } }).__learnMenuContext?.selectionCount ?? 0);

// ---- page probes -------------------------------------------------------------------------------------------------------

/** What the DOM must show for a timing to end; every field given must hold. */
interface Settled {
  /** The toolbar's "N개". */
  count?: number;
  /** Row 0's item id. */
  firstId?: string;
  /** Row 0's item id is one of these. */
  firstIn?: readonly string[];
}
interface P1Probe {
  /** From the next left pointerdown's timeStamp to the settled frame: ms, or null after 10 s. */
  afterDown(spec: Settled): void;
  /** From now (the start is in main): the settled frame's epoch ms, or null after 10 s. */
  untilShown(spec: Settled): void;
  result(): Promise<number | null>;
}
/** Installs the page-side clock and state check. Run once per page. */
function installProbe(page: Page): Promise<void> {
  return page.evaluate(() => {
    const downs: number[] = [];
    addEventListener('pointerdown', (e) => {
      if (e.button === 0) downs.push(e.timeStamp);
    }, true);
    const shown = (s: Settled, ids: Set<string> | null): boolean => {
      if (s.count !== undefined) {
        const m = /^[\d,]+/.exec(document.querySelector('[data-testid="toolbar-count"]')?.textContent ?? '');
        if (!m || Number(m[0].replace(/,/g, '')) !== s.count) return false;
      }
      const first = document.querySelector('[data-testid="item-row"][data-index="0"]')?.getAttribute('data-item-id') ?? null;
      if (s.firstId !== undefined && first !== s.firstId) return false;
      if (ids !== null && (first === null || !ids.has(first))) return false;
      return true;
    };
    const frame = (t0: number, s: Settled, epoch: boolean): Promise<number | null> => {
      const ids = s.firstIn ? new Set(s.firstIn) : null;
      return new Promise((resolve) => {
        const check = () => {
          const now = performance.now();
          if (shown(s, ids)) resolve(epoch ? performance.timeOrigin + now : now - t0);
          else if (now - t0 > 10_000) resolve(null);
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
    };
    let pending: Promise<number | null> = Promise.resolve(null);
    (window as unknown as { __learnP1: P1Probe }).__learnP1 = {
      afterDown(s) {
        const seen = downs.length;
        pending = (async () => {
          const until = performance.now() + 5000;
          while (downs.length === seen) {
            if (performance.now() > until) return null;
            await new Promise((r) => setTimeout(r, 2));
          }
          return frame(downs[seen]!, s, false);
        })();
      },
      untilShown(s) {
        pending = frame(performance.now(), s, true);
      },
      result: () => pending,
    };
  });
}
/** Arms the probe (the wait is registered when this returns); await the returned function after the action. */
async function arm(page: Page, how: 'afterDown' | 'untilShown', spec: Settled): Promise<() => Promise<number | null>> {
  await page.evaluate(([h, sp]) => (window as unknown as { __learnP1: P1Probe }).__learnP1[h](sp), [how, spec] as const);
  return () => page.evaluate(() => (window as unknown as { __learnP1: P1Probe }).__learnP1.result());
}

interface JobLog {
  /** When each import:progress notice reached the page. */
  notices: number[];
  /** Notice → the first frame showing its count and bar, for notices that came while the toast was up. */
  paints: number[];
  /** Notices of the toast's first second (no toast to update yet). */
  beforeToast: number;
  /** A newer notice came before this one was drawn. */
  superseded: number;
  /** The toast went (the run's end) or did not show the notice within 2 s. */
  missed: number;
}
/** Logs the import notices and, while the progress toast is up, how soon the toast shows each (design-spec 6 진행 토스트). */
function installJobProbe(page: Page): Promise<void> {
  return page.evaluate(() => {
    const log: JobLog = { notices: [], paints: [], beforeToast: 0, superseded: 0, missed: 0 };
    (window as unknown as { __learnP1Jobs: JobLog }).__learnP1Jobs = log;
    let seq = 0;
    window.learn.on('import:progress', (s) => {
      const t0 = performance.now();
      log.notices.push(t0);
      const mine = ++seq;
      if (s.state !== 'running') return;
      if (!document.querySelector('[data-testid="import-progress"]')) {
        log.beforeToast++;
        return;
      }
      // The toast's own words for this notice (jobs/jobProgress.ts describeJob): " · done / total" and the bar's floor percent.
      const count = new RegExp(`· ${s.done} / ${s.total}(?!\\d)`);
      const percent = String(s.bytesTotal > 0 ? Math.min(100, Math.floor((s.bytesDone * 100) / s.bytesTotal)) : 0);
      const check = () => {
        if (seq !== mine) {
          log.superseded++;
          return;
        }
        const toast = document.querySelector('[data-testid="import-progress"]');
        const now = performance.now();
        if (toast && count.test(toast.textContent ?? '') && toast.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow') === percent) log.paints.push(now - t0);
        else if (!toast || now - t0 > 2000) log.missed++;
        else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
  });
}

function installJobLog(page: Page): Promise<void> {
  return page.evaluate(() => {
    const log: JobNotice[] = [];
    (window as unknown as { __learnP1JobLog: JobNotice[] }).__learnP1JobLog = log;
    window.learn.on('job:progress', (p) => void log.push({ t: performance.now(), kind: p.kind, state: p.state, outcome: p.outcome ?? null }));
  });
}
const jobLog = (page: Page): Promise<JobNotice[]> => page.evaluate(() => (window as unknown as { __learnP1JobLog: JobNotice[] }).__learnP1JobLog);

// ---- steps -------------------------------------------------------------------------------------------------------------

/** A drop of real files on the window, as Finder's (the overlay first, then the drop). */
async function dropFiles(page: Page, files: readonly string[]): Promise<void> {
  await dropSource(page, [...files]);
  await drag(page, 'dragenter', 'source');
  await drag(page, 'dragover', 'source');
  await expect(page.getByTestId('drop-overlay')).toBeVisible();
  await drag(page, 'drop', 'source');
}

/** ms from the newest `from` mark to the newest `to` mark after it, both made after `since` (the page's clock); null until there. */
const markSpan = (page: Page, from: string, to: string, since: number): Promise<number | null> =>
  page.evaluate(
    ({ from, to, since }) => {
      const at = (name: string) => performance.getEntriesByName(`learn:${name}`, 'mark').filter((e) => e.startTime > since).at(-1)?.startTime ?? null;
      const a = at(from);
      const b = at(to);
      return a === null || b === null || b < a ? null : b - a;
    },
    { from, to, since },
  );

/**
 * One import of `files` to the queue's answer (spec 14): 파일 가져오기… (main has the paths from its panel: import:start →
 * import:answered) or a drop (the page sends them, 500 a call: import:sent → import:answered). The first file is held at
 * afterStage, then 취소 drops the rest: nothing is imported and the next run starts from the same library.
 */
async function answered(s: Session, how: 'pick' | 'drop', files: readonly string[]): Promise<number> {
  const { app, page } = s;
  await importPause(app, 'afterStage');
  const since = await page.evaluate(() => performance.now());
  if (how === 'pick') await importFiles(s, [...files]);
  else await dropFiles(page, files);
  const span = () => markSpan(page, how === 'pick' ? 'import:start' : 'import:sent', 'import:answered', since);
  await expect.poll(span, { message: `${how}: the queue answered`, timeout: 15_000 }).not.toBeNull();
  const ms = (await span())!;
  await expect.poll(() => importWaiting(app), { message: 'the first file is held', timeout: 15_000 }).toBe('afterStage');
  expect((await importQueueState(app)).total, `the queue took all ${files.length} files`).toBe(files.length);
  await page.evaluate(() => window.learn.library.cancelImport());
  await importResume(app);
  await waitImportIdle(page);
  expect((await importReports(app)).at(-1), 'a cancelled run that imported nothing').toMatchObject({ imported: 0, requested: files.length, cancelled: true });
  return ms;
}

interface Marks {
  processStart: number;
  ready: number;
  windowCreated: number;
  checkStart: number;
  checkEnd: number;
}
const marksOf = (app: ElectronApplication): Promise<Marks> => app.evaluate(() => ({ ...(globalThis as { __learnPerf?: Marks }).__learnPerf! }));
interface ColdRun {
  windowCreatedMs: number;
  appReadyMs: number;
  checkMs: number;
  checkAfterWindowMs: number;
  check: LibraryCheck | null;
}
/** One launch: the main-process marks (epoch ms, main/perf.ts) once the background check has ended, and app-ready's data-at. */
async function coldRun(lib: string, ud: string): Promise<ColdRun> {
  const s = await launch(lib, ud);
  try {
    const appReadyAt = Number(await s.page.getByTestId('app-ready').getAttribute('data-at'));
    await expect.poll(async () => (await marksOf(s.app)).checkEnd, { message: 'the startup check ended', timeout: 30_000 }).toBeGreaterThan(0);
    const m = await marksOf(s.app);
    expect(m.windowCreated * m.checkStart * appReadyAt, `every mark was reached: ${JSON.stringify({ ...m, appReadyAt })}`).toBeGreaterThan(0);
    return {
      windowCreatedMs: m.windowCreated - m.processStart,
      appReadyMs: appReadyAt - m.processStart,
      checkMs: m.checkEnd - m.checkStart,
      checkAfterWindowMs: m.checkStart - m.windowCreated,
      check: (await libraryCheckState(s.app)).check,
    };
  } finally {
    await s.app.close();
  }
}

/** Rows 0 … n−1 selected (a click on row 0, ⇧-click on row n−1), the table back at its top; main's context counts n. */
async function selectTop(page: Page, app: ElectronApplication, n: number): Promise<void> {
  const scroller = page.getByTestId('library-scroller');
  await scroller.evaluate((e) => void (e.scrollTop = 0));
  await rowAt(page, 0).click();
  const height = (await rowAt(page, 0).boundingBox())!.height;
  await scroller.evaluate((e, y) => void (e.scrollTop = y), Math.max(0, (n - 1) * height - 200));
  await rowAt(page, n - 1).click({ modifiers: ['Shift'] });
  await expect.poll(() => selectionCount(app), { message: `${n} rows selected` }).toBe(n);
  await scroller.evaluate((e) => void (e.scrollTop = 0));
  await expect(rowAt(page, 0)).toBeVisible();
}

const trashedNow = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const r = await window.learn.library.trashView();
    return r.ok ? r.data.items.map((i) => i.id).sort() : [];
  });

// ---- the measurements --------------------------------------------------------------------------------------------------

test('import queue: 파일 가져오기… and a drop of 1,000 files → the queue answered; the notices and the progress toast while 1,500 import (p1-perf.json)', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(linuxCi ? 150_000 : 300_000);
  const setA = paddedPdfs(testInfo.outputPath('a'), PATHS, SMALL_BYTES, 'a');
  const setB = paddedPdfs(testInfo.outputPath('b'), PATHS, SMALL_BYTES, 'b');
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { app, page } = s;
    // An item first: a drop then is not the empty library's first import (its busy screen).
    await importPaths(page, [path.join(FIXTURES, 'sample.pdf')]);

    // 1. The answer for 1,000 paths, each way, five times.
    const pick: number[] = [];
    const drop: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      pick.push(await answered(s, 'pick', setA));
      drop.push(await answered(s, 'drop', setB));
    }

    // 2. One run of 1,500 (1,000 through the panel, 500 dropped while it runs): the notices and the toast's frames. A run
    // with fewer than MIN_PAINTS timed paints, or a p95 over the Linux CI line, is taken once more (paintVerdict).
    const importRun = async (files: readonly string[], dropped: readonly string[]): Promise<JobLog> => {
      await installJobProbe(page);
      await importFiles(s, [...files]);
      await dropFiles(page, dropped.slice(0, JOINED));
      await expect.poll(async () => (await importQueueState(app)).total, { message: 'the drop joined the running import' }).toBe(PATHS + JOINED);
      await expect
        .poll(async () => (await importQueueState(app)).state, { message: `${PATHS + JOINED} files imported`, timeout: linuxCi ? 100_000 : 240_000, intervals: [500] })
        .toBe('idle');
      await waitImportIdle(page);
      expect((await importReports(app)).at(-1), 'one run took every file').toMatchObject({ imported: PATHS + JOINED, requested: PATHS + JOINED, cancelled: false, failed: [] });
      return page.evaluate(() => (window as unknown as { __learnP1Jobs: JobLog }).__learnP1Jobs);
    };
    const logs: JobLog[] = [await importRun(setA, setB)];
    const limit = 2 * P1_BUDGET.toastPaintP95Ms;
    let verdict = paintVerdict(logs.map((l) => l.paints), limit);
    if (!verdict.done) {
      // New files: the first run's are in the library already.
      logs.push(await importRun(paddedPdfs(testInfo.outputPath('c'), PATHS, SMALL_BYTES, 'c'), paddedPdfs(testInfo.outputPath('d'), JOINED, SMALL_BYTES, 'd')));
      verdict = paintVerdict(logs.map((l) => l.paints), limit);
    }
    const log = logs[0]!;

    const importAnswer = {
      paths: PATHS, pickMs: summary(pick), dropMs: summary(drop),
      note: 'pick: learn:import:start → learn:import:answered (main reads the paths from its panel); drop: learn:import:sent → learn:import:answered (two calls of 500)',
    };
    const progress = {
      files: PATHS + JOINED, notices: log.notices.length, maxPerSecond: maxInWindow(log.notices), meanPerSecond: meanRate(log.notices),
      toastPaintMs: { ...spread(logs.flatMap((l) => l.paints)), beforeToast: log.beforeToast, superseded: log.superseded, missed: log.missed },
      toastPaintRuns: logs.map((l, i) => ({ p95: verdict.runs[i]!.p95, samples: l.paints.length, missed: l.missed, superseded: l.superseded })),
      toastPaintVerdict: { p95: verdict.p95, samples: verdict.samples, pooled: verdict.pooled, retook: verdict.retook, failure: verdict.failure },
      note: 'notice in the page → the first frame whose toast shows its count and bar; notices before the toast (its first second) are not timed',
    };
    saveP1Perf({ importAnswer, progress });
    console.log('[measure] p1 import', JSON.stringify({ pick: importAnswer.pickMs.median, drop: importAnswer.dropMs.median, perSecond: progress.maxPerSecond, paintP95: verdict.p95, paints: verdict.samples, runs: progress.toastPaintRuns }));
    if (linuxCi) {
      expect(verdict.samples, `the toast was timed over at least ${MIN_PAINTS} updates (both runs pooled)`).toBeGreaterThanOrEqual(MIN_PAINTS);
      expect(
        limitFailures(p1Limits({ importPickMs: importAnswer.pickMs.median, importDropMs: importAnswer.dropMs.median, progressPerSecond: progress.maxPerSecond, toastPaintP95Ms: verdict.p95 })),
      ).toEqual([]);
    }
  } finally {
    await s.app.close();
  }
});

test('cold start of an empty library → app-ready, five launches, against the M5 value; the check begins after the window (p1-perf.json)', { tag: '@perf' }, async () => {
  test.setTimeout(linuxCi ? 120_000 : 240_000);
  const runs: ColdRun[] = [];
  for (let i = 0; i < LAUNCHES; i++) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-p1-cold-'));
    try {
      runs.push(await coldRun(path.join(tmp, 'library'), path.join(tmp, 'userdata')));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  for (const r of runs) expect(r.checkAfterWindowMs, 'the startup check began after the window was made (P-18)').toBeGreaterThanOrEqual(0);
  const m5 = M5_APP_READY_MS[process.platform] ?? null;
  const appReadyMs = summary(runs.map((r) => r.appReadyMs));
  const coldStart = {
    library: 'empty', launches: LAUNCHES, appReadyMs, windowCreatedMs: summary(runs.map((r) => r.windowCreatedMs)), checkMs: summary(runs.map((r) => r.checkMs)),
    m5AppReadyMs: m5, vsM5Ms: m5 === null ? null : tenth(appReadyMs.median - m5),
  };
  saveP1Perf({ coldStart });
  console.log('[measure] p1 cold start', JSON.stringify({ appReady: appReadyMs.median, m5, window: coldStart.windowCreatedMs.median }));
  if (linuxCi) expect(limitFailures(p1Limits({ coldStartMs: appReadyMs.median }))).toEqual([]);
});

test('10,000 items with a file each: the startup check after the window; 1,000 to the trash → the table; the trash view; 1,000 purged (p1-perf.json)', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(linuxCi ? 180_000 : 360_000);
  const lib = testInfo.outputPath('library');
  const ud = testInfo.outputPath('userdata');

  // 1. The library: 9,000 managed copies in assets/ and 1,000 originals outside, one row each.
  let seeded: { itemIds: string[]; sha256: string[] } = { itemIds: [], sha256: [] };
  const first = await launch(lib, ud);
  try {
    seeded = await seedAssets(first.app, { rows: seedRows(ITEMS), linkedFrom: ITEMS - LINKED, linkedDir: testInfo.outputPath('outside') });
    expect(seeded.itemIds).toHaveLength(ITEMS);
    await expect.poll(() => shownTotal(first.page), { timeout: 30_000 }).toBe(ITEMS);
  } finally {
    await first.app.close();
  }
  // seedRows go back a minute each and the default sort is the newest first: table row i is seeded row i.
  const ids = seeded.itemIds;
  const top = ids.slice(0, TRASHED);

  // 2. Cold launches of that library: the window first, the check of 10,000 assets after it, in the background.
  const cold: ColdRun[] = [];
  for (let i = 0; i < LAUNCHES; i++) cold.push(await coldRun(lib, ud));
  for (const r of cold) expect(r.checkAfterWindowMs, 'the startup check began after the window was made (P-18)').toBeGreaterThanOrEqual(0);
  expect(cold[0]!.check, 'the seeded library is a clean one').toMatchObject({ items: ITEMS, actionable: false, unreferenced: { keys: [] }, missingManaged: { itemIds: [] }, missingLinked: { itemIds: [] } });
  const emptyWindow = (readP1Perf()['coldStart'] as { windowCreatedMs?: { median: number } } | undefined)?.windowCreatedMs?.median ?? null;
  const windowCreatedMs = summary(cold.map((r) => r.windowCreatedMs));
  const startup = {
    assets: ITEMS, managed: ITEMS - LINKED, linked: LINKED, launches: LAUNCHES,
    checkMs: summary(cold.map((r) => r.checkMs)), windowCreatedMs, appReadyMs: summary(cold.map((r) => r.appReadyMs)),
    checkAfterWindowMs: summary(cold.map((r) => r.checkAfterWindowMs)),
    windowVsEmptyLibraryMs: emptyWindow === null ? null : tenth(windowCreatedMs.median - emptyWindow),
    note: 'checkStart ≥ windowCreated in every launch; app-ready here includes listing 10,000 items',
  };
  saveP1Perf({ startup });

  // 3. A warm session for the trash.
  const s = await launch(lib, ud);
  try {
    const { app, page } = s;
    await expect.poll(() => shownTotal(page), { timeout: 30_000 }).toBe(ITEMS);
    await settleIndex(page, app);
    await installProbe(page);

    // ⌘⌫ on 1,000 selected rows → the first frame with 9,000 and the 1,001st row on top. Four times put back; the fifth stays.
    const redraw: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      await selectTop(page, app, TRASHED);
      const waiting = await arm(page, 'untilShown', { count: ITEMS - TRASHED, firstId: ids[TRASHED]! });
      const clickedAt = await runMenuAccelerator(app, 'item.trash');
      const paintedAt = await waiting();
      expect(paintedAt, `the table showed ${ITEMS - TRASHED} items within 10 s`).not.toBeNull();
      redraw.push(twoClockSpan(clickedAt, paintedAt!));
      expect(await trashedNow(page), 'exactly the selected rows went to the trash').toEqual([...top].sort());
      if (r < RUNS - 1) {
        const since = await page.evaluate(() => performance.now());
        expect(await page.evaluate((itemIds) => window.learn.library.restore({ itemIds }), top)).toMatchObject({ ok: true, data: TRASHED });
        await expect.poll(() => shownTotal(page)).toBe(ITEMS);
        await expect(rowAt(page, 0)).toHaveAttribute('data-item-id', ids[0]!);
        await settleIndexSince(page, app, since);
      } else {
        await settleCalls(app, 500);
      }
    }

    // The trash view with 1,000 in it: the sidebar row's press → its 1,000 rows; back to 내 라이브러리 between.
    const open: number[] = [];
    const back: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      let waiting = await arm(page, 'afterDown', { count: TRASHED, firstIn: top });
      await specialRow(page, 'trash').click();
      const opened = await waiting();
      expect(opened, `the trash view showed its ${TRASHED} items within 10 s`).not.toBeNull();
      open.push(opened!);
      await settleCalls(app, 200);
      waiting = await arm(page, 'afterDown', { count: ITEMS - TRASHED, firstId: ids[TRASHED]! });
      await specialRow(page, 'all').click();
      const returned = await waiting();
      expect(returned, 'the library view came back within 10 s').not.toBeNull();
      back.push(returned!);
      await settleCalls(app, 200);
    }

    // 영구 삭제 of 1,000, three times (the trashed 1,000, then the next thousands): main's transaction and its file step.
    const purges: Array<{ transactionMs: number; ipcMs: number; filesMs: number }> = [];
    for (let r = 0; r < PURGES; r++) {
      const batch = ids.slice(r * TRASHED, (r + 1) * TRASHED);
      if (r > 0) expect(await trashItems(page, batch)).toBe(TRASHED);
      await forgetPurgeTimes(app);
      const answer = await page.evaluate(async (itemIds) => {
        const t0 = performance.now();
        const res = await window.learn.library.purge({ itemIds, collectionIds: [] });
        return { removed: res.ok ? res.data.itemIds.length : -1, ms: performance.now() - t0 };
      }, batch);
      expect(answer.removed, 'the purge removed every trashed row').toBe(TRASHED);
      const transactionMs = (await lastMs(app)).purge;
      expect(transactionMs, 'main timed the transaction').toBeDefined();
      await expect.poll(async () => (await lastMs(app)).purgeFiles, { message: 'the files went after the answer', timeout: 60_000 }).toBeDefined();
      const filesMs = (await lastMs(app)).purgeFiles!;
      for (const k of [0, TRASHED / 2, TRASHED - 1]) {
        const sha = seeded.sha256[r * TRASHED + k]!;
        expect(fs.existsSync(path.join(lib, 'assets', sha.slice(0, 2), sha)), 'a purged copy is gone').toBe(false);
      }
      purges.push({ transactionMs: transactionMs!, ipcMs: answer.ms, filesMs });
      await expect.poll(() => shownTotal(page)).toBe(ITEMS - TRASHED * (r + 1));
      await settleCalls(app, 300);
    }

    const trash = {
      items: ITEMS, moved: TRASHED, redrawMs: summary(redraw), viewOpenMs: summary(open), viewBackMs: summary(back),
      purge: {
        items: TRASHED, files: TRASHED, transactionMs: summary(purges.map((p) => p.transactionMs)), ipcMs: summary(purges.map((p) => p.ipcMs)), filesMs: summary(purges.map((p) => p.filesMs)),
        note: 'transaction: main around LibraryRepository.purge (lastMs.purge); ipc: the page’s round trip; files: removePurgedFiles after the answer (lastMs.purgeFiles)',
      },
      note: 'redraw: main’s click on the 휴지통으로 이동 menu item (⌘⌫) → the first frame with the table’s new count and first row; open: the sidebar row’s pointerdown → the trash view’s count and a trashed first row',
    };
    saveP1Perf({ trash });
    console.log('[measure] p1 trash', JSON.stringify({ check: startup.checkMs.median, redraw: trash.redrawMs.median, open: trash.viewOpenMs.median, purge: trash.purge.transactionMs.median, files: trash.purge.filesMs.median }));
    if (linuxCi) {
      expect(
        limitFailures(p1Limits({ startupCheckMs: startup.checkMs.median, trashRedrawMs: trash.redrawMs.median, trashViewOpenMs: trash.viewOpenMs.median, purgeTransactionMs: trash.purge.transactionMs.median })),
      ).toEqual([]);
    }
  } finally {
    await s.app.close();
  }
});

test('backup and restore throughput of 16 files of 4 MB, and one import’s fsync (p1-perf.json, reported only)', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(linuxCi ? 120_000 : 240_000);
  const files = paddedPdfs(testInfo.outputPath('big'), BIG_FILES, BIG_BYTES, 'big');
  const backups = folder(testInfo.outputPath('backups'));
  const restores = folder(testInfo.outputPath('restores'));
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { app, page } = s;
    expect(await importPaths(page, files)).toHaveLength(BIG_FILES);
    await installJobLog(page);

    await stubFolderPicker(app, backups);
    let sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'file.backup'));
    const done = await sheet.evaluate(async () => {
      const r = await window.learn.sheet.payload();
      return r.ok ? r.data : null;
    });
    if (done?.kind !== 'backupDone') throw new Error(`not the backup result sheet: ${JSON.stringify(done)}`);
    const backupDone: BackupDoneSheet = done;
    expect(backupDone.files).toBe(BIG_FILES);
    await clickToCloseSheet(sheet, sheet.getByTestId('backup-done'));
    const backup = path.join(backups, fs.readdirSync(backups).find((n) => n.startsWith('Learn 백업'))!);

    await stubFolderPicks(app, [backup, restores]);
    sheet = await expectWindow(app, 'sheet', () => runMenuCommand(app, 'file.restore'));
    await expect(sheet.getByTestId('restore-files')).toHaveText(`${BIG_FILES}개 확인 · 손상 없음`);
    await closeSheet(sheet, 'Escape'); // 나중에

    const log = await jobLog(page);
    const backupMs = jobSpan(log, 'backup');
    const restoreMs = jobSpan(log, 'restore');
    expect(backupMs, 'the backup reported its start and its end').not.toBeNull();
    expect(restoreMs, 'the restore reported its start and its end').not.toBeNull();

    const probe = await fsyncProbe(app, { dir: testInfo.outputPath('fsync-probe'), files: FSYNC_FILES, bytes: FSYNC_BYTES });
    const perImport = probe.fileMs.map((ms, i) => ms + probe.shardMs[i]! + probe.parentMs[i]!);

    const backupRestore = {
      files: BIG_FILES, bytes: backupDone.bytes,
      backup: { ms: tenth(backupMs!), sheetTookMs: backupDone.tookMs, mbPerSecond: mbPerSecond(backupDone.bytes, backupDone.tookMs) },
      restore: { ms: tenth(restoreMs!), mbPerSecond: mbPerSecond(backupDone.bytes, restoreMs!) },
      note: 'reported only (spec 14: it depends on the disk); every copy is written, flushed and read back; ms from the first running job:progress to its done',
    };
    const fsync = {
      files: FSYNC_FILES, bytes: FSYNC_BYTES, perImportMs: spread(perImport), stagingFileMs: spread(probe.fileMs), shardFolderMs: spread(probe.shardMs), newShardParentMs: spread(probe.parentMs),
      libuv: probe.uv,
      note: 'Importer.place on a new shard: fsyncDir(assets) + fsyncFile(staging) + fsyncDir(shard), the importer’s own calls; macOS libuv flushes with F_FULLFSYNC (Q-2c)',
    };
    saveP1Perf({ backupRestore, fsync });
    console.log('[measure] p1 backup', JSON.stringify({ backupMBs: backupRestore.backup.mbPerSecond, restoreMBs: backupRestore.restore.mbPerSecond, fsyncPerImportMedian: fsync.perImportMs.median, libuv: probe.uv }));
  } finally {
    await s.app.close();
  }
});
