import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CheckAction, ImportReport, LibraryCheck, LibraryCheckPayload, SheetPayload } from '@learn/domain';
import { managedRelativePath, resolveAssetPath } from '@learn/library';
import type { ImportBatch } from './jobs/import-queue';
import { AUTO_POLL_MS, LAST_SHOWN, autoShowDue, checkPayload, clearToShow, createCheckSheets, importAndWait, runCheck, startLibraryCheck, type AutoGate, type CheckSheetsDeps } from './library-check';
import { openLibraryContext, type LibraryContext } from './library-context';

const dirs: string[] = [];
const contexts: LibraryContext[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const c of contexts.splice(0)) c.db.close();
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function temp(name: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `learn-check-${name}-`));
  dirs.push(d);
  return d;
}
async function library(): Promise<LibraryContext> {
  const ctx = await openLibraryContext(path.join(temp('lib'), 'Library'));
  contexts.push(ctx);
  return ctx;
}
function pdf(dir: string, name: string, text: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `%PDF-1.4\n% ${text}\n%%EOF\n`);
  return p;
}
async function add(ctx: LibraryContext, src: string, mode: 'managed' | 'linked' = 'managed') {
  const o = await ctx.importer.importOne(src, { mode });
  if (o.status !== 'imported') throw new Error(o.status);
  return o.item;
}
function put(file: string, bytes: number | Buffer): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof bytes === 'number' ? Buffer.alloc(bytes, 5) : bytes);
  return file;
}
const ORPHAN_ID = '0a1b2c3d-4e5f-4061-8172-8394a5b6c7d8';
const EDIT = '단백질 접힘 정리 (수정본 2026-10-18 2210).pdf';
const PARENT = { webContents: { id: 7 } } as never;
const SHEET_WINDOW = { webContents: { id: 9 } } as never;
const gate = (over: Partial<AutoGate> = {}): AutoGate => ({ firstScreen: Promise.resolve(), busy: () => false, stopped: () => false, sleep: async () => {}, ...over });

/** The import queue as the sheet uses it: each batch through the real importer, then the run's end. */
function queueOf(ctx: LibraryContext) {
  const batches: ImportBatch[] = [];
  const finished = new Set<(report: ImportReport, openIn: number | null) => void>();
  return {
    batches,
    enqueue(batch: ImportBatch): number {
      batches.push(batch);
      void (async () => {
        let imported = 0;
        for (const p of batch.paths) {
          const title = batch.titles?.[p];
          const o = await ctx.importer.importOne(p, { mode: batch.mode, ...(title !== undefined ? { title } : {}), ...(batch.allowDuplicate ? { allowDuplicate: true } : {}) });
          if (o.status === 'imported') {
            imported += 1;
            await batch.afterCommit?.(o);
          }
        }
        const report: ImportReport = { imported, filed: 0, filedExisting: 0, failed: [], openItemId: null, requested: batch.paths.length, cancelled: false, untouched: 0, mode: batch.mode, collectionId: null };
        for (const cb of [...finished]) cb(report, null);
        batch.onSettled?.();
      })();
      return batch.paths.length;
    },
    onFinished(cb: (report: ImportReport, openIn: number | null) => void): () => void {
      finished.add(cb);
      return () => void finished.delete(cb);
    },
  };
}
function sheets(ctx: LibraryContext, over: Partial<CheckSheetsDeps> = {}) {
  const opened: SheetPayload[] = [];
  const relinked: string[][] = [];
  const revealed: string[] = [];
  const queue = queueOf(ctx);
  const deps: CheckSheetsDeps = {
    context: () => ctx,
    sheets: {
      open: async (_parent, payload) => {
        opened.push(payload);
        return { kind: 'libraryCheck' };
      },
    },
    imports: queue,
    announce: () => {},
    relinked: (ids) => void relinked.push(ids),
    homeDir: '/home/u',
    pickFile: async () => null,
    reveal: (file) => void revealed.push(file),
    stopAuto: vi.fn(),
    ...over,
  };
  return { deps, opened, relinked, revealed, queue, checks: createCheckSheets(deps) };
}
async function shown(h: ReturnType<typeof sheets>, mode: 'auto' | 'manual' = 'manual'): Promise<LibraryCheckPayload> {
  await h.checks.open(PARENT, mode);
  return h.opened.at(-1) as LibraryCheckPayload;
}
const acting = (payload: LibraryCheckPayload) => ({ window: SHEET_WINDOW, parent: PARENT, payload });
const act = (h: ReturnType<typeof sheets>, p: LibraryCheckPayload, action: CheckAction) => h.checks.act(action, acting(p));
const rowOf = (p: LibraryCheckPayload, kind: string) => p.rows.find((r) => r.kind === kind);

