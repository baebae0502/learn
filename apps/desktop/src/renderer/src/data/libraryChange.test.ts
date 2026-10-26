import { describe, expect, it, vi } from 'vitest';
import type { LibraryItem } from '@learn/domain';
import { NARROW_LIMIT, createChangeHandler, type ChangeDeps } from './libraryChange';

const item = (id: string, over: Partial<LibraryItem> = {}): LibraryItem => ({
  id, title: id, type: 'pdf', mime: 'application/pdf', size: 1, storageMode: 'managed', availability: 'available', assetId: `a-${id}`, revisionId: `r-${id}`,
  originalName: `${id}.pdf`, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', creators: [], year: null, publisher: null,
  progress: null, openedAt: null, ...over,
});
const LIST = [item('a'), item('b'), item('c')];

function setup(over: { list?: LibraryItem[] | undefined; refetching?: boolean; fresh?: (ids: string[]) => Promise<LibraryItem[]> } = {}) {
  const calls = { all: 0, organize: 0, texts: 0, items: [] as string[], put: [] as (readonly LibraryItem[])[], getItems: [] as string[][] };
  let list: readonly LibraryItem[] | undefined = 'list' in over ? over.list : LIST;
  const deps: ChangeDeps = {
    cached: () => list,
    refetching: () => over.refetching ?? false,
    put: (_prev, next) => {
      list = next;
      calls.put.push(next);
    },
    getItems: (ids) => {
      calls.getItems.push(ids);
      return (over.fresh ?? (async (want) => want.map((id) => item(id))))(ids);
    },
    invalidateAll: () => void (calls.all += 1),
    invalidateOrganize: () => void (calls.organize += 1),
    invalidateItem: (id) => void calls.items.push(id),
    invalidateTexts: () => void (calls.texts += 1),
  };
  return { handle: createChangeHandler(deps), calls, list: () => list };
}
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe('the library list after a change notice (spec 10.3)', () => {
  it('collections and tags read only the organize snapshot, whatever items they name', async () => {
    const { handle, calls } = setup();
    handle({ reason: 'tags', itemIds: ['a'] });
    handle({ reason: 'collections' });
    await settle();
    expect(calls).toMatchObject({ organize: 2, all: 0, getItems: [], put: [] });
  });

  it('an opened notice reads those items only and patches them into the list, in place', async () => {
    const opened = item('b', { openedAt: '2026-10-25T00:00:00.000Z' });
    const { handle, calls, list } = setup({ fresh: async () => [opened] });
    handle({ reason: 'opened', itemIds: ['b'] });
    await settle();
    expect(calls.getItems).toEqual([['b']]);
    expect(calls.all).toBe(0);
    expect(calls.items).toEqual(['b']);
    expect(calls.texts).toBe(0); // the searched fields did not change
    expect(list()!.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(list()![1]).toBe(opened);
    expect(list()![0]).toBe(LIST[0]); // the other rows keep their identity, so they do not redraw
  });

  it('relink, availability and metadata are narrowed too; only metadata makes the search texts stale', async () => {
    for (const reason of ['relink', 'availability', 'metadata'] as const) {
      const { handle, calls } = setup({ fresh: async () => [item('a', { title: '새 제목' })] });
      handle({ reason, itemIds: ['a'] });
      await settle();
      expect(calls.all, reason).toBe(0);
      expect(calls.getItems, reason).toEqual([['a']]);
      expect(calls.texts, reason).toBe(reason === 'metadata' ? 1 : 0);
    }
  });

  it('reads the whole list for import, trash and restore, and when no ids came or more than 500', async () => {
    const many = Array.from({ length: NARROW_LIMIT + 1 }, (_, k) => `x${k}`);
    for (const change of [
      { reason: 'import' as const, itemIds: ['a'] }, { reason: 'trash' as const, itemIds: ['a'] }, { reason: 'restore' as const, itemIds: ['a'] },
      { reason: 'metadata' as const }, { reason: 'opened' as const, itemIds: [] }, { reason: 'metadata' as const, itemIds: many },
    ]) {
      const { handle, calls } = setup();
      handle(change);
      await settle();
      expect(calls.all, JSON.stringify(change).slice(0, 60)).toBe(1);
      expect(calls.getItems).toEqual([]);
    }
    const exactly = Array.from({ length: NARROW_LIMIT }, (_, k) => `x${k}`);
    const { handle, calls } = setup({ fresh: async () => [] });
    handle({ reason: 'metadata', itemIds: exactly });
    expect(calls.getItems[0]).toHaveLength(NARROW_LIMIT); // 500 is still narrow
  });

  it('reads the whole list when there is none cached yet, or a read of it is already running', async () => {
    const none = setup({ list: undefined });
    none.handle({ reason: 'opened', itemIds: ['a'] });
    const busy = setup({ refetching: true });
    busy.handle({ reason: 'opened', itemIds: ['a'] });
    await settle();
    expect(none.calls.all).toBe(1);
    expect(busy.calls.all).toBe(1);
    expect(none.calls.getItems.concat(busy.calls.getItems)).toEqual([]);
  });

  it('falls back to the whole list when an item is gone, when the list has no such row, or when the read fails', async () => {
    const gone = setup({ fresh: async () => [] });
    gone.handle({ reason: 'metadata', itemIds: ['a'] });
    const unknown = setup({ fresh: async () => [item('zzz')] });
    unknown.handle({ reason: 'metadata', itemIds: ['zzz'] });
    const failing = setup({ fresh: () => Promise.reject(new Error('x')) });
    failing.handle({ reason: 'opened', itemIds: ['a'] });
    await settle();
    for (const s of [gone, unknown, failing]) {
      expect(s.calls.all).toBe(1);
      expect(s.calls.put).toEqual([]);
    }
  });

  it('puts nothing when the item came back the way the list has it', async () => {
    const { handle, calls } = setup({ fresh: async () => [item('a')] });
    handle({ reason: 'availability', itemIds: ['a'] });
    await settle();
    expect(calls.put).toEqual([]);
    expect(calls.all).toBe(0);
  });

  it('drops a patch that a whole-list read overtook', async () => {
    let release: (items: LibraryItem[]) => void = () => {};
    const { handle, calls } = setup({ fresh: () => new Promise<LibraryItem[]>((r) => (release = r)) });
    handle({ reason: 'opened', itemIds: ['a'] });
    handle({ reason: 'import', itemIds: ['d'] }); // the whole list is read again meanwhile
    release([item('a', { openedAt: '2026-10-25T00:00:00.000Z' })]);
    await settle();
    expect(calls.all).toBe(1);
    expect(calls.put).toEqual([]);
  });

  it('asks once for a repeated id', async () => {
    const getItems = vi.fn(async (ids: string[]) => ids.map((id) => item(id)));
    const { handle } = setup({ fresh: getItems });
    handle({ reason: 'opened', itemIds: ['a', 'a', 'b'] });
    expect(getItems).toHaveBeenCalledWith(['a', 'b']);
  });
});
