import { describe, expect, it, vi } from 'vitest';
import type { LibraryScope, OrganizeSnapshot } from '@learn/domain';
import type { Removal } from '../organize/membership';
import { buildOrganizeModel } from '../organize/model';
import { item } from '../organize/testing';
import { createDropActions, type DropDeps } from './drops';

const AT = '2026-10-01T00:00:00.000Z';
const SNAPSHOT: OrganizeSnapshot = {
  collections: [
    { id: 'bio', name: '분자생물학', parentId: null, createdAt: AT },
    { id: 'c6', name: '6장', parentId: 'bio', createdAt: AT },
    { id: 'stat', name: '통계', parentId: null, createdAt: AT },
    { id: 'note', name: '실험 노트', parentId: null, createdAt: AT },
  ],
  tags: [
    { id: 'exam', name: '시험', color: null, position: null },
    { id: 'must', name: '중요', color: null, position: null },
  ],
  members: { bio: ['a', 'b'], c6: ['a'] },
  tagged: { exam: ['a', 'b'] },
  duplicates: [],
};
const model = buildOrganizeModel(SNAPSHOT, ['a', 'b', 'c'].map((id) => item(id)));
const ALL: LibraryScope = { kind: 'all' };
const IN_BIO: LibraryScope = { kind: 'collection', id: 'bio' };

function setup(over: Partial<DropDeps> = {}) {
  const calls: string[] = [];
  const deps: DropDeps = {
    model: () => model,
    scope: () => ALL,
    selected: () => new Set<string>(),
    addItemsTo: vi.fn<DropDeps['addItemsTo']>(async (_collectionId, ids) => {
      calls.push('add');
      return [...ids];
    }),
    removeFromScope: vi.fn<DropDeps['removeFromScope']>(async (_model, scopeId, ids, progress) => {
      calls.push('remove');
      const removal: Removal = { collectionId: scopeId, itemIds: [...ids] };
      progress?.push(removal);
      return [removal];
    }),
    undoRemovals: vi.fn<DropDeps['undoRemovals']>(async () => void calls.push('undoRemovals')),
    undoAdds: vi.fn<DropDeps['undoAdds']>(async () => void calls.push('undoAdds')),
    moveCollection: vi.fn<DropDeps['moveCollection']>(async ({ parentId }) => ({ parentId })),
    patch: vi.fn(),
    reveal: vi.fn(),
    attachTag: vi.fn<DropDeps['attachTag']>(async () => ({})),
    undoToast: vi.fn(),
    failed: vi.fn(),
    mark: vi.fn(),
    ...over,
  };
  return { deps, calls, actions: createDropActions(deps) };
}
const toast = (deps: DropDeps) => vi.mocked(deps.undoToast).mock.calls[0]!;

