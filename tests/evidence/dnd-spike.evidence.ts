// @perf — M5 Task 1 drag-and-drop spike (branch m5-spike only, never merged): RAC useDrag/useDrop/Tree against the real
// virtualized LibraryTable (10,000 rows) and 200 collections, on ?window=spike. Report only: nothing here fails the run;
// dnd-spike.json says per check ok / how / value.
import fs from 'node:fs';
import { test } from '@playwright/test';
import { launch, type Session } from '../e2e/helpers';
import { IS_MAC } from './capture';
import {
  BUDGET, api, beginDrag, br, cancelDrag, createReport, frames, hover, limit, marked, openSpike, pct, r1, release, stats, tableRow, treeRow,
} from './dnd-measure';

const TAG = { tag: '@perf' };
const MIME_ITEMS = 'application/x-learn-items+json';
const report = createReport('dnd-spike.json', 'M5 Task 1 drag-and-drop spike: RAC useDrag/useDrop/Tree, 10,000 rows, 200 collections (ADR-0004 M5 끌어 놓기)');

test.describe.configure({ mode: 'serial' });
let s: Session;
let scratch = '';
test.beforeAll(async ({}, testInfo) => {
  scratch = testInfo.outputPath('files');
  s = await launch(testInfo.outputPath('library'), testInfo.outputPath('userdata'));
  s.page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 400)));
});
test.afterAll(async () => {
  report.save();
  await s?.app.close();
});

const idOf = (i: number) => `item-${String(i).padStart(5, '0')}`;

// ---- R1 ---------------------------------------------------------------------------------------------------------
test('R1: a row drag on the virtualized grid carries our MIME, a "자료 N개" preview, and starts within budget', TAG, async () => {
  test.setTimeout(150_000);
  const page = s.page;
  await report.guard('R1', async () => {
    const per: Record<string, unknown> = {};
    let allOk = true;
    for (const n of [1, 1000]) {
      await openSpike(page);
      if (n === 1000) await api(page, 'selectRange', 0, 1000);
      const startMs: number[] = [];
      const getItemsMs: number[] = [];
      // Four start/cancel cycles for the timing; the fifth drops on a collection for the payload.
      for (let cycle = 0; cycle < 5; cycle++) {
        await beginDrag(page, tableRow(page, 5));
        const last = await br(page, (b) => b.starts[b.starts.length - 1]!);
        startMs.push(last.pointerToDone);
        getItemsMs.push(last.getItems);
        if (cycle < 4) await cancelDrag(page);
      }
      const selSizeMidDrag = await api<number>(page, 'selectionSize');
      await hover(page, treeRow(page, 'c001'));
      await release(page);
      const out = await br(page, (b) => ({ drop: b.drops[b.drops.length - 1], types: b.dropTypes, payload: b.dropPayload, previews: b.previews.slice(-1)[0], ends: b.ends.length }));
      const expected = n === 1 ? [idOf(5)] : Array.from({ length: 1000 }, (_, i) => idOf(i));
      const ids = out.drop?.ids ?? [];
      const payloadOk = (JSON.parse(out.payload || '{}') as { itemIds?: string[] }).itemIds?.length === expected.length;
      const idsOk = ids.length === expected.length && ids.every((id, i) => id === expected[i]);
      const previewOk = n === 1 ? out.previews?.badge === null : out.previews?.badge === `자료 ${n}개`;
      const timeOk = pct(startMs, 50) <= limit(BUDGET.dragStart);
      const selOk = n === 1 ? selSizeMidDrag === 1 : selSizeMidDrag === 1000;
      const ok = out.types.includes(MIME_ITEMS) && payloadOk && idsOk && previewOk && selOk && timeOk;
      allOk &&= ok;
      per[`n${n}`] = { ok, types: out.types, idsOk, payloadOk, previewOk, preview: out.previews, selSizeMidDrag, startMs: stats(startMs), getItemsMs: stats(getItemsMs), timeOk };
    }
    report.check('R1', allOk, 'workaround: useDrag{hasDragButton:true, preview ref}; table keeps a multi-selection on press until release', per);
  });
});

