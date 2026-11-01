import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDLE_IMPORT_STATE, LearnError, type Result } from '@learn/domain';
import { CollectionsRepository, migrate, openDatabase } from '@learn/db';
import type { ImportBatch } from '../jobs/import-queue';
import { fakeSender, stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
/** Each open panel's parent window (null: none), in order. */
const panels: unknown[] = [];
/** The options each open panel was asked with, in order. */
const options: Array<{ title?: string; message?: string; buttonLabel?: string }> = [];

const MAIN = { id: 1, name: 'main window' };
let senderWindow: typeof MAIN | null = MAIN;
/** What the next open panel answers (null: cancelled). */
let picked: string[] | null = null;

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { fromWebContents: () => senderWindow, getAllWindows: () => [] },
  dialog: {
    showOpenDialog: async (...args: unknown[]) => {
      panels.push(args.length > 1 ? args[0] : null);
      options.push(args[args.length - 1] as (typeof options)[number]);
      return picked ? { canceled: false, filePaths: picked } : { canceled: true, filePaths: [] };
    },
  },
  shell: {},
}));

const { createHandle } = await import('./register');
const { registerLibraryIpc } = await import('./library');

/** The import queue the channels put files into: the run's total is what it answers. */
const enqueue = vi.fn((batch: ImportBatch) => batch.paths.length + 3);
const cancel = vi.fn();
let libraryOpen = true;
/** The library the organize/getItems handlers read. */
const getItems = vi.fn((ids: string[]) => ids.slice(0, 1).map((id) => ({ id })));
const db = openDatabase(':memory:');
migrate(db, { dbFile: null });