describe('the automatic sheet\'s rules (spec 7.1)', () => {
  const check = (over: Partial<LibraryCheck>): LibraryCheck => ({
    checkedAt: '2026-10-31T00:00:00.000Z', items: 1, staging: { count: 0, bytes: 0 }, unreferenced: { keys: [], bytes: 0 }, missingManaged: { itemIds: [] },
    missingLinked: { itemIds: [] }, corrupt: { count: 0, bytes: 0, files: [] }, orphanEdits: { count: 0, bytes: 0, copies: [] }, fingerprint: 'f'.repeat(64), actionable: false, ...over,
  });
  it('is due for something to act on whose list was not the last one shown', () => {
    expect(autoShowDue(null, undefined)).toBe(false);
    expect(autoShowDue(check({}), undefined)).toBe(false);
    expect(autoShowDue(check({ actionable: true }), undefined)).toBe(true);
    expect(autoShowDue(check({ actionable: true }), 'f'.repeat(64))).toBe(false);
    expect(autoShowDue(check({ actionable: true }), 'e'.repeat(64))).toBe(true);
  });
  it('waits for the first screen, then looks again every poll while a sheet or a job holds the window', async () => {
    let drawn = (): void => {};
    const firstScreen = new Promise<void>((resolve) => (drawn = resolve));
    let busy = 3;
    const sleeps: number[] = [];
    const result = clearToShow(gate({ firstScreen, busy: () => busy-- > 0, sleep: async (ms) => void sleeps.push(ms) }));
    await Promise.resolve();
    expect(sleeps).toEqual([]);
    drawn();
    expect(await result).toEqual({ go: true, waited: true });
    expect(sleeps).toEqual([AUTO_POLL_MS, AUTO_POLL_MS, AUTO_POLL_MS]);
  });
  it('goes at once when nothing holds the window, and not at all once stopped', async () => {
    expect(await clearToShow(gate())).toEqual({ go: true, waited: false });
    let n = 0;
    expect(await clearToShow(gate({ busy: () => true, stopped: () => n++ > 1 }))).toEqual({ go: false, waited: true });
  });
});