// ---- R2 ---------------------------------------------------------------------------------------------------------
test('R2: the drag survives the source row leaving the virtualizer (scroll, list refetch)', TAG, async () => {
  test.setTimeout(150_000);
  const page = s.page;
  await report.guard('R2', async () => {
    const out: Record<string, unknown> = {};
    const inSelection = () => api(page, 'selectRange', 0, 10);
    const scenarios: Array<{ name: string; pin: boolean; pre?(): Promise<unknown>; count?: number; mutate(): Promise<unknown> }> = [
      // Pressing a row makes it the table's cursor row, which the table already keeps mounted: a plain drag cannot lose its source.
      { name: 'scroll', pin: false, mutate: () => api(page, 'scrollTable', 60_000) },
      // A press inside a multi-selection keeps the cursor where it was, so the dragged row can leave the window.
      { name: 'scrollInSelection', pin: false, pre: inSelection, count: 10, mutate: () => api(page, 'scrollTable', 60_000) },
      { name: 'scrollInSelectionPinned', pin: true, pre: inSelection, count: 10, mutate: () => api(page, 'scrollTable', 60_000) },
      { name: 'removed', pin: false, mutate: async () => api(page, 'removeItem', idOf(5)) },
      { name: 'refetchSame', pin: false, mutate: () => api(page, 'refetch') },
    ];
    for (const sc of scenarios) {
      await openSpike(page);
      await page.evaluate((pin) => void (window.__dnd!.pin = pin), sc.pin);
      await sc.pre?.();
      await beginDrag(page, tableRow(page, 5));
      const source = idOf(5);
      await sc.mutate();
      await frames(page, 4);
      const stillMounted = (await page.locator(`[data-item-id="${source}"]`).count()) > 0;
      await hover(page, treeRow(page, 'c001'));
      const highlighted = await marked(page);
      await release(page);
      const r = await br(page, (b) => ({ drops: b.drops, ends: b.ends, native: b.nativeDragends, dragging: b.dragging, source: b.draggingRowId }));
      out[sc.name] = {
        sourceMountedAfterMutation: stillMounted, dropIds: r.drops.map((d) => d.ids), onDragEndCalls: r.ends.length, onDragEndBeforeDrop: r.ends[0] && r.drops[0] ? r.ends[0].at < r.drops[0].at : null,
        onDragEndOp: r.ends.map((e) => e.op), nativeDragendEvents: r.native, windowDragFlagStuck: r.dragging, highlighted,
        ok: r.drops.length === 1 && r.drops[0]!.ids.includes(source) && r.drops[0]!.ids.length === (sc.count ?? 1) && r.ends.length === 1 && r.source === null,
      };
    }
    const o = out as Record<string, { ok: boolean; sourceMountedAfterMutation: boolean }>;
    const base = o['scroll']!.ok && o['removed']!.ok && o['refetchSame']!.ok;
    const lostSource = !o['scrollInSelection']!.sourceMountedAfterMutation;
    const natural = base && o['scrollInSelection']!.ok;
    const ok = natural || (base && o['scrollInSelectionPinned']!.ok);
    report.check('R2', ok, natural ? 'native (the pressed row takes the focus and so is the table\'s cursor row, which LibraryTable\'s rangeExtractor already keeps mounted; for an item that leaves the list RAC useDrag calls onDragEnd(cancel) from its unmount cleanup and the drop still delivers)' : 'workaround: pin the dragged row in the virtualizer', { ...out, sourceCanLeaveTheWindow: lostSource });
  });
});

// ---- T1 ---------------------------------------------------------------------------------------------------------
async function treeState(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    selected: (window.__dnd!.api as unknown as Record<string, () => unknown>)['selected']!() as string[],
    focus: (window.__dnd!.api as unknown as Record<string, () => unknown>)['treeFocus']!() as string | null,
    expanded: (window.__dnd!.api as unknown as Record<string, () => unknown>)['expanded']!() as string[],
  }));
}

test('T1: RAC Tree of 200 collections — selection follows focus, → ← Home End, no type-ahead, double-click toggles, ↩ is an action', TAG, async () => {
  test.setTimeout(150_000);
  const page = s.page;
  await report.guard('T1', async () => {
    const out: Record<string, unknown> = {};
    await openSpike(page);
    await treeRow(page, 'c000').click();
    const trace: Array<[string, Awaited<ReturnType<typeof treeState>>]> = [];
    const press = async (key: string) => {
      await page.keyboard.press(key);
      await frames(page, 1);
      const st = await treeState(page);
      trace.push([key, st]);
      return st;
    };
    const follow: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      const st = await press('ArrowDown');
      follow.push(st.selected.length === 1 && st.selected[0] === st.focus);
    }
    const home = await press('Home');
    const end = await press('End');
    await press('Home');
    const collapse = await press('ArrowLeft'); // expanded -> collapse
    const expand = await press('ArrowRight'); // collapsed -> expand
    // ← on a collapsed child goes to the parent (selection follows); → on c008 expands it, → again goes to its first child.
    await treeRow(page, 'c008').click();
    const toParent = await press('ArrowLeft');
    await treeRow(page, 'c008').click();
    const expandChild = await press('ArrowRight');
    const toChild = await press('ArrowRight');
    out['trace'] = trace;
    const arrowsOk =
      !collapse.expanded.includes('c000') && expand.expanded.includes('c000') && toParent.focus === 'c000' && toParent.selected[0] === 'c000' && expandChild.expanded.includes('c008') && toChild.focus === 'c040' && toChild.selected[0] === 'c040';
    out['arrows'] = { collapseOk: !collapse.expanded.includes('c000'), expandOk: expand.expanded.includes('c000'), toParent, expandChild, toChild };
    // Double click toggles expansion.
    await press('End');
    const before = (await treeState(page)).expanded.includes('c001');
    await treeRow(page, 'c001').dblclick();
    const afterOne = (await treeState(page)).expanded.includes('c001');
    await treeRow(page, 'c001').dblclick();
    const afterTwo = (await treeState(page)).expanded.includes('c001');
    out['doubleClick'] = { before, afterOne, afterTwo, actions: await br(page, (b) => b.actions) };
    // Enter is an action by key.
    await treeRow(page, 'c002').click();
    await page.keyboard.press('Enter');
    await frames(page, 2);
    const entered = await br(page, (b) => b.actions.slice(-1)[0]);
    out['enter'] = { lastAction: entered, editing: await api(page, 'editing') };
    await page.keyboard.press('Escape');
    // Type-ahead, three ways (RAC default, untyped prop, wrapper above the Tree).
    const type = async (query: string) => {
      await openSpike(page, query);
      await treeRow(page, 'c000').click();
      await page.keyboard.press('Home');
      const cdp = await page.context().newCDPSession(page);
      for (const ch of '과목 003') {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      }
      await frames(page, 2);
      const t = await treeState(page);
      await cdp.detach();
      return t;
    };
    const on = await type('&typeahead=on');
    const prop = await type('&typeahead=prop');
    const wrap = await type('&typeahead=wrap');
    out['typeAhead'] = { rac: on, untypedProp: prop, wrapper: wrap };
    const racMoves = on.focus !== 'c000';
    const wrapStops = wrap.focus === 'c000' && wrap.selected[0] === 'c000';
    const propStops = prop.focus === 'c000' && prop.selected[0] === 'c000';
    const ok = follow.every(Boolean) && home.focus === 'c000' && end.focus === 'c007' && arrowsOk && !before && afterOne && !afterTwo && entered?.by === 'enter' && racMoves && wrapStops;
    report.check('T1', ok, `workaround: a wrapper above the Tree (onKeyDownCapture: type-ahead off, → into the first child; onFocus: selection follows focus, since RAC's ← to the parent moves focus only); TreeProps has no typed disallowTypeAhead (passing it anyway ${propStops ? 'works at runtime but is untyped' : 'is ignored'}); double-click = our onDoubleClick; ↩ = onAction`, out);
  });
});

