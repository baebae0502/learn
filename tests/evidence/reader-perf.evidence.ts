// @perf — M7a spec 11 (reader-perf.json): the PDF reader's budgets over paper-100.pdf — the first page, the frames of a
// scroll, a zoom step, the first find match, the visible thumbnails, and a cached translation pop-up (fake engine only:
// nothing here reaches the real service). Linux CI fails beyond twice each budget (budget.ts); the Mac reports.
//
// Every end is a state of the page, as in organize-perf.evidence.ts: pdf.js's own `pagerendered` events (read from the
// reader's event bus through the E2E handle, window.__learnReader), or the first animation frame whose callback finds the
// DOM in the state the action leads to. Every start is an event's own timeStamp in the page (the double click, the input
// event, the pointer up) or, for a menu key, main's clock at the menu item's click (runMenuAccelerator, epoch-based).
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, backFromReader, importPaths, launch, openItem, runMenuCommand, translationCalls, translationFake } from '../e2e/helpers';
import { limitFailures } from './budget';
import { EVIDENCE_ROOT, writeJson } from './capture';
import { READER_BUDGET_MS, frameGaps, readerLimits } from './reader-perf-math';
import { spread, summary, tenth } from './p1-perf-math';

const linuxCi = process.platform === 'linux' && Boolean(process.env['CI']);
const RESULT = 'reader-perf.json';
const PAPER = path.join(FIXTURES, 'paper-100.pdf');
const S1 = 'Attention is all you need.';
const K1 = '주의가 필요한 전부입니다.';
/** spec 11: how many times each is measured. */
const RUNS = { firstPage: 5, zoomStep: 10, find: 5, thumbnails: 5, popup: 10 } as const;
/** The scroll: pixels per animation frame, over this many pages. */
const SCROLL_PX_PER_FRAME = 40;
const SCROLL_PAGES = 30;

// ---- reader-perf.json ---------------------------------------------------------------------------------------------------

function readSaved(): Record<string, unknown> {
  try {
    const old = JSON.parse(fs.readFileSync(path.join(EVIDENCE_ROOT, RESULT), 'utf8')) as Record<string, unknown>;
    return old['run'] === process.ppid ? old : {};
  } catch {
    return {};
  }
}
/** Merged into reader-perf.json after each test: a worker restarted after a failure keeps the sections before it. */
function save(patch: Record<string, unknown>): void {
  writeJson(
    RESULT,
    {
      ...readSaved(), ...patch, run: process.ppid, budgetMs: READER_BUDGET_MS, linuxCiFactor: 2,
      linuxCiLimitMs: Object.fromEntries(Object.entries(READER_BUDGET_MS).map(([k, v]) => [k, tenth(v * 2)])),
      platform: `${process.platform}-${process.arch}`, ci: process.env['CI'] ?? null, updatedAt: new Date().toISOString(),
    },
    'M7a spec 11: the PDF reader — first page, scroll frames, zoom step, first find match, visible thumbnails, cached translation pop-up',
  );
}

// ---- the page's side ------------------------------------------------------------------------------------------------------

/** What the page keeps once a reader is open: every `pagerendered` (page, scale, time) from the moment its event bus exists. */
async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __learnReader: { getState(): { handle: { eventBus(): { on(n: string, f: (e: never) => void): void } } | null }; subscribe(f: () => void): () => void };
      __rp?: { log: Array<{ page: number; scale: number; at: number }>; bus: unknown };
    };
    const rp = (w.__rp = { log: [] as Array<{ page: number; scale: number; at: number }>, bus: null as unknown });
    const attach = () => {
      const bus = w.__learnReader.getState().handle?.eventBus();
      if (!bus || rp.bus === bus) return;
      rp.bus = bus;
      bus.on('pagerendered', ((e: { pageNumber: number; source: { scale: number }; error?: unknown }) => {
        if (!e.error) rp.log.push({ page: e.pageNumber, scale: e.source.scale, at: performance.now() });
      }) as (e: never) => void);
    };
    w.__learnReader.subscribe(attach);
    attach();
  });
}

