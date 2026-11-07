// @perf — M7b spec 12 (tabs-perf.json): switching to a reader tab that is kept mounted and to one that was unmounted, one
// back jump (⌘[), a cold start with five saved tabs, and the renderer's memory with one and with four reader tabs. Linux CI
// fails beyond twice each budget (budget.ts); the Mac reports.
//
// Ends are states of the page, as in reader-perf.evidence.ts: the first animation frame in which the DOM is in the state the
// action leads to, or pdf.js's own `pagerendered` (read from the active reader's event bus through window.__learnReader).
// Starts are an event's own timeStamp in the page (the tab click) or, for the menu key, main's clock at the item's click.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURES, backFromReader, importPaths, launch, libraryTab, openItem, readerTab, runMenuAccelerator } from '../e2e/helpers';
import { limitFailures } from './budget';
import { EVIDENCE_ROOT, writeJson } from './capture';
import { median } from './percentile';
import { summary, tenth, type Summary } from './p1-perf-math';
import { TABS_BUDGET_MS, medianKB, overBudget, tabsLimits, type TabsLine } from './tabs-perf-math';

const linuxCi = process.platform === 'linux' && Boolean(process.env['CI']);
const RESULT = 'tabs-perf.json';
/** Five PDFs that open without a password; the first is the long paper the unmounted-tab switch and the jump are measured on. */
const PDFS = ['paper-100.pdf', 'sample.pdf', 'korean.pdf', 'long-outline.pdf', '한글 경로 (테스트) #1.pdf'].map((f) => path.join(FIXTURES, f));
const RUNS = { switchKept: 10, switchUnmounted: 5, historyJump: 10, coldStart: 5 } as const;
/** Quiet time before memory is read, and the reads taken after it. */
const IDLE_MS = 2000;
const MEMORY_READS = 3;

// ---- tabs-perf.json -------------------------------------------------------------------------------------------------------

type Saved = { lines?: Partial<Record<TabsLine, Summary>>; memory?: Record<string, unknown> } & Record<string, unknown>;

function readSaved(): Saved {
  try {
    const old = JSON.parse(fs.readFileSync(path.join(EVIDENCE_ROOT, RESULT), 'utf8')) as Saved & { run?: unknown };
    return old.run === process.ppid ? old : {};
  } catch {
    return {};
  }
}

/** Merged into tabs-perf.json after each test: a worker restarted after a failure keeps the sections before it. */
function save(patch: { line?: [TabsLine, Summary]; memory?: Record<string, unknown> }): void {
  const old = readSaved();
  const lines = { ...old.lines, ...(patch.line ? { [patch.line[0]]: patch.line[1] } : {}) };
  const values = Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v!.median]));
  const seen = Object.keys(values) as TabsLine[];
  const limits = tabsLimits({ switchKept: 0, switchUnmounted: 0, historyJump: 0, coldStartFiveTabs: 0, ...values }).filter((_, i) => seen.includes(Object.keys(TABS_BUDGET_MS)[i] as TabsLine));
  writeJson(
    RESULT,
    {
      run: process.ppid,
      budgetMs: TABS_BUDGET_MS,
      values,
      max: Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v!.max])),
      runs: Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, v!.runs])),
      lines,
      linuxCiLimitMs: Object.fromEntries(Object.entries(TABS_BUDGET_MS).map(([k, v]) => [k, tenth(v * 2)])),
      // Private memory is not reachable without a preload test surface, so this is the working set read from main (report only).
      memory: { ...old.memory, ...patch.memory },
      overBudget: overBudget({ switchKept: 0, switchUnmounted: 0, historyJump: 0, coldStartFiveTabs: 0, ...values }).filter((k) => seen.includes(k)),
      linuxCiFailures: limitFailures(limits),
      platform: `${process.platform}-${process.arch}`,
      ci: process.env['CI'] ?? null,
      updatedAt: new Date().toISOString(),
    },
    'M7b spec 12: reader tabs — switching to a kept and to an unmounted tab, one back jump, a cold start with five saved tabs, renderer memory',
  );
}

/** Linux CI: the one line fails beyond twice its budget. */
function expectWithinLimit(line: TabsLine, s: Summary): void {
  if (!linuxCi) return;
  const limits = tabsLimits({ switchKept: 0, switchUnmounted: 0, historyJump: 0, coldStartFiveTabs: 0, [line]: s.median }).filter((_, i) => Object.keys(TABS_BUDGET_MS)[i] === line);
  expect(limitFailures(limits)).toEqual([]);
}

