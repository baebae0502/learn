import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnError, type ReadingPosition, type Result } from '@learn/domain';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
const sent: unknown[] = [];
const fakeWindow = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...args: unknown[]) => sent.push(args) } };

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { getAllWindows: () => [fakeWindow] },
}));

const { createHandle } = await import('./register');
const { registerReaderIpc } = await import('./reader');

const ITEM = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
const REV = '1b6f5a52-2c1e-4d55-9a3e-0d2c6f7e8a90';
const stored: ReadingPosition = {
  itemId: ITEM, revisionId: REV, locator: { kind: 'pdf', pageIndex: 2 }, progress: 0.5, openedAt: 'then', updatedAt: 'then',
};
const reading = { get: vi.fn((_id: string): ReadingPosition | undefined => stored), markOpened: vi.fn(), save: vi.fn() };
registerReaderIpc(createHandle(null), stubDeps({ getContext: () => ({ reading }) as never, appInfo: () => ({}) as never }));

const MAIN_PAGE = fakeSender(1, 'main');
const call = (channel: string, raw: unknown) => handlers.get(channel)!({ sender: MAIN_PAGE, senderFrame: { url: 'learn://app/index.html' } }, raw);

beforeEach(() => {
  vi.clearAllMocks();
  sent.length = 0;
});

describe('reader IPC', () => {
  it('getPosition is a pure read: it never records an open', async () => {
    expect(await call('reader:getPosition', { itemId: ITEM })).toEqual({ ok: true, data: stored });
    reading.get.mockReturnValueOnce(undefined);
    expect(await call('reader:getPosition', { itemId: ITEM })).toEqual({ ok: true, data: null });
    expect(reading.markOpened).not.toHaveBeenCalled();
    expect(reading.save).not.toHaveBeenCalled();
  });

  it('open records the open once per call and announces it, so a list that shows openedAt can follow', async () => {
    expect(await call('reader:open', { itemId: ITEM })).toEqual({ ok: true, data: undefined });
    expect(reading.markOpened).toHaveBeenCalledTimes(1);
    expect(reading.markOpened).toHaveBeenCalledWith(ITEM);
    expect(reading.get).not.toHaveBeenCalled();
    expect(sent).toEqual([['evt:library-changed', { reason: 'opened', itemIds: [ITEM] }]]);
  });

  it('announces nothing for an open that failed, nor for a read or a save of the position', async () => {
    reading.markOpened.mockImplementationOnce(() => {
      throw new LearnError('NOT_FOUND', '항목을 찾을 수 없습니다.');
    });
    expect(await call('reader:open', { itemId: ITEM })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await call('reader:getPosition', { itemId: ITEM })).toEqual({ ok: true, data: stored });
    expect(await call('reader:savePosition', { itemId: ITEM, revisionId: REV, locator: { kind: 'pdf', pageIndex: 1 }, progress: 0.1 })).toEqual({ ok: true, data: undefined });
    expect(sent).toEqual([]);
  });
});
