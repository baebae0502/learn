import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TAG_COLORS, type OrganizeSnapshot, type OrganizeTag, type Tag } from '@learn/domain';
import { buildOrganizeModel } from '../organize/model';
import { item } from '../organize/testing';
import { TOGGLE_CHUNK, createTagActions, type TagActionDeps } from './tagActions';
import { useTagEdit } from './tagEdit';

const row = (id: string, name: string, position: number | null = null): OrganizeTag => ({ id, name, color: position === null ? null : TAG_COLORS[position - 1]!.id, position });
const asTag = (r: OrganizeTag): Tag => ({ ...r, itemCount: 0 });
const BASE: OrganizeSnapshot = {
  collections: [],
  tags: [row('rng', '시험 범위', 1), row('imp', '중요', 3), row('rec', '수용체'), row('alpha', 'Alpha'), row('empty', '복습')],
  members: {},
  tagged: { rng: ['i1'], imp: ['i1', 'i2'], rec: ['i3'], alpha: ['i2'] },
  duplicates: [],
};
const ITEMS = ['i1', 'i2', 'i3', 'i4'].map((id) => item(id));
const NOTICE = (slot: string) => `색 태그 ${slot} 없습니다. 태그의 컨텍스트 메뉴에서 색을 지정하세요.`;

function setup(over: Partial<TagActionDeps> = {}, items = ITEMS, start: OrganizeSnapshot = BASE) {
  let snapshot = start;
  const find = (id: string) => snapshot.tags.find((x) => x.id === id)!;
  const deps: TagActionDeps = {
    tags: {
      rename: vi.fn(async ({ tagId, name }) => asTag({ ...find(tagId), name })),
      setColor: vi.fn(async ({ tagId, color, position }) => asTag({ ...find(tagId), color, position })),
      remove: vi.fn(async () => {}),
      assign: vi.fn(async ({ itemIds }) => itemIds.length),
      unassign: vi.fn(async ({ itemIds }) => itemIds.length),
      togglePosition: vi.fn(async ({ position }) => ({ tagId: snapshot.tags.find((x) => x.position === position)!.id, assigned: true })),
    },
    confirm: vi.fn(async () => true),
    model: () => buildOrganizeModel(snapshot, items),
    patch: vi.fn((update: (s: OrganizeSnapshot) => OrganizeSnapshot) => void (snapshot = update(snapshot))),
    leaveFilter: vi.fn(),
    opener: () => null,
    failed: vi.fn(),
    notice: vi.fn(),
    ...over,
  };
  return { deps, actions: createTagActions(deps), snapshot: () => snapshot };
}
const edit = () => useTagEdit.getState();
beforeEach(() => useTagEdit.setState({ editingId: null, text: '', opener: null, busy: false, restoreTo: null }));