// ---- the page's side ------------------------------------------------------------------------------------------------------

/**
 * What the page keeps from the moment a reader exists: every reader's event bus (in the order they appeared) and every
 * `pagerendered` of any of them (bus index, page, time). A reader mounted later is attached when the store announces it.
 */
async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    type Bus = { on(n: string, f: (e: never) => void): void };
    const w = window as unknown as {
      __learnReader: { getState(): { handle: { eventBus(): Bus } | null }; subscribe(f: () => void): () => void };
      __tp?: { buses: Bus[]; log: Array<{ bus: number; page: number; at: number }> };
    };
    const tp = (w.__tp = { buses: [] as Bus[], log: [] as Array<{ bus: number; page: number; at: number }> });
    const attach = () => {
      const bus = w.__learnReader.getState().handle?.eventBus();
      if (!bus || tp.buses.includes(bus)) return;
      const index = tp.buses.push(bus) - 1;
      bus.on('pagerendered', ((e: { pageNumber: number; error?: unknown }) => {
        if (!e.error) tp.log.push({ bus: index, page: e.pageNumber, at: performance.now() });
      }) as (e: never) => void);
    };
    w.__learnReader.subscribe(attach);
    attach();
  });
}

const settle = (page: Page, ms = 300) => page.evaluate((ms) => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, ms)))), ms);

/** The shown reader's first page is drawn. */
async function shownDrawn(page: Page): Promise<void> {
  await expect(page.getByTestId('pdf-viewer')).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
}

/** Opens an item in a tab of its own from the library list (the first tab has no strip yet). */
async function openTab(page: Page, id: string, title: string): Promise<void> {
  if ((await libraryTab(page).count()) > 0) await backFromReader(page);
  await openItem(page, title);
  await expect(page.locator(`[data-testid="tab-panel"][data-item-id="${id}"][data-active="true"]`)).toBeAttached();
  await shownDrawn(page);
}

const panels = (page: Page, id: string) => page.locator(`[data-testid="tab-panel"][data-item-id="${id}"]`);

async function seed(page: Page) {
  const items = await importPaths(page, PDFS);
  expect(items).toHaveLength(PDFS.length);
  // import order is the list's; ask for them by the files' own names
  return PDFS.map((p) => items.find((i) => path.basename(p).startsWith(i.title.slice(0, 6)))!).map((i) => ({ id: i.id, title: i.title }));
}

/** The main window's renderer: its working set in KB, read in main as perf.evidence.ts reads the settings window's. */
const rendererKB = (app: ElectronApplication): Promise<number> =>
  app.evaluate(({ app, BrowserWindow }) => {
    const pid = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.webContents.getURL().includes('window=main'))?.webContents.getOSProcessId();
    const m = app.getAppMetrics().find((x) => x.pid === pid);
    if (!m) throw new Error('no metrics for the main renderer');
    return m.memory.workingSetSize;
  });

/** Idle for 2 s, then the median of three reads half a second apart. */
async function idleMemory(app: ElectronApplication, page: Page): Promise<number> {
  await page.waitForTimeout(IDLE_MS);
  const reads: number[] = [];
  for (let i = 0; i < MEMORY_READS; i++) {
    reads.push(await rendererKB(app));
    await page.waitForTimeout(500);
  }
  return medianKB(reads);
}

test.beforeAll(() => {
  for (const f of PDFS) if (!fs.existsSync(f)) throw new Error(`fixture missing: ${f} — run \`pnpm fixtures\``);
});

// ---- memory, kept-tab switch, unmounted-tab switch: one session -----------------------------------------------------------------

