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
registerUiIpc(createHandle(null), stubDeps({ getContext: () => ({}) as never, appInfo: () => ({}) as never }));

const call = (raw?: unknown) => handlers.get('ui:windowState')!({ sender: {}, senderFrame: { url: 'learn://app/index.html' } }, raw);

beforeEach(() => {
  Object.assign(win, { fullscreen: false, focused: true, destroyed: false });
  senderWindow = fakeWindow;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ui.windowState (query; the windowState push stays)', () => {
  it("answers the sender window's current fullscreen and focus state", async () => {
    expect(await call()).toEqual({ ok: true, data: { fullscreen: false, focused: true } });
    Object.assign(win, { fullscreen: true, focused: false });
    expect(await call({})).toEqual({ ok: true, data: { fullscreen: true, focused: false } });
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
