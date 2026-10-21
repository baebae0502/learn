import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Availability, LibraryItem, Result } from '@learn/domain';
import { stubDeps } from './test-deps';

type Listener = (event: unknown, raw: unknown) => Promise<Result<unknown>>;
const handlers = new Map<string, Listener>();
const sent: Array<[string, unknown]> = [];
const fakeWindow = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (ch: string, p: unknown) => sent.push([ch, p]) } };
const disk: { availability: Availability } = { availability: 'available' };
const popup = vi.fn(async (_entries: unknown, _at: unknown): Promise<string | null> => null);

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Listener) => handlers.set(channel, fn) },
  BrowserWindow: { getAllWindows: () => [fakeWindow], fromWebContents: () => fakeWindow },
  dialog: {},
}));
// The disk check: report whatever `disk` says and store it, like the real refreshAvailability.
vi.mock('@learn/library', () => ({
  refreshAvailability: vi.fn(async (_layout: unknown, r: { setAvailability(id: string, a: Availability): void }, asset: { id: string }) => {
    r.setAvailability(asset.id, disk.availability);
    return disk.availability;
  }),
  relinkAsset: vi.fn(),
}));
vi.mock('../menu/context-menu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../menu/context-menu')>()),
  popupCommandMenu: (entries: unknown, at: unknown) => popup(entries, at),
}));

const { createHandle } = await import('./register');
const { registerLibraryIpc } = await import('./library');
const { registerOrganizeIpc } = await import('./organize');
const { registerUiIpc } = await import('./ui');

const ITEM = '7d3f3c3e-8a51-4f7e-9d7c-2b1f0f6f8f10';
const ASSET = '1b6f5a52-2c1e-4d55-9a3e-0d2c6f7e8a90';
const COLL = '5a0b8c1d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const stored: { availability: Availability } = { availability: 'available' };
const item = (): LibraryItem => ({ id: ITEM, assetId: ASSET, storageMode: 'linked', availability: stored.availability }) as LibraryItem;

const OTHER = '3c2d1e0f-9a8b-4c7d-8e6f-5a4b3c2d1e0f';
const repo = {
  trashChanged: vi.fn((ids: string[]) => ids.slice(0, 1)),
  restoreChanged: vi.fn((ids: string[]) => ids.slice(0, 1)),
  updateMetadata: vi.fn((_id: string, _u: unknown) => item()),
  getItem: vi.fn((id: string) => (id === ITEM ? item() : undefined)),
  getAsset: vi.fn((id: string) => (id === ASSET ? { id: ASSET, availability: stored.availability } : undefined)),
  setAvailability: vi.fn((_id: string, a: Availability) => void (stored.availability = a)),
  itemIdsForAsset: vi.fn(() => [ITEM]),
};
const TAG = '9e8d7c6b-5a49-4382-9170-6f5e4d3c2b1a';
const collections = {
  create: vi.fn(() => ({ id: COLL })),
  addItemsChanged: vi.fn((_c: string, ids: string[]) => ids.slice(0, 1)),
  removeItemsChanged: vi.fn((_c: string, _ids: string[]): string[] => []),
  restoreChanged: vi.fn(() => ({ collection: { id: COLL }, changed: true })),
};
const tags = {
  findOrCreate: vi.fn(() => ({ tag: { id: TAG }, created: true })),
  assignChanged: vi.fn((_t: string, _ids: string[]): string[] => []),
  unassignChanged: vi.fn((_t: string, ids: string[]) => ids),
  togglePositionChanged: vi.fn((): { tagId: string; assigned: boolean; itemIds: string[] } | null => null),
};
const deps = stubDeps({ getContext: () => ({ layout: {}, repo, collections, tags }) as never, appInfo: () => ({}) as never });

const handle = createHandle(null);
registerLibraryIpc(handle, deps);
registerOrganizeIpc(handle, deps);
registerUiIpc(handle, deps);

const call = (channel: string, raw: unknown) => handlers.get(channel)!({ sender: {}, senderFrame: { url: 'learn://app/index.html' } }, raw);
const CHANGED = 'evt:library-changed';