test('tabs budgets @1: renderer memory with one and four reader tabs, 10 switches to a kept tab, 5 to an unmounted one', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(linuxCi ? 150_000 : 240_000);
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const tabs = await seed(page);
    await installProbe(page); // before any reader: the probe follows the store, so no event of a first draw is missed

    // 1. Memory: one reader tab, then four, each drawn and the page idle.
    await openTab(page, tabs[0]!.id, tabs[0]!.title);
    const oneTab = await idleMemory(app, page);
    for (const t of tabs.slice(1, 4)) await openTab(page, t.id, t.title);
    const fourTabs = await idleMemory(app, page);
    save({ memory: { rendererWorkingSetKB: { oneTab, fourTabs }, reads: MEMORY_READS, idleMs: IDLE_MS } });
    expect(oneTab).toBeGreaterThan(0);

    // 2. A kept tab: the four are all mounted; click the next in turn. The click's own timeStamp → the first frame in which that
    //    tab's panel is shown and its page canvas has a size.
    const kept: number[] = [];
    for (let i = 0; i < RUNS.switchKept; i++) {
      const target = tabs[i % 4]!; // the shown one is tabs[3] at the start, so the first target is another tab
      for (const t of tabs.slice(0, 4)) await expect(panels(page, t.id)).toHaveCount(1);
      await page.evaluate((id) => {
        const w = window as unknown as { __sw?: Promise<number>; __clickAt?: number };
        w.__clickAt = undefined;
        window.addEventListener('click', (e) => (w.__clickAt ??= e.timeStamp), { capture: true, once: true });
        w.__sw = new Promise<number>((resolve) => {
          const look = () => {
            const panel = document.querySelector<HTMLElement>(`[data-testid="tab-panel"][data-item-id="${id}"]`);
            const canvas = panel?.querySelector<HTMLElement>('.page canvas[role="presentation"]');
            const r = canvas?.getBoundingClientRect();
            if (panel && panel.dataset['active'] === 'true' && !panel.hidden && r && r.width > 0 && r.height > 0) resolve(performance.now());
            else requestAnimationFrame(look);
          };
          requestAnimationFrame(look);
        });
      }, target.id);
      await readerTab(page, target.id).click();
      const ms = await page.evaluate(async () => (await (window as unknown as { __sw: Promise<number> }).__sw) - (window as unknown as { __clickAt: number }).__clickAt);
      expect(ms, 'the end is after the click').toBeGreaterThan(0);
      kept.push(ms);
      await settle(page);
    }
    const keptSummary = summary(kept);
    save({ line: ['switchKept', keptSummary] });

    // 3. An unmounted tab: the paper is made the least recent of the four kept, so a fifth tab pushes it out. The click → page 1 of
    //    the reader that mounts. Then the other four in turn, which push the paper out again.
    const paper = tabs[0]!;
    const others = tabs.slice(1);
    for (const t of others.slice(0, 3)) {
      await readerTab(page, t.id).click();
      await expect(page.locator(`[data-testid="tab-panel"][data-item-id="${t.id}"][data-active="true"]`)).toBeAttached();
    }
    await openTab(page, others[3]!.id, others[3]!.title);
    const unmounted: number[] = [];
    for (let i = 0; i < RUNS.switchUnmounted; i++) {
      await expect(panels(page, paper.id), 'the paper is not mounted').toHaveCount(0);
      await page.evaluate(() => {
        const w = window as unknown as { __un?: Promise<number>; __clickAt?: number; __tp: { buses: unknown[]; log: Array<{ bus: number; page: number; at: number }> } };
        w.__clickAt = undefined;
        const firstNew = w.__tp.buses.length; // a reader that mounts for this click gets a bus after these
        window.addEventListener('click', (e) => (w.__clickAt ??= e.timeStamp), { capture: true, once: true });
        w.__un = new Promise<number>((resolve) => {
          const look = () => {
            const hit = w.__tp.log.find((e) => e.bus >= firstNew && e.page === 1 && w.__clickAt !== undefined && e.at >= w.__clickAt);
            if (hit) resolve(hit.at);
            else requestAnimationFrame(look);
          };
          requestAnimationFrame(look);
        });
      });
      await readerTab(page, paper.id).click();
      const ms = await page.evaluate(async () => (await (window as unknown as { __un: Promise<number> }).__un) - (window as unknown as { __clickAt: number }).__clickAt);
      expect(ms, 'the end is after the click').toBeGreaterThan(0);
      unmounted.push(ms);
      await shownDrawn(page);
      await settle(page, 500);
      for (const t of others) {
        await readerTab(page, t.id).click();
        await expect(page.locator(`[data-testid="tab-panel"][data-item-id="${t.id}"][data-active="true"]`)).toBeAttached();
        await shownDrawn(page);
        await settle(page);
      }
    }
    const unmountedSummary = summary(unmounted);
    save({ line: ['switchUnmounted', unmountedSummary] });
    console.log('[measure] tabs', JSON.stringify({ memory: { oneTab, fourTabs }, kept: keptSummary, unmounted: unmountedSummary }));
    expectWithinLimit('switchKept', keptSummary);
    expectWithinLimit('switchUnmounted', unmountedSummary);
  } finally {
    await app.close();
  }
});

// ---- one back jump ---------------------------------------------------------------------------------------------------------------