describe('startLibraryCheck (P-18: once the window exists, in the background)', () => {
  it('interrupts the jobs left running, checks, and asks for the automatic sheet when something is left', async () => {
    const ctx = await library();
    await add(ctx, pdf(temp('src'), 'a.pdf', 'a'));
    ctx.db.prepare(`UPDATE jobs SET state = 'running'`).run();
    put(path.join(ctx.layout.stagingDir, 'dead.part'), 10);
    expect(ctx.check).toBeNull();
    const requestAuto = vi.fn();
    expect(await startLibraryCheck(ctx, { announce: () => {}, requestAuto, gate: gate() })).toBe('requested');
    expect(requestAuto).toHaveBeenCalledTimes(1);
    expect(ctx.check).toMatchObject({ staging: { count: 1 }, actionable: true });
    expect(ctx.db.prepare(`SELECT state FROM jobs`).pluck().get()).toBe('interrupted');
  });
  it('tells the body-text scheduler the first check ended (P-29): before the gate is looked at, and also when the check threw', async () => {
    const ctx = await library();
    const order: string[] = [];
    await startLibraryCheck(ctx, { announce: () => {}, requestAuto: () => {}, gate: gate({ busy: () => (order.push('gate'), false) }), onChecked: () => void order.push('checked') });
    expect(order).toEqual(['checked', 'gate']);
    const broken = await library();
    broken.db.close();
    const onChecked = vi.fn();
    await expect(startLibraryCheck(broken, { announce: () => {}, requestAuto: () => {}, gate: gate(), onChecked })).rejects.toThrow();
    expect(onChecked).toHaveBeenCalledTimes(1);
  });
  it('does not ask for the list the user was shown last, nor for a missing linked original alone — which it announces', async () => {
    const ctx = await library();
    put(path.join(ctx.layout.stagingDir, 'dead.part'), 10);
    const requestAuto = vi.fn();
    await startLibraryCheck(ctx, { announce: () => {}, requestAuto, gate: gate() });
    ctx.settings.set(LAST_SHOWN, ctx.check!.fingerprint);
    expect(await startLibraryCheck(ctx, { announce: () => {}, requestAuto, gate: gate() })).toBe('not-due');
    fs.rmSync(path.join(ctx.layout.stagingDir, 'dead.part'));
    const dir = temp('src');
    const src = pdf(dir, 'paper.pdf', 'paper');
    const linked = await add(ctx, src, 'linked');
    fs.rmSync(src);
    const announced: string[][] = [];
    expect(await startLibraryCheck(ctx, { announce: (ids) => void announced.push(ids), requestAuto, gate: gate() })).toBe('not-due');
    expect(announced).toEqual([[linked.id]]);
    expect(requestAuto).toHaveBeenCalledTimes(1);
  });
  it('checks again before asking when it had to wait (an import ran meanwhile); a stop calls it off', async () => {
    const ctx = await library();
    put(path.join(ctx.layout.stagingDir, 'a.part'), 1);
    let busy = 1;
    const busyOnce = () => {
      if (busy-- <= 0) return false;
      put(path.join(ctx.layout.stagingDir, 'b.part'), 1);
      return true;
    };
    expect(await startLibraryCheck(ctx, { announce: () => {}, requestAuto: () => {}, gate: gate({ busy: busyOnce }) })).toBe('requested');
    expect(ctx.check!.staging.count).toBe(2);
    const requestAuto = vi.fn();
    expect(await startLibraryCheck(ctx, { announce: () => {}, requestAuto, gate: gate({ stopped: () => true }) })).toBe('stopped');
    expect(requestAuto).not.toHaveBeenCalled();
  });
  it('announces the items whose managed copy it found gone, once', async () => {
    const ctx = await library();
    const item = await add(ctx, pdf(temp('src'), 'a.pdf', 'a'));
    fs.rmSync(resolveAssetPath(ctx.layout, ctx.repo.getAsset(item.assetId)!));
    const announced: string[][] = [];
    await runCheck(ctx, (ids) => void announced.push(ids));
    await runCheck(ctx, (ids) => void announced.push(ids));
    expect(announced).toEqual([[item.id]]);
  });
});

