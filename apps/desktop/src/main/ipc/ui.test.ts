import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '@learn/domain';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
const messageBox = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => ({ response: 0, checkboxChecked: false })));
const win = { fullscreen: false, focused: true, destroyed: false };
const fakeWindow = {
  isDestroyed: () => win.destroyed,
  isFullScreen: () => win.fullscreen,
  isFocused: () => win.focused,
  focus: () => {
    win.focused = true;
  },
};
let senderWindow: typeof fakeWindow | null = fakeWindow;

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => senderWindow, getAllWindows: () => [] },
  dialog: { showMessageBox: messageBox },
}));

vi.mock('../menu/column-menu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../menu/column-menu')>()),
  popupColumnMenu: vi.fn(async () => ({ toggle: 'year' as const })),
}));

const { createHandle } = await import('./register');
const { registerUiIpc } = await import('./ui');
const { popupColumnMenu } = await import('../menu/column-menu');

const MAIN = fakeSender(1, 'main');
const SHEET = fakeSender(2, 'sheet');
const SETTINGS = fakeSender(3, 'settings');
const opened: unknown[] = [];
const openSettings = vi.fn();
const themeShown = vi.fn();
const prepareSettings = vi.fn();
registerUiIpc(
  createHandle(null),
  stubDeps({
    appInfo: () => ({}) as never,
    isMainWindow: (sender) => sender === (MAIN as never),
    sheets: {
      open: async (_parent, payload) => {
        opened.push(payload);
        return { kind: 'shortcuts' };
      },
      payloadFor: () => ({ kind: 'shortcuts' }),
      resolve: () => {},
      act: async () => {
        throw new Error('sheets.act not stubbed');
      },
      onAct: () => {},
    },
    windows: { openSettings, asSheet: (_owner, show) => show() },
    isSettingsWindow: (sender) => sender === (SETTINGS as never),
    theme: { changed: () => {}, shown: themeShown },
    prepareSettings,
  }),
);

const invoke = (channel: string, sender: unknown, raw?: unknown) => handlers.get(channel)!({ sender, senderFrame: { url: 'learn://app/index.html' } }, raw);
const call = (raw?: unknown) => invoke('ui:windowState', MAIN, raw);

