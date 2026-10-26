import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../data/saveSetting', () => ({ saveSetting: vi.fn() }));
const { saveSetting } = await import('../data/saveSetting');
import { useLibrary } from './library-store';

beforeEach(() => useLibrary.setState({ selected: new Set(), anchorId: null, cursorId: null }));
const now = () => {
  const s = useLibrary.getState();
  return { selected: [...s.selected], anchor: s.anchorId, cursor: s.cursorId };
};

describe('library selection store (M4 spec 3.3)', () => {
  it('replaces the selection with the given ids, once each; the first anchors and takes the cursor', () => {
    useLibrary.getState().setSelected(['a', 'b', 'a']);
    expect(now()).toEqual({ selected: ['a', 'b'], anchor: 'a', cursor: 'a' });
    useLibrary.getState().setSelected([]);
    expect(now()).toEqual({ selected: [], anchor: null, cursor: 'a' }); // the keyboard cursor stays where it was
  });
  it('keeps the same set when nothing changed, so subscribers do not redraw for a repeated pick', () => {
    useLibrary.getState().setSelected(['a', 'b']);
    const before = useLibrary.getState().selected;
    useLibrary.getState().setSelected(['b', 'a']);
    expect(useLibrary.getState().selected).toBe(before);
  });
  it("takes the table model's step whole, and nothing when it is the same", () => {
    const selected = new Set(['c', 'd']);
    useLibrary.getState().setSelection({ selected, anchorId: 'c', cursorId: 'd' });
    expect(now()).toEqual({ selected: ['c', 'd'], anchor: 'c', cursor: 'd' });
    expect(useLibrary.getState().selected).toBe(selected);
    const state = useLibrary.getState();
    useLibrary.getState().setSelection({ selected, anchorId: 'c', cursorId: 'd' });
    expect(useLibrary.getState()).toBe(state);
  });
  it('prunes the ids no longer shown, the anchor and the cursor with them, and makes a new set only then', () => {
    useLibrary.getState().setSelection({ selected: new Set(['a', 'b', 'c']), anchorId: 'a', cursorId: 'c' });
    const before = useLibrary.getState().selected;
    useLibrary.getState().pruneSelected(new Set(['a', 'b', 'c', 'd']));
    expect(useLibrary.getState().selected).toBe(before);
    useLibrary.getState().pruneSelected(new Set(['b', 'd']));
    expect(now()).toEqual({ selected: ['b'], anchor: null, cursor: null });
  });
  it('remembers the item the reader opened last (the table shows its row on return)', () => {
    useLibrary.getState().setLastOpened('x');
    expect(useLibrary.getState().lastOpenedId).toBe('x');
    useLibrary.getState().setLastOpened(null);
    expect(useLibrary.getState().lastOpenedId).toBeNull();
  });
});
describe('the library scope (spec 3.1, 3.5)', () => {
  const COLLECTION = { kind: 'collection', id: 'c1' } as const;
  beforeEach(() => {
    vi.mocked(saveSetting).mockClear();
    useLibrary.setState({
      scope: { kind: 'all' }, scopeReady: true, scopeEpoch: 0, revealOnScope: null, tagFilter: new Set(),
      selected: new Set(['a', 'b']), anchorId: 'a', cursorId: 'b',
    });
  });

  it('starts at all, and not ready until the stored view was checked', () => {
    useLibrary.setState({ scopeReady: false });
    expect(useLibrary.getState().scope).toEqual({ kind: 'all' });
    expect(useLibrary.getState().scopeReady).toBe(false);
  });
  it('changing the scope empties the selection and the tag filter, keeps the search query, and remembers the view', () => {
    useLibrary.setState({ tagFilter: new Set(['t1']), query: '신호' });
    useLibrary.getState().setScope(COLLECTION);
    const s = useLibrary.getState();
    expect(s.scope).toEqual(COLLECTION);
    expect([...s.selected]).toEqual([]);
    expect([s.anchorId, s.cursorId]).toEqual([null, null]);
    expect(s.tagFilter.size).toBe(0);
    expect(s.query).toBe('신호');
    expect(s.scopeEpoch).toBe(1);
    expect(saveSetting).toHaveBeenCalledWith('library.view', COLLECTION);
  });
  it('choosing the scope already shown changes nothing and writes nothing', () => {
    useLibrary.getState().setScope({ kind: 'all' });
    expect([...useLibrary.getState().selected]).toEqual(['a', 'b']);
    expect(useLibrary.getState().scopeEpoch).toBe(0);
    expect(saveSetting).not.toHaveBeenCalled();
  });
  it('keepSelected is the one exception: that item stays selected and is the row to show', () => {
    useLibrary.getState().setScope(COLLECTION, { keepSelected: 'b' });
    const s = useLibrary.getState();
    expect([...s.selected]).toEqual(['b']);
    expect([s.anchorId, s.cursorId, s.revealOnScope]).toEqual(['b', 'b', 'b']);
    useLibrary.getState().setScope({ kind: 'recent' });
    expect(useLibrary.getState().revealOnScope).toBeNull();
  });
  it('restoring the stored view sets it and makes the store ready without writing it back', () => {
    useLibrary.setState({ scopeReady: false });
    useLibrary.getState().restoreScope(COLLECTION);
    expect(useLibrary.getState().scope).toEqual(COLLECTION);
    expect(useLibrary.getState().scopeReady).toBe(true);
    expect(useLibrary.getState().scopeEpoch).toBe(0); // the table has not drawn another view yet: nothing to scroll
    expect(saveSetting).not.toHaveBeenCalled();
  });
});

