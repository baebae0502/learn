// @perf — M5 organise: the spec 12 library (10,000 items, 200 collections, 50 tags, 30,000 memberships, 20,000 tag
// assignments, 50 duplicate groups) against its budgets. organize-perf.json; Linux CI fails beyond twice each budget, every
// other run reports. Search, palette and the list IPC over the same library are timed in perf.evidence.ts (library-perf.json).
//
// "Painted" is a state of the page, not a mark: each timing ends at the first animation frame whose callback — which runs
// just before that frame is drawn — finds the DOM in the state the action must lead to (the view's count and first row, a
// tag dot on the rows, a sidebar count). A stale or empty table cannot satisfy it. Starts are the event's own timeStamp,
// taken in the capture phase on the window, so nothing of ours runs before the clock starts.
import path from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FIXTURES, createCollection, importPaths, ipcCalls, launch, recordedPopupTimes, rowAt, seedRows, stubContextMenu } from '../e2e/helpers';
import { writeJson } from './capture';
import { limitFailures } from './budget';
import { seedOrganizeFixture, type ScopeFact } from './organize-fixture';
import { median } from './percentile';

/** spec 12, ms. Linux CI fails beyond twice each. */
const ORGANIZE_BUDGET_MS = { organizeIpc: 50, scopeSwitch: 100, tagFilter: 100, keyOneSelected: 100, keyAllSelected: 300, drop100: 200, contextMenu10k: 150 } as const;
const ITEMS = 10_000;
/** Every single-shot timing at least five times (spec 12). */
const RUNS = 5;
const DROP_ROWS = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tenth = (x: number) => Math.round(x * 10) / 10;

/** The markup of other tasks this test reads. */
const SEL = {
  row: '[data-testid="item-row"]',
  rowZero: '[data-testid="item-row"][data-index="0"]',
  count: '[data-testid="toolbar-count"]',
  navScope: (kind: string) => `nav-scope-${kind}`,
  navCollection: (id: string) => `nav-collection-${id}`,
  chip: (tagId: string) => `tag-chip-${tagId}`,
  dropTarget: (id: string) => `[data-testid="nav-collection-${id}"][data-drop-target]`,
} as const;

