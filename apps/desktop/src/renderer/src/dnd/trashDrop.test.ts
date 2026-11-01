import { describe, expect, it, vi } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from '../organize/model';
import { SCOPE_KEYS } from '../sidebar/rows';
import { createDropActions, type DropDeps } from './drops';
import { MIME_COLLECTION, MIME_ITEMS, MIME_TAG } from './mime';
import { onTrashRow } from './rules';

const types = (...t: string[]) => new Set(t);
const SNAPSHOT: OrganizeSnapshot = { collections: [{ id: 'bio', name: '분자생물학', parentId: null, createdAt: '2026-10-01T00:00:00.000Z' }], tags: [], members: {}, tagged: {}, duplicates: [], trashCount: 1 };

describe('the sidebar\'s 휴지통 as a drop target (spec 4.1, 4.2)', () => {
  it('takes table rows and collection rows as a move; never Finder\'s files or a tag; no other special row does', () => {
    expect(onTrashRow({ target: SCOPE_KEYS.trash, types: types(MIME_ITEMS), files: false, allowed: ['copy', 'move'] })).toBe('move');
    expect(onTrashRow({ target: SCOPE_KEYS.trash, types: types(MIME_COLLECTION), files: false, allowed: ['move'] })).toBe('move');
    expect(onTrashRow({ target: SCOPE_KEYS.trash, types: types(MIME_TAG), files: false, allowed: ['copy'] })).toBe('cancel');
    expect(onTrashRow({ target: SCOPE_KEYS.trash, types: types('Files'), files: true, allowed: ['copy', 'move'] })).toBe('cancel');
    expect(onTrashRow({ target: SCOPE_KEYS.trash, types: types(MIME_ITEMS), files: false, allowed: ['copy'] })).toBe('cancel');
    expect(onTrashRow({ target: SCOPE_KEYS.all, types: types(MIME_ITEMS), files: false, allowed: ['move'] })).toBe('cancel');
  });
  it('rows dropped there go to the trash; a collection goes with its 실행 취소 (collectionActions); a collection gone since, not', async () => {
    const deps = { model: () => buildOrganizeModel(SNAPSHOT, []), mark: vi.fn(), failed: vi.fn(), trashItems: vi.fn(async () => {}), trashCollection: vi.fn(async () => {}) };
    const actions = createDropActions(deps as unknown as DropDeps);
    await actions.itemsOnTrash(['a', 'b']);
    expect(deps.trashItems).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    await actions.collectionOnTrash('bio');
    expect(deps.trashCollection).toHaveBeenCalledExactlyOnceWith('bio');
    await actions.collectionOnTrash('gone');
    await actions.itemsOnTrash([]);
    expect(deps.trashCollection).toHaveBeenCalledTimes(1);
    expect(deps.trashItems).toHaveBeenCalledTimes(1);
  });
});