describe('renaming in the chip (spec 4.1)', () => {
  it('starts with the current name; ↩ saves the cleaned name, the snapshot has it at once, the chip gets the focus back', async () => {
    const { actions, deps, snapshot } = setup();
    actions.startRename('rec');
    expect(edit()).toMatchObject({ editingId: 'rec', text: '수용체' });
    await actions.finishRename('  수용체 단백질 ', 'enter');
    expect(deps.tags.rename).toHaveBeenCalledExactlyOnceWith({ tagId: 'rec', name: '수용체 단백질' });
    expect(snapshot().tags.find((x) => x.id === 'rec')?.name).toBe('수용체 단백질');
    expect(edit().editingId).toBeNull();
    expect(edit().restoreTo).toEqual({ tagId: 'rec', opener: null });
    expect(deps.confirm).not.toHaveBeenCalled();
  });
  it('a blank or unchanged name is no call and no error; ↩ gives the focus back, a click elsewhere does not', async () => {
    const { actions, deps } = setup();
    actions.startRename('rec');
    await actions.finishRename('   ', 'enter');
    expect(edit().restoreTo).toEqual({ tagId: 'rec', opener: null });
    actions.startRename('rec');
    await actions.finishRename('수용체', 'blur');
    expect(edit().restoreTo).toBeNull();
    expect(deps.tags.rename).not.toHaveBeenCalled();
    expect(deps.failed).not.toHaveBeenCalled();
  });
  it('over 200 characters: ↩ changes nothing and the field stays; leaving the field drops the edit', async () => {
    const { actions, deps } = setup();
    actions.startRename('rec');
    await actions.finishRename('가'.repeat(201), 'enter');
    expect(edit().editingId).toBe('rec');
    await actions.finishRename('가'.repeat(201), 'blur');
    expect(edit().editingId).toBeNull();
    expect(deps.tags.rename).not.toHaveBeenCalled();
  });
  it('a change of case alone is a rename, not a merge with itself', async () => {
    const { actions, deps } = setup();
    actions.startRename('alpha');
    await actions.finishRename('ALPHA', 'enter');
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.tags.rename).toHaveBeenCalledExactlyOnceWith({ tagId: 'alpha', name: 'ALPHA' });
  });
  it('a name another tag has asks first, in the sheet\'s words; cancelling changes nothing', async () => {
    const { actions, deps, snapshot } = setup({ confirm: vi.fn(async () => false) });
    actions.startRename('rec');
    await actions.finishRename('중요', 'enter');
    expect(deps.confirm).toHaveBeenCalledExactlyOnceWith({
      message: '‘중요’ 태그가 이미 있습니다. 두 태그를 합치겠습니까?',
      detail: '‘수용체’ 태그의 자료는 ‘중요’로 옮겨지고, ‘수용체’ 태그는 없어집니다.',
      confirm: '합치기',
    });
    expect(deps.tags.rename).not.toHaveBeenCalled();
    expect(snapshot()).toBe(BASE);
    expect(edit().editingId).toBeNull();
  });
  it('finds the other tag ignoring case and spaces at the ends, and names it as it is written', async () => {
    const { actions, deps } = setup({ confirm: vi.fn(async () => false) });
    actions.startRename('rec');
    await actions.finishRename(' alpha ', 'enter');
    expect(vi.mocked(deps.confirm).mock.calls[0]![0].message).toBe('‘Alpha’ 태그가 이미 있습니다. 두 태그를 합치겠습니까?');
  });
  it('confirming merges: the other tag has the items of both, this one is gone from the cache and the filter, and the focus goes to the tag that remains', async () => {
    const { actions, deps, snapshot } = setup({}, ITEMS, BASE);
    // The database answers a merge with the tag that remains.
    deps.tags.rename = vi.fn(async () => asTag(BASE.tags.find((x) => x.id === 'rng')!));
    actions.startRename('rec');
    await actions.finishRename('시험 범위', 'enter');
    expect(snapshot().tags.map((x) => x.id)).not.toContain('rec');
    expect(snapshot().tagged['rng']).toEqual(['i1', 'i3']);
    expect(deps.leaveFilter).toHaveBeenCalledExactlyOnceWith('rec', 'rng');
    expect(edit().restoreTo).toEqual({ tagId: 'rng', opener: null });
  });
  it('a merge the cache did not foresee (the database answers another tag) is handled the same, without a sheet', async () => {
    const { actions, deps, snapshot } = setup();
    deps.tags.rename = vi.fn(async () => asTag(BASE.tags.find((x) => x.id === 'imp')!));
    actions.startRename('rec');
    await actions.finishRename('다른 이름', 'enter');
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(snapshot().tags.map((x) => x.id)).not.toContain('rec');
    expect(deps.leaveFilter).toHaveBeenCalledExactlyOnceWith('rec', 'imp');
  });
  it('a second finish while the call is out is ignored; a refused rename is told and the edit ends with the name unchanged', async () => {
    let release: (t: Tag) => void = () => {};
    const slow = vi.fn(() => new Promise<Tag>((r) => void (release = r)));
    const held = setup();
    held.deps.tags.rename = slow;
    held.actions.startRename('rec');
    const first = held.actions.finishRename('새 이름', 'enter');
    await held.actions.finishRename('다른 이름', 'blur');
    expect(slow).toHaveBeenCalledTimes(1);
    release(asTag({ ...BASE.tags.find((x) => x.id === 'rec')!, name: '새 이름' }));
    await first;
    expect(edit().editingId).toBeNull();
    const boom = setup();
    boom.deps.tags.rename = vi.fn(async () => Promise.reject(new Error('x')));
    boom.actions.startRename('rec');
    await boom.actions.finishRename('새 이름', 'enter');
    expect(boom.deps.failed).toHaveBeenCalledTimes(1);
    expect(boom.snapshot()).toBe(BASE);
    expect(edit().editingId).toBeNull();
  });
  it('esc cancels; an unknown tag starts nothing', () => {
    const { actions, deps } = setup();
    actions.startRename('rec');
    actions.cancelRename();
    expect(edit().editingId).toBeNull();
    actions.startRename('gone');
    expect(edit().editingId).toBeNull();
    expect(deps.tags.rename).not.toHaveBeenCalled();
  });
});

