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
let keys = 0;
function setup(over: Partial<TrashDeps> = {}) {
  const deps: TrashDeps = {
    trash: vi.fn(async (ids: string[]) => ids.length),
    restoreItems: vi.fn(async (ids: string[]) => ids.length),
    restoreCollection: vi.fn(async () => {}),
    purge: vi.fn(async (rows: { itemIds: string[]; collectionIds: string[] }) => ({ itemIds: rows.itemIds, collectionIds: rows.collectionIds })),
    readTrash: vi.fn(async () => view(2, 1)),
    confirmPurge: vi.fn(async () => true),
    titleOf: vi.fn((id: string) => (id === 'a' ? '분자생물학 6장' : undefined)),
    dropFromList: vi.fn(),
    toast: vi.fn(),
    undoToast: vi.fn((): string => `k${++keys}`),
    closeToast: vi.fn(),
    failedWithUndo: vi.fn(),
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
    expect(deps.purge).toHaveBeenCalledExactlyOnceWith({ itemIds: ['t0', 't1'], collectionIds: ['c0'] });
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
    const refused = setup({ purge: vi.fn(async () => Promise.reject(boom)) });
    await refused.actions.emptyTrash();
    expect(refused.deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
    expect(refused.deps.toast).not.toHaveBeenCalled();
  });
});

describe('the 실행 취소 toasts of what is purged (critique C-1)', () => {
  it('a purge closes the undo toast whose items are all gone, and leaves one that still has items', async () => {
    const { deps, actions } = setup();
    await actions.trashItems(['a', 'b']);
    await actions.trashItems(['c', 'd']);
    const [k1, k2] = vi.mocked(deps.undoToast).mock.results.map((r) => r.value as string);
    await actions.purge({ itemIds: ['a', 'b', 'c'], collectionIds: [] });
    expect(deps.closeToast).toHaveBeenCalledExactlyOnceWith(k1);
    await actions.purge({ itemIds: ['d'], collectionIds: [] });
    expect(deps.closeToast).toHaveBeenLastCalledWith(k2);
    expect(deps.closeToast).toHaveBeenCalledTimes(2);
  });
  it('a cancelled sheet or a refused purge closes nothing', async () => {
    const no = setup({ confirmPurge: vi.fn(async () => false) });
    await no.actions.trashItems(['a']);
    await no.actions.purge({ itemIds: ['a'], collectionIds: [] });
    expect(no.deps.closeToast).not.toHaveBeenCalled();
  });
  it('휴지통 비우기… leaves no undo toast of the trash behind', async () => {
    const { deps, actions } = setup();
    await actions.trashItems(['a']);
    await actions.trashItems(['b']);
    const keysShown = vi.mocked(deps.undoToast).mock.results.map((r) => r.value as string);
    await actions.emptyTrash();
    expect(vi.mocked(deps.closeToast).mock.calls.map((c) => c[0]).sort()).toEqual([...keysShown].sort());
  });
  it('an undo that restores nothing ends quietly, and its toast is not closed again later', async () => {
    const { deps, actions } = setup({ restoreItems: vi.fn(async () => 0) });
    await actions.trashItems(['a']);
    const [, undo] = vi.mocked(deps.undoToast).mock.calls[0]!;
    await expect(undo()).resolves.toBeUndefined();
    expect(deps.failed).not.toHaveBeenCalled();
    await actions.purge({ itemIds: ['a'], collectionIds: [] });
    expect(deps.closeToast).not.toHaveBeenCalled();
  });
});

describe('휴지통 비우기… purges the rows the sheet counted (R-3)', () => {
  it('an item trashed after the count is not purged', async () => {
    const { deps, actions } = setup({
      confirmPurge: vi.fn(async () => true),
    });
    await actions.emptyTrash();
    const [rows] = vi.mocked(deps.purge).mock.calls[0]!;
    expect(rows).toEqual({ itemIds: ['t0', 't1'], collectionIds: ['c0'] });
    expect(deps.readTrash).toHaveBeenCalledTimes(1);
  });
});

describe('a large selection refused part-way (R-5b)', () => {
  it('names the part already in the trash and offers 실행 취소 for exactly it', async () => {
    const boom = new Error('x');
    const ids = Array.from({ length: 5001 }, (_, k) => `i${k}`);
    let call = 0;
    const { deps, actions } = setup({ trash: vi.fn(async (part: string[]) => (++call === 2 ? Promise.reject(boom) : part.length)) });
    await actions.trashItems(ids);
    expect(deps.failed).not.toHaveBeenCalled();
    expect(deps.undoToast).not.toHaveBeenCalled();
    expect(deps.dropFromList).toHaveBeenCalledExactlyOnceWith(ids.slice(0, 5000));
    const [err, title, undo] = vi.mocked(deps.failedWithUndo).mock.calls[0]!;
    expect(err).toBe(boom);
    expect(title).toBe('자료 5000개만 휴지통으로 옮겼습니다.');
    await undo();
    expect(deps.restoreItems).toHaveBeenCalledExactlyOnceWith(ids.slice(0, 5000));
  });
  it('a refusal of the first part is the plain error', async () => {
    const boom = new Error('x');
    const { deps, actions } = setup({ trash: vi.fn(async () => Promise.reject(boom)) });
    await actions.trashItems(['a']);
    expect(deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
    expect(deps.failedWithUndo).not.toHaveBeenCalled();
  });
});