test('tabs budgets @2: one ⌘[ after a link jump → the page it returns to is drawn (10 jumps)', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(linuxCi ? 120_000 : 200_000);
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const [paper] = await importPaths(page, [PDFS[0]!]);
    await openItem(page, paper!.title);
    await shownDrawn(page);
    await expect(page.getByTestId('pdf-scroll')).toHaveAttribute('data-restored', '');
    const field = page.getByTestId('pdf-page-field');
    const link = page.locator('.page[data-page-number="1"] .annotationLayer .linkAnnotation > a').nth(0);
    const jumps: number[] = [];
    for (let i = 0; i < RUNS.historyJump + 1; i++) {
      await expect(link).toBeAttached();
      await link.scrollIntoViewIfNeeded();
      await link.click();
      await expect(field).toHaveValue('50');
      await expect(page.locator('.page[data-page-number="50"][data-loaded="true"]')).toBeAttached();
      await settle(page, 500);
      // Armed before the key: the first frame in which the viewer is on page 1 and page 1 is drawn (an event of its own when it
      // had to be drawn again, or the next frame when it still was). main's click is the start, on the same epoch clock.
      await page.evaluate(() => {
        const w = window as unknown as {
          __learnReader: { getState(): { handle: { viewer(): { currentPageNumber: number } } } };
          __jump?: Promise<number>;
          __jumpFrom?: number;
        };
        w.__jumpFrom = undefined;
        w.__jump = new Promise<number>((resolve) => {
          const look = () => {
            const drawn = document.querySelector('.page[data-page-number="1"][data-loaded="true"] canvas[role="presentation"]');
            if (drawn && w.__learnReader.getState().handle.viewer().currentPageNumber === 1) resolve(performance.timeOrigin + performance.now());
            else requestAnimationFrame(look);
          };
          requestAnimationFrame(look);
        });
      });
      const at = await runMenuAccelerator(app, 'nav.historyBack');
      const ms = (await page.evaluate(() => (window as unknown as { __jump: Promise<number> }).__jump)) - at;
      await expect(field).toHaveValue('1');
      if (i > 0) jumps.push(ms); // the first jump is a warm-up
      await settle(page);
    }
    const s = summary(jumps);
    save({ line: ['historyJump', s] });
    console.log('[measure] tabs history jump', JSON.stringify(s));
    expectWithinLimit('historyJump', s);
  } finally {
    await app.close();
  }
});

// ---- cold start with five saved tabs ---------------------------------------------------------------------------------------------

test('tabs budgets @3: cold start to app-ready with five saved tabs, 5 launches', { tag: '@perf' }, async () => {
  test.setTimeout(linuxCi ? 150_000 : 240_000);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-tabs-cold-'));
  const lib = path.join(tmp, 'library');
  const ud = path.join(tmp, 'userdata');
  try {
    // Session one saves five tabs (the paper shown) and ends; every launch after it starts from that record.
    const first = await launch(lib, ud);
    let ids: string[];
    try {
      const tabs = await seed(first.page);
      ids = tabs.map((t) => t.id);
      const value = { items: ids, active: ids[0]! };
      const r = await first.page.evaluate((v) => window.learn.settings.set({ key: 'ui.tabs', value: v }), value);
      expect(r.ok).toBe(true);
      const back = await first.page.evaluate(() => window.learn.settings.get({ key: 'ui.tabs' }));
      expect(back.ok && back.data).toEqual(value);
    } finally {
      await first.app.close();
    }
    const appReady: number[] = [];
    for (let i = 0; i < RUNS.coldStart; i++) {
      const s = await launch(lib, ud);
      try {
        const at = Number(await s.page.getByTestId('app-ready').getAttribute('data-at'));
        const m = await s.app.evaluate(() => (globalThis as { __learnPerf?: { processStart: number } }).__learnPerf!);
        expect(at * m.processStart, 'app-ready has a time').toBeGreaterThan(0);
        // The record was restored, not an empty window: five reader tabs and the paper shown.
        await expect(s.page.locator('[data-testid="tab"]:not([data-item-id="library"])')).toHaveCount(5);
        await expect(readerTab(s.page, ids[0]!)).toHaveAttribute('aria-selected', 'true');
        appReady.push(at - m.processStart);
      } finally {
        await s.app.close();
      }
    }
    const sum = summary(appReady);
    save({ line: ['coldStartFiveTabs', sum] });
    console.log('[measure] tabs cold start with five saved tabs', JSON.stringify(sum), 'median of the same read as perf.json:', median(appReady));
    expectWithinLimit('coldStartFiveTabs', sum);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
