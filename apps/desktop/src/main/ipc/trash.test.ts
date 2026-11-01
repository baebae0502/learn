import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeepOneResult, PurgedRows, Result, TrashView } from '@learn/domain';
import { resolveAssetPath } from '@learn/library';
import { openLibraryContext, type LibraryContext } from '../library-context';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
const sent: Array<[string, unknown]> = [];
const fakeWindow = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (ch: string, p: unknown) => sent.push([ch, p]) } };
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { getAllWindows: () => [fakeWindow] },
}));

const { createHandle } = await import('./register');
const { registerTrashIpc, purgeFilesSettled } = await import('./trash');

let ctx: LibraryContext;
let dir: string;
registerTrashIpc(createHandle(null), stubDeps({ getContext: () => ctx }));
const PAGE = fakeSender(31, 'main');
const SETTINGS_PAGE = fakeSender(32, 'settings');
async function call<T>(channel: string, raw?: unknown): Promise<T> {
  const r = await handlers.get(channel)!({ sender: PAGE, senderFrame: { url: 'learn://app/index.html?window=main' } }, raw);
  if (!r.ok) throw new Error(`${channel}: ${r.code}`);
  return r.data as T;
}
const CHANGED = 'evt:library-changed';
const pdf = (name: string, text: string) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `%PDF-1.4\n% ${text}\n%%EOF\n`);
  return file;
};
async function imported(file: string, mode: 'managed' | 'linked' = 'managed', allowDuplicate = false) {
  const out = await ctx.importer.importOne(file, { mode, allowDuplicate });
  if (out.status !== 'imported') throw new Error(out.status);
  return { item: out.item, stored: resolveAssetPath(ctx.layout, ctx.repo.getAsset(out.item.assetId)!) };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-trash-ipc-'));
  ctx = await openLibraryContext(path.join(dir, 'Library'));
  sent.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(async () => {
  await purgeFilesSettled();
  vi.restoreAllMocks();
  if (ctx.db.open) ctx.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('library:trashView', () => {
  it('answers the collection rows and the trashed items, with when each went', async () => {
    const a = await imported(pdf('a.pdf', 'a'));
    const coll = ctx.collections.create({ name: '강의' }).id;
    ctx.repo.trash([a.item.id]);
    ctx.collections.softDelete(coll);
    const view = await call<TrashView>('library:trashView');
    expect(view.items.map((i) => i.id)).toEqual([a.item.id]);
    expect(view.items[0]!.deletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(view.collections.map((c) => [c.id, c.name, c.childCount, c.itemCount])).toEqual([[coll, '강의', 0, 0]]);
  });

  it('is the main window\'s only, and takes no input', async () => {
    const asSettings = await handlers.get('library:trashView')!({ sender: SETTINGS_PAGE, senderFrame: { url: 'learn://app/index.html?window=settings' } }, undefined);
    expect(asSettings).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await handlers.get('library:trashView')!({ sender: PAGE, senderFrame: { url: 'learn://app/index.html?window=main' } }, { all: true })).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('library:purge and library:emptyTrash (spec 4.5)', () => {
  it('removes the rows in one go and announces purge, then the managed copy after the answer', async () => {
    const a = await imported(pdf('a.pdf', 'a'));
    ctx.repo.trash([a.item.id]);
    sent.length = 0;
    const answer = await call<PurgedRows>('library:purge', { itemIds: [a.item.id], collectionIds: [] });
    expect(answer).toEqual({ itemIds: [a.item.id], collectionIds: [] });
    expect(sent).toEqual([[CHANGED, { reason: 'purge', itemIds: [a.item.id] }]]);
    expect(ctx.repo.trashView().items).toEqual([]);
    await purgeFilesSettled();
    expect(fs.existsSync(a.stored)).toBe(false);
  });

  it('never removes a linked original', async () => {
    const original = pdf('linked.pdf', 'mine');
    const before = fs.readFileSync(original);
    const l = await imported(original, 'linked');
    ctx.repo.trash([l.item.id]);
    await call('library:purge', { itemIds: [l.item.id], collectionIds: [] });
    await purgeFilesSettled();
    expect(fs.readFileSync(original)).toEqual(before);
  });

  it('a live id is a no-op: nothing removed, nothing announced', async () => {
    const a = await imported(pdf('a.pdf', 'a'));
    sent.length = 0;
    expect(await call<PurgedRows>('library:purge', { itemIds: [a.item.id], collectionIds: [] })).toEqual({ itemIds: [], collectionIds: [] });
    await purgeFilesSettled();
    expect(sent).toEqual([]);
    expect(ctx.repo.getItem(a.item.id)).toMatchObject({ id: a.item.id });
    expect(fs.existsSync(a.stored)).toBe(true);
  });

  it('a collection row alone is announced without item ids; emptyTrash takes the rest', async () => {
    const coll = ctx.collections.create({ name: '강의' }).id;
    ctx.collections.softDelete(coll);
    const a = await imported(pdf('a.pdf', 'a'));
    const b = await imported(pdf('b.pdf', 'b'));
    ctx.repo.trash([a.item.id, b.item.id]);
    sent.length = 0;
    expect(await call<PurgedRows>('library:purge', { itemIds: [], collectionIds: [coll] })).toEqual({ itemIds: [], collectionIds: [coll] });
    expect(sent).toEqual([[CHANGED, { reason: 'purge' }]]);
    const emptied = await call<PurgedRows>('library:emptyTrash');
    expect(emptied.itemIds.sort()).toEqual([a.item.id, b.item.id].sort());
    expect(sent[1]![1]).toMatchObject({ reason: 'purge' });
    await purgeFilesSettled();
    expect([a.stored, b.stored].filter((f) => fs.existsSync(f))).toEqual([]);
    expect(await call<PurgedRows>('library:emptyTrash')).toEqual({ itemIds: [], collectionIds: [] });
    expect(sent).toHaveLength(2);
  });

  it.skipIf(process.getuid?.() === 0)('a copy it cannot remove stays for the library check; the purge succeeds and the log has the count only', async () => {
    const a = await imported(pdf('a.pdf', 'a'));
    ctx.repo.trash([a.item.id]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const shard = path.dirname(a.stored);
    fs.chmodSync(shard, 0o555);
    try {
      expect(await call<PurgedRows>('library:purge', { itemIds: [a.item.id], collectionIds: [] })).toEqual({ itemIds: [a.item.id], collectionIds: [] });
      await purgeFilesSettled();
      expect(fs.existsSync(a.stored)).toBe(true);
      expect(warn.mock.calls).toEqual([['[library] purge: 1 file(s) left for the library check']]);
    } finally {
      fs.chmodSync(shard, 0o755);
    }
  });

  it('refuses an empty or malformed request', async () => {
    for (const bad of [{ itemIds: [], collectionIds: [] }, { itemIds: ['x'], collectionIds: [] }, { paths: ['/etc'] }]) {
      expect(await handlers.get('library:purge')!({ sender: PAGE, senderFrame: { url: 'learn://app/index.html?window=main' } }, bad)).toMatchObject({
        ok: false,
        code: 'VALIDATION_FAILED',
      });
    }
  });
});

describe('library:keepOneOfDuplicates, keepOneOfAllDuplicates, undoKeepOne (spec 5)', () => {
  it('keeps the first import, trashes the rest under one stamp with one trash notice, and the undo puts it all back', async () => {
    const file = pdf('a.pdf', 'dup');
    const first = await imported(file);
    const second = await imported(file, 'managed', true);
    const coll = ctx.collections.create({ name: '강의' }).id;
    ctx.collections.addItems(coll, [second.item.id]);
    sent.length = 0;

    const result = await call<KeepOneResult>('library:keepOneOfDuplicates', { itemIds: [second.item.id] });
    expect(result).toMatchObject({ kept: [first.item.id], trashed: [second.item.id], undo: { trashed: [second.item.id], memberships: [[coll, first.item.id]], tags: [] } });
    expect(sent).toEqual([[CHANGED, { reason: 'trash', itemIds: [second.item.id, first.item.id] }]]);

    expect(await call<number>('library:undoKeepOne', result.undo)).toBe(1);
    expect(sent[1]).toEqual([CHANGED, { reason: 'restore', itemIds: [second.item.id, first.item.id] }]);
    expect(ctx.collections.itemIds(coll, { includeSubcollections: false })).toEqual([second.item.id]);
    expect(await call<number>('library:undoKeepOne', result.undo)).toBe(0); // nothing left to bring back: no notice
    expect(sent).toHaveLength(2);
  });

  it('cleans every group at once; with none there is nothing to announce', async () => {
    const file = pdf('a.pdf', 'dup');
    await imported(file);
    await imported(file, 'managed', true);
    sent.length = 0;
    expect((await call<KeepOneResult>('library:keepOneOfAllDuplicates')).trashed).toHaveLength(1);
    expect(await call<KeepOneResult>('library:keepOneOfAllDuplicates')).toMatchObject({ kept: [], trashed: [] });
    expect(sent).toHaveLength(1);
  });

  it('refuses an undo token that is not one', async () => {
    const bad = { trashed: ['x'], stamp: 'now', memberships: [], tags: [] };
    expect(await handlers.get('library:undoKeepOne')!({ sender: PAGE, senderFrame: { url: 'learn://app/index.html?window=main' } }, bad)).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
  });
});
