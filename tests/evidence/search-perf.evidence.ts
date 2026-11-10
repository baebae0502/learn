// @perf — M7c body search (spec 13): 1,000 PDFs of 12 pages and 4,000 characters (12,000 page texts) against the 300 ms of
// search.body at p95 and the 100 ms of search.pages, the same 100 ms for search.pages on one 1,000-page book of that library,
// the table's scroll while twenty papers are being indexed (p95 of the frame gap at 16.7 ms), the index's throughput and the
// DB size. search-perf.json; Linux CI fails beyond twice each budget, every other run reports.
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { distinctPdfs, importPaths, launch, seedBodyText, textExtraction, textIdle, textState, textStats } from '../e2e/helpers';
import { writeJson } from './capture';
import { limitFailures, type Limit } from './budget';
import { median, percentile } from './percentile';

const BUDGET = { body: 300, pages: 100, bookPages: 100, scrollP95: 16.7 } as const;
// Two-letter, three-letter, absent (index and scan), Korean and English, and two words on one page.
const QUERIES = ['형광', '세포', 'zq', '현미경', 'transduction', '단백질 신호', 'xylophone'] as const;
const REPEATS = 20;
// On (nearly) every page of the thousand papers, and on the book's last page only.
const BOOK_WORD = 'transduction';
const tenth = (x: number) => Math.round(x * 10) / 10;

