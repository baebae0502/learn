import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsRepository, LibraryRepository, type Db } from '@learn/db';
import { LearnError, nowIso, type Result, type SessionSummary, type SessionThread } from '@learn/domain';
import { freshDb, seedItem } from '../../../../../packages/db/test/fixtures';
import type { LibraryContext } from '../library-context';
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
const { registerSessionsIpc } = await import('./sessions');

let db: Db;
let ctx: LibraryContext | null;
registerSessionsIpc(createHandle(null), stubDeps({
  getContext: () => {
    if (!ctx) throw new LearnError('LIBRARY_UNAVAILABLE', 'no library');
    return ctx;
  },
}));
const MAIN_PAGE = fakeSender(51, 'main');
const SETTINGS_PAGE = fakeSender(52, 'settings');
const call = (channel: string, raw?: unknown, sender = MAIN_PAGE) => handlers.get(channel)!({ sender, senderFrame: { url: 'learn://app/index.html?window=main' } }, raw);
async function data<T>(channel: string, raw?: unknown): Promise<T> {
  const r = await call(channel, raw);
  if (!r.ok) throw new Error(`${channel}: ${r.code}`);
  return r.data as T;
}
const CHANGED = 'evt:sessions-changed';
const notices = () => sent.filter(([ch]) => ch === CHANGED).map(([, p]) => p);

/** A session of a new item, made as a first question makes one. */
function session(title = '어텐션이 뭐야?') {
  const item = seedItem(db);
  const b = ctx!.conversations.beginTurn({
    conversationId: null, itemId: item.itemId, revisionId: item.revisionId, agent: 'fake', openedAtPage: 0,
    user: { kind: 'question', text: title, sent: { selection: 0, replayedTurns: 0, preamble: true }, attached: null }, now: nowIso(),
  });
  return { itemId: item.itemId, conversationId: b.conversationId };
}

beforeEach(() => {
  db = freshDb();
  ctx = { db, repo: new LibraryRepository(db), conversations: new ConversationsRepository(db) } as unknown as LibraryContext;
  sent.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

const CHANNELS = ['sessions:list', 'sessions:recent', 'sessions:get', 'sessions:rename', 'sessions:delete', 'sessions:restore'];
const inputOf = (channel: string, s: { itemId: string; conversationId: string }): unknown =>
  ({
    'sessions:list': { itemId: s.itemId },
    'sessions:recent': undefined,
    'sessions:get': { conversationId: s.conversationId },
    'sessions:rename': { conversationId: s.conversationId, title: '새 이름' },
    'sessions:delete': { conversationId: s.conversationId },
    'sessions:restore': { conversationId: s.conversationId },
  })[channel];

describe('sessions:* (spec 12)', () => {
  it('registers the six channels', () => {
    expect([...handlers.keys()].sort()).toEqual([...CHANNELS].sort());
  });

  it.each(CHANNELS)('%s: the settings window is refused before the library is read', async (channel) => {
    const s = session();
    expect(await call(channel, inputOf(channel, s), SETTINGS_PAGE)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(notices()).toEqual([]);
    expect(ctx!.conversations.conversation(s.conversationId)).toMatchObject({ deleted: false });
  });

  it.each(CHANNELS)('%s: an unknown key is VALIDATION_FAILED', async (channel) => {
    const s = session();
    expect(await call(channel, { ...((inputOf(channel, s) as object | undefined) ?? {}), extra: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(notices()).toEqual([]);
  });

  it.each(CHANNELS)('%s: without a library it is LIBRARY_UNAVAILABLE', async (channel) => {
    const s = session();
    ctx = null;
    expect(await call(channel, inputOf(channel, s))).toMatchObject({ ok: false, code: 'LIBRARY_UNAVAILABLE' });
    expect(notices()).toEqual([]);
  });

  it('list, recent and get read the repository', async () => {
    const s = session('첫 질문입니다');
    expect((await data<SessionSummary[]>('sessions:list', { itemId: s.itemId })).map((x) => [x.id, x.title])).toEqual([[s.conversationId, '첫 질문입니다']]);
    expect(await data('sessions:recent')).toMatchObject({ groups: [{ item: { id: s.itemId }, sessions: [{ id: s.conversationId }] }] });
    const thread = await data<SessionThread>('sessions:get', { conversationId: s.conversationId });
    expect(thread.messages.map((m) => [m.role, m.status])).toEqual([['user', 'complete'], ['tutor', 'streaming']]);
  });

  it('get: a deleted session and a session of an item in the trash are NOT_FOUND', async () => {
    const s = session();
    expect(await call('sessions:get', { conversationId: s.conversationId })).toMatchObject({ ok: true });
    ctx!.conversations.remove(s.conversationId, nowIso());
    expect(await call('sessions:get', { conversationId: s.conversationId })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const t = session();
    expect(await call('sessions:get', { conversationId: t.conversationId })).toMatchObject({ ok: true });
    ctx!.repo.trash([t.itemId]);
    expect(await call('sessions:get', { conversationId: t.conversationId })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('rename changes the row, then sessions:changed{renamed} once, to every window', async () => {
    const s = session();
    const renamed = await data<SessionSummary>('sessions:rename', { conversationId: s.conversationId, title: '  내 세션  ' });
    expect(renamed).toMatchObject({ id: s.conversationId, title: '내 세션', renamed: true });
    expect(notices()).toEqual([{ reason: 'renamed', itemIds: [s.itemId], conversationIds: [s.conversationId] }]);
    // null gives the first question back as the title.
    sent.length = 0;
    expect(await data<SessionSummary>('sessions:rename', { conversationId: s.conversationId, title: null })).toMatchObject({ renamed: false });
    expect(notices()).toHaveLength(1);
  });

  it('delete marks the session deleted and announces it; restore brings it back and announces that', async () => {
    const s = session();
    expect(await call('sessions:delete', { conversationId: s.conversationId })).toEqual({ ok: true, data: undefined });
    expect(ctx!.conversations.conversation(s.conversationId)).toMatchObject({ deleted: true });
    expect(await data<SessionSummary[]>('sessions:list', { itemId: s.itemId })).toEqual([]);
    expect(await call('sessions:restore', { conversationId: s.conversationId })).toEqual({ ok: true, data: undefined });
    expect(ctx!.conversations.conversation(s.conversationId)).toMatchObject({ deleted: false });
    expect(notices()).toEqual([
      { reason: 'deleted', itemIds: [s.itemId], conversationIds: [s.conversationId] },
      { reason: 'restored', itemIds: [s.itemId], conversationIds: [s.conversationId] },
    ]);
  });

  it('nothing is announced when nothing changed: an unknown session, a second delete, a restore of a live one', async () => {
    const s = session();
    const unknown = '9f2b8c1e-5d4a-4b6f-8a9e-1c2d3e4f5a6b';
    expect(await call('sessions:rename', { conversationId: unknown, title: 'x' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await call('sessions:delete', { conversationId: unknown })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await call('sessions:restore', { conversationId: s.conversationId })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(notices()).toEqual([]);
    expect(await call('sessions:delete', { conversationId: s.conversationId })).toMatchObject({ ok: true });
    expect(await call('sessions:delete', { conversationId: s.conversationId })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(notices()).toHaveLength(1);
  });
});
