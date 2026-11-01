import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditedCopy, Result } from '@learn/domain';
import type { ImportBatch } from '../jobs/import-queue';
import { openLibraryContext, type LibraryContext } from '../library-context';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
const revealed: string[] = [];
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  shell: { showItemInFolder: (p: string) => void revealed.push(p) },
  BrowserWindow: { getAllWindows: () => [] },
}));

const { createHandle } = await import('./register');
const { registerEditedCopiesIpc } = await import('./edited-copies');

let ctx: LibraryContext;
let dir: string;
const batches: ImportBatch[] = [];
const imports = {
  enqueue: vi.fn((batch: ImportBatch) => batches.push(batch)),
  cancel: vi.fn(), state: vi.fn(), onProgress: vi.fn(), onFinished: vi.fn(),
};
registerEditedCopiesIpc(createHandle(null), stubDeps({ getContext: () => ctx, imports: imports as never }));
const PAGE = fakeSender(41, 'main');
const SETTINGS_PAGE = fakeSender(42, 'settings');
const as = (sender: unknown, url: string) => (channel: string, input?: unknown) => handlers.get(channel)!({ sender, senderFrame: { url } }, input);
const raw = as(PAGE, 'learn://app/index.html?window=main');
async function call<T>(channel: string, input?: unknown): Promise<T> {
  const r = await raw(channel, input);
  if (!r.ok) throw new Error(`${channel}: ${r.code}`);
  return r.data as T;
}

const ASIDE = '강의 3 (수정본 2026-10-30 1412).pdf';
const EDITED = '%PDF-1.4\n% edited in another app\n%%EOF\n';
/** An imported item whose folder holds its named copy and one copy another app saved. */
async function itemWithCopy() {
  const src = path.join(dir, '강의 3.pdf');
  fs.writeFileSync(src, '%PDF-1.4\n% the original\n%%EOF\n');
  const out = await ctx.importer.importOne(src, { mode: 'managed' });
  if (out.status !== 'imported') throw new Error(out.status);
  const folder = path.join(ctx.layout.derivedDir, 'open', out.item.assetId);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, '강의 3.pdf'), 'the named copy');
  const copy = path.join(folder, ASIDE);
  fs.writeFileSync(copy, EDITED);
  return { item: out.item, folder, copy };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-edited-ipc-'));
  ctx = await openLibraryContext(path.join(dir, 'Library'));
  batches.length = 0;
  revealed.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  if (ctx.db.open) ctx.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('library:editedCopies', () => {
  it('lists the item copies kept aside, not its named copy; none for an item without any', async () => {
    const { item } = await itemWithCopy();
    const copies = await call<EditedCopy[]>('library:editedCopies', { itemId: item.id });
    expect(copies).toEqual([{ name: ASIDE, modifiedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), size: EDITED.length }]);
    const other = path.join(dir, 'other.pdf');
    fs.writeFileSync(other, '%PDF-1.4\n% another\n%%EOF\n');
    const plain = await ctx.importer.importOne(other, { mode: 'managed' });
    if (plain.status !== 'imported') throw new Error(plain.status);
    expect(await call('library:editedCopies', { itemId: plain.item.id })).toEqual([]);
  });

  it('answers NOT_FOUND for a trashed or unknown item, and refuses the settings window', async () => {
    const { item } = await itemWithCopy();
    ctx.repo.trash([item.id]);
    expect(await raw('library:editedCopies', { itemId: item.id })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await raw('library:editedCopies', { itemId: '00000000-0000-4000-8000-000000000000' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await as(SETTINGS_PAGE, 'learn://app/index.html?window=settings')('library:editedCopies', { itemId: item.id })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });
});

describe('library:importEditedCopy', () => {
  it('puts the copy in the queue as a new managed item, titled after it, in no collection, owned by the asking window', async () => {
    const { item, copy } = await itemWithCopy();
    expect(await call('library:importEditedCopy', { itemId: item.id, name: ASIDE })).toEqual({ queued: 1 });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ paths: [copy], mode: 'managed', collectionId: null, owner: 41, titles: { [copy]: '강의 3 (수정본 2026-10-30 1412)' } });
    expect(batches[0]!.afterCommit).toBeTypeOf('function');
  });

  it('after the commit removes the copy whose bytes the library now holds, and keeps one saved over meanwhile', async () => {
    const { item, folder, copy } = await itemWithCopy();
    await call('library:importEditedCopy', { itemId: item.id, name: ASIDE });
    const batch = batches[0]!;
    const out = await ctx.importer.importOne(copy, { mode: batch.mode, title: batch.titles![copy]! });
    if (out.status !== 'imported') throw new Error(out.status);
    expect(out.item.title).toBe('강의 3 (수정본 2026-10-30 1412)');
    await batch.afterCommit!(out);
    expect(fs.existsSync(copy)).toBe(false);

    const second = path.join(folder, '강의 3 (수정본 2026-10-31 0905).pdf');
    fs.writeFileSync(second, '%PDF-1.4\n% edited twice\n%%EOF\n');
    await call('library:importEditedCopy', { itemId: item.id, name: path.basename(second) });
    const again = batches[1]!;
    const out2 = await ctx.importer.importOne(second, { mode: again.mode, title: again.titles![second]! });
    if (out2.status !== 'imported') throw new Error(out2.status);
    fs.appendFileSync(second, '% saved again while it was imported\n');
    await again.afterCommit!(out2);
    expect(fs.existsSync(second)).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/^\[library\] an edited copy stays/));
  });

  it('refuses what is not a copy of this item: its named copy, another item copy, a gone one (NOT_FOUND); a path (VALIDATION_FAILED)', async () => {
    const { item, copy } = await itemWithCopy();
    expect(await raw('library:importEditedCopy', { itemId: item.id, name: '강의 3.pdf' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const other = path.join(dir, 'other.pdf');
    fs.writeFileSync(other, '%PDF-1.4\n% another\n%%EOF\n');
    const plain = await ctx.importer.importOne(other, { mode: 'managed' });
    if (plain.status !== 'imported') throw new Error(plain.status);
    expect(await raw('library:importEditedCopy', { itemId: plain.item.id, name: ASIDE })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await raw('library:importEditedCopy', { itemId: item.id, name: `../${item.assetId}/${ASIDE}` })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    fs.rmSync(copy);
    const gone = await raw('library:importEditedCopy', { itemId: item.id, name: ASIDE });
    expect(gone).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(gone.ok ? null : gone.message).toBe('이 수정본을 찾을 수 없습니다. 이미 가져왔거나 다른 곳으로 옮겼는지 확인하세요.');
    expect(batches).toEqual([]);
  });
});

describe('library:revealEditedCopy', () => {
  it('shows that file selected in the file manager; a gone one is NOT_FOUND', async () => {
    const { item, copy } = await itemWithCopy();
    await call('library:revealEditedCopy', { itemId: item.id, name: ASIDE });
    expect(revealed).toEqual([copy]);
    fs.rmSync(copy);
    expect(await raw('library:revealEditedCopy', { itemId: item.id, name: ASIDE })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(revealed).toHaveLength(1);
  });
});
