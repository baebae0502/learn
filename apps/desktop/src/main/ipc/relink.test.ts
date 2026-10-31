import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearnEventMap, Result } from '@learn/domain';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-relink-'));
/** What the open panel answers next (null: cancelled), and how often it was shown. */
const panel: { answer: string | null; shown: number } = { answer: null, shown: 0 };

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => null, getAllWindows: () => [] },
  dialog: {
    showOpenDialog: async () => {
      panel.shown += 1;
      return panel.answer === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [panel.answer] };
    },
  },
  shell: {},
}));

const { createHandle } = await import('./register');
const { registerLibraryIpc } = await import('./library');
const { onBroadcast } = await import('../events');
const { openLibraryContext } = await import('../library-context');

const ctx = await openLibraryContext(path.join(tmp, 'Library'));
afterAll(() => {
  ctx.db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});
registerLibraryIpc(createHandle(null), stubDeps({ getContext: () => ctx }));
const MAIN_PAGE = fakeSender(30, 'main');
const invoke = (channel: string, raw?: unknown) => handlers.get(channel)!({ sender: MAIN_PAGE, senderFrame: { url: 'learn://app/index.html?window=main' } }, raw);
const announced: Array<LearnEventMap['libraryChanged']> = [];
onBroadcast((e) => {
  if (e.name === 'libraryChanged') announced.push(e.payload);
});

beforeEach(() => {
  panel.answer = null;
  panel.shown = 0;
  announced.length = 0;
});

/** Two linked items on one file (새 자료로 추가), and the file moved away; the content differs per call. */
async function twoItemsOneFile() {
  const dir = fs.mkdtempSync(path.join(tmp, 'src-'));
  const file = path.join(dir, '공유 원본.pdf');
  fs.writeFileSync(file, `%PDF-1.4\n% ${dir}\n%%EOF\n`);
  const first = await ctx.importer.importOne(file, { mode: 'linked' });
  const second = await ctx.importer.importOne(file, { mode: 'linked', allowDuplicate: true });
  if (first.status !== 'imported' || second.status !== 'imported') throw new Error('setup');
  const moved = path.join(dir, 'moved.pdf');
  fs.renameSync(file, moved);
  return { first: first.item, second: second.item, moved };
}

describe('다시 연결… answers the item it was asked from (spec 10, relink itemId)', () => {
  it('relinks the shared file, announces every item on it, and answers the item asked from, not the first one', async () => {
    const { first, second, moved } = await twoItemsOneFile();
    expect(second.assetId).toBe(first.assetId);
    panel.answer = moved;
    expect(await invoke('library:pickAndRelink', { itemId: second.id })).toMatchObject({ ok: true, data: { id: second.id, availability: 'available' } });
    expect(ctx.repo.getAsset(second.assetId)!.externalPath).toBe(moved);
    expect(announced).toEqual([{ reason: 'relink', itemIds: [first.id, second.id] }]);
  });

  it('answers null and changes nothing when the panel is cancelled', async () => {
    const { second } = await twoItemsOneFile();
    const before = ctx.repo.getAsset(second.assetId)!.externalPath;
    expect(await invoke('library:pickAndRelink', { itemId: second.id })).toEqual({ ok: true, data: null });
    expect(panel.shown).toBe(1);
    expect(ctx.repo.getAsset(second.assetId)!.externalPath).toBe(before);
    expect(announced).toEqual([]);
  });

  it('refuses an item in the trash, or one that does not exist, before any panel is shown', async () => {
    const { second } = await twoItemsOneFile();
    ctx.repo.trash([second.id]);
    expect(await invoke('library:pickAndRelink', { itemId: second.id })).toMatchObject({ ok: false, code: 'NOT_FOUND', message: '자료를 찾을 수 없습니다.' });
    expect(await invoke('library:pickAndRelink', { itemId: '00000000-0000-4000-8000-0000000000aa' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(panel.shown).toBe(0);
  });

  it('takes an item id, not an asset id', async () => {
    expect(await invoke('library:pickAndRelink', { assetId: '00000000-0000-4000-8000-000000000001' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(panel.shown).toBe(0);
  });
});
