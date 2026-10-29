import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Collection, LibraryScope, OrganizeSnapshot } from '@learn/domain';
import { buildOrganizeModel } from '../organize/model';
import { createCollectionActions, type ActionDeps } from './collectionActions';
import { useSidebarEdit } from './sidebarEdit';

const AT = '2026-10-01T00:00:00.000Z';
const collection = (id: string, name: string, parentId: string | null = null): Collection => ({ id, name, parentId, itemCount: 0, createdAt: AT, updatedAt: null });
const BASE: OrganizeSnapshot = {
  collections: [
    { id: 'bio', name: '분자생물학', parentId: null, createdAt: AT },
    { id: 'c6', name: '6장', parentId: 'bio', createdAt: AT },
    { id: 'lab', name: '실험', parentId: 'c6', createdAt: AT },
    { id: 'c7', name: '7장', parentId: 'bio', createdAt: AT },
    { id: 'stats', name: '통계', parentId: null, createdAt: AT },
  ],
  tags: [], members: {}, tagged: {}, duplicates: [],
};
const NEW = '새\u00a0컬렉션';

function setup(over: Partial<ActionDeps> = {}, startAt: LibraryScope = { kind: 'all' }) {
  let snapshot = BASE;
  let scope = startAt;
  const deps: ActionDeps = {
    collections: {
      create: vi.fn(async ({ name, parentId }) => collection('new1', name, parentId)),
      rename: vi.fn(async ({ collectionId, name }) => collection(collectionId, name)),
      remove: vi.fn(async () => {}),
      restore: vi.fn(async ({ collectionId }) => collection(collectionId, '되살림')),
    },
    confirm: vi.fn(async () => true),
    model: () => buildOrganizeModel(snapshot, []),
    scope: () => scope,
    setScope: vi.fn((s: LibraryScope) => void (scope = s)),
    patch: vi.fn((update: (s: OrganizeSnapshot) => OrganizeSnapshot) => void (snapshot = update(snapshot))),
    expand: vi.fn(),
    forget: vi.fn(),
    showSidebar: vi.fn(),
    opener: () => null,
    failed: vi.fn(),
    undoToast: vi.fn(),
    ...over,
  };
  return { deps, actions: createCollectionActions(deps), snapshot: () => snapshot, scope: () => scope };
}
const editNow = () => useSidebarEdit.getState().edit;
beforeEach(() => useSidebarEdit.setState({ edit: null, opener: null, busy: false, restoreTo: null }));

