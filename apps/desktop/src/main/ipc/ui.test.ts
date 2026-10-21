import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '@learn/domain';
import { stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
const win = { fullscreen: false, focused: true, destroyed: false };
const fakeWindow = {
  isDestroyed: () => win.destroyed,
  isFullScreen: () => win.fullscreen,
  isFocused: () => win.focused,
};
let senderWindow: typeof fakeWindow | null = fakeWindow;

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => senderWindow, getAllWindows: () => [] },
}));

const { createHandle } = await import('./register');
const { registerUiIpc } = await import('./ui');

const MAIN = { id: 1 };
const SHEET = { id: 2 };
const ITEM_ID = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
const item = { title: '분자생물학 6장', type: 'pdf', size: 4200, createdAt: '2026-10-20T11:40:00.000Z', storageMode: 'managed' };
const opened: unknown[] = [];
registerUiIpc(
  createHandle(null),
  stubDeps({
    getContext: () => ({ repo: { getItem: (id: string) => (id === ITEM_ID ? item : null) } }) as never,
    appInfo: () => ({}) as never,
    isMainWindow: (sender) => sender === (MAIN as never),
    sheets: {
      open: async (_parent, payload) => {
        opened.push(payload);
        return payload.kind === 'duplicate' ? { kind: 'duplicate', choice: 'add' } : { kind: 'shortcuts' };
      },
      payloadFor: () => ({ kind: 'shortcuts' }),
      resolve: () => {},
    },
  }),
);

const invoke = (channel: string, sender: unknown, raw?: unknown) => handlers.get(channel)!({ sender, senderFrame: { url: 'learn://app/index.html' } }, raw);
const call = (raw?: unknown) => invoke('ui:windowState', {}, raw);

beforeEach(() => {
  Object.assign(win, { fullscreen: false, focused: true, destroyed: false });
  senderWindow = fakeWindow;
  opened.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('sheets are opened over the main window only', () => {
  it('ui.confirmDuplicate shows the duplicate sheet with the existing item card and answers its choice', async () => {
    expect(await invoke('ui:confirmDuplicate', MAIN, { path: '/x/molbio.pdf', existingItemId: ITEM_ID })).toEqual({ ok: true, data: { choice: 'add' } });
    expect(opened).toEqual([{ kind: 'duplicate', fileName: 'molbio.pdf', existing: item }]);
    expect(await invoke('ui:showShortcuts', MAIN)).toEqual({ ok: true, data: undefined });
    expect(opened).toHaveLength(2);
  });
  it('any other window (a sheet, later the settings window) is PERMISSION_DENIED and opens nothing', async () => {
    expect(await invoke('ui:confirmDuplicate', SHEET, { path: '/x/molbio.pdf', existingItemId: ITEM_ID })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await invoke('ui:showShortcuts', SHEET)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(opened).toEqual([]);
  });
});

describe('ui.windowState (query; the windowState push stays)', () => {
  it("answers the sender window's current fullscreen and focus state", async () => {
    expect(await call()).toEqual({ ok: true, data: { fullscreen: false, focused: true, sheetOpen: false } });
    Object.assign(win, { fullscreen: true, focused: false });
    expect(await call({})).toEqual({ ok: true, data: { fullscreen: true, focused: false, sheetOpen: false } });
  });

  it('NOT_FOUND when the sender has no (live) window; extra input is VALIDATION_FAILED', async () => {
    senderWindow = null;
    expect(await call()).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    senderWindow = fakeWindow;
    win.destroyed = true;
    expect(await call()).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await call({ extra: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });
});
