import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { IDS_PER_CALL, addItemsTo, inChunks, removeFromScope, undoAdds, undoRemovals } from './membership';
import { buildOrganizeModel } from './model';
import { item } from './testing';

const AT = '2026-10-01T00:00:00.000Z';
const SNAPSHOT: OrganizeSnapshot = {
  collections: [
    { id: 'bio', name: '분자생물학', parentId: null, createdAt: AT },
    { id: 'c6', name: '6장', parentId: 'bio', createdAt: AT },
    { id: 'c7', name: '7장', parentId: 'bio', createdAt: AT },
    { id: 'stat', name: '통계', parentId: null, createdAt: AT },
  ],
  tags: [],
  members: { bio: ['a', 'b'], c6: ['a', 'c'], stat: ['d'] },
  tagged: {},
  duplicates: [],
};
const model = buildOrganizeModel(SNAPSHOT, ['a', 'b', 'c', 'd', 'e'].map((id) => item(id)));
const members = () => queryClient.getQueryData<OrganizeSnapshot>(keys.organize)!.members;

const addItems = vi.fn();
const removeItems = vi.fn();
/** What main answers: the ids whose membership really changed (INSERT OR IGNORE / DELETE). */
const answerFromSnapshot = () => {
  addItems.mockImplementation(async (input: { collectionId: string; itemIds: string[] }) => ({ ok: true, data: input.itemIds.filter((id) => !(SNAPSHOT.members[input.collectionId] ?? []).includes(id)) }));
  removeItems.mockImplementation(async (input: { collectionId: string; itemIds: string[] }) => ({ ok: true, data: input.itemIds.filter((id) => (SNAPSHOT.members[input.collectionId] ?? []).includes(id)) }));
};
beforeEach(() => {
  queryClient.setQueryData(keys.organize, SNAPSHOT);
  answerFromSnapshot();
  vi.stubGlobal('window', { learn: { collections: { addItems, removeItems } } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
  addItems.mockReset();
  removeItems.mockReset();
});

describe('inChunks', () => {
  it('splits at the channel\'s bound and keeps the order', () => {
    expect(IDS_PER_CALL).toBe(5000);
    expect(inChunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(inChunks([], 2)).toEqual([]);
  });
});

describe('addItemsTo (Task 8 reuses it for a move)', () => {
  it('returns the ids that were new, sends them all (the database ignores what is there) and shows the result at once', async () => {
    expect(await addItemsTo('bio', ['a', 'c', 'e'])).toEqual(['c', 'e']);
    expect(addItems).toHaveBeenCalledExactlyOnceWith({ collectionId: 'bio', itemIds: ['a', 'c', 'e'] });
    expect(members()['bio']).toEqual(['a', 'b', 'c', 'e']);
  });
  it('returns exactly the ids main answers — nothing when main changed nothing — whatever the snapshot thought', async () => {
    addItems.mockResolvedValueOnce({ ok: true, data: [] });
    expect(await addItemsTo('bio', ['c'])).toEqual([]);
    addItems.mockResolvedValueOnce({ ok: true, data: ['c'] });
    expect(await addItemsTo('bio', ['a', 'c'])).toEqual(['c']); // a was already in for main too, though the call carried it
  });
  it('sends the same id once, and splits a large selection at 5,000 ids a call', async () => {
    const ids = Array.from({ length: 12_000 }, (_, i) => `x${i}`);
    const added = await addItemsTo('stat', [...ids, ...ids.slice(0, 10)]);
    expect(added).toHaveLength(12_000);
    expect(addItems.mock.calls.map(([input]) => (input as { itemIds: string[] }).itemIds.length)).toEqual([5000, 5000, 2000]);
  });
  it('does nothing for no ids, and a refusal from main throws and leaves the snapshot as it was', async () => {
    expect(await addItemsTo('bio', [])).toEqual([]);
    expect(addItems).not.toHaveBeenCalled();
    addItems.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', message: '컬렉션을 찾을 수 없습니다.', retryable: false });
    await expect(addItemsTo('bio', ['e'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(members()['bio']).toEqual(['a', 'b']);
  });
});

describe('removeFromScope (owner decision 0: out of the collection and what is below it)', () => {
  it('takes each id out of every collection in the scope that holds it directly, in tree order, and nothing outside the scope', async () => {
    const removals = await removeFromScope(model, 'bio', ['a', 'b', 'c', 'd', 'e']);
    expect(removals).toEqual([
      { collectionId: 'bio', itemIds: ['a', 'b'] },
      { collectionId: 'c6', itemIds: ['a', 'c'] },
    ]);
    expect(removeItems.mock.calls.map(([input]) => (input as { collectionId: string }).collectionId)).toEqual(['bio', 'c6']);
    expect(members()).toEqual({ stat: ['d'] }); // d is in 통계, outside the scope; e was in none
  });
  it('a scope without children takes out of itself only', async () => {
    expect(await removeFromScope(model, 'c6', ['a'])).toEqual([{ collectionId: 'c6', itemIds: ['a'] }]);
    expect(members()['bio']).toEqual(['a', 'b']);
  });
  it('is empty, and calls nothing, when no id is held in the scope', async () => {
    expect(await removeFromScope(model, 'stat', ['a', 'e'])).toEqual([]);
    expect(await removeFromScope(model, 'c7', ['a'])).toEqual([]);
    expect(removeItems).not.toHaveBeenCalled();
  });
  it('puts back what main says it removed: a collection where it removed nothing has no removal, and a partial answer is kept as it is', async () => {
    removeItems.mockImplementation(async (input: { collectionId: string; itemIds: string[] }) => ({ ok: true, data: input.collectionId === 'c6' ? [] : input.itemIds.slice(0, 1) }));
    expect(await removeFromScope(model, 'bio', ['a', 'b'])).toEqual([{ collectionId: 'bio', itemIds: ['a'] }]);
  });
  it('a refusal throws; what was taken out before it stays out', async () => {
    removeItems.mockResolvedValueOnce({ ok: true, data: ['a', 'b'] }).mockResolvedValueOnce({ ok: false, code: 'INTERNAL', message: '실패', retryable: true });
    await expect(removeFromScope(model, 'bio', ['a', 'b', 'c'])).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(members()['bio']).toBeUndefined();
    expect(members()['c6']).toEqual(['a', 'c']);
  });
});

describe('undoing', () => {
  it('undoRemovals puts each id back into its collection — and skips a collection that was deleted since', async () => {
    queryClient.setQueryData(keys.organize, { ...SNAPSHOT, collections: SNAPSHOT.collections.filter((c) => c.id !== 'c6'), members: {} });
    await undoRemovals([{ collectionId: 'bio', itemIds: ['a', 'b'] }, { collectionId: 'c6', itemIds: ['a'] }]);
    expect(addItems.mock.calls.map(([input]) => input)).toEqual([{ collectionId: 'bio', itemIds: ['a', 'b'] }]);
    expect(members()).toEqual({ bio: ['a', 'b'] });
  });
  it('undoAdds takes back exactly the ids that were added', async () => {
    await undoAdds('bio', ['c', 'e']);
    expect(removeItems).toHaveBeenCalledExactlyOnceWith({ collectionId: 'bio', itemIds: ['c', 'e'] });
    await undoAdds('bio', []);
    expect(removeItems).toHaveBeenCalledTimes(1);
  });
  it('a refusal while undoing throws (the toast says so)', async () => {
    addItems.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND', message: '컬렉션을 찾을 수 없습니다.', retryable: false });
    await expect(undoRemovals([{ collectionId: 'bio', itemIds: ['a'] }])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