describe('a new collection (spec 3.4)', () => {
  it('shows the sidebar and starts a row named 새 컬렉션; ↩ creates it with the name typed and leaves the view where it was', async () => {
    const { actions, deps, snapshot, scope } = setup();
    actions.startNew();
    expect(deps.showSidebar).toHaveBeenCalled();
    expect(editNow()).toEqual({ kind: 'new', parentId: null, text: NEW });
    await actions.finish('  논문 읽기 ', 'enter');
    expect(deps.collections.create).toHaveBeenCalledExactlyOnceWith({ name: '논문 읽기', parentId: null });
    expect(snapshot().collections.at(-1)).toMatchObject({ id: 'new1', name: '논문 읽기', parentId: null });
    expect(editNow()).toBeNull();
    expect(useSidebarEdit.getState().restoreTo).not.toBeNull();
    expect(deps.setScope).not.toHaveBeenCalled();
    expect(scope()).toEqual({ kind: 'all' });
  });
  it('under a parent: the parent is opened first, and whoever asked is told the id', async () => {
    const onCreated = vi.fn();
    const { actions, deps } = setup();
    actions.startNew({ parentId: 'bio', onCreated });
    expect(deps.expand).toHaveBeenCalledExactlyOnceWith(['bio']);
    await actions.finish('8장', 'blur');
    expect(deps.collections.create).toHaveBeenCalledExactlyOnceWith({ name: '8장', parentId: 'bio' });
    expect(onCreated).toHaveBeenCalledExactlyOnceWith('new1');
    expect(useSidebarEdit.getState().restoreTo).toBeNull(); // the click that left the field put the focus somewhere: not taken back
  });
  it('under a deep parent every closed ancestor opens with it, or the row would not be drawn', () => {
    const { actions, deps } = setup();
    actions.startNew({ parentId: 'lab' });
    expect(deps.expand).toHaveBeenCalledExactlyOnceWith(['bio', 'c6', 'lab']);
  });
  it('a parent that is not there starts nothing', () => {
    const { actions, deps } = setup();
    actions.startNew({ parentId: 'gone' });
    expect(editNow()).toBeNull();
    expect(deps.showSidebar).not.toHaveBeenCalled();
  });
  it('an empty or blank name creates the default name (no error); esc creates nothing', async () => {
    const { actions, deps } = setup();
    actions.startNew();
    await actions.finish('   ', 'enter');
    expect(deps.collections.create).toHaveBeenCalledExactlyOnceWith({ name: NEW, parentId: null });
    actions.startNew();
    actions.cancel();
    expect(editNow()).toBeNull();
    expect(deps.collections.create).toHaveBeenCalledTimes(1);
  });
  it('over 200 characters: ↩ changes nothing and the field stays; leaving the field drops the edit', async () => {
    const { actions, deps } = setup();
    actions.startNew();
    await actions.finish('가'.repeat(201), 'enter');
    expect(editNow()).not.toBeNull();
    expect(deps.collections.create).not.toHaveBeenCalled();
    await actions.finish('가'.repeat(201), 'blur');
    expect(editNow()).toBeNull();
    expect(deps.collections.create).not.toHaveBeenCalled();
  });
  it('a second finish while the call is out is ignored; a refused create is told and the edit ends', async () => {
    let release: (c: Collection) => void = () => {};
    const slow = vi.fn(() => new Promise<Collection>((r) => void (release = r)));
    const { actions, deps } = setup({ collections: { ...setup().deps.collections, create: slow } });
    actions.startNew();
    const first = actions.finish('가', 'enter');
    await actions.finish('가', 'blur');
    expect(slow).toHaveBeenCalledTimes(1);
    release(collection('new1', '가'));
    await first;
    expect(editNow()).toBeNull();
    const boom = setup({ collections: { ...setup().deps.collections, create: vi.fn(async () => Promise.reject(new Error('x'))) } });
    boom.actions.startNew();
    await boom.actions.finish('가', 'enter');
    expect(boom.deps.failed).toHaveBeenCalledTimes(1);
    expect(editNow()).toBeNull();
    expect(deps.failed).not.toHaveBeenCalled();
  });
});

describe('renaming (spec 3.4)', () => {
  it('starts with the current name; ↩ saves the new one, and the snapshot has it at once', async () => {
    const { actions, deps, snapshot } = setup();
    actions.startRename('stats');
    expect(editNow()).toEqual({ kind: 'rename', id: 'stats', text: '통계' });
    await actions.finish('통계학', 'enter');
    expect(deps.collections.rename).toHaveBeenCalledExactlyOnceWith({ collectionId: 'stats', name: '통계학' });
    expect(snapshot().collections.find((c) => c.id === 'stats')?.name).toBe('통계학');
    expect(editNow()).toBeNull();
  });
  it('renaming a collection below closed ancestors opens them; a top-level one opens nothing', () => {
    const { actions, deps } = setup();
    actions.startRename('lab');
    expect(deps.expand).toHaveBeenCalledExactlyOnceWith(['bio', 'c6']);
    actions.startRename('stats');
    expect(deps.expand).toHaveBeenCalledTimes(1);
  });
  it('an empty name, or the same name, is no call and no error; an unknown collection starts nothing', async () => {
    const { actions, deps } = setup();
    actions.startRename('stats');
    await actions.finish('  ', 'enter');
    actions.startRename('stats');
    await actions.finish('통계', 'blur');
    expect(deps.collections.rename).not.toHaveBeenCalled();
    actions.startRename('gone');
    expect(editNow()).toBeNull();
  });
  it('a refused rename is told, the name stays, and the edit ends', async () => {
    const { actions, deps, snapshot } = setup({ collections: { ...setup().deps.collections, rename: vi.fn(async () => Promise.reject(new Error('x'))) } });
    actions.startRename('stats');
    await actions.finish('통계학', 'enter');
    expect(deps.failed).toHaveBeenCalledTimes(1);
    expect(snapshot().collections.find((c) => c.id === 'stats')?.name).toBe('통계');
    expect(editNow()).toBeNull();
  });
});

