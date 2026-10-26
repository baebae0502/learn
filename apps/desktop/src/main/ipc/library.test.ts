import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '@learn/domain';
import { CollectionsRepository, migrate, openDatabase } from '@learn/db';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
/** Each open panel's parent window (null: none), in order. */
const panels: unknown[] = [];
/** The options each open panel was asked with, in order. */
const options: Array<{ title?: string; message?: string; buttonLabel?: string }> = [];

const MAIN = { id: 1, name: 'main window' };
let senderWindow: typeof MAIN | null = MAIN;

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => senderWindow, getAllWindows: () => [] },
  dialog: {
    showOpenDialog: async (...args: unknown[]) => {
      panels.push(args.length > 1 ? args[0] : null);
      options.push(args[args.length - 1] as (typeof options)[number]);
      return { canceled: true, filePaths: [] };
    },
  },
  shell: {},
}));

const { createHandle } = await import('./register');
const { registerLibraryIpc } = await import('./library');

/** What the import handlers hand the importer, and the library the organize/getItems handlers read. */
const importMany = vi.fn(async (_paths: string[], _opts: unknown): Promise<unknown[]> => []);
const getItems = vi.fn((ids: string[]) => ids.slice(0, 1).map((id) => ({ id })));
const db = openDatabase(':memory:');
migrate(db, { dbFile: null });

/** Follow-up D: every dialog with a parent window runs inside windows.asSheet(owner, …). */
const sheetOwners: Array<{ owner: unknown; phase: 'shown' | 'closed' }> = [];
registerLibraryIpc(
  createHandle(null),
  stubDeps({
    getContext: () => ({ importer: { importMany }, repo: { searchTexts: () => [{ id: 'i1', abstract: '초록', extra: null }], getItems }, db }) as never,
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

const MAIN_PAGE = fakeSender(10, 'main');
const invoke = (channel: string, raw?: unknown) => handlers.get(channel)!({ sender: MAIN_PAGE, senderFrame: { url: 'learn://app/index.html?window=main' } }, raw);

beforeEach(() => {
  panels.length = 0;
  options.length = 0;
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

  it('each panel says what it is for: a message on the sheet and its own button (macOS shows no title on a sheet)', async () => {
    await invoke('library:pickAndImport', { mode: 'managed' });
    await invoke('library:pickAndImport', { mode: 'linked' });
    await invoke('library:pickAndRelink', { assetId: '00000000-0000-4000-8000-000000000001' });
    expect(options.map((o) => o.buttonLabel)).toEqual(['가져오기', '연결', '다시 연결']);
    expect(new Set(options.map((o) => o.message)).size).toBe(3);
    for (const o of options) expect(o.message).toMatch(/\S/);
  });

  it('without a window the panel stands alone and no sheet is marked', async () => {
    senderWindow = null;
    expect(await invoke('library:pickAndImport', { mode: 'managed' })).toMatchObject({ ok: true, data: [] });
    expect(panels).toEqual([null]);
    expect(sheetOwners).toEqual([]);
  });
});

describe('library.searchTexts', () => {
  it('answers the repository’s long texts, and takes no input', async () => {
    expect(await invoke('library:searchTexts')).toEqual({ ok: true, data: [{ id: 'i1', abstract: '초록', extra: null }] });
    expect(await invoke('library:searchTexts', { extra: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });
});

describe('library.organize', () => {
  it('answers the snapshot of the library, and takes no input', async () => {
    expect(await invoke('library:organize')).toEqual({ ok: true, data: { collections: [], tags: [], members: {}, tagged: {}, duplicates: [] } });
    const coll = new CollectionsRepository(db).create({ name: '강의' });
    expect(await invoke('library:organize')).toEqual({
      ok: true,
      data: { collections: [{ id: coll.id, name: '강의', parentId: null, createdAt: coll.createdAt }], tags: [], members: {}, tagged: {}, duplicates: [] },
    });
    expect(await invoke('library:organize', { extra: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });
});

describe('library.getItems', () => {
  const A = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
  const B = '1b6f5a52-2c1e-4d55-9a3e-0d2c6f7e8a90';

  it('hands the ids to the repository and answers its items', async () => {
    getItems.mockClear();
    expect(await invoke('library:getItems', { ids: [A, B] })).toEqual({ ok: true, data: [{ id: A }] });
    expect(getItems).toHaveBeenCalledWith([A, B]);
  });

  it('refuses no ids, more than 5,000, and anything that is not a uuid, without asking the repository', async () => {
    getItems.mockClear();
    for (const raw of [{ ids: [] }, { ids: ['nope'] }, { ids: Array.from({ length: 5001 }, () => A) }, {}, undefined]) {
      expect(await invoke('library:getItems', raw), JSON.stringify(raw)?.slice(0, 40)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    }
    expect(getItems).not.toHaveBeenCalled();
  });
});

describe('importing into a collection', () => {
  const COLL = '5a0b8c1d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';

  it('library.import hands the collection (a uuid, null or nothing) to the importer with the mode', async () => {
    importMany.mockClear();
    expect(await invoke('library:import', { paths: ['/a.pdf'], mode: 'managed', collectionId: COLL })).toEqual({ ok: true, data: [] });
    expect(importMany).toHaveBeenLastCalledWith(['/a.pdf'], expect.objectContaining({ mode: 'managed', allowDuplicate: false, collectionId: COLL }));
    await invoke('library:import', { paths: ['/a.pdf'], mode: 'linked', collectionId: null });
    expect(importMany).toHaveBeenLastCalledWith(['/a.pdf'], expect.objectContaining({ mode: 'linked', collectionId: null }));
    await invoke('library:import', { paths: ['/a.pdf'], mode: 'linked' });
    expect(importMany.mock.lastCall?.[1]).not.toHaveProperty('collectionId');
  });

  it('refuses a collection id that is not a uuid, for both import channels, before anything is asked of the importer', async () => {
    importMany.mockClear();
    expect(await invoke('library:import', { paths: ['/a.pdf'], mode: 'managed', collectionId: 'nope' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await invoke('library:pickAndImport', { mode: 'managed', collectionId: 'nope' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await invoke('library:pickAndImport', { mode: 'managed', collectionId: COLL })).toMatchObject({ ok: true, data: [] }); // the panel is cancelled in this file's mock
    expect(importMany).not.toHaveBeenCalled();
  });
});