describe('rows dropped on a collection row (spec 8.2)', () => {
  it('an add is silent: one call with the ids as dragged, no toast, and the two marks in order', async () => {
    const { deps, actions } = setup();
    await actions.itemsOn('stat', ['a', 'b'], 'copy');
    expect(deps.addItemsTo).toHaveBeenCalledExactlyOnceWith('stat', ['a', 'b']);
    expect(deps.removeFromScope).not.toHaveBeenCalled();
    expect(deps.undoToast).not.toHaveBeenCalled();
    expect(vi.mocked(deps.mark).mock.calls.map(([name]) => name)).toEqual(['dnd:drop', 'dnd:filed']);
  });

  it('the move key in a viewed collection takes them out of it and its descendants first, puts them in second, and offers one undo', async () => {
    const { deps, calls, actions } = setup({ scope: () => IN_BIO });
    await actions.itemsOn('c6', ['a', 'b'], 'move');
    expect(calls).toEqual(['remove', 'add']);
    expect(deps.removeFromScope).toHaveBeenCalledWith(model, 'bio', ['a', 'b'], expect.any(Array));
    const [title, undo] = toast(deps);
    expect(title).toBe('자료 2개를 ‘6장’\u2060으로 옮겼습니다.');
    await (undo as () => Promise<void>)();
    // The added ids come back out before the removed ones go back in: an item the target held already is in both.
    expect(calls.slice(2)).toEqual(['undoAdds', 'undoRemovals']);
    expect(deps.undoAdds).toHaveBeenCalledWith('c6', ['a', 'b']);
    expect(deps.undoRemovals).toHaveBeenCalledWith([{ collectionId: 'bio', itemIds: ['a', 'b'] }]);
  });

  it('the particle follows the target: ‘실험 노트’\u2060로, ‘통계’\u2060로, ‘분자생물학’\u2060으로', async () => {
    for (const [id, name] of [['note', '‘실험 노트’\u2060로'], ['stat', '‘통계’\u2060로'], ['bio', '‘분자생물학’\u2060으로']] as const) {
      const { deps, actions } = setup({ scope: (): LibraryScope => ({ kind: 'collection', id: id === 'bio' ? 'c6' : 'bio' }) });
      await actions.itemsOn(id, ['a'], 'move');
      expect(toast(deps)[0], id).toBe(`자료 1개를 ${name} 옮겼습니다.`);
    }
  });

  it('the toast counts distinct items, however many memberships went', async () => {
    const { deps, actions } = setup({
      scope: () => IN_BIO,
      removeFromScope: vi.fn<DropDeps['removeFromScope']>(async (_m, _s, _ids, progress) => {
        const removals: Removal[] = [{ collectionId: 'bio', itemIds: ['a'] }, { collectionId: 'c6', itemIds: ['a'] }];
        progress?.push(...removals);
        return removals;
      }),
      addItemsTo: vi.fn<DropDeps['addItemsTo']>(async () => ['a']),
    });
    await actions.itemsOn('stat', ['a'], 'move');
    expect(toast(deps)[0]).toBe('자료 1개를 ‘통계’\u2060로 옮겼습니다.');
  });

  it('outside a collection the move key only adds (nothing is taken out of anywhere)', async () => {
    for (const scope of [ALL, { kind: 'unfiled' }, { kind: 'recent' }] as const) {
      const { deps, actions } = setup({ scope: () => scope });
      await actions.itemsOn('stat', ['a'], 'move');
      expect(deps.removeFromScope, scope.kind).not.toHaveBeenCalled();
      expect(deps.addItemsTo, scope.kind).toHaveBeenCalledOnce();
      expect(deps.undoToast, scope.kind).not.toHaveBeenCalled();
    }
  });

  it('nothing to do for a target that is not a collection, or for no items', async () => {
    const { deps, actions } = setup();
    await actions.itemsOn('scope:all', ['a'], 'copy');
    await actions.itemsOn('stat', [], 'copy');
    expect(deps.addItemsTo).not.toHaveBeenCalled();
  });

  it('a move that changed nothing (they were nowhere in the view, nothing new in the target) says nothing', async () => {
    const { deps, actions } = setup({ scope: () => IN_BIO, removeFromScope: vi.fn<DropDeps['removeFromScope']>(async () => []), addItemsTo: vi.fn<DropDeps['addItemsTo']>(async () => []) });
    await actions.itemsOn('c6', ['a'], 'move');
    expect(deps.undoToast).not.toHaveBeenCalled();
    expect(deps.failed).not.toHaveBeenCalled();
  });

  it('a refused add is an error toast and no other', async () => {
    const boom = new Error('x');
    const { deps, actions } = setup({ addItemsTo: vi.fn<DropDeps['addItemsTo']>(async () => Promise.reject(boom)) });
    await actions.itemsOn('stat', ['a'], 'copy');
    expect(deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
    expect(deps.undoToast).not.toHaveBeenCalled();
  });

  it('a refusal in the second half puts the first half back and is one error toast, no undo', async () => {
    const boom = new Error('x');
    const { deps, calls, actions } = setup({ scope: () => IN_BIO, addItemsTo: vi.fn<DropDeps['addItemsTo']>(async () => Promise.reject(boom)) });
    await actions.itemsOn('c6', ['a', 'b'], 'move');
    expect(calls).toEqual(['remove', 'undoRemovals']);
    expect(deps.undoRemovals).toHaveBeenCalledWith([{ collectionId: 'bio', itemIds: ['a', 'b'] }]);
    expect(deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
    expect(deps.undoToast).not.toHaveBeenCalled();
  });

  it('an undo whose target was deleted since still puts the removed rows back, then says the undo failed', async () => {
    const gone = new Error('collection gone');
    const { deps, calls, actions } = setup({
      scope: () => IN_BIO,
      undoAdds: vi.fn<DropDeps['undoAdds']>(async () => Promise.reject(gone)),
    });
    await actions.itemsOn('c6', ['a', 'b'], 'move');
    const [, undo] = toast(deps);
    await (undo as () => Promise<void>)();
    expect(calls).toEqual(['remove', 'add', 'undoRemovals']);
    expect(deps.undoRemovals).toHaveBeenCalledWith([{ collectionId: 'bio', itemIds: ['a', 'b'] }]);
    expect(deps.failed).toHaveBeenCalledExactlyOnceWith(gone);
  });

  it('a refusal half way through the first half puts back what was taken out so far — and the second half never starts', async () => {
    const boom = new Error('x');
    const { deps, actions } = setup({
      scope: () => IN_BIO,
      removeFromScope: vi.fn<DropDeps['removeFromScope']>(async (_m, _s, _ids, progress) => {
        progress?.push({ collectionId: 'bio', itemIds: ['a'] });
        throw boom;
      }),
    });
    await actions.itemsOn('c6', ['a', 'b'], 'move');
    expect(deps.undoRemovals).toHaveBeenCalledWith([{ collectionId: 'bio', itemIds: ['a'] }]);
    expect(deps.addItemsTo).not.toHaveBeenCalled();
    expect(deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
  });

  it('a put-back that is refused too does not hide the first error', async () => {
    const boom = new Error('first');
    const { deps, actions } = setup({
      scope: () => IN_BIO,
      addItemsTo: vi.fn<DropDeps['addItemsTo']>(async () => Promise.reject(boom)),
      undoRemovals: vi.fn<DropDeps['undoRemovals']>(async () => Promise.reject(new Error('second'))),
    });
    await actions.itemsOn('c6', ['a'], 'move');
    expect(deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
  });
});

describe('a collection dropped on a collection row or the 컬렉션 heading (spec 8.3)', () => {
  it('moves it, shows it at once, and opens the way to it', async () => {
    const { deps, actions } = setup();
    await actions.collectionOn('stat', 'c6');
    expect(deps.moveCollection).toHaveBeenCalledExactlyOnceWith({ collectionId: 'stat', parentId: 'c6' });
    expect(deps.patch).toHaveBeenCalledOnce();
    const update = vi.mocked(deps.patch).mock.calls[0]![0];
    expect(update(SNAPSHOT).collections.find((x) => x.id === 'stat')!.parentId).toBe('c6');
    expect(deps.reveal).toHaveBeenCalledExactlyOnceWith('stat');
  });

  it('the heading makes it a top-level collection', async () => {
    const { deps, actions } = setup();
    await actions.collectionOn('c6', null);
    expect(deps.moveCollection).toHaveBeenCalledExactlyOnceWith({ collectionId: 'c6', parentId: null });
  });

  it('asks nothing of main for a cycle, its current parent, or a collection that is gone', async () => {
    const { deps, actions } = setup();
    await actions.collectionOn('bio', 'c6');
    await actions.collectionOn('c6', 'bio');
    await actions.collectionOn('bio', null);
    await actions.collectionOn('gone', 'stat');
    expect(deps.moveCollection).not.toHaveBeenCalled();
  });

  it('a refusal is an error toast, and the tree is left as it was', async () => {
    const boom = new Error('x');
    const { deps, actions } = setup({ moveCollection: vi.fn<DropDeps['moveCollection']>(async () => Promise.reject(boom)) });
    await actions.collectionOn('stat', 'c6');
    expect(deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
    expect(deps.patch).not.toHaveBeenCalled();
    expect(deps.reveal).not.toHaveBeenCalled();
  });
});

describe('a tag dropped on a table row (spec 8.3)', () => {
  const must = SNAPSHOT.tags[1]!;

  it('on a row inside the selection it goes on the whole selection, the tag as the snapshot has it', async () => {
    const { deps, actions } = setup({ selected: () => new Set(['a', 'b']) });
    await actions.tagOn('must', 'b');
    expect(deps.attachTag).toHaveBeenCalledExactlyOnceWith(['a', 'b'], { tag: must });
    expect(vi.mocked(deps.mark).mock.calls.map(([name]) => name)).toEqual(['dnd:drop', 'dnd:filed']);
  });

  it('on a row outside it goes on that row alone', async () => {
    const { deps, actions } = setup({ selected: () => new Set(['a', 'b']) });
    await actions.tagOn('must', 'c');
    expect(deps.attachTag).toHaveBeenCalledExactlyOnceWith(['c'], { tag: must });
  });

  it('does nothing when they all have it, or the tag is gone', async () => {
    const { deps, actions } = setup({ selected: () => new Set(['a', 'b']) });
    await actions.tagOn('exam', 'a');
    await actions.tagOn('gone', 'c');
    expect(deps.attachTag).not.toHaveBeenCalled();
  });

  it('a refusal is an error toast', async () => {
    const boom = new Error('x');
    const { deps, actions } = setup({ attachTag: vi.fn<DropDeps['attachTag']>(async () => Promise.reject(boom)) });
    await actions.tagOn('must', 'c');
    expect(deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
  });
});
