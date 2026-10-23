import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '@learn/domain';
import { stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
/** Each open panel's parent window (null: none), in order. */
const panels: unknown[] = [];

const MAIN = { id: 1, name: 'main window' };
let senderWindow: typeof MAIN | null = MAIN;

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => senderWindow, getAllWindows: () => [] },
  dialog: {
    showOpenDialog: async (...args: unknown[]) => {
      panels.push(args.length > 1 ? args[0] : null);
      return { canceled: true, filePaths: [] };
    },
  },
  shell: {},
}));

const { createHandle } = await import('./register');
const { registerLibraryIpc } = await import('./library');

/** Follow-up D: every dialog with a parent window runs inside windows.asSheet(owner, …). */
const sheetOwners: Array<{ owner: unknown; phase: 'shown' | 'closed' }> = [];
registerLibraryIpc(
  createHandle(null),
  stubDeps({
    getContext: () => ({ importer: { importMany: vi.fn() }, repo: {} }) as never,
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
  }),
);

const invoke = (channel: string, raw?: unknown) => handlers.get(channel)!({ sender: { id: 10 }, senderFrame: { url: 'learn://app/index.html?window=main' } }, raw);

beforeEach(() => {
  panels.length = 0;
  sheetOwners.length = 0;
  senderWindow = MAIN;
});

describe('library open panels hang on the asking window as sheets (follow-up D)', () => {
  it('파일 가져오기 and 다시 연결… run their panel inside asSheet with the window as parent', async () => {
    expect(await invoke('library:pickAndImport', { mode: 'managed' })).toMatchObject({ ok: true, data: [] });
    expect(await invoke('library:pickAndRelink', { assetId: '00000000-0000-4000-8000-000000000001' })).toMatchObject({ ok: true, data: null });
    expect(panels).toEqual([MAIN, MAIN]);
    expect(sheetOwners).toEqual([
      { owner: MAIN, phase: 'shown' },
      { owner: MAIN, phase: 'closed' },
      { owner: MAIN, phase: 'shown' },
      { owner: MAIN, phase: 'closed' },
    ]);
  });

  it('without a window the panel stands alone and no sheet is marked', async () => {
    senderWindow = null;
    expect(await invoke('library:pickAndImport', { mode: 'managed' })).toMatchObject({ ok: true, data: [] });
    expect(panels).toEqual([null]);
    expect(sheetOwners).toEqual([]);
  });
});