/** What the DOM must show for a timing to end; every field present must hold. */
interface Settled {
  /** The number in the toolbar's "N개" (the first number when "N개 / M개"). */
  count?: number;
  /** The id of row 0. */
  firstId?: string;
  /** A tag dot (`data-tag-id`) present (on) or absent (off) on the one row `itemId`, or on every mounted row. */
  dots?: { tagId: string; on: boolean; itemId?: string };
  /** The `.count` of a sidebar collection row. */
  sidebar?: { id: string; count: number };
}
interface OrgProbe {
  /** Starts waiting for the next `kind` event (synchronously: an event after this call returns is the one waited for). */
  after(kind: 'down' | 'key' | 'drop', spec: Settled): void;
  next(kind: 'menu'): void;
  /** The pending wait started last: ms from the event to the settled frame, or the event's epoch ms for `next`; null on a timeout. */
  result(): Promise<number | null>;
}
/** Installs the page-side clock and state check. Run once per page. */
function installProbe(page: Page): Promise<void> {
  return page.evaluate(
    (sel) => {
      const log: Record<'down' | 'key' | 'drop' | 'menu', number[]> = { down: [], key: [], drop: [], menu: [] };
      addEventListener('pointerdown', (e) => { if (e.button === 0) log.down.push(e.timeStamp); }, true);
      addEventListener('keydown', (e) => { if (e.key === '1' && !e.repeat) log.key.push(e.timeStamp); }, true);
      addEventListener('drop', (e) => { log.drop.push(e.timeStamp); }, true);
      addEventListener('contextmenu', (e) => { log.menu.push(e.timeStamp); }, true);
      const settled = (s: Settled): boolean => {
        if (s.count !== undefined) {
          const m = /^[\d,]+/.exec(document.querySelector(sel.count)?.textContent ?? '');
          if (!m || Number(m[0].replace(/,/g, '')) !== s.count) return false;
        }
        if (s.firstId !== undefined && document.querySelector(sel.rowZero)?.getAttribute('data-item-id') !== s.firstId) return false;
        if (s.dots) {
          const { tagId, on, itemId } = s.dots;
          const rows = itemId === undefined ? [...document.querySelectorAll(sel.row)] : [document.querySelector(`${sel.row}[data-item-id="${itemId}"]`)].flatMap((r) => (r ? [r] : []));
          if (rows.length === 0) return false;
          if (!rows.every((r) => (r.querySelector(`[data-tag-id="${tagId}"]`) !== null) === on)) return false;
        }
        if (s.sidebar) {
          const el = document.querySelector(`[data-testid="nav-collection-${s.sidebar.id}"] .count`);
          if (Number(el?.textContent ?? 0) !== s.sidebar.count) return false;
        }
        return true;
      };
      const arrival = (kind: keyof typeof log): Promise<number | null> => {
        const seen = log[kind].length;
        return (async () => {
          const until = performance.now() + 5000;
          while (log[kind].length === seen) {
            if (performance.now() > until) return null;
            await new Promise((r) => setTimeout(r, 2));
          }
          return log[kind][seen]!;
        })();
      };
      let pending: Promise<number | null> = Promise.resolve(null);
      (window as unknown as { __learnOrg: OrgProbe }).__learnOrg = {
        after(kind, spec) {
          const arrived = arrival(kind);
          pending = arrived.then(
            (t0) =>
              t0 === null
                ? null
                : new Promise<number | null>((resolve) => {
                    const check = () => {
                      const now = performance.now();
                      if (settled(spec)) resolve(now - t0);
                      else if (now - t0 > 10000) resolve(null);
                      else requestAnimationFrame(check);
                    };
                    requestAnimationFrame(check);
                  }),
          );
        },
        next(kind) {
          pending = arrival(kind).then((t0) => (t0 === null ? null : performance.timeOrigin + t0));
        },
        result: () => pending,
      };
    },
    { row: SEL.row, rowZero: SEL.rowZero, count: SEL.count },
  );
}

/**
 * The tree draws only the rows near its visible part (Virtualizer), so in a short window, such as the Mac runner's 768 px
 * screen, a collection far down the list is not on the page until the tree scrolls to it: scroll from the top until it is.
 */
async function revealNavRow(page: Page, testId: string): Promise<void> {
  const row = page.getByTestId(testId);
  const tree = page.getByTestId('sidebar-tree');
  if ((await row.count()) === 0) {
    await tree.evaluate((e) => e.scrollTo(0, 0));
    for (let i = 0; i < 60 && (await row.count()) === 0; i++) {
      const moved = await tree.evaluate((e) => {
        const before = e.scrollTop;
        e.scrollBy(0, Math.max(1, Math.floor(e.clientHeight * 0.8)));
        return e.scrollTop !== before;
      });
      if (!moved) break;
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
  }
  await row.scrollIntoViewIfNeeded();
}

/**
 * Arms the clock for the next `kind` event; the page has the wait registered when this returns, so an action sent right
 * after it (a key press needs no actionability wait) cannot be missed. Await the returned function after the action.
 */
async function arm(page: Page, kind: 'down' | 'key' | 'drop', spec: Settled): Promise<() => Promise<number | null>> {
  await page.evaluate(([k, sp]) => (window as unknown as { __learnOrg: OrgProbe }).__learnOrg.after(k, sp), [kind, spec] as const);
  return () => page.evaluate(() => (window as unknown as { __learnOrg: OrgProbe }).__learnOrg.result());
}

/** Call counts once none has changed for `quietMs`: what an action started has finished. */
async function settleCalls(app: ElectronApplication, quietMs = 300): Promise<Record<string, number>> {
  let last = JSON.stringify(await ipcCalls(app));
  let since = Date.now();
  while (Date.now() - since < quietMs) {
    await sleep(60);
    const now = JSON.stringify(await ipcCalls(app));
    if (now !== last) {
      last = now;
      since = Date.now();
    }
  }
  return JSON.parse(last) as Record<string, number>;
}
const grew = (before: Record<string, number>, after: Record<string, number>, channel: string) => (after[channel] ?? 0) - (before[channel] ?? 0);

/** The search index is built at an idle moment after each list (useSearch): wait until no new build starts, so that long task lands in no timing. */
async function settleIndex(page: Page, app: ElectronApplication): Promise<void> {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => performance.getEntriesByName('learn:search:index', 'measure').length);
    if (n > 0 && n === last) break;
    last = n;
    await sleep(700);
  }
  await settleCalls(app, 500);
}

