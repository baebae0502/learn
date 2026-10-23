import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '@learn/domain';
import { stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
/** What the fake dialogs and shell saw: each call's parent window and kind, in order. */
const calls: Array<{ kind: 'open' | 'confirm' | 'reveal'; parent: unknown; detail?: string }> = [];
let picked: string[] = [];
let answer = 0;

const SETTINGS = { id: 2, name: 'settings window' };
let senderWindow: typeof SETTINGS | null = SETTINGS;

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => senderWindow, getAllWindows: () => [] },
  dialog: {
    showOpenDialog: async (...args: unknown[]) => {
      calls.push({ kind: 'open', parent: args.length > 1 ? args[0] : null });
      return { canceled: picked.length === 0, filePaths: picked };
    },
    showMessageBox: async (...args: unknown[]) => {
      calls.push({ kind: 'confirm', parent: args.length > 1 ? args[0] : null, detail: (args.at(-1) as { detail?: string }).detail });
      return { response: answer, checkboxChecked: false };
    },
  },
  shell: { showItemInFolder: (p: string) => calls.push({ kind: 'reveal', parent: p }) },
}));

const { createHandle } = await import('./register');
const { registerAppIpc } = await import('./app');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-app-ipc-'));
const current = path.join(tmp, 'current');
const other = path.join(tmp, 'other');
fs.mkdirSync(current);
fs.mkdirSync(other);
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const saved: unknown[] = [];
const relaunch = vi.fn();
/** Each native dialog runs inside windows.asSheet(owner, …): the owner stays main and is re-read afterwards. */
const sheetOwners: Array<{ owner: unknown; phase: 'shown' | 'closed' }> = [];
registerAppIpc(
  createHandle(null),
  stubDeps({
    appInfo: () => ({ libraryRoot: current }) as never,
    prefs: { readOnly: false, get: () => ({}) as never, set: (patch) => (saved.push(patch), {} as never) },
    windows: {
      openSettings: () => {},
      asSheet: async (owner, show) => {
        sheetOwners.push({ owner, phase: 'shown' });
        try {
          return await show();
        } finally {
          sheetOwners.push({ owner, phase: 'closed' });
        }
      },
    },
    relaunch,
    isSettingsWindow: (sender) => sender === (SETTINGS_PAGE as never),
  }),
);

/** The settings window's webContents, and the main window's (allowed by the URL check, refused by the sender check). */
const SETTINGS_PAGE = { id: 20 };
const MAIN_PAGE = { id: 10 };
const invokeFrom = (sender: unknown, channel: string, raw?: unknown) =>
  handlers.get(channel)!({ sender, senderFrame: { url: 'learn://app/index.html?window=main' } }, raw);
const invoke = (channel: string, raw?: unknown) => invokeFrom(SETTINGS_PAGE, channel, raw);
const choose = () => invoke('app:chooseLibraryFolder');

beforeEach(() => {
  calls.length = 0;
  saved.length = 0;
  sheetOwners.length = 0;
  relaunch.mockClear();
  picked = [];
  answer = 0;
  senderWindow = SETTINGS;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('app.chooseLibraryFolder (R4: main picks, checks, confirms, saves and relaunches)', () => {
  it('a confirmed folder: both dialogs are sheets on the settings window, then the path is saved and the app relaunches', async () => {
    picked = [other];
    expect(await choose()).toEqual({ ok: true, data: { relaunching: true } });
    expect(calls.map((c) => [c.kind, c.parent])).toEqual([['open', SETTINGS], ['confirm', SETTINGS]]);
    expect(calls[1]!.detail).toContain(other);
    // 38e3a9e for any owner: the settings window stays main under each sheet and is re-read once it closes.
    expect(sheetOwners).toEqual([
      { owner: SETTINGS, phase: 'shown' }, { owner: SETTINGS, phase: 'closed' },
      { owner: SETTINGS, phase: 'shown' }, { owner: SETTINGS, phase: 'closed' },
    ]);
    expect(saved).toEqual([{ libraryRoot: other }]);
    expect(relaunch).toHaveBeenCalledTimes(1);
  });
  it('cancelling either dialog, or picking the current folder, changes nothing', async () => {
    expect(await choose()).toEqual({ ok: true, data: { relaunching: false } }); // the folder dialog cancelled
    picked = [other];
    answer = 1;
    expect(await choose()).toEqual({ ok: true, data: { relaunching: false } }); // 취소 in the confirmation
    picked = [current + path.sep];
    expect(await choose()).toEqual({ ok: true, data: { relaunching: false } }); // the library already open
    expect(calls.filter((c) => c.kind === 'confirm')).toHaveLength(1);
    expect(saved).toEqual([]);
    expect(relaunch).not.toHaveBeenCalled();
  });
  it('a folder that is missing or not a folder is refused before any confirmation, with the cause and next step', async () => {
    picked = [path.join(tmp, 'missing')];
    expect(await choose()).toMatchObject({ ok: false, code: 'VALIDATION_FAILED', message: '폴더를 찾을 수 없습니다. 다른\u00a0폴더를 고르세요.' });
    expect(calls.map((c) => c.kind)).toEqual(['open']);
    expect(saved).toEqual([]);
    expect(relaunch).not.toHaveBeenCalled();
  });
  it('takes no input: the renderer never sends a path', async () => {
    picked = [other];
    expect(await invoke('app:chooseLibraryFolder', { path: other })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(calls).toEqual([]);
  });
});

describe('only the settings window may ask for the library folder (defence in depth, review minor 5)', () => {
  it('another window of ours is PERMISSION_DENIED before any dialog, reveal or write', async () => {
    picked = [other];
    expect(await invokeFrom(MAIN_PAGE, 'app:chooseLibraryFolder')).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await invokeFrom(MAIN_PAGE, 'app:showLibraryFolder')).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(calls).toEqual([]);
    expect(saved).toEqual([]);
    expect(relaunch).not.toHaveBeenCalled();
  });
});

describe('app.showLibraryFolder', () => {
  it('reveals the library folder of this session', async () => {
    expect(await invoke('app:showLibraryFolder')).toEqual({ ok: true, data: undefined });
    expect(calls).toEqual([{ kind: 'reveal', parent: current }]);
  });
});
