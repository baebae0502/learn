import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnError, type Result } from '@learn/domain';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { getAllWindows: () => [] },
}));

const { createHandle } = await import('./register');
const { registerSearchIpc } = await import('./search');

interface Call { query: string; signal: AbortSignal; release: () => void }
const calls: Call[] = [];
const searchBody = vi.fn((_db: unknown, query: string, signal: AbortSignal) => {
  return new Promise<{ itemIds: string[]; searched: boolean }>((resolve, reject) => {
    const call: Call = {
      query, signal,
      release: () => (signal.aborted ? reject(new LearnError('CANCELLED', 'stopped')) : resolve({ itemIds: [query], searched: true })),
    };
    calls.push(call);
  });
});
const searchPages = vi.fn(() => ({ pages: [], total: 0 }));
const progress = vi.fn(() => ({ done: 1, total: 2 }));
const ctx = { db: {}, repo: {}, text: { progress } };
registerSearchIpc(createHandle(null), stubDeps({ getContext: () => ctx as never }), { searchBody: searchBody as never, searchPages: searchPages as never });

const W1 = fakeSender(1, 'main');
const W2 = fakeSender(2, 'main');
const call = (sender: unknown, channel: string, raw: unknown) => handlers.get(channel)!({ sender, senderFrame: { url: 'learn://app/index.html' } }, raw);
const ITEM = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe('search:body', () => {
  it('a newer request of a window stops the older one: the older answers CANCELLED, the newer answers', async () => {
    const first = call(W1, 'search:body', { query: 'abc' });
    const second = call(W1, 'search:body', { query: 'abcd' });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.signal.aborted).toBe(false);
    calls[0]!.release();
    calls[1]!.release();
    expect(await first).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(await second).toEqual({ ok: true, data: { itemIds: ['abcd'], searched: true } });
  });

  it('another window does not stop it (positive control: the same window does)', async () => {
    const a = call(W1, 'search:body', { query: 'one' });
    const b = call(W2, 'search:body', { query: 'two' });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]!.signal.aborted).toBe(false);
    const c = call(W1, 'search:body', { query: 'three' });
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[0]!.signal.aborted).toBe(true);
    expect(calls[1]!.signal.aborted).toBe(false);
    for (const k of calls) k.release();
    expect(await a).toMatchObject({ ok: false, code: 'CANCELLED' });
    expect(await b).toMatchObject({ ok: true });
    expect(await c).toMatchObject({ ok: true });
  });

  it('a finished request leaves the table: the next one stops nothing', async () => {
    const a = call(W1, 'search:body', { query: 'one' });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    calls[0]!.release();
    await a;
    const b = call(W1, 'search:body', { query: 'two' });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]!.signal.aborted).toBe(false);
    calls[1]!.release();
    await b;
  });

  it('refuses a query over 200 characters and an unknown key', async () => {
    expect(await call(W1, 'search:body', { query: 'a'.repeat(201) })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await call(W1, 'search:body', { query: 'a', extra: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(searchBody).not.toHaveBeenCalled();
  });
});

describe('search:pages and search:progress', () => {
  it('pages passes a valid request through; a bad item id, an empty query and an unknown key are refused', async () => {
    expect(await call(W1, 'search:pages', { itemId: ITEM, query: 'abc' })).toEqual({ ok: true, data: { pages: [], total: 0 } });
    expect(searchPages).toHaveBeenCalledTimes(1);
    expect(await call(W1, 'search:pages', { itemId: 'nope', query: 'abc' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await call(W1, 'search:pages', { itemId: ITEM, query: '' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await call(W1, 'search:pages', { itemId: ITEM, query: 'abc', x: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(searchPages).toHaveBeenCalledTimes(1);
  });

  it('progress answers the index progress', async () => {
    expect(await call(W1, 'search:progress', undefined)).toEqual({ ok: true, data: { done: 1, total: 2 } });
  });
});
