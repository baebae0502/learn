import { describe, expect, it, vi } from 'vitest';
import type { OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from './model';
import { createMembershipCommands, type MembershipDeps } from './membershipCommands';
import { item } from './testing';

const AT = '2026-10-01T00:00:00.000Z';
const SNAPSHOT: OrganizeSnapshot = {
  collections: [
    { id: 'bio', name: '분자생물학', parentId: null, createdAt: AT },
    { id: 'c6', name: '6장', parentId: 'bio', createdAt: AT },
  ],
  tags: [],
  members: { bio: ['a'], c6: ['a', 'b'] },
  tagged: {},
  duplicates: [],
};
const model = buildOrganizeModel(SNAPSHOT, ['a', 'b', 'c'].map((id) => item(id)));

function setup(over: Partial<MembershipDeps> = {}) {
  const mocks = {
    model: () => model,
    scope: () => ({ kind: 'collection', id: 'bio' }) as const,
    addItemsTo: vi.fn(async (_c: string, ids: readonly string[]) => [...ids]),
    removeFromScope: vi.fn(async () => [{ collectionId: 'bio', itemIds: ['a'] }, { collectionId: 'c6', itemIds: ['a', 'b'] }]),
    undoRemovals: vi.fn(async () => {}),
    startNew: vi.fn(),
    undoToast: vi.fn(),
    failed: vi.fn(),
  };
  const deps = { ...mocks, ...over } as typeof mocks;
  return { deps, commands: createMembershipCommands(deps as MembershipDeps) };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('컬렉션에 추가 (spec 9.2)', () => {
  it('files the ids into the collection the menu row names, quietly (no toast: filing is not undone from a toast)', async () => {
    const { deps, commands } = setup();
    commands.add(['a', 'b'], { collectionId: 'c6' });
    await settle();
    expect(deps.addItemsTo).toHaveBeenCalledExactlyOnceWith('c6', ['a', 'b']);
    expect(deps.undoToast).not.toHaveBeenCalled();
    expect(deps.startNew).not.toHaveBeenCalled();
  });
  it('"새 컬렉션" names one in the tree first and files the items it was picked for when the name is made (the selection as of the pick)', async () => {
    const { deps, commands } = setup();
    const picked = ['a', 'b'];
    commands.add(picked, { addSelection: true });
    expect(deps.addItemsTo).not.toHaveBeenCalled();
    picked.push('c'); // the table moves on while the name is typed
    const { onCreated } = deps.startNew.mock.calls[0]![0] as { onCreated(id: string): void };
    onCreated('new1');
    await settle();
    expect(deps.addItemsTo).toHaveBeenCalledExactlyOnceWith('new1', ['a', 'b']);
  });
  it('esc in the name field makes no collection and files nothing (onCreated never comes)', () => {
    const { deps, commands } = setup();
    commands.add(['a'], { addSelection: true });
    expect(deps.addItemsTo).not.toHaveBeenCalled();
  });
  it('does nothing for no items or for a row that names nothing', () => {
    const { deps, commands } = setup();
    commands.add([], { collectionId: 'c6' });
    commands.add(['a'], {});
    expect(deps.addItemsTo).not.toHaveBeenCalled();
    expect(deps.startNew).not.toHaveBeenCalled();
  });
  it('tells a refusal with the toast of failures', async () => {
    const boom = new Error('컬렉션을 찾을 수 없습니다.');
    const { deps, commands } = setup({ addItemsTo: vi.fn(async () => { throw boom; }) });
    commands.add(['a'], { collectionId: 'c6' });
    await settle();
    expect(deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
  });
});

describe('이 컬렉션에서 빼기 (spec 9.2, owner decision 0)', () => {
  it('takes the items out of the collection viewed and below it, and offers 실행 취소 with what went — N counts items, not memberships', async () => {
    const { deps, commands } = setup();
    await commands.remove(['a', 'b']);
    expect(deps.removeFromScope).toHaveBeenCalledExactlyOnceWith(model, 'bio', ['a', 'b']);
    expect(deps.undoToast).toHaveBeenCalledOnce();
    const [title, undo] = deps.undoToast.mock.calls[0]! as [string, () => Promise<void>];
    expect(title).toBe('‘분자생물학’에서 자료 2개를 뺐습니다.'); // a was in two collections, b in one: two items
    await undo();
    expect(deps.undoRemovals).toHaveBeenCalledExactlyOnceWith([{ collectionId: 'bio', itemIds: ['a'] }, { collectionId: 'c6', itemIds: ['a', 'b'] }]);
  });
  it('is nothing outside a collection view, with no snapshot, or for a collection that is gone', async () => {
    for (const over of [
      { scope: () => ({ kind: 'all' }) as const },
      { scope: () => ({ kind: 'unfiled' }) as const },
      { model: () => undefined },
      { scope: () => ({ kind: 'collection', id: 'gone' }) as const },
    ] satisfies Partial<MembershipDeps>[]) {
      const { deps, commands } = setup(over);
      await commands.remove(['a']);
      expect(deps.removeFromScope).not.toHaveBeenCalled();
      expect(deps.undoToast).not.toHaveBeenCalled();
    }
  });
  it('says nothing when nothing was held in the scope (a snapshot a step behind)', async () => {
    const { deps, commands } = setup({ removeFromScope: vi.fn(async () => []) });
    await commands.remove(['a']);
    expect(deps.undoToast).not.toHaveBeenCalled();
    expect(deps.failed).not.toHaveBeenCalled();
  });
  it('a refusal is told as a failure and offers no undo', async () => {
    const boom = new Error('실패');
    const { deps, commands } = setup({ removeFromScope: vi.fn(async () => { throw boom; }) });
    await commands.remove(['a']);
    expect(deps.failed).toHaveBeenCalledExactlyOnceWith(boom);
    expect(deps.undoToast).not.toHaveBeenCalled();
  });
});