beforeEach(() => {
  sent.length = 0;
  stored.availability = 'available';
  disk.availability = 'available';
  popup.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('library mutations broadcast libraryChanged', () => {
  it('trash and restore announce only the items that actually changed, and nothing when none did', async () => {
    expect(await call('library:trash', { itemIds: [ITEM, OTHER] })).toEqual({ ok: true, data: 1 });
    expect(await call('library:restore', { itemIds: [OTHER, ITEM] })).toEqual({ ok: true, data: 1 });
    expect(sent).toEqual([
      [CHANGED, { reason: 'trash', itemIds: [ITEM] }],
      [CHANGED, { reason: 'restore', itemIds: [OTHER] }],
    ]);
    sent.length = 0;
    repo.trashChanged.mockReturnValueOnce([]);
    repo.restoreChanged.mockReturnValueOnce([]);
    expect(await call('library:trash', { itemIds: [ITEM] })).toEqual({ ok: true, data: 0 });
    expect(await call('library:restore', { itemIds: [ITEM] })).toEqual({ ok: true, data: 0 });
    expect(sent).toEqual([]);
  });

  it('metadata edits announce the item; a failed mutation announces nothing', async () => {
    await call('library:updateMetadata', { itemId: ITEM, title: '새 제목' });
    expect(sent).toEqual([[CHANGED, { reason: 'metadata', itemIds: [ITEM] }]]);
    sent.length = 0;
    repo.updateMetadata.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    expect(await call('library:updateMetadata', { itemId: ITEM, title: 'x' })).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(sent).toEqual([]);
  });

  it('a metadata update with no fields announces nothing', async () => {
    expect(await call('library:updateMetadata', { itemId: ITEM })).toMatchObject({ ok: true, data: { id: ITEM } });
    expect(sent).toEqual([]);
  });

  it('library.get announces an availability change found on disk, and only then', async () => {
    await call('library:get', { itemId: ITEM });
    expect(sent).toEqual([]);
    disk.availability = 'missing';
    expect(await call('library:get', { itemId: ITEM })).toMatchObject({ ok: true, data: { availability: 'missing' } });
    expect(sent).toEqual([[CHANGED, { reason: 'availability', itemIds: [ITEM] }]]);
  });
});

describe('collection and tag mutations broadcast reason collections / tags, only when something changed', () => {
  it('collections: create announces; addItems/removeItems announce the items that changed, or nothing', async () => {
    await call('collections:create', { name: '세포 신호' });
    expect(await call('collections:addItems', { collectionId: COLL, itemIds: [ITEM, OTHER] })).toEqual({ ok: true, data: 1 });
    expect(await call('collections:removeItems', { collectionId: COLL, itemIds: [ITEM] })).toEqual({ ok: true, data: 0 });
    collections.addItemsChanged.mockReturnValueOnce([]);
    expect(await call('collections:addItems', { collectionId: COLL, itemIds: [ITEM] })).toEqual({ ok: true, data: 0 });
    expect(sent).toEqual([
      [CHANGED, { reason: 'collections' }],
      [CHANGED, { reason: 'collections', itemIds: [ITEM] }],
    ]);
  });

  it('collections.restore announces only when a deleted collection came back', async () => {
    expect(await call('collections:restore', { collectionId: COLL })).toEqual({ ok: true, data: { id: COLL } });
    collections.restoreChanged.mockReturnValueOnce({ collection: { id: COLL }, changed: false });
    expect(await call('collections:restore', { collectionId: COLL })).toEqual({ ok: true, data: { id: COLL } });
    expect(sent).toEqual([[CHANGED, { reason: 'collections' }]]);
  });

  it('tags: create announces only a new tag; assign/unassign/togglePosition announce the items that changed', async () => {
    expect(await call('tags:create', { name: '시험' })).toEqual({ ok: true, data: { id: TAG } });
    tags.findOrCreate.mockReturnValueOnce({ tag: { id: TAG }, created: false });
    expect(await call('tags:create', { name: '시험' })).toEqual({ ok: true, data: { id: TAG } });
    expect(await call('tags:assign', { tagId: TAG, itemIds: [ITEM] })).toEqual({ ok: true, data: 0 });
    expect(await call('tags:unassign', { tagId: TAG, itemIds: [ITEM, OTHER] })).toEqual({ ok: true, data: 2 });
    expect(await call('tags:togglePosition', { position: 1, itemIds: [ITEM] })).toEqual({ ok: true, data: null }); // no tag there
    tags.togglePositionChanged.mockReturnValueOnce({ tagId: TAG, assigned: true, itemIds: [OTHER] });
    expect(await call('tags:togglePosition', { position: 1, itemIds: [ITEM, OTHER] })).toEqual({ ok: true, data: { tagId: TAG, assigned: true } });
    expect(sent).toEqual([
      [CHANGED, { reason: 'tags' }],
      [CHANGED, { reason: 'tags', itemIds: [ITEM, OTHER] }],
      [CHANGED, { reason: 'tags', itemIds: [OTHER] }],
    ]);
  });
});

describe('item context menu re-checks the file first', () => {
  it('a linked file that went missing this session puts 다시 연결… first and updates the badge', async () => {
    disk.availability = 'missing'; // stored state still says available
    await call('ui:showContextMenu', { kind: 'item', itemIds: [ITEM], x: 1, y: 2 });
    expect(popup.mock.calls[0]![0]).toEqual([
      { id: 'item.relink', label: '다시 연결…', enabled: true },
      'separator',
      { id: 'item.open', label: '열기', enabled: true },
    ]);
    expect(sent).toEqual([[CHANGED, { reason: 'availability', itemIds: [ITEM] }]]);
  });

  it('no broadcast when the disk agrees with the stored state; 다시 연결… is left out for an available file', async () => {
    await call('ui:showContextMenu', { kind: 'item', itemIds: [ITEM], x: 1, y: 2 });
    expect(popup.mock.calls[0]![0]).toEqual([{ id: 'item.open', label: '열기', enabled: true }]);
    expect(sent).toEqual([]);
  });
});
