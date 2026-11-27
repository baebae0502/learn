import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryRepository, SubtitlesRepository, type Db } from '@learn/db';
import { Importer, ensureLayout, libraryLayout } from '@learn/library';
import type { Result } from '@learn/domain';
import { freshDb, seedItem } from '../../../../../packages/db/test/fixtures';
import type { LibraryContext } from '../library-context';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
const sent: Array<[string, unknown]> = [];
const fakeWindow = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (ch: string, p: unknown) => sent.push([ch, p]) } };
let picked: string[] = [];
const panels: unknown[] = [];
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { getAllWindows: () => [fakeWindow], fromWebContents: () => fakeWindow },
  dialog: {
    showOpenDialog: async (_win: unknown, options: unknown) => {
      panels.push(options);
      return picked.length > 0 ? { canceled: false, filePaths: picked } : { canceled: true, filePaths: [] };
    },
  },
  shell: {},
  app: {},
}));

const { createHandle } = await import('./register');
const { registerSubtitlesIpc } = await import('./subtitles');

const STATIC = path.resolve(import.meta.dirname, '../../../../../fixtures/static/subtitles');
let db: Db;
let ctx: LibraryContext;
let tmp: string;
registerSubtitlesIpc(createHandle(null), stubDeps({ getContext: () => ctx }));
const MAIN_PAGE = fakeSender(61, 'main');
const call = (channel: string, raw?: unknown, sender = MAIN_PAGE) => handlers.get(channel)!({ sender, senderFrame: { url: 'learn://app/index.html?window=main' } }, raw);
async function data<T>(channel: string, raw?: unknown): Promise<T> {
  const r = await call(channel, raw);
  if (!r.ok) throw new Error(`${channel}: ${r.code}`);
  return r.data as T;
}
const notices = () => sent.filter(([ch]) => ch === 'evt:subtitles-changed').map(([, p]) => p);
/** What the body search hears: the library's own notice, as a PDF's extraction sends it. */
const bodyNotices = () => sent.filter(([ch]) => ch === 'evt:library-changed').map(([, p]) => p);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-subipc-'));
  const layout = libraryLayout(path.join(tmp, 'Library'));
  ensureLayout(layout);
  db = freshDb();
  const repo = new LibraryRepository(db);
  ctx = { db, repo, subtitles: new SubtitlesRepository(db), importer: new Importer({ layout, repo }), layout } as unknown as LibraryContext;
  sent.length = 0;
  panels.length = 0;
  picked = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const video = () => {
  const s = seedItem(db, { type: 'video' });
  return s.itemId;
};

describe('subtitles:* (spec 11)', () => {
  it('registers the six channels, main window only', async () => {
    expect([...handlers.keys()].sort()).toEqual(['subtitles:attach', 'subtitles:cues', 'subtitles:list', 'subtitles:pick', 'subtitles:remove', 'subtitles:restore']);
    const settings = await call('subtitles:list', { itemId: video() }, fakeSender(62, 'settings'));
    expect(settings).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });

  it('attach, list, cues; the change is announced once the rows are committed', async () => {
    const itemId = video();
    const r = await data<{ added: Array<{ assetId: string; language: string }>; failed: unknown[] }>('subtitles:attach', { itemId, paths: [path.join(STATIC, 'lecture-60s.ko.srt'), path.join(STATIC, 'broken.srt')] });
    expect(r.added.map((t) => t.language)).toEqual(['ko']);
    expect(r.failed).toEqual([{ name: 'broken.srt', reason: 'no-cues' }]);
    expect(notices()).toEqual([{ itemId }]);
    expect(bodyNotices()).toEqual([{ reason: 'text', itemIds: [itemId] }]);
    const { tracks } = await data<{ tracks: Array<{ assetId: string }> }>('subtitles:list', { itemId });
    expect(tracks).toHaveLength(1);
    const { cues } = await data<{ cues: Array<{ text: string }> }>('subtitles:cues', { itemId, assetId: tracks[0]!.assetId });
    expect(cues.length).toBeGreaterThan(0);
  });

  it('says nothing when nothing was added', async () => {
    const itemId = video();
    await data('subtitles:attach', { itemId, paths: [path.join(STATIC, 'broken.srt')] });
    expect(notices()).toEqual([]);
    expect(bodyNotices()).toEqual([]);
  });

  it('asks for a relative path or an unknown key with VALIDATION_FAILED', async () => {
    const itemId = video();
    expect(await call('subtitles:attach', { itemId, paths: ['rel.srt'] })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await call('subtitles:list', { itemId, extra: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });

  it('pick: the panel offers srt and vtt, and the picked files are attached', async () => {
    const itemId = video();
    picked = [path.join(STATIC, 'lecture-60s.en.vtt')];
    const r = await data<{ added: unknown[] }>('subtitles:pick', { itemId });
    expect(r.added).toHaveLength(1);
    expect(panels[0]).toMatchObject({
      properties: ['openFile', 'multiSelections'],
      filters: [{ extensions: ['srt', 'vtt'] }, { extensions: ['*'] }],
    });
    expect(notices()).toEqual([{ itemId }]);
  });

  it('pick: a cancelled panel answers empty and announces nothing', async () => {
    const itemId = video();
    expect(await data('subtitles:pick', { itemId })).toEqual({ added: [], already: [], failed: [] });
    expect(notices()).toEqual([]);
  });

  it('remove and restore announce, and restore brings the language and the place back', async () => {
    const itemId = video();
    const a = await data<{ added: Array<{ assetId: string }> }>('subtitles:attach', { itemId, paths: [path.join(STATIC, 'lecture-60s.ko.srt'), path.join(STATIC, 'lecture-60s.en.vtt')] });
    sent.length = 0;
    const [ko, en] = a.added as [{ assetId: string }, { assetId: string }];
    const removed = await data<{ position: number; language: string | null }>('subtitles:remove', { itemId, assetId: ko.assetId });
    expect(removed).toEqual({ position: 0, language: 'ko' });
    expect(notices()).toEqual([{ itemId }]);
    // The body search answers from the cues: a cached answer for the same query is read again (spec 8.2).
    expect(bodyNotices()).toEqual([{ reason: 'text', itemIds: [itemId] }]);
    const back = await data<{ position: number; language: string }>('subtitles:restore', { itemId, assetId: ko.assetId, ...removed });
    expect(back).toMatchObject({ position: 0, language: 'ko' });
    expect(notices()).toEqual([{ itemId }, { itemId }]);
    expect(bodyNotices()).toEqual([{ reason: 'text', itemIds: [itemId] }, { reason: 'text', itemIds: [itemId] }]);
    expect(en.assetId).not.toBe(ko.assetId);
  });
});
