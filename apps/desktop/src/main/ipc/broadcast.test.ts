import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Availability, LibraryItem, Result } from '@learn/domain';

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

const repo = {
  trash: vi.fn((_ids: string[]) => 2),
  updateMetadata: vi.fn((_id: string, _u: unknown) => item()),
  getItem: vi.fn((id: string) => (id === ITEM ? item() : undefined)),
  getAsset: vi.fn((id: string) => (id === ASSET ? { id: ASSET, availability: stored.availability } : undefined)),
  setAvailability: vi.fn((_id: string, a: Availability) => void (stored.availability = a)),
  itemIdsForAsset: vi.fn(() => [ITEM]),
};
const collections = { create: vi.fn(() => ({ id: COLL })), addItems: vi.fn(() => 1) };
const tags = { togglePosition: vi.fn((): { tagId: string; assigned: boolean } | null => null) };
const deps = { getContext: () => ({ layout: {}, repo, collections, tags }) as never, appInfo: () => ({}) as never, prefs: {} as never };

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
  it('trash announces the trashed items (and nothing when no item changed)', async () => {
    expect(await call('library:trash', { itemIds: [ITEM] })).toEqual({ ok: true, data: 2 });
    expect(sent).toEqual([[CHANGED, { reason: 'trash', itemIds: [ITEM] }]]);
    sent.length = 0;
    repo.trash.mockReturnValueOnce(0);
    await call('library:trash', { itemIds: [ITEM] });
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

  it('library.get announces an availability change found on disk, and only then', async () => {
    await call('library:get', { itemId: ITEM });
    expect(sent).toEqual([]);
    disk.availability = 'missing';
    expect(await call('library:get', { itemId: ITEM })).toMatchObject({ ok: true, data: { availability: 'missing' } });
    expect(sent).toEqual([[CHANGED, { reason: 'availability', itemIds: [ITEM] }]]);
  });
});

describe('organize mutations broadcast reason organize', () => {
  it('collections and tags', async () => {
    await call('collections:create', { name: '세포 신호' });
    await call('collections:addItems', { collectionId: COLL, itemIds: [ITEM] });
    expect(sent).toEqual([
      [CHANGED, { reason: 'organize' }],
      [CHANGED, { reason: 'organize', itemIds: [ITEM] }],
    ]);
    sent.length = 0;
    await call('tags:togglePosition', { position: 1, itemIds: [ITEM] }); // no tag at that position → nothing changed
    expect(sent).toEqual([]);
  });
});

describe('item context menu re-checks the file first', () => {
  it('a linked file that went missing this session enables 다시 연결… and updates the badge', async () => {
    disk.availability = 'missing'; // stored state still says available
    await call('ui:showContextMenu', { kind: 'item', itemIds: [ITEM], x: 1, y: 2 });
    const entries = popup.mock.calls[0]![0] as Array<{ id: string; enabled: boolean }>;
    expect(entries).toEqual([
      { id: 'item.open', label: '열기', enabled: true },
      { id: 'item.relink', label: '다시 연결…', enabled: true },
    ]);
    expect(sent).toEqual([[CHANGED, { reason: 'availability', itemIds: [ITEM] }]]);
  });

  it('no broadcast when the disk agrees with the stored state', async () => {
    await call('ui:showContextMenu', { kind: 'item', itemIds: [ITEM], x: 1, y: 2 });
    const entries = popup.mock.calls[0]![0] as Array<{ id: string; enabled: boolean }>;
    expect(entries.find((e) => e.id === 'item.relink')!.enabled).toBe(false);
    expect(sent).toEqual([]);
  });
});