// ---- T2 ---------------------------------------------------------------------------------------------------------
test('T2: an <input> inside a TreeItem keeps Space, arrows, Home/End, Enter, Escape and Korean composition', TAG, async () => {
  test.setTimeout(150_000);
  const page = s.page;
  await report.guard('T2', async () => {
    const out: Record<string, unknown> = {};
    const variants: Record<string, boolean> = {};
    for (const variant of ['raw', 'own'] as const) {
      await openSpike(page, `&rename=${variant}`);
      const v: Record<string, unknown> = {};
      await treeRow(page, 'c002').click();
      await page.keyboard.press('Enter');
      const input = page.getByTestId('rename-input');
      await input.waitFor({ timeout: 3000 });
      const stBefore = await treeState(page);
      const actionsBefore = (await br(page, (b) => b.actions)).length;
      const per: Array<{ key: string; present: boolean; value: string | null; caret: number | null; focusInInput: boolean; treeChanged: boolean }> = [];
      const keys = ['End', 'a', 'b', 'Space', 'c', 'ArrowLeft', 'ArrowLeft', 'Home', 'ArrowDown', 'ArrowUp', 'ArrowRight', 'End', 'Backspace'];
      let lost: string | null = null;
      for (const key of keys) {
        await page.keyboard.press(key);
        await frames(page, 1);
        const present = (await input.count()) === 1;
        const st = await treeState(page);
        per.push({
          key, present, value: present ? await input.inputValue() : null, caret: present ? await input.evaluate((e: HTMLInputElement) => e.selectionStart) : null,
          focusInInput: present && (await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'rename-input')), treeChanged: JSON.stringify(st) !== JSON.stringify(stBefore),
        });
        if (!present) {
          lost = key;
          break;
        }
      }
      v['perKey'] = per;
      v['lostOnKey'] = lost;
      v['actionsAdded'] = (await br(page, (b) => b.actions)).length - actionsBefore;
      if (lost === null) {
        const value = await input.inputValue();
        v['finalValue'] = value;
        // Mouse: a double click inside the input selects a word although the row is draggable.
        await input.dblclick();
        v['mouseWordSelect'] = await input.evaluate((e: HTMLInputElement) => [e.selectionStart, e.selectionEnd]);
        // Korean composition.
        await input.evaluate((e: HTMLInputElement) => { e.value = ''; });
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Input.imeSetComposition', { text: 'ㅎ', selectionStart: 1, selectionEnd: 1 });
        await cdp.send('Input.imeSetComposition', { text: '하', selectionStart: 1, selectionEnd: 1 });
        for (const key of ['ArrowDown', 'Space', 'Enter', 'Escape']) await page.keyboard.press(key);
        const stillEditing = (await input.count()) === 1;
        const stDuring = await treeState(page);
        await cdp.send('Input.insertText', { text: '한' });
        const afterCommit = (await input.count()) === 1 ? await input.inputValue() : null;
        v['ime'] = { stillEditing, treeChanged: JSON.stringify(stBefore) !== JSON.stringify(stDuring), afterCommit, stDuring };
        await cdp.detach();
        // Enter closes the rename once and does not start it again (the row's own ↩ action).
        await page.keyboard.press('Enter');
        await frames(page, 3);
        const closed = (await input.count()) === 0;
        await page.waitForTimeout(100);
        v['enter'] = { closed, reopened: (await input.count()) === 1, actionsTail: (await br(page, (b) => b.actions)).slice(-3) };
        // Escape inside the input: the tree keeps its selection.
        await treeRow(page, 'c002').click();
        await page.keyboard.press('Enter');
        await input.waitFor({ timeout: 3000 });
        await page.keyboard.press('Escape');
        await frames(page, 3);
        const stEsc = await treeState(page);
        v['escape'] = { selectionKept: stEsc.selected.length === 1, stEsc, inputGone: (await input.count()) === 0 };
      }
      out[variant] = v;
      const ime = v['ime'] as { stillEditing: boolean; treeChanged: boolean; afterCommit: string | null } | undefined;
      const enter = v['enter'] as { closed: boolean; reopened: boolean } | undefined;
      variants[variant] = lost === null && per.every((p) => p.focusInInput && !p.treeChanged) && v['actionsAdded'] === 0 && !!ime && ime.stillEditing && !ime.treeChanged && !!ime.afterCommit?.includes('한') && !!enter && enter.closed && !enter.reopened;
    }
    out['variantsOk'] = variants;
    report.check('T2', variants['raw'] === true || variants['own'] === true, variants['raw'] ? 'native: RAC leaves keys from a nested input alone' : 'workaround: a capture handler above the Tree owns the input\'s keydowns (decides Enter/Escape itself, stops the rest from reaching RAC\'s row)', out);
  });
});