describe('colours (spec 4.1: colour N = slot N)', () => {
  it('sets colour and slot in one call; the tag that held the slot loses both in the cache', async () => {
    const { actions, deps, snapshot } = setup();
    await actions.setColor('rec', 3);
    expect(deps.tags.setColor).toHaveBeenCalledExactlyOnceWith({ tagId: 'rec', color: 'green', position: 3 });
    expect(snapshot().tags.find((x) => x.id === 'rec')).toMatchObject({ color: 'green', position: 3 });
    expect(snapshot().tags.find((x) => x.id === 'imp')).toMatchObject({ color: null, position: null });
  });
  it('choosing the slot the tag already holds is no call', async () => {
    const { actions, deps } = setup();
    await actions.setColor('imp', 3);
    expect(deps.tags.setColor).not.toHaveBeenCalled();
  });
  it('clears colour and slot together, and only for a tag that has them', async () => {
    const { actions, deps, snapshot } = setup();
    await actions.clearColor('imp');
    expect(deps.tags.setColor).toHaveBeenCalledExactlyOnceWith({ tagId: 'imp', color: null, position: null });
    expect(snapshot().tags.find((x) => x.id === 'imp')).toMatchObject({ color: null, position: null });
    await actions.clearColor('rec');
    expect(deps.tags.setColor).toHaveBeenCalledTimes(1);
  });
  it('a refused call is told and the cache stays as it was', async () => {
    const { actions, deps, snapshot } = setup();
    deps.tags.setColor = vi.fn(async () => Promise.reject(new Error('x')));
    await actions.setColor('rec', 5);
    expect(deps.failed).toHaveBeenCalledTimes(1);
    expect(snapshot()).toBe(BASE);
  });
});

describe('deleting (spec 4.1)', () => {
  it('asks in the sheet\'s words with the number of items it comes off, then deletes it from the cache and the filter — there is no undo', async () => {
    const { actions, deps, snapshot } = setup();
    await actions.remove('imp');
    expect(deps.confirm).toHaveBeenCalledExactlyOnceWith({ message: '‘중요’ 태그를 삭제하겠습니까?', detail: '자료 2개에서 떼어집니다.', confirm: '삭제', caution: true });
    expect(deps.tags.remove).toHaveBeenCalledExactlyOnceWith({ tagId: 'imp' });
    expect(snapshot().tags.map((x) => x.id)).not.toContain('imp');
    expect(snapshot().tagged['imp']).toBeUndefined();
    expect(deps.leaveFilter).toHaveBeenCalledExactlyOnceWith('imp');
  });
  it('says so when it is on no item, and counts only the items the list has', async () => {
    const { actions, deps } = setup();
    await actions.remove('empty');
    expect(deps.confirm).toHaveBeenLastCalledWith({ message: '‘복습’ 태그를 삭제하겠습니까?', detail: '붙어 있는 자료가 없습니다.', confirm: '삭제', caution: true });
    const gone = setup({}, ITEMS.slice(0, 1)); // i2 is no longer in the list
    await gone.actions.remove('imp');
    expect(gone.deps.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ detail: '자료 1개에서 떼어집니다.' }));
  });
  it('cancelling the sheet, a refused delete and an unknown tag change nothing', async () => {
    const no = setup({ confirm: vi.fn(async () => false) });
    await no.actions.remove('imp');
    expect(no.deps.tags.remove).not.toHaveBeenCalled();
    const refused = setup();
    refused.deps.tags.remove = vi.fn(async () => Promise.reject(new Error('x')));
    await refused.actions.remove('imp');
    expect(refused.deps.failed).toHaveBeenCalledTimes(1);
    expect(refused.snapshot()).toBe(BASE);
    expect(refused.deps.leaveFilter).not.toHaveBeenCalled();
    const unknown = setup();
    await unknown.actions.remove('gone');
    expect(unknown.deps.confirm).not.toHaveBeenCalled();
  });
});