/** Opens the paper from the library list and waits for its first page; returns the time from the double click to page 1's `pagerendered`. */
async function openFirstPage(page: Page): Promise<number> {
  await page.evaluate(() => {
    (window as unknown as { __open?: number }).__open = undefined;
    window.addEventListener('dblclick', (e) => ((window as unknown as { __open?: number }).__open = e.timeStamp), { capture: true, once: true });
  });
  // The reader (and so its event bus) does not exist yet: the probe comes with the store's first change.
  await page.evaluate(() => {
    const w = window as unknown as { __learnReader: { subscribe(f: () => void): () => void; getState(): { handle: unknown } }; __first?: Promise<number> };
    w.__first = new Promise<number>((resolve) => {
      const stop = w.__learnReader.subscribe(() => {
        const handle = w.__learnReader.getState().handle as { eventBus(): { on(n: string, f: (e: never) => void): void } } | null;
        if (!handle) return;
        stop();
        handle.eventBus().on('pagerendered', ((e: { pageNumber: number; error?: unknown }) => {
          if (e.pageNumber === 1 && !e.error) resolve(performance.now());
        }) as (e: never) => void);
      });
    });
  });
  await openItem(page, 'paper-100');
  return page.evaluate(async () => {
    const w = window as unknown as { __open: number; __first: Promise<number> };
    return (await w.__first) - w.__open;
  });
}

const viewer = (page: Page) => page.getByTestId('pdf-viewer');
const shell = (page: Page) => page.getByTestId('shell');

async function openReader(page: Page): Promise<void> {
  await openItem(page, 'paper-100');
  await expect(viewer(page)).toHaveAttribute('data-pages', '100');
  await expect(viewer(page)).toHaveAttribute('data-rendered', /^[1-9]\d*$/);
}

async function seedPaper(page: Page): Promise<void> {
  const [item] = await importPaths(page, [PAPER]);
  expect(item?.title).toBe('paper-100');
}

test.beforeAll(() => {
  if (!fs.existsSync(PAPER)) throw new Error(`fixture missing: ${PAPER} — run \`pnpm fixtures\``);
});

// ---- first page, find, thumbnails: each from a document just opened -----------------------------------------------------