// ---- T3 ---------------------------------------------------------------------------------------------------------
test('T3: table rows onto tree rows — "on" only, whole row height, current collection refused, copy by default, move with the modifier', TAG, async () => {
  test.setTimeout(150_000);
  const page = s.page;
  await report.guard('T3', async () => {
    const out: Record<string, unknown> = {};
    await openSpike(page);
    // Coverage of the "on" target over one row's height; no between-row indicator ever.
    await beginDrag(page, tableRow(page, 5));
    const row = treeRow(page, 'c003');
    const box = (await row.boundingBox())!;
    const ys: Array<{ dy: number; marked: string[] }> = [];
    await page.mouse.move(box.x + 60, box.y - 20, { steps: 3 });
    for (let dy = -6; dy <= box.height + 6; dy += 2) {
      await page.mouse.move(box.x + 60, box.y + dy, { steps: 2 });
      await page.mouse.move(box.x + 61, box.y + dy);
      await frames(page, 2);
      ys.push({ dy, marked: await marked(page) });
    }
    const between = await page.getByTestId('between-indicator').count();
    const inner = ys.filter((p) => p.dy >= 4 && p.dy < box.height - 4);
    const onThis = inner.filter((p) => p.marked.length === 1 && p.marked[0] === 'coll-c003').length;
    const coverage = onThis / inner.length;
    out['onZone'] = { coverageOfInnerRow: r1(coverage), rowHeight: box.height, between, samples: ys.map((p) => `${p.dy}:${p.marked.join('+') || '-'}`) };
    // The viewed collection (c000) refuses the drop.
    await hover(page, treeRow(page, 'c000'));
    const refusedMarks = await marked(page);
    out['currentCollection'] = { marked: refusedMarks };
    await cancelDrag(page);
    // Default operation: copy.
    await beginDrag(page, tableRow(page, 6));
    await hover(page, treeRow(page, 'c004'));
    await release(page);
    const d1 = await br(page, (b) => b.drops.slice(-1)[0]);
    // Shift (RAC's non-mac move) and Meta on this platform's RAC.
    const modified = async (key: 'Shift' | 'Meta', query: string) => {
      await openSpike(page, query);
      await beginDrag(page, tableRow(page, 7));
      await page.keyboard.down(key);
      await hover(page, treeRow(page, 'c004'));
      await page.mouse.move((await treeRow(page, 'c004').boundingBox())!.x + 62, (await treeRow(page, 'c004').boundingBox())!.y + 12, { steps: 2 });
      await frames(page, 2);
      await release(page);
      await page.keyboard.up(key);
      return br(page, (b) => b.drops.slice(-1)[0]);
    };
    const nativeMeta = await modified('Meta', '');
    const nativeShift = await modified('Shift', '');
    const macMeta = await modified('Meta', '&asMac=1');
    out['operations'] = { default: d1, nativeMeta, nativeShift, asMacMeta: macMeta };
    const copyDefault = d1?.operation === 'copy';
    const metaMoves = IS_MAC ? nativeMeta?.operation === 'move' : macMeta?.operation === 'move';
    const ok = coverage >= 0.95 && between === 0 && refusedMarks.length === 0 && copyDefault && metaMoves;
    report.check('T3', ok, coverage >= 0.95 ? 'native: getDropOperation cancels everything but item/"on"; copy unless allowedOperations is only move (⌘ via RAC mac mapping)' : 'record: "on" zone is smaller than the row', out);
  });
});

