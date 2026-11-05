import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnError, POSITION_NOTICE_MS, type ReadingPosition, type Result } from '@learn/domain';
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

  it('announces nothing for an open that failed, nor for a read of the position', async () => {
    reading.markOpened.mockImplementationOnce(() => {
      throw new LearnError('NOT_FOUND', '항목을 찾을 수 없습니다.');
    });
    expect(await call('reader:open', { itemId: ITEM })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await call('reader:getPosition', { itemId: ITEM })).toEqual({ ok: true, data: stored });
    expect(sent).toEqual([]);
  });

  describe('position notices', () => {
    const OTHER = '9c1e2b3a-4d5f-4a6b-8c7d-0e1f2a3b4c5d';
    const save = (itemId: string, pageIndex: number) =>
      call('reader:savePosition', { itemId, revisionId: REV, locator: { kind: 'pdf', pageIndex }, progress: 0.1 });
    const notice = (itemId: string) => ['evt:library-changed', { reason: 'position', itemIds: [itemId] }];
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('the first save of an item is announced at once; saves inside the next two seconds make one notice at the end', async () => {
      await save(ITEM, 1);
      expect(sent).toEqual([notice(ITEM)]);
      await vi.advanceTimersByTimeAsync(300);
      await save(ITEM, 2);
      await vi.advanceTimersByTimeAsync(300);
      await save(ITEM, 3);
      expect(sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(POSITION_NOTICE_MS - 600 - 1);
      expect(sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sent).toEqual([notice(ITEM), notice(ITEM)]);
      await vi.advanceTimersByTimeAsync(POSITION_NOTICE_MS * 2);
      expect(sent).toHaveLength(2); // nothing more was saved
    });

    it('a save after the window is announced at once, and each item keeps its own window', async () => {
      await save(ITEM, 1);
      await vi.advanceTimersByTimeAsync(POSITION_NOTICE_MS);
      await save(ITEM, 2);
      await save(OTHER, 1);
      expect(sent).toEqual([notice(ITEM), notice(ITEM), notice(OTHER)]);
      await vi.advanceTimersByTimeAsync(POSITION_NOTICE_MS); // the windows close
    });

    it('a save that failed announces nothing', async () => {
      reading.save.mockImplementationOnce(() => {
        throw new LearnError('NOT_FOUND', '항목을 찾을 수 없습니다.');
      });
      expect(await save(ITEM, 1)).toMatchObject({ ok: false });
      await vi.advanceTimersByTimeAsync(POSITION_NOTICE_MS * 2);
      expect(sent).toEqual([]);
    });
  });
});