beforeEach(() => {
  Object.assign(win, { fullscreen: false, focused: true, destroyed: false });
  senderWindow = fakeWindow;
  opened.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('sheets are opened over the main window only', () => {
  it('ui.showShortcuts shows the ⌘/ sheet over the main window', async () => {
    expect(await invoke('ui:showShortcuts', MAIN)).toEqual({ ok: true, data: undefined });
    expect(opened).toEqual([{ kind: 'shortcuts', view: 'library' }]);
  });
  it('any other window (a sheet, the settings window) is PERMISSION_DENIED and opens nothing', async () => {
    for (const from of [SHEET, SETTINGS]) expect(await invoke('ui:showShortcuts', from)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(opened).toEqual([]);
  });
  it('the duplicate question is no channel of the page any more: main\'s import queue asks it', () => {
    expect(handlers.has('ui:confirmDuplicate')).toBe(false);
  });
});

describe('ui.openSettings (the main-owned ⌘, behind the fatal screen\'s 설정 열기)', () => {
  it('opens (or brings forward) the settings window from the main window; the settings window and a sheet are refused', async () => {
    openSettings.mockClear();
    expect(await invoke('ui:openSettings', MAIN)).toEqual({ ok: true, data: undefined });
    expect(await invoke('ui:openSettings', SETTINGS)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await invoke('ui:openSettings', SHEET)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(await invoke('ui:openSettings', MAIN, { x: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(openSettings).toHaveBeenCalledTimes(1);
  });
});

describe('ui.windowState (query; the windowState push stays)', () => {
  it("answers the sender window's current fullscreen and focus state", async () => {
    expect(await call()).toEqual({ ok: true, data: { fullscreen: false, focused: true, sheetOpen: false, main: true } });
    Object.assign(win, { fullscreen: true, focused: false });
    expect(await call({})).toEqual({ ok: true, data: { fullscreen: true, focused: false, sheetOpen: false, main: false } });
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

describe('ui.themeShown (T13R4-m1: the native theme follows the pages)', () => {
  it('takes the shade a main or settings page shows; a sheet is PERMISSION_DENIED; anything but light / dark is refused', async () => {
    themeShown.mockClear();
    expect(await invoke('ui:themeShown', MAIN, { shade: 'dark' })).toEqual({ ok: true, data: undefined });
    expect(await invoke('ui:themeShown', SETTINGS, { shade: 'light' })).toEqual({ ok: true, data: undefined });
    expect(themeShown.mock.calls).toEqual([
      [MAIN, 'dark'],
      [SETTINGS, 'light'],
    ]);
    expect(await invoke('ui:themeShown', SHEET, { shade: 'dark' })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await invoke('ui:themeShown', MAIN, { shade: 'system' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await invoke('ui:themeShown', MAIN, { shade: 'dark', at: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(themeShown).toHaveBeenCalledTimes(2);
  });
});

describe('ui.showColumnMenu (P-9: the column header has its own channel)', () => {
  beforeEach(() => {
    senderWindow = fakeWindow;
  });
  it('pops the column menu over the sender window, the shown columns checked, and returns the pick', async () => {
    expect(await invoke('ui:showColumnMenu', MAIN, { visible: ['title', 'year'], x: 12, y: 34 })).toEqual({ ok: true, data: { toggle: 'year' } });
    const [entries, at] = vi.mocked(popupColumnMenu).mock.calls.at(-1)!;
    expect(entries.filter((e) => e !== 'separator' && e.kind === 'column' && e.checked).map((e) => (e as { id: string }).id)).toEqual(['title', 'year']);
    expect(at).toEqual({ window: fakeWindow, x: 12, y: 34 });
  });
  it('refuses columns it does not know (VALIDATION_FAILED) and answers null without a window', async () => {
    expect(await invoke('ui:showColumnMenu', MAIN, { visible: ['tags'], x: 0, y: 0 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    senderWindow = null;
    expect(await invoke('ui:showColumnMenu', MAIN, { visible: ['title'], x: 0, y: 0 })).toEqual({ ok: true, data: null });
  });
});

describe('ui.reportIdle (spec 8, P-4: the settings window is prepared once the main window is idle)', () => {
  it('prepares it for the main window only; a sheet or the settings window is PERMISSION_DENIED; it takes no input', async () => {
    prepareSettings.mockClear();
    expect(await invoke('ui:reportIdle', MAIN)).toEqual({ ok: true, data: undefined });
    expect(prepareSettings).toHaveBeenCalledTimes(1);
    expect(await invoke('ui:reportIdle', SHEET)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await invoke('ui:reportIdle', SETTINGS)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await invoke('ui:reportIdle', MAIN, { now: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(prepareSettings).toHaveBeenCalledTimes(1);
  });
});

describe('ui.confirm (a question as a sheet on the main window, in the renderer\'s words)', () => {
  const ask = { message: '‘학회 준비’\u2060를 삭제하겠습니까?', detail: '자료는 내 라이브러리에 남습니다.', confirm: '삭제' };
  beforeEach(() => messageBox.mockClear());

  it('shows the message with the confirming button first and the default, 취소 after it, and answers whether the first was chosen', async () => {
    expect(await invoke('ui:confirm', MAIN, ask)).toEqual({ ok: true, data: true });
    expect(messageBox).toHaveBeenCalledExactlyOnceWith(fakeWindow, { type: 'none', message: ask.message, detail: ask.detail, buttons: ['삭제', '취소'], defaultId: 0, cancelId: 1, noLink: true });
    messageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
    expect(await invoke('ui:confirm', MAIN, { message: ask.message, confirm: '삭제' })).toEqual({ ok: true, data: false });
    expect(messageBox.mock.lastCall?.[1]).not.toHaveProperty('detail');
  });
  it('shows the caution symbol only when the question asks for it', async () => {
    await invoke('ui:confirm', MAIN, { ...ask, caution: true });
    expect(messageBox.mock.lastCall?.[1]).toMatchObject({ type: 'warning' });
    await invoke('ui:confirm', MAIN, { ...ask, caution: false });
    expect(messageBox.mock.lastCall?.[1]).toMatchObject({ type: 'none' });
    expect(await invoke('ui:confirm', MAIN, { ...ask, caution: 'yes' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });
  it('is refused from any other window and for input it is not meant to take', async () => {
    for (const from of [SHEET, SETTINGS]) expect(await invoke('ui:confirm', from, ask)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await invoke('ui:confirm', MAIN, { message: '', confirm: '삭제' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await invoke('ui:confirm', MAIN, { ...ask, extra: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(messageBox).not.toHaveBeenCalled();
  });
});