// ---- T4 ---------------------------------------------------------------------------------------------------------
test('T4: collection onto collection re-parents; self, descendants and the current parent are refused; the header = root', TAG, async () => {
  test.setTimeout(150_000);
  const page = s.page;
  await report.guard('T4', async () => {
    const out: Record<string, unknown> = {};
    await openSpike(page);
    await api(page, 'setExpanded', ['c000', 'c008']);
    await frames(page, 2);
    const tryDrop = async (from: string, to: string) => {
      await beginDrag(page, treeRow(page, from));
      await hover(page, treeRow(page, to));
      const m = await marked(page);
      await release(page);
      return m;
    };
    const parent = (id: string) => api<string | null>(page, 'parentOf', id);
    const selfMarks = await tryDrop('c000', 'c000');
    const childMarks = await tryDrop('c000', 'c008');
    const grandMarks = await tryDrop('c000', 'c040');
    const parentMarks = await tryDrop('c009', 'c000');
    const refusedStill = [await parent('c000'), await parent('c009')];
    const okMarks = await (async () => {
      await beginDrag(page, treeRow(page, 'c009'));
      await hover(page, treeRow(page, 'c003'));
      const m = await marked(page);
      await release(page);
      return m;
    })();
    const moved = await parent('c009');
    // Header = root.
    await beginDrag(page, treeRow(page, 'c010'));
    await api(page, 'setExpanded', ['c000']);
    await hover(page, page.getByTestId('tree-header'));
    const headerMarks = await marked(page);
    await release(page);
    const toRoot = await parent('c010');
    out['cycles'] = { selfMarks, childMarks, grandMarks, parentMarks, refusedStill };
    out['move'] = { okMarks, movedParent: moved, headerMarks, c010After: toRoot, c010Before: 'c000' };
    const drops = await br(page, (b) => b.drops.map((d) => [d.target, d.ids[0], d.operation]));
    out['drops'] = drops;
    const ok =
      selfMarks.length === 0 && childMarks.length === 0 && grandMarks.length === 0 && parentMarks.length === 0 && refusedStill[0] === null && refusedStill[1] === 'c000' &&
      okMarks.includes('coll-c003') && moved === 'c003' && headerMarks.includes('tree-header') && toRoot === null;
    report.check('T4', ok, 'native: draggingCollectionId from onDragStart feeds getDropOperation (RAC gives no dragged key there); header is a plain useDrop', out);
  });
});

// ---- T5 ---------------------------------------------------------------------------------------------------------
test('T5: Finder files onto a tree row; the window overlay stays right of the sidebar; guardDocumentDrops lets our drops through', TAG, async () => {
  test.setTimeout(150_000);
  const page = s.page;
  await report.guard('T5', async () => {
    const out: Record<string, unknown> = {};
    const file = `${scratch}/sample.pdf`;
    fs.mkdirSync(scratch, { recursive: true });
    fs.writeFileSync(file, '%PDF-1.4\n%%EOF\n');
    const cdp = await page.context().newCDPSession(page);
    const fileDrag = async (type: 'dragEnter' | 'dragOver' | 'drop', x: number, y: number) => {
      await cdp.send('Input.dispatchDragEvent', { type, x, y, data: { items: [], files: [file], dragOperationsMask: 3 } });
      await frames(page, 2);
    };
    const overlay = () => page.getByTestId('drop-overlay').count().then((n) => n > 0);
    const run = async (query: string) => {
      await openSpike(page, query);
      const row = (await treeRow(page, 'c003').boundingBox())!;
      const rowPoint = { x: row.x + 60, y: row.y + row.height / 2 };
      const tableRowBox = (await tableRow(page, 4).boundingBox())!;
      const overRow = { x: tableRowBox.x + 200, y: tableRowBox.y + tableRowBox.height / 2 };
      await fileDrag('dragEnter', overRow.x, overRow.y);
      await fileDrag('dragOver', overRow.x, overRow.y);
      const overlayOverTableRow = await overlay();
      await fileDrag('dragOver', rowPoint.x, rowPoint.y);
      const overlayOverSidebar = await overlay();
      const marksOnRow = await marked(page);
      await fileDrag('drop', rowPoint.x, rowPoint.y);
      const rowDrop = await api<Array<{ target: string; names: string[] }>>(page, 'filesDrops');
      const overlayAfterDrop = await overlay();
      // A drop in the main area is the overlay's.
      await fileDrag('dragEnter', overRow.x, overRow.y);
      await fileDrag('dragOver', overRow.x, overRow.y);
      await fileDrag('drop', overRow.x, overRow.y);
      const log = await br(page, (b) => b.log.filter((l) => l.startsWith('overlay drop')));
      return { overlayOverTableRow, overlayOverSidebar, marksOnRow, rowDrop, overlayAfterDrop, overlayDrop: log };
    };
    const normal = await run('');
    const always = await run('&rowdrop=always');
    out['normal'] = normal;
    out['rowsAlwaysDroppable'] = always;
    // Our own MIME drop through guardDocumentDrops is T3's (a drop that RAC took); one refused drop shows guard sets "none".
    await cdp.detach();
    const ok =
      normal.overlayOverTableRow && !normal.overlayOverSidebar && normal.marksOnRow.includes('coll-c003') && normal.rowDrop[0]?.target === 'c003' &&
      normal.rowDrop[0]?.names[0] === 'sample.pdf' && !normal.overlayAfterDrop && normal.overlayDrop.length === 1;
    report.check('T5', ok, 'workaround: window overlay listeners ignore events inside [data-sidebar] (reset on enter); rows take drops only during a tag drag', out);
  });
});

