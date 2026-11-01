import { describe, expect, it, vi } from 'vitest';
import type { Result } from '@learn/domain';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
const win = { id: 1 };
let senderWindow: typeof win | null = win;
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => senderWindow, getAllWindows: () => [] },
}));

const { createHandle } = await import('./register');
const { registerCheckIpc } = await import('./check');

const opened: unknown[][] = [];
registerCheckIpc(
  createHandle(null),
  stubDeps({
    checks: {
      open: async (parent, mode) => void opened.push([parent, mode]),
      act: async () => {
        throw new Error('not used');
      },
      recheck: async () => {
        throw new Error('not used');
      },
    },
  }),
);
const MAIN = fakeSender(61, 'main');
const SHEET = fakeSender(62, 'sheet');
const SETTINGS = fakeSender(63, 'settings');
const invoke = (sender: unknown, raw?: unknown) => handlers.get('library:check')!({ sender, senderFrame: { url: 'learn://app/index.html' } }, raw);

describe('library:check (spec 7.1, 11.1 파일 › 라이브러리 점검…)', () => {
  it('opens the check over the asking window — fresh by default, the automatic one when asked so — and answers once it closed', async () => {
    expect(await invoke(MAIN)).toEqual({ ok: true, data: undefined });
    expect(await invoke(MAIN, { auto: true })).toEqual({ ok: true, data: undefined });
    expect(await invoke(MAIN, { auto: false })).toEqual({ ok: true, data: undefined });
    expect(opened).toEqual([[win, 'manual'], [win, 'auto'], [win, 'manual']]);
  });
  it('is the main window\'s only, takes nothing more, and needs a window', async () => {
    opened.length = 0;
    expect(await invoke(SHEET)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await invoke(SETTINGS)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await invoke(MAIN, { auto: true, path: '/tmp' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    senderWindow = null;
    expect(await invoke(MAIN)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    senderWindow = win;
    expect(opened).toEqual([]);
  });
});
