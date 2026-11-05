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
const written: Array<[string, unknown]> = [];
const changed = vi.fn();
const cancelTranslation = vi.fn();
registerSettingsIpc(
  createHandle(null),
  stubDeps({
    getContext: () => ({ settings: { get: () => null, set: (key: string, value: unknown) => void written.push([key, value]) } }) as never,
    prefs: {
      get: () => stored,
      set: (patch: Partial<Prefs>) => (stored = { ...stored, ...patch }),
    } as never,
    theme: { changed, shown: () => {} },
    translation: { translate: async () => { throw new Error('not stubbed'); }, cancel: cancelTranslation },
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

describe('prefs.set and the translation in flight (final review m-5)', () => {
  it('ends the request in flight when translation is not on after the set, and leaves it when it is', async () => {
    cancelTranslation.mockClear();
    expect(await invoke({ translation: { ...DEFAULT_PREFS.translation, enabled: true } })).toMatchObject({ ok: true });
    expect(cancelTranslation).not.toHaveBeenCalled();
    expect(await invoke({ translation: { ...DEFAULT_PREFS.translation, enabled: false } })).toMatchObject({ ok: true });
    expect(cancelTranslation).toHaveBeenCalledTimes(1);
    expect(await invoke({ translation: { ...DEFAULT_PREFS.translation, enabled: null } })).toMatchObject({ ok: true });
    expect(cancelTranslation).toHaveBeenCalledTimes(2);
  });
});

describe('settings.set: keys main writes itself (Q-8e)', () => {
  const set = (raw: unknown) => handlers.get('settings:set')!({ sender: MAIN_PAGE, senderFrame: { url: 'learn://app/index.html' } }, raw);
  it('refuses recovery.lastShown from a page and writes a page\'s own key', async () => {
    expect(await set({ key: 'recovery.lastShown', value: 'a'.repeat(64) })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await set({ key: 'ui.lastOpenItemId', value: null })).toMatchObject({ ok: true });
    expect(written).toEqual([['ui.lastOpenItemId', null]]);
  });
});

describe('settings.set: what main alone writes (R4)', () => {
  it('refuses backup.last from a page — it would point 마지막 백업\'s Finder에서 보기 anywhere — before the library is asked', async () => {
    const set = (raw: unknown) => handlers.get('settings:set')!({ sender: MAIN_PAGE, senderFrame: { url: 'learn://app/index.html' } }, raw);
    expect(await set({ key: 'backup.last', value: { at: '2026-10-30T12:41:00.000Z', folder: '/tmp' } })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });
});