// ---- T6 ---------------------------------------------------------------------------------------------------------
test('T6: spring-loading and edge autoscroll while dragging over the tree', TAG, async () => {
  test.setTimeout(150_000);
  const page = s.page;
  await report.guard('T6', async () => {
    const out: Record<string, unknown> = {};
    await openSpike(page);
    await beginDrag(page, tableRow(page, 5));
    const t0 = await page.evaluate(() => performance.now());
    await hover(page, treeRow(page, 'c001'));
    const hoverAt = await page.evaluate(() => performance.now());
    // The pointer rests (RAC restarts its 800 ms timer on every dragover that moved).
    let expandedAt: number | null = null;
    let at500 = false;
    for (let i = 0; i < 80; i++) {
      await page.waitForTimeout(25);
      const now = await page.evaluate(() => performance.now());
      const has = (await api<string[]>(page, 'expanded')).includes('c001');
      if (now - hoverAt >= 440 && now - hoverAt < 560 && has) at500 = true;
      if (has) {
        expandedAt = now - hoverAt;
        break;
      }
    }
    out['spring'] = { expandedAfterMs: expandedAt === null ? null : r1(expandedAt), alreadyAt500: at500, setupMs: r1(hoverAt - t0) };
    await cancelDrag(page);
    // Autoscroll: tree scrolled down by hand, then a drag held within / outside the edge band.
    const scrollWith = async (query: string, distanceFromEdge: number, edge: 'bottom' | 'top') => {
      await openSpike(page, query);
      await api(page, 'expandAll');
      await page.waitForTimeout(800); // 200 rows to render
      await frames(page, 3);
      const tree = page.getByTestId('tree');
      const start = edge === 'bottom' ? 0 : 3000;
      await tree.evaluate((e, y) => void (e.scrollTop = y), start);
      await beginDrag(page, tableRow(page, 5));
      const tb = (await tree.boundingBox())!;
      const y = edge === 'bottom' ? tb.y + tb.height - distanceFromEdge : tb.y + distanceFromEdge;
      const before = await tree.evaluate((e) => e.scrollTop);
      await page.mouse.move(tb.x + 100, y, { steps: 4 });
      for (let i = 0; i < 24; i++) {
        await page.mouse.move(tb.x + 100 + (i % 2) * 4, y);
        await page.waitForTimeout(40);
      }
      const after = await tree.evaluate((e) => e.scrollTop);
      await cancelDrag(page);
      return after - before;
    };
    const native = {
      bottom10: await scrollWith('', 10, 'bottom'),
      bottom22: await scrollWith('', 22, 'bottom'),
      bottom40: await scrollWith('', 40, 'bottom'),
      top10: await scrollWith('', 10, 'top'),
      top22: await scrollWith('', 22, 'top'),
    };
    const own = {
      bottom22: await scrollWith('&autoscroll=own', 22, 'bottom'),
      bottom40: await scrollWith('&autoscroll=own', 40, 'bottom'),
      top22: await scrollWith('&autoscroll=own', 22, 'top'),
    };
    out['autoscrollPx'] = { rac: native, ours: own };
    const springOk = expandedAt !== null && expandedAt >= 600 && expandedAt <= 900 && !at500;
    const racBand = native.bottom10 > 0 && native.bottom22 > 0 && native.top22 < 0 && native.bottom40 === 0;
    const ownBand = own.bottom22 > 0 && own.top22 < 0 && own.bottom40 === 0;
    report.check('T6', springOk && (racBand || ownBand), racBand ? 'native (spring 800 ms is RAC fixed; autoscroll band covers 22 px)' : ownBand ? 'workaround: spring native (RAC fixed 800 ms); own dragover autoscroll for the 24 px band (RAC band is 20 px)' : 'record', out);
  });
});