describe('deleting (spec 3.4)', () => {
  it('asks in the renderer\'s words — the name with its particle, the sub-collections counted, the items staying — and deletes with an undo', async () => {
    const { actions, deps, snapshot } = setup();
    await actions.remove('bio');
    expect(deps.confirm).toHaveBeenCalledExactlyOnceWith({
      message: '‘분자생물학’\u2060을 삭제하겠습니까?',
      detail: '하위 컬렉션 3개도 함께 삭제합니다.\n자료는 내 라이브러리에 남습니다.',
      confirm: '삭제',
    });
    expect(deps.collections.remove).toHaveBeenCalledExactlyOnceWith({ collectionId: 'bio' });
    expect(snapshot().collections.map((c) => c.id)).toEqual(['stats']);
    expect(deps.undoToast).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.undoToast).mock.calls[0]![0]).toBe('‘분자생물학’\u2060을 삭제했습니다');
    await vi.mocked(deps.undoToast).mock.calls[0]![1]();
    expect(deps.collections.restore).toHaveBeenCalledExactlyOnceWith({ collectionId: 'bio' });
    expect(deps.forget).toHaveBeenCalledExactlyOnceWith(['bio', 'c6', 'lab', 'c7']); // restored folded
  });
  it('a collection with no sub-collections says only that the items stay, and a vowel name takes 를', async () => {
    const { actions, deps } = setup();
    await actions.remove('stats');
    expect(deps.confirm).toHaveBeenCalledExactlyOnceWith({ message: '‘통계’\u2060를 삭제하겠습니까?', detail: '자료는 내 라이브러리에 남습니다.', confirm: '삭제' });
  });
  it('the view moves to the parent when it was inside the deleted collection (to 내 라이브러리 from the top level), and stays otherwise', async () => {
    const inside = setup({}, { kind: 'collection', id: 'lab' });
    await inside.actions.remove('c6');
    expect(inside.scope()).toEqual({ kind: 'collection', id: 'bio' });
    const top = setup({}, { kind: 'collection', id: 'lab' });
    await top.actions.remove('bio');
    expect(top.scope()).toEqual({ kind: 'all' });
    const elsewhere = setup({}, { kind: 'collection', id: 'stats' });
    await elsewhere.actions.remove('bio');
    expect(elsewhere.deps.setScope).not.toHaveBeenCalled();
  });
  it('a sheet that fails is told and deletes nothing', async () => {
    const { actions, deps } = setup({ confirm: vi.fn(async () => Promise.reject(new Error('x'))) });
    await actions.remove('bio');
    expect(deps.failed).toHaveBeenCalledTimes(1);
    expect(deps.collections.remove).not.toHaveBeenCalled();
  });
  it('cancelling the sheet, a refused delete, and an unknown collection change nothing', async () => {
    const cancelled = setup({ confirm: vi.fn(async () => false) });
    await cancelled.actions.remove('bio');
    expect(cancelled.deps.collections.remove).not.toHaveBeenCalled();
    const refused = setup({ collections: { ...setup().deps.collections, remove: vi.fn(async () => Promise.reject(new Error('x'))) } });
    await refused.actions.remove('bio');
    expect(refused.deps.failed).toHaveBeenCalledTimes(1);
    expect(refused.snapshot()).toBe(BASE);
    expect(refused.deps.undoToast).not.toHaveBeenCalled();
    const unknown = setup();
    await unknown.actions.remove('gone');
    expect(unknown.deps.confirm).not.toHaveBeenCalled();
  });
});
