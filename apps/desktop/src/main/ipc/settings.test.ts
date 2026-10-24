import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PREFS, type Prefs, type Result } from '@learn/domain';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { getAllWindows: () => [] },
}));

const { createHandle } = await import('./register');
const { registerSettingsIpc } = await import('./settings');

let stored: Prefs = { ...DEFAULT_PREFS };
const changed = vi.fn();
registerSettingsIpc(
  createHandle(null),
  stubDeps({
    prefs: {
      get: () => stored,
      set: (patch: Partial<Prefs>) => (stored = { ...stored, ...patch }),
    } as never,
    theme: { changed, shown: () => {} },
  }),
);
const MAIN_PAGE = fakeSender(1, 'main');
const invoke = (raw: unknown) => handlers.get('prefs:set')!({ sender: MAIN_PAGE, senderFrame: { url: 'learn://app/index.html' } }, raw);

describe('prefs.set and the theme (T13R4-m1)', () => {
  it('hands a changed theme to the follower (the pages lead, the native theme follows); other prefs do not', async () => {
    expect(stored.theme).toBe('system');
    expect(await invoke({ density: 'compact' })).toMatchObject({ ok: true });
    expect(changed).not.toHaveBeenCalled();
    expect(await invoke({ theme: 'dark' })).toMatchObject({ ok: true, data: { theme: 'dark' } });
    expect(changed.mock.calls).toEqual([['dark']]);
    expect(await invoke({ theme: 'dark', fontSize: 14 })).toMatchObject({ ok: true });
    expect(changed).toHaveBeenCalledTimes(1); // the same theme again: nothing to follow
  });
});