test('reader budgets @1: the first page (5 opens), the first find match (5) and the visible thumbnails (5), each on a freshly opened document', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(linuxCi ? 150_000 : 240_000);
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await seedPaper(page);

    // 1. First page: the open command (the double click) → the first `pagerendered` of page 1. One open first, unmeasured: the
    //    cold start of pdf.js's worker and module is not a reader's open.
    await openReader(page);
    await backFromReader(page);
    const first: number[] = [];
    for (let i = 0; i < RUNS.firstPage; i++) {
      first.push(await openFirstPage(page));
      await expect(viewer(page)).toHaveAttribute('data-pages', '100');
      await backFromReader(page);
    }
    save({ firstPage: { ...summary(first), runs: first.map(tenth) } });

    // 2. Find: "attention" typed into the find bar → the first `.highlight.selected` on screen, the debounce inside. A fresh
    //    document each time: the find controller keeps the text it has extracted.
    const find: number[] = [];
    for (let i = 0; i < RUNS.find; i++) {
      await openReader(page);
      await runMenuCommand(app, 'library.find');
      const input = page.getByTestId('pdf-find-field').getByRole('searchbox');
      await expect(input).toBeFocused();
      await page.evaluate(() => {
        const w = window as unknown as { __typed?: number; __shown?: Promise<number> };
        w.__typed = undefined;
        window.addEventListener('input', (e) => (w.__typed ??= e.timeStamp), { capture: true, once: true });
        w.__shown = new Promise<number>((resolve) => {
          const look = () => {
            const hit = document.querySelector('.pdf-scroll .highlight.selected');
            const r = hit?.getBoundingClientRect();
            if (r && r.width > 0 && r.height > 0) resolve(performance.now());
            else requestAnimationFrame(look);
          };
          requestAnimationFrame(look);
        });
      });
      await input.fill('attention');
      find.push(await page.evaluate(async () => (await (window as unknown as { __shown: Promise<number> }).__shown) - (window as unknown as { __typed: number }).__typed));
      await input.press('Escape');
      await backFromReader(page);
    }
    save({ findFirstMatch: summary(find) });

    // 3. Thumbnails: the list made from nothing — the sidebar's outline switched to its thumbnails (a hidden sidebar keeps a list
    //    that is already drawing, so showing it would time a half-drawn one) → every thumbnail in the list's view has its picture.
    //    The click's own timeStamp starts it; the list is a new one each run, its cache empty.
    const thumbs: number[] = [];
    await openReader(page);
    if ((await shell(page).getAttribute('data-sidebar')) !== 'shown') await runMenuCommand(app, 'view.toggleSidebar');
    await expect(shell(page)).toHaveAttribute('data-sidebar', 'shown');
    await backFromReader(page);
    for (let i = 0; i < RUNS.thumbnails; i++) {
      await openReader(page);
      await page.getByTestId('reader-nav-outline').click();
      await expect(page.getByTestId('pdf-thumbnails')).toHaveCount(0);
      await page.evaluate(() => {
        const w = window as unknown as { __clicked?: number; __thumbsShown?: Promise<number> };
        w.__clicked = undefined;
        window.addEventListener('click', (e) => (w.__clicked ??= e.timeStamp), { capture: true, once: true });
        w.__thumbsShown = new Promise<number>((resolve) => {
          const look = () => {
            const list = document.querySelector('[data-testid="pdf-thumbnails"]');
            if (list) {
              const box = list.getBoundingClientRect();
              const inView = [...list.querySelectorAll<HTMLElement>('[data-testid="pdf-thumb"]')].filter((t) => {
                const r = t.getBoundingClientRect();
                return r.bottom > box.top && r.top < box.bottom;
              });
              if (inView.length > 0 && inView.every((t) => t.querySelector('canvas[data-drawn]'))) {
                resolve(performance.now());
                return;
              }
            }
            requestAnimationFrame(look);
          };
          requestAnimationFrame(look);
        });
      });
      await page.getByTestId('reader-nav-thumbnails').click();
      thumbs.push(await page.evaluate(async () => (await (window as unknown as { __thumbsShown: Promise<number> }).__thumbsShown) - (window as unknown as { __clicked: number }).__clicked));
      await backFromReader(page);
    }
    save({ thumbnailsVisible: summary(thumbs) });
  } finally {
    await app.close();
  }
});

// ---- scroll frames and zoom steps: one open document -------------------------------------------------------------------------

