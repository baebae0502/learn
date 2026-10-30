import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { attachTag, detachTag } from './itemTags';

const SNAPSHOT: OrganizeSnapshot = {
  collections: [],
  tags: [{ id: 't1', name: '중요', color: 'yellow', position: 1 }],
  members: {},
  tagged: { t1: ['a'] },
  duplicates: [],
};
const snap = () => queryClient.getQueryData<OrganizeSnapshot>(keys.organize)!;
const create = vi.fn();
const assign = vi.fn();
const unassign = vi.fn();
beforeEach(() => {
  queryClient.setQueryData(keys.organize, SNAPSHOT);
  create.mockImplementation(async (input: { name: string }) => ({ ok: true, data: { id: 't9', name: input.name, color: null, position: null, itemCount: 0 } }));
  assign.mockResolvedValue({ ok: true, data: 1 });
  unassign.mockResolvedValue({ ok: true, data: 1 });
  vi.stubGlobal('window', { learn: { tags: { create, assign, unassign } } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  queryClient.clear();
  for (const f of [create, assign, unassign]) f.mockReset();
});

describe('attachTag', () => {
  it('puts a chosen tag on the items without creating anything, and shows it at once', async () => {
    const tag = SNAPSHOT.tags[0]!;
    expect(await attachTag(['a', 'b'], { tag })).toEqual(tag);
    expect(create).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledExactlyOnceWith({ tagId: 't1', itemIds: ['a', 'b'] });
    expect(snap().tagged['t1']).toEqual(['a', 'b']);
  });
  it('creates a typed name (main answers the existing tag when the name is there) and puts the answer on the items', async () => {
    const tag = await attachTag(['b'], { name: '수용체' });
    expect(create).toHaveBeenCalledExactlyOnceWith({ name: '수용체' });
    expect(tag).toEqual({ id: 't9', name: '수용체', color: null, position: null });
    expect(snap().tags.map((t) => t.id)).toEqual(['t1', 't9']);
    expect(snap().tagged['t9']).toEqual(['b']);
    create.mockResolvedValueOnce({ ok: true, data: { id: 't1', name: '중요', color: 'yellow', position: 1, itemCount: 1 } });
    await attachTag(['b'], { name: '중요' });
    expect(snap().tags.map((t) => t.id)).toEqual(['t1', 't9']); // no second copy
    expect(snap().tagged['t1']).toEqual(['a', 'b']);
  });
  it('splits a large selection at 5,000 ids a call and sends each id once', async () => {
    const ids = Array.from({ length: 6_000 }, (_, i) => `x${i}`);
    await attachTag([...ids, 'x0'], { tag: SNAPSHOT.tags[0]! });
    expect(assign.mock.calls.map(([input]) => (input as { itemIds: string[] }).itemIds.length)).toEqual([5000, 1000]);
  });
  it('a tag that was created stays in the snapshot even if putting it on the items is refused; the refusal throws', async () => {
    assign.mockResolvedValueOnce({ ok: false, code: 'INTERNAL', message: '실패', retryable: true });
    await expect(attachTag(['b'], { name: '새 이름' })).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(snap().tags.map((t) => t.id)).toEqual(['t1', 't9']);
    expect(snap().tagged['t9']).toBeUndefined();
  });
  it('a refused create throws and puts nothing anywhere', async () => {
    create.mockResolvedValueOnce({ ok: false, code: 'VALIDATION_FAILED', message: '태그 이름은 1–200자여야 합니다.', retryable: false });
    await expect(attachTag(['b'], { name: '' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('detachTag', () => {
  it('takes the tag off the items and shows it at once; a tag with no item left loses its key', async () => {
    await detachTag(['a'], 't1');
    expect(unassign).toHaveBeenCalledExactlyOnceWith({ tagId: 't1', itemIds: ['a'] });
    expect(snap().tagged).toEqual({});
  });
  it('a refusal throws and the snapshot keeps the tag', async () => {
    unassign.mockResolvedValueOnce({ ok: false, code: 'INTERNAL', message: '실패', retryable: true });
    await expect(detachTag(['a'], 't1')).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(snap().tagged['t1']).toEqual(['a']);
  });
});
