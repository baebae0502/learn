import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_LIBRARY_VIEW, type CommandContextState, type Result, type SheetPayload, type SheetResult, type TrashView } from '@learn/domain';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
const popup = vi.hoisted(() => vi.fn(async (..._args: unknown[]): Promise<unknown> => null));
const fakeWindow = { isDestroyed: () => false, isFocused: () => true, focus: () => {} };

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => fakeWindow, getAllWindows: () => [] },
  dialog: { showMessageBox: vi.fn() },
}));
vi.mock('../menu/context-menu', async (importOriginal) => ({ ...(await importOriginal<typeof import('../menu/context-menu')>()), popupCommandMenu: popup }));

const { createHandle } = await import('./register');
const { registerUiIpc } = await import('./ui');

const MAIN = fakeSender(21, 'main');
const SETTINGS = fakeSender(22, 'settings');
const ITEM = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
const GONE = '1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9';
const COL = '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0';
const view: TrashView = {
  collections: [{ id: COL, name: '학회 준비', parentId: null, deletedAt: '2026-10-31T00:10:00.000Z', childCount: 0, itemCount: 2 }],
  items: [{ id: ITEM, deletedAt: '2026-10-31T00:12:00.000Z' } as TrashView['items'][number]],
  members: {},
  tagged: {},
};
const context: CommandContextState = { view: 'library', blocked: false, textSize: 13, libraryCount: 4, selectionCount: 2, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW, scope: 'trash', trashCount: 2 };
const opened: SheetPayload[] = [];
let answer: SheetResult | null = { kind: 'purge', confirmed: true };
registerUiIpc(
  createHandle(null),
  stubDeps({
    getContext: () => ({ repo: { trashView: () => view } }) as never,
    isMainWindow: (sender) => sender === (MAIN as never),
    uiContext: { report: () => {}, current: () => context },
    sheets: {
      open: async (_parent, payload) => {
        opened.push(payload);
        return answer;
      },
      payloadFor: () => ({ kind: 'shortcuts' }),
      resolve: () => {},
      act: async () => {
        throw new Error('sheets.act not stubbed');
      },
      onAct: () => {},
    },
  }),
);
const invoke = (channel: string, sender: unknown, raw?: unknown) => handlers.get(channel)!({ sender, senderFrame: { url: 'learn://app/index.html' } }, raw);

beforeEach(() => {
  popup.mockClear();
  opened.length = 0;
  answer = { kind: 'purge', confirmed: true };
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the trash rows\' menu (P-10): only rows still in the trash, named by the trash view', () => {
  it('lists 복원 · — · 영구 삭제… for the rows and hands the pick back', async () => {
    popup.mockResolvedValueOnce({ commandId: 'item.restore' });
    expect(await invoke('ui:showContextMenu', MAIN, { kind: 'trash', itemIds: [ITEM, GONE], collectionIds: [COL], x: 5, y: 6 })).toEqual({ ok: true, data: { commandId: 'item.restore' } });
    const [entries, at] = popup.mock.lastCall as unknown as [unknown[], { x: number; y: number }];
    expect(entries).toEqual([{ id: 'item.restore', label: '복원', enabled: true }, 'separator', { id: 'item.trash', label: '영구 삭제…', enabled: true }]);
    expect(at).toMatchObject({ x: 5, y: 6 });
  });
  it('answers null without a menu when none of the rows is in the trash any more', async () => {
    expect(await invoke('ui:showContextMenu', MAIN, { kind: 'trash', itemIds: [GONE], collectionIds: [], x: 1, y: 1 })).toEqual({ ok: true, data: null });
    expect(popup).not.toHaveBeenCalled();
  });
});

describe('ui.confirmPurge (P-25): the app sheet over the main window, and its answer', () => {
  it('opens the purge sheet with the variant and the counts and answers whether the destructive button was pressed', async () => {
    expect(await invoke('ui:confirmPurge', MAIN, { variant: 'items', items: 3, collections: 0 })).toEqual({ ok: true, data: true });
    expect(opened).toEqual([{ kind: 'purge', variant: 'items', items: 3, collections: 0 }]);
    answer = { kind: 'purge', confirmed: false };
    expect(await invoke('ui:confirmPurge', MAIN, { variant: 'empty', items: 7, collections: 2 })).toEqual({ ok: true, data: false });
    answer = null; // the sheet went away unanswered
    expect(await invoke('ui:confirmPurge', MAIN, { variant: 'collections', items: 0, collections: 1 })).toEqual({ ok: true, data: false });
  });
  it('is the main window\'s only, and takes only its own input', async () => {
    expect(await invoke('ui:confirmPurge', SETTINGS, { variant: 'items', items: 1, collections: 0 })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await invoke('ui:confirmPurge', MAIN, { variant: 'items', items: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(opened).toEqual([]);
  });
});