test('reader budgets @2: the frame gaps of a 30-page scroll at the automatic fit, and ten zoom steps', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(linuxCi ? 150_000 : 240_000);
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await seedPaper(page);
    await installProbe(page); // before the reader: the probe follows the store, so no event of the first draw is missed
    await openReader(page);
    await expect(viewer(page)).toHaveAttribute('data-zoom', 'auto');

    // 4. Scroll: a constant distance on every animation frame down 30 pages; the gaps between the frames' own times.
    const times = await page.evaluate(
      async ({ px, pages }) => {
        const scroller = document.querySelector<HTMLElement>('[data-testid="pdf-scroll"]')!;
        const pageH = document.querySelector<HTMLElement>('.page[data-page-number="1"]')!.offsetHeight;
        const goal = pageH * pages;
        const stamps: number[] = [];
        scroller.scrollTop = 0;
        await new Promise((r) => requestAnimationFrame(r));
        const startTop = scroller.scrollTop;
        return await new Promise<{ stamps: number[]; pageH: number; moved: number }>((resolve) => {
          const step = (t: number) => {
            stamps.push(t);
            scroller.scrollTop += px;
            if (scroller.scrollTop - startTop >= goal || stamps.length > 20_000) resolve({ stamps, pageH, moved: scroller.scrollTop - startTop });
            else requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
      },
      { px: SCROLL_PX_PER_FRAME, pages: SCROLL_PAGES },
    );
    expect(times.moved, 'the scroll covered 30 pages').toBeGreaterThanOrEqual(times.pageH * SCROLL_PAGES);
    const gaps = frameGaps(times.stamps);
    const scroll = { ...spread(gaps), frames: times.stamps.length, pageHeightPx: times.pageH, pxPerFrame: SCROLL_PX_PER_FRAME, pages: SCROLL_PAGES, over33ms: gaps.filter((g) => g > 33.4).length };
    save({ scrollFrames: scroll });

    // 5. Zoom: ⌘+ from 100 % → every page in view drawn at the new scale. Back to 100 % between steps, drawn before the next.
    await page.evaluate(() => (window as unknown as { __learnReader: { getState(): { handle: { goToPage(n: number): void } } } }).__learnReader.getState().handle.goToPage(1));
    const zoom: number[] = [];
    for (let i = 0; i < RUNS.zoomStep + 1; i++) {
      await page.evaluate(async (scale) => {
        const w = window as unknown as { __learnReader: { getState(): { handle: { setZoom(z: number): void } } } };
        w.__learnReader.getState().handle.setZoom(scale);
      }, 1); // every step starts at 100 %
      await expect(viewer(page)).toHaveAttribute('data-scale', '1');
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      // 100 % is drawn before the step starts: the visible pages have an event at that scale.
      await expect
        .poll(() =>
          page.evaluate(() => {
            const rp = (window as unknown as { __rp: { log: Array<{ page: number; scale: number }> } }).__rp;
            const h = (window as unknown as { __learnReader: { getState(): { handle: { viewer(): { _getVisiblePages(): { views: Array<{ id: number }> } } } } } }).__learnReader.getState().handle;
            const seen = new Set(rp.log.filter((e) => Math.abs(e.scale - 1) < 1e-6).map((e) => e.page));
            const want = h.viewer()._getVisiblePages().views.map((v) => v.id);
            return want.length > 0 && want.every((p) => seen.has(p));
          }),
        )
        .toBe(true);
      const ms = await page.evaluate(async () => {
        const w = window as unknown as {
          __rp: { log: Array<{ page: number; scale: number; at: number }> };
          __learnReader: { getState(): { handle: { zoomIn(): void; viewer(): { currentScale: number; _getVisiblePages(): { views: Array<{ id: number }> } } } } };
        };
        const { handle } = w.__learnReader.getState();
        const from = w.__rp.log.length;
        const t0 = performance.now();
        handle.zoomIn();
        const scale = handle.viewer().currentScale;
        return await new Promise<number>((resolve) => {
          const look = () => {
            const done = w.__rp.log.slice(from).filter((e) => Math.abs(e.scale - scale) < 1e-6);
            const want = handle.viewer()._getVisiblePages().views.map((v) => v.id);
            if (want.length > 0 && want.every((p) => done.some((e) => e.page === p))) resolve(Math.max(...done.filter((e) => want.includes(e.page)).map((e) => e.at)) - t0);
            else requestAnimationFrame(look);
          };
          requestAnimationFrame(look);
        });
      });
      if (i > 0) zoom.push(ms); // the first step is a warm-up (the first draw at a new scale loads its fonts)
    }
    save({ zoomStep: summary(zoom) });
  } finally {
    await app.close();
  }
});

// ---- the cached translation pop-up ----------------------------------------------------------------------------------------------

test('reader budgets @3: the same sentence selected again → the pop-up shows its translation from the cache (fake engine)', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(linuxCi ? 120_000 : 200_000);
  const { app, page } = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    await seedPaper(page);
    await translationFake(app, 'ok');
    await page.evaluate(async () => {
      const r = await window.learn.prefs.get();
      if (!r.ok) throw new Error(r.code);
      const done = await window.learn.prefs.set({ translation: { ...r.data.translation, autoOnSelect: true, enabled: true } });
      if (!done.ok) throw new Error(done.code);
    });
    await openReader(page);
    await expect(page.locator('.page[data-page-number="1"] .textLayer span').first()).toBeAttached();
    const popup = page.getByTestId('selection-popup');
    const line = page.locator('.page[data-page-number="1"] .textLayer span', { hasText: S1 }).first();
    await expect(line).toBeVisible();

    /** A drag across the line; the clock starts at the pointer up (the pop-up comes right after it) and stops at the frame that shows the translation. */
    const select = async (): Promise<number> => {
      await page.evaluate(() => {
        const w = window as unknown as { __up?: number; __painted?: Promise<number> };
        w.__up = undefined;
        window.addEventListener('pointerup', (e) => (w.__up ??= e.timeStamp), { capture: true, once: true });
        w.__painted = new Promise<number>((resolve) => {
          const look = () => {
            const p = document.querySelector('[data-testid="selection-popup"]');
            if (p?.getAttribute('data-state') === 'done' && p.textContent?.includes('주의가 필요한 전부입니다.')) resolve(performance.now());
            else requestAnimationFrame(look);
          };
          requestAnimationFrame(look);
        });
      });
      const box = (await line.boundingBox())!;
      const y = box.y + box.height / 2;
      await page.mouse.move(box.x + 1, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 1, y, { steps: 8 });
      await page.mouse.up();
      return page.evaluate(async () => (await (window as unknown as { __painted: Promise<number> }).__painted) - (window as unknown as { __up: number }).__up);
    };
    const unselect = async () => {
      await page.evaluate(() => getSelection()!.removeAllRanges());
      await expect(popup).toHaveCount(0);
    };

    await select(); // the engine's answer, kept by main
    await expect(popup).toContainText(K1);
    expect(await translationCalls(app)).toBe(1);
    await unselect();
    const painted: number[] = [];
    for (let i = 0; i < RUNS.popup; i++) {
      painted.push(await select());
      await unselect();
    }
    expect(await translationCalls(app), 'every later selection came from the cache').toBe(1);
    save({ popupCachedPaint: { ...spread(painted), runs: painted.map(tenth) } });

    // The verdict for the whole file, once every section is in.
    const all = readSaved() as Record<string, { median?: number; p95?: number } | undefined>;
    const values = {
      firstPage: all['firstPage']?.median, scrollFrameP95: all['scrollFrames']?.p95, zoomStep: all['zoomStep']?.median,
      findFirstMatch: all['findFirstMatch']?.median, thumbnailsVisible: all['thumbnailsVisible']?.median, popupCachedPaint: all['popupCachedPaint']?.p95,
    };
    for (const [k, v] of Object.entries(values)) expect(typeof v, `${k} was measured`).toBe('number');
    const limits = readerLimits(values as Record<keyof typeof READER_BUDGET_MS, number>);
    const failures = limitFailures(limits);
    // Report-only: a value over its own budget but inside the 2x line (the scroll p95 sits at the 60 Hz frame) is said, not hidden.
    const overBudget = limits.filter((l) => l.value > l.budget).map((l) => `${l.what}: ${l.value} ms over its budget ${l.budget} ms`);
    save({ values, overBudget, overBudgetOnLinuxCiLine: failures });
    console.log('[measure] reader', JSON.stringify(values), overBudget.length ? `over budget: ${overBudget.join('; ')}` : 'within budget', failures.length ? `| over the 2x line: ${failures.join('; ')}` : '| within the 2x line');
    if (linuxCi) expect(failures).toEqual([]);
  } finally {
    await app.close();
  }
});