test('body search over 1,000 PDFs, and the table while twenty papers index', { tag: '@perf' }, async ({}, testInfo) => {
  test.setTimeout(600_000);
  const library = testInfo.outputPath('library');
  const s = await launch(library, testInfo.outputPath('userdata'));
  try {
    const t0 = Date.now();
    const seeded = await seedBodyText(s.app, { docs: 1000, pages: 12, chars: 4000, seed: 42 });
    const seedMs = Date.now() - t0;
    expect(seeded.itemIds).toHaveLength(1000);
    await expect(s.page.getByTestId('toolbar-count')).toContainText(/1,?000/);

    // search.body: the round trip as the page sees it. The first of each query runs on a cold statement and is kept apart.
    const body = await s.page.evaluate(
      async ({ queries, repeats }) => {
        const values: number[] = [];
        const first: number[] = [];
        const hits: Record<string, number> = {};
        for (const query of queries) {
          for (let i = 0; i < repeats; i++) {
            const t = performance.now();
            const r = await window.learn.search.body({ query });
            const ms = performance.now() - t;
            if (!r.ok) throw new Error(`search.body ${query}: ${r.code}`);
            if (i === 0) {
              first.push(ms);
              hits[query] = r.data.itemIds.length;
            }
            values.push(ms);
          }
        }
        return { values, first, hits };
      },
      { queries: [...QUERIES], repeats: REPEATS },
    );
    expect(body.values).toHaveLength(QUERIES.length * REPEATS);
    expect(body.hits['형광'], 'the seeded library answers a query that occurs').toBeGreaterThan(0);
    expect(body.hits['zq'], 'and one that never occurs finds nothing').toBe(0);
    // The queries the budget is measured with answer too, so a fast answer is not a fast empty one.
    for (const q of ['현미경', 'transduction', '단백질 신호']) expect(body.hits[q], `the seeded library has hits for ${q}`).toBeGreaterThan(0);
    expect(body.hits['xylophone'], 'and none for xylophone').toBe(0);

    // search.pages: a random item (LCG, seed 7) for each query.
    const pages = await s.page.evaluate(
      async ({ queries, ids, per }) => {
        let x = 7;
        const next = () => {
          x = (Math.imul(1103515245, x) + 12345) & 0x7fffffff;
          return x >>> 8;
        };
        const values: number[] = [];
        let withPages = 0;
        for (const query of queries) {
          for (let i = 0; i < per; i++) {
            const itemId = ids[next() % ids.length]!;
            const t = performance.now();
            const r = await window.learn.search.pages({ itemId, query });
            const ms = performance.now() - t;
            if (!r.ok) throw new Error(`search.pages ${query}: ${r.code}`);
            if (r.data.pages.length > 0) withPages++;
            values.push(ms);
          }
        }
        return { values, withPages };
      },
      { queries: [...QUERIES], ids: seeded.itemIds, per: 20 },
    );
    expect(pages.withPages, 'some of the sampled items have matching pages').toBeGreaterThan(0);

    const dbBytes = ['library.sqlite', 'library.sqlite-wal'].reduce((n, f) => {
      const file = path.join(library, f);
      return n + (fs.existsSync(file) ? fs.statSync(file).size : 0);
    }, 0);

    // search.pages on one 1,000-page book of the same library, for a word the book has on its last page only: a plan whose cost
    // grows with the file's length pays here for every page, and the papers' matches of the word are many.
    const book = await seedBodyText(s.app, { docs: 1, pages: 1000, chars: 4000, seed: 43, rare: BOOK_WORD });
    const bookPages = await s.page.evaluate(
      async ({ itemId, query, repeats }) => {
        const values: number[] = [];
        let answer: { pages: number[]; total: number } | null = null;
        for (let i = 0; i < repeats; i++) {
          const t = performance.now();
          const r = await window.learn.search.pages({ itemId, query });
          const ms = performance.now() - t;
          if (!r.ok) throw new Error(`search.pages on the book: ${r.code}`);
          answer = { pages: r.data.pages.map((p) => p.pageIndex), total: r.data.total };
          values.push(ms);
        }
        return { values, answer };
      },
      { itemId: book.itemIds[0]!, query: BOOK_WORD, repeats: REPEATS },
    );
    expect(bookPages.answer, 'the word is on the book\'s last page only').toEqual({ pages: [999], total: 1 });

    // The table's scroll while twenty 100-page papers are read: 40 px every frame, as the 10,000-item scroll in perf.evidence.ts.
    const copies = distinctPdfs(testInfo.outputPath('copies'), 20, 'paper-100.pdf');
    const imported = await importPaths(s.page, copies);
    expect(imported).toHaveLength(20);
    const before = await textStats(s.app);
    await textExtraction(s.app, 'now');
    // How the index started (its first job starts inside the call above) and, after textIdle, how it ended: kept on every run,
    // so a run that passes still shows whether each step of the main window's first idle returned. The first snapshot keeps
    // the start even when a longer run fills the trail (it keeps the newest 64 steps).
    const started = await textState(s.app);
    const scroll = await s.page.evaluate(async () => {
      const target = document.querySelector<HTMLElement>('[data-testid="library-scroller"]')!;
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
    const during = await textStats(s.app);
    expect(scroll.scrolledTo, 'the table scrolled').toBeGreaterThan(0);
    await textIdle(s.app);
    const after = await textStats(s.app);
    const indexState = { started, idle: await textState(s.app) };
    await testInfo.attach('textState', { body: JSON.stringify(indexState, null, 2), contentType: 'application/json' });
    expect(after.pagesWritten - before.pagesWritten, 'twenty papers of 100 pages were read').toBe(2000);

    const scrollFrames = scroll.deltas.map(tenth);
    const p95 = (xs: number[]) => tenth(percentile(xs, 95));
    const values = { body: p95(body.values), pages: p95(pages.values), bookPages: p95(bookPages.values), scrollP95: p95(scrollFrames) };
    const batchMs = after.batchMs.slice(before.batchMs.length);
    const throughput = {
      pagesPerSecond: tenth(((after.pagesWritten - before.pagesWritten) / (after.activeMs - before.activeMs)) * 1000),
      pagesWrittenWhileScrolling: during.pagesWritten - before.pagesWritten,
    };
    const result = {
      budgetMs: BUDGET,
      values,
      bodyMs: { median: tenth(median(body.values)), max: tenth(Math.max(...body.values)), samples: body.values.length },
      pagesMs: { median: tenth(median(pages.values)), max: tenth(Math.max(...pages.values)), samples: pages.values.length },
      bookPagesMs: { pages: 1000, word: BOOK_WORD, median: tenth(median(bookPages.values)), max: tenth(Math.max(...bookPages.values)), samples: bookPages.values.length },
      firstQueryMs: Object.fromEntries(QUERIES.map((q, i) => [q, tenth(body.first[i]!)])),
      hits: body.hits,
      dbBytes,
      seedMs,
      scrollFrames: scrollFrames.length,
      throughput,
      batchMs: { median: batchMs.length ? tenth(median(batchMs)) : null, max: batchMs.length ? tenth(Math.max(...batchMs)) : null, batches: batchMs.length },
      overBudget: Object.entries(values).filter(([k, v]) => v > BUDGET[k as keyof typeof BUDGET]).map(([k]) => k),
      platform: `${process.platform}-${process.arch}`,
      ci: process.env['CI'] ?? null,
      textState: indexState,
    };
    writeJson('search-perf.json', result, 'M7c body search: search.body and search.pages p95 over 1,000 PDFs, search.pages on a 1,000-page book, the table scroll while twenty papers index, throughput, DB size');
    console.log('[measure] search-perf', JSON.stringify({ values, bookPagesMs: result.bookPagesMs, firstQueryMs: result.firstQueryMs, dbBytes, seedMs, throughput, batchMs: result.batchMs, firstIdle: indexState.idle.main?.firstIdle ?? null }));
    expect(throughput.pagesWrittenWhileScrolling, 'the index was working while the table scrolled').toBeGreaterThan(0);

    if (process.platform === 'linux' && process.env['CI']) {
      const limits: Limit[] = [
        { what: 'search.body p95', value: values.body, budget: BUDGET.body },
        { what: 'search.pages p95', value: values.pages, budget: BUDGET.pages },
        { what: 'search.pages p95 on a 1,000-page book, a word on its last page only', value: values.bookPages, budget: BUDGET.bookPages },
        { what: 'scroll frame gap p95', value: values.scrollP95, budget: BUDGET.scrollP95 },
      ];
      expect(limitFailures(limits)).toEqual([]);
    }
  } finally {
    await s.app.close();
  }
});