describe('the tag filter (spec 4.3)', () => {
  beforeEach(() => useLibrary.setState({ tagFilter: new Set() }));
  it('toggles a tag in and out of the filter, a new set each time', () => {
    const empty = useLibrary.getState().tagFilter;
    useLibrary.getState().toggleTagFilter('t1');
    useLibrary.getState().toggleTagFilter('t2');
    expect([...useLibrary.getState().tagFilter]).toEqual(['t1', 't2']);
    expect(useLibrary.getState().tagFilter).not.toBe(empty);
    useLibrary.getState().toggleTagFilter('t1');
    expect([...useLibrary.getState().tagFilter]).toEqual(['t2']);
  });
  it('clearing an empty filter keeps the same set, so nothing redraws', () => {
    const before = useLibrary.getState().tagFilter;
    useLibrary.getState().clearTagFilter();
    expect(useLibrary.getState().tagFilter).toBe(before);
    useLibrary.getState().toggleTagFilter('t1');
    useLibrary.getState().clearTagFilter();
    expect(useLibrary.getState().tagFilter.size).toBe(0);
  });
});

describe('the tag filter loses a tag that is gone (spec 4.1)', () => {
  beforeEach(() => useLibrary.setState({ tagFilter: new Set(['t1', 't2']) }));
  it('drops a deleted tag from the filter', () => {
    useLibrary.getState().dropFromTagFilter('t1');
    expect([...useLibrary.getState().tagFilter]).toEqual(['t2']);
  });
  it('hands the place of a merged tag to the tag that remains, once', () => {
    useLibrary.getState().dropFromTagFilter('t1', 't9');
    expect([...useLibrary.getState().tagFilter].sort()).toEqual(['t2', 't9']);
    useLibrary.setState({ tagFilter: new Set(['t1', 't9']) });
    useLibrary.getState().dropFromTagFilter('t1', 't9');
    expect([...useLibrary.getState().tagFilter]).toEqual(['t9']);
  });
  it('is a no-op, with the same set, for a tag that was not in it', () => {
    const before = useLibrary.getState().tagFilter;
    useLibrary.getState().dropFromTagFilter('zz', 't9');
    expect(useLibrary.getState().tagFilter).toBe(before);
  });
});