describe('1–8 (spec 4.2)', () => {
  it('a slot with no tag says so — with 이 or 가 by how the digit is read — and calls nothing', async () => {
    const { actions, deps } = setup();
    await actions.togglePosition(6, ['i1']);
    expect(deps.notice).toHaveBeenLastCalledWith(NOTICE('6이'));
    await actions.togglePosition(5, ['i1']);
    expect(deps.notice).toHaveBeenLastCalledWith(NOTICE('5가'));
    await actions.togglePosition(2, ['i1']);
    expect(deps.notice).toHaveBeenLastCalledWith(NOTICE('2가'));
    expect(deps.tags.togglePosition).not.toHaveBeenCalled();
  });
  it('puts the tag on the items, or takes it off when the database says every one had it, and the cache follows', async () => {
    const { actions, deps, snapshot } = setup();
    await actions.togglePosition(3, ['i3', 'i4']);
    expect(deps.tags.togglePosition).toHaveBeenCalledExactlyOnceWith({ position: 3, itemIds: ['i3', 'i4'] });
    expect(snapshot().tagged['imp']).toEqual(['i1', 'i2', 'i3', 'i4']);
    deps.tags.togglePosition = vi.fn(async () => ({ tagId: 'imp', assigned: false }));
    await actions.togglePosition(3, ['i1', 'i2']);
    expect(snapshot().tagged['imp']).toEqual(['i3', 'i4']);
  });
  it('an empty selection is nothing, and a database that finds no target says the slot is empty', async () => {
    const { actions, deps } = setup();
    await actions.togglePosition(3, []);
    expect(deps.tags.togglePosition).not.toHaveBeenCalled();
    deps.tags.togglePosition = vi.fn(async () => null);
    await actions.togglePosition(3, ['i1']);
    expect(deps.notice).toHaveBeenCalledTimes(1);
  });
  it('a refused call is told', async () => {
    const { actions, deps } = setup();
    deps.tags.togglePosition = vi.fn(async () => Promise.reject(new Error('x')));
    await actions.togglePosition(3, ['i1']);
    expect(deps.failed).toHaveBeenCalledTimes(1);
  });
  it('more than the channel takes at once: the model decides, and the items go in chunks of the limit', async () => {
    expect(TOGGLE_CHUNK).toBe(5000);
    const many = Array.from({ length: 5001 }, (_, i) => item(`b${i}`));
    const ids = many.map((m) => m.id);
    const none = setup({}, many, { ...BASE, tagged: {} });
    await none.actions.togglePosition(1, ids);
    expect(none.deps.tags.togglePosition).not.toHaveBeenCalled();
    expect(vi.mocked(none.deps.tags.assign).mock.calls.map(([i]) => [i.tagId, i.itemIds.length])).toEqual([['rng', 5000], ['rng', 1]]);
    expect(none.snapshot().tagged['rng']).toHaveLength(5001);
    const all = setup({}, many, { ...BASE, tagged: { rng: ids } });
    await all.actions.togglePosition(1, ids);
    expect(vi.mocked(all.deps.tags.unassign).mock.calls.map(([i]) => i.itemIds.length)).toEqual([5000, 1]);
    expect(all.snapshot().tagged['rng']).toBeUndefined();
  });
});
