import { beforeEach, describe, expect, it } from 'vitest';
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