describe('the check sheet (spec 7.1–7.2, P-17, P-26)', () => {
  it('from the menu: a fresh check, the rows there are with two names, the list recorded as shown, the automatic one called off', async () => {
    const ctx = await library();
    const dir = temp('src');
    const items = [await add(ctx, pdf(dir, 'c.pdf', 'c')), await add(ctx, pdf(dir, 'a.pdf', 'a')), await add(ctx, pdf(dir, 'b.pdf', 'b'))];
    for (const i of items) fs.rmSync(resolveAssetPath(ctx.layout, ctx.repo.getAsset(i.assetId)!));
    const h = sheets(ctx);
    const p = await shown(h);
    expect(p).toMatchObject({ kind: 'libraryCheck', mode: 'manual', items: 3, homeDir: '/home/u', failed: null });
    expect(p.rows).toEqual([{ kind: 'missingManaged', state: 'todo', count: 3, bytes: 0, entries: [{ itemId: items[1]!.id, label: 'a', path: null }, { itemId: items[2]!.id, label: 'b', path: null }], fix: null, keys: [] }]);
    expect(ctx.settings.get(LAST_SHOWN)).toBe(ctx.check!.fingerprint);
    expect(h.deps.stopAuto).toHaveBeenCalledTimes(1);
  });
  it('the automatic one shows the startup\'s list, and nothing when that list has nothing to act on', async () => {
    const ctx = await library();
    put(path.join(ctx.layout.stagingDir, 'a.part'), 1);
    await startLibraryCheck(ctx, { announce: () => {}, requestAuto: () => {}, gate: gate() });
    put(path.join(ctx.layout.stagingDir, 'b.part'), 1);
    const h = sheets(ctx);
    expect(rowOf(await shown(h, 'auto'), 'staging')).toMatchObject({ count: 1 });
    expect(h.opened.at(-1)).toMatchObject({ mode: 'auto' });
    const clean = await library();
    const k = sheets(clean);
    await startLibraryCheck(clean, { announce: () => {}, requestAuto: () => {}, gate: gate() });
    await k.checks.open(PARENT, 'auto');
    expect(k.opened).toEqual([]);
  });
  it('a corrupt copy names its item and size; an orphan edited copy its file; a linked one its original location', async () => {
    const ctx = await library();
    const dir = temp('src');
    const src = pdf(dir, 'sample.pdf', 'sample');
    await add(ctx, src);
    const sha = createHash('sha256').update(fs.readFileSync(src)).digest('hex');
    put(path.join(ctx.layout.stagingDir, `corrupt-${sha}-44444444-4444-4444-8444-444444444444`), 42);
    put(path.join(ctx.layout.derivedDir, 'open', ORPHAN_ID, EDIT), 31);
    const paper = pdf(dir, 'paper.pdf', 'paper');
    const linked = await add(ctx, paper, 'linked');
    fs.rmSync(paper);
    const p = await shown(sheets(ctx));
    expect(p.rows.map((r) => r.kind)).toEqual(['missingLinked', 'corrupt', 'orphanEdits']);
    expect(rowOf(p, 'missingLinked')!.entries).toEqual([{ itemId: linked.id, label: 'paper', path: paper }]);
    expect(rowOf(p, 'corrupt')).toMatchObject({ count: 1, bytes: 42, entries: [{ itemId: null, label: 'sample', path: null }] });
    expect(rowOf(p, 'orphanEdits')).toMatchObject({ count: 1, bytes: 31, entries: [{ itemId: null, label: EDIT, path: null }] });
  });
  it('임시 파일 정리: the .part files go — not one an import is writing, not .DS_Store, not a corrupt copy — and the row turns ok in place', async () => {
    const ctx = await library();
    const corrupt = `corrupt-${'c'.repeat(64)}-1`;
    for (const n of ['dead.part', 'live.part', '.DS_Store', corrupt]) put(path.join(ctx.layout.stagingDir, n), 10);
    vi.spyOn(ctx.importer, 'stagingInUse').mockReturnValue(new Set(['live.part']));
    const h = sheets(ctx);
    let p = await shown(h);
    expect(p.rows.map((r) => [r.kind, r.state, r.count])).toEqual([['staging', 'todo', 1], ['corrupt', 'todo', 1]]);
    p = await act(h, p, { kind: 'libraryCheck', act: 'cleanStaging' });
    expect(p.rows.map((r) => [r.kind, r.state, r.fix])).toEqual([['staging', 'done', 'cleaned'], ['corrupt', 'todo', null]]);
    expect(fs.readdirSync(ctx.layout.stagingDir).sort()).toEqual(['.DS_Store', corrupt, 'live.part'].sort());
    expect(ctx.settings.get(LAST_SHOWN)).toBe(ctx.check!.fingerprint);
  });
  it('자료로 되살리기 puts the unused copies through the queue as 이름 없는 자료 (no duplicate question); what did not import stays and is said; 정리 removes the rest', async () => {
    const ctx = await library();
    const bytes = fs.readFileSync(pdf(temp('src'), 'lost.pdf', 'lost'));
    const sha = createHash('sha256').update(bytes).digest('hex');
    const copy = put(path.join(ctx.layout.root, ...managedRelativePath(sha).split('/')), bytes);
    const junk = put(path.join(ctx.layout.assetsDir, 'ee', 'e'.repeat(64)), Buffer.from('not a document'));
    const h = sheets(ctx);
    let p = await shown(h);
    expect(rowOf(p, 'unreferenced')).toMatchObject({ state: 'todo', count: 2 });
    p = await act(h, p, { kind: 'libraryCheck', act: 'revive' });
    expect(h.queue.batches).toEqual([
      expect.objectContaining({ paths: [copy, junk].sort(), mode: 'managed', collectionId: null, owner: 7, allowDuplicate: true, titles: { [copy]: '이름 없는 자료', [junk]: '이름 없는 자료' } }),
    ]);
    expect(ctx.repo.listItems().map((i) => i.title)).toEqual(['이름 없는 자료']);
    expect(rowOf(p, 'unreferenced')).toMatchObject({ state: 'todo', count: 1 });
    expect(p.failed).toEqual({ kind: 'unreferenced', message: '사본 1개는 자료로 되살리지 못했습니다. 지원하지 않는 형식이면 정리할 수 있습니다.' });
    expect(fs.existsSync(copy)).toBe(true);
    const asked = rowOf(p, 'unreferenced')!.keys;
    expect(asked).toHaveLength(1);
    // A copy that comes after the question (an interrupted import's leftover) is not what the user was asked about.
    const later = put(path.join(ctx.layout.assetsDir, 'ff', 'f'.repeat(64)), Buffer.from('came later'));
    p = await act(h, p, { kind: 'libraryCheck', act: 'cleanUnreferenced', keys: asked });
    expect(fs.existsSync(later)).toBe(true);
    expect(rowOf(p, 'unreferenced')).toMatchObject({ state: 'todo', count: 1 });
    p = await act(h, p, { kind: 'libraryCheck', act: 'cleanUnreferenced', keys: rowOf(p, 'unreferenced')!.keys });
    expect(rowOf(p, 'unreferenced')).toMatchObject({ state: 'done', fix: 'cleaned' });
    expect(fs.existsSync(later)).toBe(false);
    expect(p.failed).toBeNull();
    expect(fs.existsSync(junk)).toBe(false);
    expect(fs.existsSync(copy)).toBe(true);
  });
  it('다시 연결… per item: a managed copy put back only from the same bytes, a linked original pointed at where it went; the next name shows; a cancel changes nothing', async () => {
    const ctx = await library();
    const dir = temp('src');
    const [a, b, c] = ['a', 'b', 'c'].map((n) => pdf(dir, `${n}.pdf`, n)) as [string, string, string];
    const items = [await add(ctx, a), await add(ctx, b), await add(ctx, c)];
    for (const i of items) fs.rmSync(resolveAssetPath(ctx.layout, ctx.repo.getAsset(i.assetId)!));
    const paper = pdf(dir, 'paper.pdf', 'paper');
    const linked = await add(ctx, paper, 'linked');
    const moved = path.join(dir, 'moved.pdf');
    fs.renameSync(paper, moved);
    let answer: string | null = b;
    const h = sheets(ctx, { pickFile: async () => answer });
    let p = await shown(h);
    const relink = (itemId: string) => act(h, p, { kind: 'libraryCheck', act: 'relink', itemId });
    await expect(relink(items[0]!.id)).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
    answer = a;
    p = await relink(items[0]!.id);
    expect(rowOf(p, 'missingManaged')).toMatchObject({ count: 2, entries: [{ label: 'b' }, { label: 'c' }] });
    expect(fs.readFileSync(resolveAssetPath(ctx.layout, ctx.repo.getAsset(items[0]!.assetId)!)).equals(fs.readFileSync(a))).toBe(true);
    expect(h.relinked).toEqual([[items[0]!.id]]);
    answer = null;
    expect(await relink(items[1]!.id)).toBe(p);
    for (const [k, src] of [[1, b], [2, c]] as const) {
      answer = src;
      p = await relink(items[k]!.id);
    }
    expect(rowOf(p, 'missingManaged')).toEqual({ kind: 'missingManaged', state: 'done', count: 0, bytes: 0, entries: [], fix: 'relinked', keys: [] });
    answer = moved;
    p = await relink(linked.id);
    expect(rowOf(p, 'missingLinked')).toMatchObject({ state: 'done', fix: 'relinked' });
    expect(ctx.repo.getAsset(linked.assetId)).toMatchObject({ externalPath: moved, availability: 'available' });
  });
  it('Finder에서 보기 shows the first corrupt copy and the first orphan edited copy, and changes nothing', async () => {
    const ctx = await library();
    const corrupt = put(path.join(ctx.layout.stagingDir, `corrupt-${'c'.repeat(64)}-1`), 4);
    const edit = put(path.join(ctx.layout.derivedDir, 'open', ORPHAN_ID, EDIT), 4);
    const h = sheets(ctx);
    const p = await shown(h);
    expect(await act(h, p, { kind: 'libraryCheck', act: 'revealCorrupt' })).toBe(p);
    expect(await act(h, p, { kind: 'libraryCheck', act: 'revealOrphanEdit' })).toBe(p);
    expect(h.revealed).toEqual([corrupt, edit]);
    fs.rmSync(corrupt);
    await expect(act(h, p, { kind: 'libraryCheck', act: 'revealCorrupt' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
  it('새 자료로 가져오기 imports the orphan edited copies through the queue under their names, and each goes after its commit', async () => {
    const ctx = await library();
    const edit = put(path.join(ctx.layout.derivedDir, 'open', ORPHAN_ID, EDIT), fs.readFileSync(pdf(temp('src'), 'e.pdf', 'edited')));
    const h = sheets(ctx);
    let p = await shown(h);
    p = await act(h, p, { kind: 'libraryCheck', act: 'importOrphanEdits' });
    expect(h.queue.batches[0]).toMatchObject({ paths: [edit], mode: 'managed', collectionId: null, owner: 7, allowDuplicate: true, titles: { [edit]: '단백질 접힘 정리 (수정본 2026-10-18 2210)' } });
    expect(ctx.repo.listItems().map((i) => i.title)).toEqual(['단백질 접힘 정리 (수정본 2026-10-18 2210)']);
    expect(fs.existsSync(edit)).toBe(false);
    expect(rowOf(p, 'orphanEdits')).toMatchObject({ state: 'done', fix: 'imported' });
  });
  it('refuses an action for another sheet', async () => {
    const ctx = await library();
    const h = sheets(ctx);
    await expect(h.checks.act({ kind: 'libraryCheck', act: 'cleanStaging' }, { window: SHEET_WINDOW, parent: PARENT, payload: { kind: 'shortcuts' } })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('checkPayload: rows keep their place (spec 7.2 "그 자리에서 ok로")', () => {
  it('a row gone since it was shown stays done — fixed by the action on it, or none — and a new one shows as todo', async () => {
    const ctx = await library();
    put(path.join(ctx.layout.stagingDir, 'a.part'), 1);
    put(path.join(ctx.layout.stagingDir, `corrupt-${'c'.repeat(64)}-1`), 1);
    const first = await runCheck(ctx, () => {});
    const input = { mode: 'manual' as const, prev: null, acted: null, failed: null, homeDir: '/h' };
    const p1 = checkPayload(first, ctx.repo, input);
    fs.rmSync(path.join(ctx.layout.stagingDir, 'a.part'));
    fs.rmSync(path.join(ctx.layout.stagingDir, `corrupt-${'c'.repeat(64)}-1`));
    put(path.join(ctx.layout.derivedDir, 'open', ORPHAN_ID, EDIT), 1);
    const p2 = checkPayload(await runCheck(ctx, () => {}), ctx.repo, { ...input, prev: p1, acted: { kind: 'staging', fix: 'cleaned' } });
    expect(p2.rows.map((r) => [r.kind, r.state, r.fix])).toEqual([['staging', 'done', 'cleaned'], ['corrupt', 'done', 'none'], ['orphanEdits', 'todo', null]]);
    const p3 = checkPayload(await runCheck(ctx, () => {}), ctx.repo, { ...input, prev: p2, acted: null });
    expect(p3.rows.map((r) => [r.kind, r.state, r.fix])).toEqual([['staging', 'done', 'cleaned'], ['corrupt', 'done', 'none'], ['orphanEdits', 'todo', null]]);
  });
});

describe('importAndWait', () => {
  it('is answered when its own batch settles, not when a run it shares ends', async () => {
    let settle: (() => void) | undefined;
    const imports = {
      enqueue: (b: ImportBatch): number => {
        settle = b.onSettled;
        return b.paths.length;
      },
      // The run this batch joined has other files: its end never comes in this test.
      onFinished: () => () => {},
    };
    let answered = false;
    const waiting = importAndWait(imports, { paths: ['/in/a.pdf'], mode: 'managed', collectionId: null, owner: 1 }).then(() => void (answered = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(answered).toBe(false);
    settle!();
    await waiting;
    expect(answered).toBe(true);
  });
});
