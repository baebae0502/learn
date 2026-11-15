import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_LIBRARY_VIEW, platformAccelerator, type CommandContextState, type PurgeVariant, type Result, type SheetPayload, type SheetResult, type TrashView } from '@learn/domain';
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
const SESSION = '3c2b1a09-8f7e-4d6c-9b5a-0f1e2d3c4b5a';
const DELETED = '4d3c2b1a-0f9e-4d7c-8b6a-1f2e3d4c5b6a';
const OF_TRASHED = '5e4d3c2b-1a0f-4e8d-9c7b-2a3b4c5d6e7f';
const view: TrashView = {
  collections: [{ id: COL, name: '학회 준비', parentId: null, deletedAt: '2026-10-31T00:10:00.000Z', childCount: 0, itemCount: 2 }],
  items: [{ id: ITEM, deletedAt: '2026-10-31T00:12:00.000Z' } as TrashView['items'][number]],
  members: {},
  tagged: {},
};
const context: CommandContextState = { view: 'library', blocked: false, textSize: 13, libraryCount: 4, selectionCount: 2, selectionAvailable: 0, selectionRelinkable: 0, ...NO_LIBRARY_VIEW, scope: 'trash', trashCount: 2 };
const opened: SheetPayload[] = [];
let answer: SheetResult | null = { kind: 'purge', confirmed: true };
const counted: Array<{ variant: PurgeVariant; itemIds: readonly string[] }> = [];
let sessionCount = { sessions: 0, items: 0 };
const conversations = {
  conversation: (id: string) =>
    id === SESSION ? { id, itemId: ITEM, deleted: false, itemTrashed: false }
    : id === DELETED ? { id, itemId: ITEM, deleted: true, itemTrashed: false }
    : id === OF_TRASHED ? { id, itemId: ITEM, deleted: false, itemTrashed: true }
    : undefined,
  purgeCount: (input: { variant: PurgeVariant; itemIds: readonly string[] }) => {
    counted.push(input);
    return sessionCount;
  },
};
registerUiIpc(
  createHandle(null),
  stubDeps({
    getContext: () => ({ repo: { trashView: () => view }, conversations }) as never,
    isMainWindow: (sender) => sender === (MAIN as never),
    uiContext: { report: () => {}, current: () => context },
    sheets: {
      open: async (_parent, payload) => {
        opened.push(payload);
        return answer;
      },
      payloadFor: async () => ({ kind: 'shortcuts' }),
      prepare: () => {},
      discardPrepared: () => {},
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
  counted.length = 0;
  sessionCount = { sessions: 0, items: 0 };
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

describe('a session row\'s menu (T1a spec 11): 이름 바꾸기 · — · 세션 삭제 with its ⌘⌫, for a live session only', () => {
  it('lists the two lines, 세션 삭제 named by the focused row (even in the trash view) with the key it shares, and hands the pick back', async () => {
    popup.mockResolvedValueOnce({ commandId: 'item.trash' });
    expect(await invoke('ui:showContextMenu', MAIN, { kind: 'session', conversationId: SESSION, x: 7, y: 8 })).toEqual({ ok: true, data: { commandId: 'item.trash' } });
    const [entries, at] = popup.mock.lastCall as unknown as [unknown[], { x: number; y: number }];
    expect(entries).toEqual([
      { id: 'session.rename', label: '이름 바꾸기', enabled: true },
      'separator',
      { id: 'item.trash', label: '세션 삭제', enabled: true, hint: platformAccelerator('CmdOrCtrl+Backspace', process.platform) },
    ]);
    expect(at).toMatchObject({ x: 7, y: 8 });
  });
  it('answers null without a menu for a session that is deleted, gone, or of an item in the trash', async () => {
    for (const conversationId of [DELETED, OF_TRASHED, '6f5e4d3c-2b1a-4f9e-8d7c-3b4c5d6e7f80']) {
      expect(await invoke('ui:showContextMenu', MAIN, { kind: 'session', conversationId, x: 1, y: 1 }), conversationId).toEqual({ ok: true, data: null });
    }
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
  it('says how many tutor sessions go with the items, as main counts them; the item ids stay in main (T1a spec 6.2)', async () => {
    sessionCount = { sessions: 4, items: 2 };
    expect(await invoke('ui:confirmPurge', MAIN, { variant: 'items', items: 3, collections: 0, itemIds: [ITEM, GONE] })).toEqual({ ok: true, data: true });
    expect(counted).toEqual([{ variant: 'items', itemIds: [ITEM, GONE] }]);
    expect(opened).toEqual([{ kind: 'purge', variant: 'items', items: 3, collections: 0, sessions: 4, sessionItems: 2 }]);
    // 휴지통 비우기 counts the trash's items itself; no sessions: the sheet hears of none.
    await invoke('ui:confirmPurge', MAIN, { variant: 'empty', items: 7, collections: 2 });
    expect(counted.at(-1)).toEqual({ variant: 'empty', itemIds: [] });
    expect(opened.at(-1)).toEqual({ kind: 'purge', variant: 'empty', items: 7, collections: 2, sessions: 4, sessionItems: 2 });
    sessionCount = { sessions: 0, items: 0 };
    await invoke('ui:confirmPurge', MAIN, { variant: 'mixed', items: 1, collections: 1, itemIds: [ITEM], name: '통계' });
    expect(opened.at(-1)).toEqual({ kind: 'purge', variant: 'mixed', items: 1, collections: 1, name: '통계' });
    expect(opened.every((p) => !('itemIds' in p))).toBe(true);
  });
  it('is the main window\'s only, and takes only its own input', async () => {
    expect(await invoke('ui:confirmPurge', SETTINGS, { variant: 'items', items: 1, collections: 0 })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await invoke('ui:confirmPurge', MAIN, { variant: 'items', items: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(opened).toEqual([]);
  });
});