// ---- T7 ---------------------------------------------------------------------------------------------------------
test('T7: a tag chip (plain element) onto virtualized grid rows; a selected row means all selected; rows mounted mid-drag take it', TAG, async () => {
  test.setTimeout(150_000);
  const page = s.page;
  await report.guard('T7', async () => {
    const out: Record<string, unknown> = {};
    await openSpike(page);
    await api(page, 'selectRange', 0, 10);
    const chipDrag = async (target: () => Promise<void>) => {
      await beginDrag(page, page.getByTestId('chip-t1'));
      await target();
      const m = await marked(page);
      await release(page);
      return { marks: m, drop: await br(page, (b) => b.tagDrops.slice(-1)[0]) };
    };
    const inSel = await chipDrag(() => hover(page, tableRow(page, 3)));
    const outSel = await chipDrag(() => hover(page, tableRow(page, 20)));
    // Rows mounted during the drag (scroll mid-drag), then drop on a row that did not exist when the drag began.
    await api(page, 'selectRange', 0, 0);
    let newRowIndex = -1;
    const midDrag = await chipDrag(async () => {
      await api(page, 'scrollTable', 40_000);
      await frames(page, 4);
      newRowIndex = Number(await page.locator('[data-testid="item-row"]').nth(10).getAttribute('data-index'));
      await hover(page, tableRow(page, newRowIndex));
    });
    out['inSelection'] = { marks: inSel.marks, tagDrop: inSel.drop ? { rowId: inSel.drop.rowId, applied: inSel.drop.applied.length } : null };
    out['outsideSelection'] = { marks: outSel.marks, tagDrop: outSel.drop };
    out['midDrag'] = { newRowIndex, marks: midDrag.marks, tagDrop: midDrag.drop };
    // useDrag's default pointer handling on a chip: CDP's synthetic mouse looks like a virtual (screen-reader) press to RAC, which then runs its own virtual drag and the browser's drag never reaches the rows.
    await openSpike(page, '&chipdrag=virtual');
    await api(page, 'selectRange', 0, 10);
    await beginDrag(page, page.getByTestId('chip-t1'));
    await hover(page, tableRow(page, 3));
    const virtualMarks = await marked(page);
    await release(page);
    out['defaultChipUnderCdp'] = { marks: virtualMarks, tagDrops: await br(page, (b) => b.tagDrops.length) };
    const ok =
      inSel.drop?.rowId === idOf(3) && inSel.drop.applied.length === 10 && inSel.marks.length === 1 && outSel.drop?.rowId === idOf(20) && outSel.drop.applied.length === 1 &&
      midDrag.drop?.rowId === idOf(newRowIndex) && midDrag.drop.applied.length === 1;
    report.check('T7', ok, 'workaround: row useDrop isDisabled outside tag drags (otherwise rows swallow every dragover, see T5 rowsAlwaysDroppable)', out);
  });
});

// ---- T8 ---------------------------------------------------------------------------------------------------------
test('T8: esc cancels, the keymap is quiet during a drag, RAC keyboard drag for a collection', TAG, async () => {
  test.setTimeout(150_000);
  const page = s.page;
  await report.guard('T8', async () => {
    const out: Record<string, unknown> = {};
    const escape = async (query: string) => {
      await openSpike(page, query);
      await beginDrag(page, tableRow(page, 5));
      await hover(page, treeRow(page, 'c003'));
      const markBefore = await marked(page);
      await page.keyboard.press('F6'); // the keymap stand-in
      await page.keyboard.press('Escape');
      await frames(page, 2);
      await page.waitForTimeout(150);
      const markAfter = await marked(page);
      await page.mouse.up();
      await frames(page, 3);
      const r = await br(page, (b) => ({ drops: b.drops.length, ends: b.ends, keymap: b.keymap }));
      await page.keyboard.press('F6');
      const keymapAfter = await br(page, (b) => b.keymap);
      const markFinal = await marked(page);
      return { markBefore, markAfter, markFinal, drops: r.drops, ends: r.ends.map((e) => e.op), keymapDuring: r.keymap, keymapAfter };
    };
    const raw = await escape('');
    const swept = await escape('&sweep=1');
    out['escape'] = { raw, withDragendSweep: swept };
    // Esc on a collection drag too (with the sweep).
    await openSpike(page, '&sweep=1');
    await beginDrag(page, treeRow(page, 'c009'));
    await hover(page, treeRow(page, 'c003'));
    await cancelDrag(page);
    out['escapeTree'] = { drops: await br(page, (b) => b.drops.length), parent: await api(page, 'parentOf', 'c009'), marks: await marked(page) };
    // RAC keyboard drag: a Tree item needs a <Button slot="drag"> (Tree passes hasDragButton); Enter on it starts, arrows choose, Enter drops.
    await openSpike(page);
    await treeRow(page, 'c009').click();
    const handle = treeRow(page, 'c009').locator('button[slot="drag"]');
    await handle.focus();
    const handleLabel = await handle.getAttribute('aria-label');
    await page.keyboard.press('Enter');
    await frames(page, 3);
    const visited: string[] = [];
    let dropped = false;
    for (let i = 0; i < 16 && !dropped; i++) {
      await page.keyboard.press('ArrowDown');
      await frames(page, 2);
      const m = await marked(page);
      visited.push(m.join(',') || '-');
      if (m.includes('coll-c004')) {
        await page.keyboard.press('Enter');
        await frames(page, 3);
        dropped = true;
      }
    }
    const parent = await api<string | null>(page, 'parentOf', 'c009');
    out['keyboardDrag'] = { handleLabel, visited, dropped, parentAfter: parent, lastDrop: await br(page, (b) => b.drops.slice(-1)[0]), actions: (await br(page, (b) => b.actions)).slice(-3), selectedAfter: await api(page, 'selected') };
    const km = raw.keymapDuring;
    const sweepNeeded = raw.markAfter.length > 0;
    const ok =
      raw.markBefore.length === 1 && (!sweepNeeded || swept.markAfter.length === 0) && raw.drops === 0 && swept.drops === 0 && raw.ends[0] === 'cancel' && km.fired === 0 && raw.keymapAfter.fired === 1 &&
      (out['escapeTree'] as { drops: number }).drops === 0 && (out['escapeTree'] as { parent: string }).parent === 'c000' && (out['escapeTree'] as { marks: string[] }).marks.length === 0;
    const kbd = parent === 'c004';
    report.check('T8', ok, `${sweepNeeded ? 'workaround: a dragend sweep sends dragleave to rows still marked (esc left the marker; may be Playwright\'s cancel)' : 'native: esc'}; keymap: keys do not reach the page during a drag; RAC keyboard drag ${kbd ? 'works from the row\'s <Button slot="drag">' : 'did not complete (see value)'}`, out);
  });
});