/** Follow-up D: every dialog with a parent window runs inside windows.asSheet(owner, …). */
const sheetOwners: Array<{ owner: unknown; phase: 'shown' | 'closed' }> = [];
registerLibraryIpc(
  createHandle(null),
  stubDeps({
    getContext: () => {
      if (!libraryOpen) throw new LearnError('LIBRARY_UNAVAILABLE', '라이브러리를 열 수 없습니다.');
      return { repo: { searchTexts: () => [{ id: 'i1', abstract: '초록', extra: null }], getItems, getItem: (id: string) => ({ id, assetId: '00000000-0000-4000-8000-000000000001', storageMode: 'linked', availability: 'missing' }) }, db } as never;
    },
    imports: { enqueue, cancel, state: () => ({ ...IDLE_IMPORT_STATE }), onProgress: () => () => {}, onFinished: () => () => {} },
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
  picked = null;
});

describe('library open panels hang on the asking window as sheets (follow-up D)', () => {
  it('파일 가져오기 and 다시 연결… run their panel inside asSheet with the window as parent', async () => {
    expect(await invoke('library:pickAndImport', { mode: 'managed' })).toEqual({ ok: true, data: { queued: 0 } });
    expect(await invoke('library:pickAndRelink', { itemId: '00000000-0000-4000-8000-000000000002' })).toMatchObject({ ok: true, data: null });
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
    await invoke('library:pickAndRelink', { itemId: '00000000-0000-4000-8000-000000000002' });
    expect(options.map((o) => o.buttonLabel)).toEqual(['가져오기', '연결', '다시 연결']);
    expect(new Set(options.map((o) => o.message)).size).toBe(3);
    for (const o of options) expect(o.message).toMatch(/\S/);
  });

  it('without a window the panel stands alone and no sheet is marked', async () => {
    senderWindow = null;
    expect(await invoke('library:pickAndImport', { mode: 'managed' })).toEqual({ ok: true, data: { queued: 0 } });
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
    expect(await invoke('library:organize')).toEqual({ ok: true, data: { collections: [], tags: [], members: {}, tagged: {}, duplicates: [], trashCount: 0 } });
    const coll = new CollectionsRepository(db).create({ name: '강의' });
    expect(await invoke('library:organize')).toEqual({
      ok: true,
      data: { collections: [{ id: coll.id, name: '강의', parentId: null, createdAt: coll.createdAt }], tags: [], members: {}, tagged: {}, duplicates: [], trashCount: 0 },
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

  it('refuses no ids, more than 5,000, anything that is not a uuid, and an unknown key, without asking the repository', async () => {
    getItems.mockClear();
    for (const raw of [{ ids: [] }, { ids: ['nope'] }, { ids: Array.from({ length: 5001 }, () => A) }, {}, undefined, { ids: [A], extra: 1 }]) {
      expect(await invoke('library:getItems', raw), JSON.stringify(raw)?.slice(0, 40)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    }
    expect(getItems).not.toHaveBeenCalled();
  });
});

describe('the import channels put files into main\'s queue and answer at once (spec 3.7)', () => {
  const COLL = '5a0b8c1d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
  beforeEach(() => {
    enqueue.mockClear();
    cancel.mockClear();
    libraryOpen = true;
  });

  it('library.import: one batch with the mode, the collection (or null) and the sending window as owner; the answer is the run\'s total', async () => {
    expect(await invoke('library:import', { paths: ['/in/a.pdf', '/in/b.pdf'], mode: 'linked', collectionId: COLL })).toEqual({ ok: true, data: { queued: 5 } });
    expect(enqueue).toHaveBeenLastCalledWith({ paths: ['/in/a.pdf', '/in/b.pdf'], mode: 'linked', collectionId: COLL, owner: 10 });
    await invoke('library:import', { paths: ['/in/a.pdf'], mode: 'managed' });
    expect(enqueue).toHaveBeenLastCalledWith({ paths: ['/in/a.pdf'], mode: 'managed', collectionId: null, owner: 10 });
    // The E2E setup's new item for the same content (Q-4a): only when asked.
    await invoke('library:import', { paths: ['/in/a.pdf'], mode: 'managed', allowDuplicate: true });
    expect(enqueue).toHaveBeenLastCalledWith({ paths: ['/in/a.pdf'], mode: 'managed', collectionId: null, owner: 10, allowDuplicate: true });
  });

  it('library.pickAndImport: the picked files as one batch; a cancelled panel puts nothing in and answers 0', async () => {
    expect(await invoke('library:pickAndImport', { mode: 'managed' })).toEqual({ ok: true, data: { queued: 0 } });
    expect(enqueue).not.toHaveBeenCalled();
    picked = ['/in/x.pdf', '/in/y.mp4'];
    expect(await invoke('library:pickAndImport', { mode: 'managed', collectionId: COLL })).toEqual({ ok: true, data: { queued: 5 } });
    expect(enqueue).toHaveBeenCalledExactlyOnceWith({ paths: ['/in/x.pdf', '/in/y.mp4'], mode: 'managed', collectionId: COLL, owner: 10 });
  });

  it('library.cancelImport stops the queue and takes no input', async () => {
    expect(await invoke('library:cancelImport')).toEqual({ ok: true, data: undefined });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await invoke('library:cancelImport', { all: true })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('refuses a relative path, a collection id that is not a uuid and an unknown key before anything reaches the queue', async () => {
    for (const raw of [
      { paths: ['in/a.pdf'], mode: 'managed' },
      { paths: ['/in/a.pdf'], mode: 'managed', collectionId: 'nope' },
      { paths: ['/in/a.pdf'], mode: 'managed', extra: 1 },
    ]) expect(await invoke('library:import', raw), JSON.stringify(raw)).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await invoke('library:pickAndImport', { mode: 'managed', collectionId: 'nope' })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(await invoke('library:pickAndImport', { mode: 'managed', extra: 1 })).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(panels).toEqual([]);
  });

  it('without a library (the fatal screen) both are LIBRARY_UNAVAILABLE, and no panel opens', async () => {
    libraryOpen = false;
    expect(await invoke('library:pickAndImport', { mode: 'managed' })).toMatchObject({ ok: false, code: 'LIBRARY_UNAVAILABLE' });
    expect(await invoke('library:import', { paths: ['/in/a.pdf'], mode: 'managed' })).toMatchObject({ ok: false, code: 'LIBRARY_UNAVAILABLE' });
    expect(panels).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
