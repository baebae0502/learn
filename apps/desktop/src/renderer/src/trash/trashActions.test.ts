import { describe, expect, it, vi } from 'vitest';
import type { TrashView } from '@learn/domain';
import { item } from '../organize/testing';
import { createTrashActions, purgeVariant, type TrashDeps } from './trashActions';

const view = (items: number, collections: number): TrashView => ({
  items: Array.from({ length: items }, (_, k) => ({ ...item(`t${k}`), deletedAt: '2026-10-31T00:00:00.000Z' })),
  collections: Array.from({ length: collections }, (_, k) => ({ id: `c${k}`, name: `c${k}`, parentId: null, deletedAt: '2026-10-31T00:00:00.000Z', childCount: 0, itemCount: 0 })),
  members: {},
  tagged: {},
});
function setup(over: Partial<TrashDeps> = {}) {
  const deps: TrashDeps = {
    trash: vi.fn(async (ids: string[]) => ids.length),
    restoreItems: vi.fn(async (ids: string[]) => ids.length),
    restoreCollection: vi.fn(async () => {}),
    purge: vi.fn(async (rows: { itemIds: string[]; collectionIds: string[] }) => ({ itemIds: rows.itemIds, collectionIds: rows.collectionIds })),
    emptyTrash: vi.fn(async () => ({ itemIds: ['t0', 't1'], collectionIds: ['c0'] })),
    readTrash: vi.fn(async () => view(2, 1)),
    confirmPurge: vi.fn(async () => true),
    titleOf: vi.fn((id: string) => (id === 'a' ? '분자생물학 6장' : undefined)),
    dropFromList: vi.fn(),
    toast: vi.fn(),
    undoToast: vi.fn(),
    failed: vi.fn(),
    ...over,
  };
  return { deps, actions: createTrashActions(deps) };
}

describe('휴지통으로 이동 (spec 4.1)', () => {
  it('moves at once, says how many with 실행 취소 (one is named), and the undo brings back exactly those', async () => {
    const { deps, actions } = setup();
    await actions.trashItems(['a', 'b', 'a']);
    expect(deps.trash).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    expect(deps.dropFromList).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    const [title, undo] = vi.mocked(deps.undoToast).mock.calls[0]!;
    expect(title).toBe('자료 2개를 휴지통으로 옮겼습니다');
    await undo();
    expect(deps.restoreItems).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    await actions.trashItems(['a']);
    expect(vi.mocked(deps.undoToast).mock.calls[1]![0]).toBe('‘분자생물학 6장’⁠을 휴지통으로 옮겼습니다');
  });
  it('nothing moved (gone meanwhile) says nothing; a refusal is told and moves nothing on screen', async () => {
    const none = setup({ trash: vi.fn(async () => 0) });
    await none.actions.trashItems(['a']);
    expect(none.deps.undoToast).not.toHaveBeenCalled();
    expect(none.deps.dropFromList).not.toHaveBeenCalled();
    const boom = new Error('x');
    const refused = setup({ trash: vi.fn(async () => Promise.reject(boom)) });
    await refused.actions.trashItems(['a']);
    expect(refused.deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
    expect(refused.deps.dropFromList).not.toHaveBeenCalled();
    await refused.actions.trashItems([]);
    expect(refused.deps.trash).toHaveBeenCalledTimes(1);
  });
});

describe('복원 (spec 4.4)', () => {
  it('restores the items and each collection, counted together, with no undo; quiet from the reader', async () => {
    const { deps, actions } = setup();
    await actions.restore({ itemIds: ['t0', 't1'], collectionIds: ['c0'] });
    expect(deps.restoreItems).toHaveBeenCalledExactlyOnceWith(['t0', 't1']);
    expect(deps.restoreCollection).toHaveBeenCalledExactlyOnceWith('c0');
    expect(deps.toast).toHaveBeenCalledExactlyOnceWith('3개를 복원했습니다', 'restore-done');
    expect(deps.undoToast).not.toHaveBeenCalled();
    await actions.restore({ itemIds: ['t0'], collectionIds: [] }, { quiet: true });
    expect(deps.toast).toHaveBeenCalledTimes(1);
  });
  it('a refusal is told; what came back before it is still said', async () => {
    const boom = new Error('x');
    const { deps, actions } = setup({ restoreCollection: vi.fn(async () => Promise.reject(boom)) });
    await actions.restore({ itemIds: ['t0'], collectionIds: ['c0'] });
    expect(deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
    expect(deps.toast).toHaveBeenCalledExactlyOnceWith('1개를 복원했습니다', 'restore-done');
  });
});

describe('영구 삭제… and 휴지통 비우기… (spec 4.5, P-25)', () => {
  it('asks in the sheet first with its variant; 취소 deletes nothing; the toast counts what went', async () => {
    const no = setup({ confirmPurge: vi.fn(async () => false) });
    await no.actions.purge({ itemIds: ['t0'], collectionIds: [] });
    expect(no.deps.confirmPurge).toHaveBeenCalledExactlyOnceWith({ variant: 'items', items: 1, collections: 0 });
    expect(no.deps.purge).not.toHaveBeenCalled();
    const yes = setup();
    await yes.actions.purge({ itemIds: ['t0', 't1'], collectionIds: ['c0'] });
    expect(yes.deps.confirmPurge).toHaveBeenCalledExactlyOnceWith({ variant: 'mixed', items: 2, collections: 1 });
    expect(yes.deps.purge).toHaveBeenCalledExactlyOnceWith({ itemIds: ['t0', 't1'], collectionIds: ['c0'] });
    expect(yes.deps.toast).toHaveBeenCalledExactlyOnceWith('자료 2개와 컬렉션 1개를 영구히 삭제했습니다', 'purge-done');
    expect([purgeVariant(0, 2), purgeVariant(3, 0), purgeVariant(1, 1)]).toEqual(['collections', 'items', 'mixed']);
  });
  it('휴지통 비우기… counts the trash as it is now; an empty trash asks nothing', async () => {
    const { deps, actions } = setup();
    await actions.emptyTrash();
    expect(deps.confirmPurge).toHaveBeenCalledExactlyOnceWith({ variant: 'empty', items: 2, collections: 1 });
    expect(deps.emptyTrash).toHaveBeenCalledTimes(1);
    expect(deps.toast).toHaveBeenCalledExactlyOnceWith('휴지통을 비웠습니다', 'purge-done');
    const none = setup({ readTrash: vi.fn(async () => view(0, 0)) });
    await none.actions.emptyTrash();
    expect(none.deps.confirmPurge).not.toHaveBeenCalled();
  });
  it('a sheet that fails, or a refused delete, is told and nothing more happens', async () => {
    const boom = new Error('x');
    const sheet = setup({ confirmPurge: vi.fn(async () => Promise.reject(boom)) });
    await sheet.actions.purge({ itemIds: ['t0'], collectionIds: [] });
    expect(sheet.deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
    expect(sheet.deps.purge).not.toHaveBeenCalled();
    const refused = setup({ emptyTrash: vi.fn(async () => Promise.reject(boom)) });
    await refused.actions.emptyTrash();
    expect(refused.deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
    expect(refused.deps.toast).not.toHaveBeenCalled();
  });
});