const summary = (runs: readonly number[]) => ({ runs: runs.map(tenth), median: tenth(median(runs)), max: tenth(Math.max(...runs)) });

test('10,000 items with the organise fixture: organise IPC, view switch, tag filter, key 1, drop, context menu (organize-perf.json)', { tag: '@perf' }, async ({}, testInfo) => {
  const linuxCi = process.platform === 'linux' && Boolean(process.env['CI']);
  // On Linux CI the whole test, seeding included, ends within 120 s (one session, no restart; the limit stops a hang; a loaded host took 53-80 s).
  test.setTimeout(linuxCi ? 120_000 : 240_000);
  const s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  try {
    const { app, page } = s;
    const shownTotal = async () => Number(/^\d+/.exec((await page.locator(SEL.count).textContent()) ?? '')?.[0] ?? 0);

    // 1. The library: one real PDF, 10,000 items sharing its file, then the organise fixture over all 10,001.
    const [from] = await importPaths(page, [path.join(FIXTURES, 'sample.pdf')]);
    const added = await app.evaluate(
      (_electron, input) => (globalThis as unknown as { __learnTest: { seedItems(i: typeof input): number } }).__learnTest.seedItems(input),
      { fromItemId: from!.id, rows: seedRows(ITEMS) },
    );
    expect(added, 'main added every seeded row, in one transaction').toBe(ITEMS);
    await expect.poll(shownTotal, { timeout: 30_000 }).toBeGreaterThanOrEqual(ITEMS);
    const org = await seedOrganizeFixture(app, page);
    const { facts, n } = org.fixture;
    await expect(page.getByTestId(SEL.navScope('duplicates'))).toBeVisible();
    await expect(page.getByTestId(SEL.navCollection(org.collectionIds[0]!))).toBeVisible();
    await expect.poll(shownTotal, { timeout: 30_000 }).toBe(n);
    await settleIndex(page, app);
    await installProbe(page);

    // 2. library:organize, in the page as the sidebar calls it; the payload size explains a slow one.
    const organise = await page.evaluate(async (runs) => {
      const out: number[] = [];
      for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        const r = await window.learn.library.organize();
        if (!r.ok) throw new Error(`library.organize failed: ${r.code}`);
        out.push(performance.now() - t0);
      }
      const r = await window.learn.library.organize();
      return { out, bytes: r.ok ? new TextEncoder().encode(JSON.stringify(r.data)).length : 0 };
    }, RUNS);

    // 3. View switches: three top-level collections and the special views, twice around; none reads anything from main.
    const [all, rootA, rootB, rootC, unfiled, duplicates] = [
      facts.scopes.find((f) => f.kind === 'all')!,
      ...facts.scopes.filter((f) => f.kind === 'collection'),
      facts.scopes.find((f) => f.kind === 'unfiled')!,
      facts.scopes.find((f) => f.kind === 'duplicates')!,
    ] as [ScopeFact, ScopeFact, ScopeFact, ScopeFact, ScopeFact, ScopeFact];
    const rowOf = (f: ScopeFact) => (f.kind === 'collection' ? SEL.navCollection(org.collectionIds[f.collection!]!) : SEL.navScope(f.kind));
    const ring = [rootA, unfiled, rootB, duplicates, rootC, all];
    const switchMs: Array<{ view: string; ms: number }> = [];
    const beforeSwitches = await settleCalls(app, 500);
    for (const f of [...ring, ...ring]) {
      await revealNavRow(page, rowOf(f)); // before the clock starts: the scroll is not part of the switch
      const waiting = await arm(page, 'down', { count: f.count, firstId: org.ids[f.first]! });
      await page.getByTestId(rowOf(f)).click();
      const ms = await waiting();
      expect(ms, `the table showed ${f.label} (${f.count} items) within 10 s`).not.toBeNull();
      switchMs.push({ view: f.label, ms: ms! });
      await settleCalls(app, 200);
    }
    const afterSwitches = await settleCalls(app, 500);
    expect(grew(beforeSwitches, afterSwitches, 'library:list'), 'a view switch does not read the item list').toBe(0);
    expect(grew(beforeSwitches, afterSwitches, 'library:organize'), 'a view switch does not read the snapshot').toBe(0);

    // 4. Tag filter: the first five tags on, then off (the library is on "all" again).
    const filterOn: number[] = [];
    const filterOff: number[] = [];
    const beforeFilter = await settleCalls(app, 300);
    for (let t = 0; t < RUNS; t++) {
      for (const on of [true, false]) {
        const waiting = await arm(page, 'down', on ? { count: facts.tagCount[t]!, firstId: org.ids[facts.tagFirst[t]!]! } : { count: n, firstId: org.ids[0]! });
        await page.getByTestId(SEL.chip(org.tagIds[t]!)).click();
        const ms = await waiting();
        expect(ms, `the table ${on ? 'narrowed to' : 'came back from'} tag ${t} within 10 s`).not.toBeNull();
        (on ? filterOn : filterOff).push(ms!);
        await settleCalls(app, 200);
      }
    }
    const afterFilter = await settleCalls(app, 300);
    expect(grew(beforeFilter, afterFilter, 'library:list') + grew(beforeFilter, afterFilter, 'library:organize'), 'a tag filter reads nothing from main').toBe(0);

    // 5. Key 1 on one selected row: tag 0 (position 1) is on none of the first rows, so it goes on, off, on, off …
    const tag0 = org.tagIds[0]!;
    const key = async (spec: Settled): Promise<number> => {
      const waiting = await arm(page, 'key', spec);
      await page.keyboard.press('1');
      const ms = await waiting();
      expect(ms, 'the dots followed the key within 10 s').not.toBeNull();
      await settleCalls(app, 300);
      return ms!;
    };
    await rowAt(page, 0).click();
    const oneAdd: number[] = [];
    const oneRemove: number[] = [];
    for (let k = 0; k < 2 * RUNS; k++) {
      const on = k % 2 === 0;
      (on ? oneAdd : oneRemove).push(await key({ dots: { tagId: tag0, on, itemId: org.ids[0]! } }));
    }

    // 6. Key 1 on every item: the library has some items with the tag, so the first press adds it to all, the next takes it from all.
    await page.keyboard.press('ControlOrMeta+a');
    await expect(rowAt(page, 0)).toHaveAttribute('data-selected', /.*/);
    const allAdd: number[] = [];
    const allRemove: number[] = [];
    for (let k = 0; k < 2 * RUNS; k++) {
      const on = k % 2 === 0;
      (on ? allAdd : allRemove).push(await key({ dots: { tagId: tag0, on } }));
    }

    // 7. The context menu with everything selected: the page's contextmenu event → main's Menu.popup (stubbed: the OS draws the menu).
    await stubContextMenu(app, null);
    // the timing below is only the all-selected menu if the selection really is every item
    await expect(page.getByTestId('inspector-multi').locator('h2')).toHaveText('자료 10001개 선택');
    const menuMs: number[] = [];
    const beforeMenu = await settleCalls(app, 300);
    for (let i = 0; i < RUNS; i++) {
      const shown = (await recordedPopupTimes(app)).length;
      await page.evaluate(() => (window as unknown as { __learnOrg: OrgProbe }).__learnOrg.next('menu'));
      await rowAt(page, 0).click({ button: 'right' });
      const start = await page.evaluate(() => (window as unknown as { __learnOrg: OrgProbe }).__learnOrg.result());
      expect(start, 'the page saw the contextmenu event').not.toBeNull();
      await expect.poll(async () => (await recordedPopupTimes(app)).length, { timeout: 5000 }).toBe(shown + 1);
      const popupAt = (await recordedPopupTimes(app))[shown]!;
      menuMs.push(popupAt - start!);
      await settleCalls(app, 200);
    }
    expect(grew(beforeMenu, await settleCalls(app, 300), 'ui:showContextMenu'), 'one menu request per right click').toBe(RUNS);
    expect(menuMs.every((ms) => ms > 0 && ms < 3000), `popup times are on the page's clock: ${menuMs.join(', ')}`).toBe(true);

    // 8. Drop 100 rows on a collection: five empty collections, each takes the same first 100 rows by a real mouse drag.
    await page.getByTestId(SEL.navScope('all')).click();
    await expect.poll(shownTotal).toBe(n);
    const dropMs: number[] = [];
    const targets: string[] = [];
    let selectedAt = 0; // where the table was scrolled when the 100 rows were selected: row 99 is in view there
    const beforeDrop = await settleCalls(app, 300);
    for (let i = 0; i < RUNS; i++) {
      const targetId = await createCollection(page, `0 드롭 ${i + 1}`);
      await expect(page.getByTestId(SEL.navCollection(targetId))).toBeVisible();
      // 100 rows selected with the keyboard (⇧↓ 99 times), once: a drop leaves the selection as it is, so the next drag only needs row 99
      // (the cursor row, selected) mounted. Selecting again costs a hundred key presses per round and nothing the budget measures.
      const scroller = page.getByTestId('library-scroller');
      await scroller.evaluate((e, y) => void (e.scrollTop = y), selectedAt);
      if (i === 0 || (await rowAt(page, DROP_ROWS - 1).getAttribute('data-selected')) === null) {
        await scroller.evaluate((e) => void (e.scrollTop = 0));
        await rowAt(page, 0).click();
        await page.keyboard.down('Shift');
        for (let k = 1; k < DROP_ROWS; k++) await page.keyboard.press('ArrowDown');
        await page.keyboard.up('Shift');
        selectedAt = await scroller.evaluate((e) => e.scrollTop);
      }
      const source = rowAt(page, DROP_ROWS - 1);
      await expect(source).toHaveAttribute('data-selected', /.*/);
      const box = (await source.boundingBox())!;
      const to = (await page.getByTestId(SEL.navCollection(targetId)).boundingBox())!;
      const sx = box.x + 40;
      const sy = box.y + box.height / 2;
      const dx = to.x + 60;
      const dy = to.y + to.height / 2;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      await page.mouse.move(sx + 8, sy + 8, { steps: 4 });
      await page.mouse.move(dx, dy, { steps: 14 });
      for (let k = 1; k <= 3; k++) await page.mouse.move(dx + k, dy + 1); // the last dragover is the one that counts: Chromium thins them between moves
      await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      await expect(page.locator(SEL.dropTarget(targetId)), 'the drag is over the collection row').toBeVisible();
      const waiting = await arm(page, 'drop', { sidebar: { id: targetId, count: DROP_ROWS } });
      await page.mouse.up();
      const ms = await waiting();
      expect(ms, `the collection showed ${DROP_ROWS} items within 10 s`).not.toBeNull();
      dropMs.push(ms!);
      await settleCalls(app, 300);
      targets.push(targetId);
    }
    const afterDrop = await settleCalls(app, 300);
    expect(grew(beforeDrop, afterDrop, 'collections:addItems'), 'one addItems call per drop of 100 rows').toBe(RUNS);
    expect(grew(beforeDrop, afterDrop, 'library:list'), 'a drop does not read the item list').toBe(0);
    // each createCollection above asks for the snapshot once, and so does each drop
    expect(grew(beforeDrop, afterDrop, 'library:organize'), 'a drop reads the snapshot once').toBeLessThanOrEqual(2 * RUNS);
    // read only now: the check's own snapshot requests must not count as the drops'
    const members = await page.evaluate(async () => {
      const r = await window.learn.library.organize();
      return r.ok ? r.data.members : {};
    });
    for (const id of targets) expect([...(members[id] ?? [])].sort(), 'the drop filed exactly the 100 selected rows').toEqual(org.ids.slice(0, DROP_ROWS).sort());

    // Results.
    const result = {
      items: n,
      fixture: { collections: org.fixture.spec.collections, tags: org.fixture.spec.tags, coloured: org.fixture.spec.coloured, memberships: org.fixture.spec.memberships, assignments: org.fixture.spec.assignments, duplicateGroups: org.fixture.spec.duplicateGroups, duplicateItems: facts.duplicateItems },
      runs: RUNS,
      budgetMs: ORGANIZE_BUDGET_MS,
      linuxCiLimitMs: Object.fromEntries(Object.entries(ORGANIZE_BUDGET_MS).map(([k, v]) => [k, 2 * v])),
      organizeIpcMs: { ...summary(organise.out), bytes: organise.bytes },
      scopeSwitchMs: { views: switchMs.map((x) => ({ view: x.view, ms: tenth(x.ms) })), ...summary(switchMs.map((x) => x.ms)) },
      tagFilterMs: { on: summary(filterOn), off: summary(filterOff), median: tenth(median([...filterOn, ...filterOff])) },
      keyOneSelectedMs: { add: summary(oneAdd), remove: summary(oneRemove) },
      keyAllSelectedMs: { selected: n, add: summary(allAdd), remove: summary(allRemove) },
      dropMs: { rows: DROP_ROWS, ...summary(dropMs) },
      contextMenuMs: { selected: n, ...summary(menuMs), note: 'renderer contextmenu event to main Menu.popup call; the OS draws the menu after' },
      platform: `${process.platform}-${process.arch}`,
      ci: process.env['CI'] ?? null,
    };
    writeJson('organize-perf.json', result, 'M5 organise over 10,000 items: organise IPC, view switch, tag filter, key 1, drop of 100 rows, context menu (spec 12)');
    console.log(
      '[measure] organize',
      JSON.stringify({
        ipc: result.organizeIpcMs.median, bytes: organise.bytes, scope: result.scopeSwitchMs.median, filter: result.tagFilterMs.median,
        key1: [result.keyOneSelectedMs.add.median, result.keyOneSelectedMs.remove.median], keyAll: [result.keyAllSelectedMs.add.median, result.keyAllSelectedMs.remove.median],
        drop: result.dropMs.median, menu: result.contextMenuMs.median,
      }),
    );

    // spec 12: Linux CI fails beyond twice each budget (every failure listed); Mac values are reported.
    if (linuxCi) {
      const B = ORGANIZE_BUDGET_MS;
      expect(
        limitFailures([
          { what: 'library:organize, median', value: result.organizeIpcMs.median, budget: B.organizeIpc },
          { what: 'view switch → first row, median', value: result.scopeSwitchMs.median, budget: B.scopeSwitch },
          { what: 'tag filter on → painted, median', value: result.tagFilterMs.on.median, budget: B.tagFilter },
          { what: 'tag filter off → painted, median', value: result.tagFilterMs.off.median, budget: B.tagFilter },
          { what: 'key 1 → dot on one selected item, median', value: result.keyOneSelectedMs.add.median, budget: B.keyOneSelected },
          { what: 'key 1 → dot off one selected item, median', value: result.keyOneSelectedMs.remove.median, budget: B.keyOneSelected },
          { what: 'key 1 → dots on all selected items, median', value: result.keyAllSelectedMs.add.median, budget: B.keyAllSelected },
          { what: 'key 1 → dots off all selected items, median', value: result.keyAllSelectedMs.remove.median, budget: B.keyAllSelected },
          { what: 'drop of 100 rows → target count, median', value: result.dropMs.median, budget: B.drop100 },
          { what: 'context menu, all items selected → popup, median', value: result.contextMenuMs.median, budget: B.contextMenu10k },
        ]),
      ).toEqual([]);
    }
  } finally {
    await s.app.close();
  }
});
