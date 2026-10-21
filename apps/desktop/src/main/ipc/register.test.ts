import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Channels, LearnError, itemIdInput, type Result } from '@learn/domain';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
}));

const { createHandle } = await import('./register');

const APP_URL = 'learn://app/index.html';
const ITEM = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
const call = (channel: string, raw: unknown, url = APP_URL) => handlers.get(channel)!({ senderFrame: { url } }, raw);

let logged: unknown[][];
beforeEach(() => {
  handlers.clear();
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void logged.push(args));
});
afterEach(() => vi.restoreAllMocks());

describe('createHandle (the single IPC entry point)', () => {
  it('rejects a sender from a foreign URL (and asset documents) without running the handler', async () => {
    const fn = vi.fn(() => ({ version: 'x' }) as never);
    createHandle(null)(Channels.app.info, z.object({}).optional(), fn);
    for (const url of ['https://evil.example/', 'file:///tmp/x.html', 'learn://app/asset/abc', 'http://localhost:5173/']) {
      const r = await call(Channels.app.info, undefined, url);
      expect(r).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it('accepts the dev server origin only when one was configured', async () => {
    createHandle('http://localhost:5173')(Channels.app.info, z.object({}).optional(), () => ({ version: 'dev' }) as never);
    expect(await call(Channels.app.info, undefined, 'http://localhost:5173/')).toEqual({ ok: true, data: { version: 'dev' } });
  });

  it('answers VALIDATION_FAILED for invalid input without running the handler', async () => {
    const fn = vi.fn(() => null);
    createHandle(null)(Channels.reader.getPosition, itemIdInput, fn);
    for (const raw of [undefined, null, {}, { itemId: 'not-a-uuid' }, { itemId: 42 }]) {
      expect(await call(Channels.reader.getPosition, raw)).toEqual({
        ok: false, code: 'VALIDATION_FAILED', message: '잘못된 요청입니다.', retryable: false,
      });
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it('turns a throwing handler into a failure Result and logs only the channel and the code', async () => {
    const handle = createHandle(null);
    handle(Channels.library.detail, itemIdInput, () => {
      throw new Error('/Users/someone/Secret Papers/paper.pdf could not be parsed');
    });
    handle(Channels.library.trash, z.object({ itemIds: z.array(z.string()) }), () => {
      throw new LearnError('NOT_FOUND', '자료를 찾을 수 없습니다: /Users/someone/Secret Papers');
    });

    const internal = await call(Channels.library.detail, { itemId: ITEM });
    expect(internal).toEqual({ ok: false, code: 'INTERNAL', message: '알 수 없는 오류가 발생했습니다.', retryable: false });
    const known = await call(Channels.library.trash, { itemIds: [ITEM] });
    expect(known).toMatchObject({ ok: false, code: 'NOT_FOUND' });

    expect(logged).toEqual([['[ipc] library:detail failed: INTERNAL'], ['[ipc] library:trash failed: NOT_FOUND']]);
    expect(JSON.stringify(logged)).not.toMatch(/Secret|Users|paper|찾을/);
  });

  it('wraps the handler result (sync or async) in an ok Result and passes the parsed input', async () => {
    const handle = createHandle(null);
    const seen: unknown[] = [];
    handle(Channels.reader.getPosition, itemIdInput, (input) => {
      seen.push(input);
      return null;
    });
    handle(Channels.library.trash, z.object({ itemIds: z.array(z.string()).min(1) }), async ({ itemIds }) => itemIds.length);
    expect(await call(Channels.reader.getPosition, { itemId: ITEM, extra: 1 })).toEqual({ ok: true, data: null });
    expect(seen).toEqual([{ itemId: ITEM }]); // zod output, unknown keys stripped
    expect(await call(Channels.library.trash, { itemIds: [ITEM, ITEM] })).toEqual({ ok: true, data: 2 });
    expect(logged).toEqual([]);
  });
});
