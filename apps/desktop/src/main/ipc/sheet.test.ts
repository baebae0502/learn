import { describe, expect, it, vi } from 'vitest';
import type { LibraryCheckPayload, Result, SheetAction } from '@learn/domain';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
}));

const { createHandle } = await import('./register');
const { registerSheetIpc } = await import('./sheet');

const NEXT: LibraryCheckPayload = { kind: 'libraryCheck', mode: 'auto', items: 1, rows: [], homeDir: '/home/u', failed: null };
const acted: Array<[unknown, SheetAction]> = [];
registerSheetIpc(
  createHandle(null),
  stubDeps({
    sheets: {
      open: async () => null,
      payloadFor: () => NEXT,
      resolve: () => {},
      act: async (contents, action) => {
        acted.push([contents, action]);
        return NEXT;
      },
      onAct: () => {},
    },
  }),
);
const SHEET = fakeSender(51, 'sheet');
const MAIN = fakeSender(52, 'main');
const invoke = (sender: unknown, raw?: unknown) => handlers.get('sheet:act')!({ sender, senderFrame: { url: 'learn://app/index.html' } }, raw);

describe('sheet:act (P-17)', () => {
  it('hands the sheet\'s action to the host and answers the payload the sheet shows now', async () => {
    expect(await invoke(SHEET, { action: { kind: 'libraryCheck', act: 'cleanStaging' } })).toEqual({ ok: true, data: NEXT });
    expect(acted).toEqual([[SHEET, { kind: 'libraryCheck', act: 'cleanStaging' }]]);
  });
  it('is the sheet windows\' only and takes only a known action', async () => {
    acted.length = 0;
    expect(await invoke(MAIN, { action: { kind: 'libraryCheck', act: 'cleanStaging' } })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(await invoke(SHEET, { action: { kind: 'libraryCheck', act: 'relink', itemId: 'x' } })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await invoke(SHEET, {})).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(acted).toEqual([]);
  });
});