// ---- P1 ---------------------------------------------------------------------------------------------------------
test('P1: tree mount, expand-all, dragover over grid rows, drop → handler', TAG, async () => {
  test.setTimeout(240_000);
  const page = s.page;
  await report.guard('P1', async () => {
    const tree: Record<string, unknown> = {};
    for (const variant of ['plain', 'virtual'] as const) {
      await openSpike(page, variant === 'virtual' ? '&virtual=1' : '');
      const mountCollapsed: number[] = [];
      const mountExpanded: number[] = [];
      const expandAll: number[] = [];
      const toggleOne: number[] = [];
      const syncExpandAll: number[] = [];
      const idle: number[] = [];
      for (let i = 0; i < 8; i++) {
        await api(page, 'setExpanded', ['c000']);
        await frames(page, 3);
        idle.push(await page.evaluate(() => new Promise<number>((res) => { const t0 = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - t0))); })));
        mountCollapsed.push(await api<number>(page, 'timeRemount'));
        await frames(page, 3);
        toggleOne.push(await api<number>(page, 'timeToggleOne', 'c001'));
        await frames(page, 3);
        await api(page, 'setExpanded', ['c000']);
        await frames(page, 3);
        expandAll.push(await api<number>(page, 'timeExpandAll'));
        await frames(page, 3);
        mountExpanded.push(await api<number>(page, 'timeRemount')); // everything is expanded now
        await frames(page, 3);
        await api(page, 'setExpanded', ['c000']);
        await frames(page, 3);
        syncExpandAll.push(await api<number>(page, 'syncRender', 'expandAll'));
        await frames(page, 3);
      }
      tree[variant] = { mountCollapsedMs: stats(mountCollapsed), mountAllExpandedMs: stats(mountExpanded), expandAllMs: stats(expandAll), expandAllSyncRenderMs: stats(syncExpandAll), toggleOneMs: stats(toggleOne), idleTwoFramesMs: stats(idle), rowsInDomAllExpanded: await page.locator('[data-testid="tree"] [role="row"]').count() };
    }
    // Dragover over rows during a tag drag: a sweep of 150 moves over the table.
    await openSpike(page);
    await beginDrag(page, page.getByTestId('chip-t1'));
    const table = (await page.getByTestId('library-table').boundingBox())!;
    for (let i = 0; i < 150; i++) {
      await page.mouse.move(table.x + 200 + (i % 7), table.y + 60 + ((i * 5) % 600));
      if (i % 5 === 0) await page.waitForTimeout(20);
    }
    await hover(page, tableRow(page, 6));
    await release(page);
    const o = await br(page, (b) => ({ over: b.overMs, other: b.overOtherMs, tagDrop: b.dropMs }));
    // Tree drops for the drop → handler figure.
    const drops: number[] = [];
    for (let i = 0; i < 5; i++) {
      await beginDrag(page, tableRow(page, 8 + i));
      await hover(page, treeRow(page, 'c005'));
      await release(page);
    }
    drops.push(...(await br(page, (b) => b.dropMs)).slice(o.tagDrop.length));
    const plain = tree['plain'] as { mountAllExpandedMs: { p50: number }; expandAllMs: { p50: number }; mountCollapsedMs: { p50: number } };
    const value = { tree, dragoverRows: o.over.length ? stats(o.over) : null, dragoverOther: o.other.length ? stats(o.other) : null, tagDropToHandlerMs: o.tagDrop.map(r1), treeDropToHandlerMs: stats(drops) };
    const overP95 = o.over.length ? pct(o.over, 95) : Number.POSITIVE_INFINITY;
    const ok = plain.mountCollapsedMs.p50 <= limit(BUDGET.treeMount) && plain.expandAllMs.p50 <= limit(BUDGET.expandAll) && plain.mountAllExpandedMs.p50 <= limit(BUDGET.treeMount) && overP95 <= limit(BUDGET.overP95) && Math.max(...drops, ...o.tagDrop) <= limit(BUDGET.dropToHandler);
    report.check('P1', ok, 'record: times are change -> second frame after (about 29 ms of that is the two idle frames); dragover is capture -> MessageChannel (the whole dispatch)', value);
  });
});
