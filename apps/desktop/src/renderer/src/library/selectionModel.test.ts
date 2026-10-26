import { describe, expect, it } from 'vitest';
import { inOrder, openTarget, reduceSelection, rowOrder, type SelectAction, type SelectionState } from './selectionModel';

// Rows a … h in table order.
const order = rowOrder(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
const NONE: SelectionState = { selected: new Set(), anchorId: null, cursorId: null };
/** Runs the actions from `start`; returns the selection (in table order), the anchor and the cursor. */
function run(actions: readonly SelectAction[], start: SelectionState = NONE) {
  const s = actions.reduce((state, a) => reduceSelection(state, a, order), start);
  return { selected: inOrder(s.selected, order), anchor: s.anchorId, cursor: s.cursorId };
}
const click = (id: string, mods: { shift?: boolean; toggle?: boolean } = {}): SelectAction => ({ kind: 'click', id, shift: mods.shift ?? false, toggle: mods.toggle ?? false });
const move = (to: 'up' | 'down' | 'home' | 'end' | 'pageUp' | 'pageDown', extend = false, page = 3): SelectAction => ({ kind: 'move', to, extend, page });

describe('the table selection model (M4 spec 3.3, design-spec 7.1)', () => {
  it('a click selects that row alone; it becomes the anchor and the cursor', () => {
    expect(run([click('c')])).toEqual({ selected: ['c'], anchor: 'c', cursor: 'c' });
    expect(run([click('c'), click('f')])).toEqual({ selected: ['f'], anchor: 'f', cursor: 'f' });
  });
  it('⇧-click selects the range from the anchor, either way, and the anchor stays', () => {
    expect(run([click('c'), click('f', { shift: true })])).toEqual({ selected: ['c', 'd', 'e', 'f'], anchor: 'c', cursor: 'f' });
    expect(run([click('c'), click('f', { shift: true }), click('a', { shift: true })])).toEqual({ selected: ['a', 'b', 'c'], anchor: 'c', cursor: 'a' });
  });
  it('⌘/Ctrl-click toggles one row and moves the anchor there; a later ⇧-click keeps the rows picked apart', () => {
    expect(run([click('b'), click('e', { toggle: true })])).toEqual({ selected: ['b', 'e'], anchor: 'e', cursor: 'e' });
    expect(run([click('b'), click('e', { toggle: true }), click('b', { toggle: true })])).toEqual({ selected: ['e'], anchor: 'b', cursor: 'b' });
    expect(run([click('a'), click('e', { toggle: true }), click('g', { shift: true })])).toEqual({ selected: ['a', 'e', 'f', 'g'], anchor: 'e', cursor: 'g' });
  });
  it('⇧-click with no anchor on screen extends from the cursor, else selects the row', () => {
    expect(run([click('d', { shift: true })])).toEqual({ selected: ['d'], anchor: 'd', cursor: 'd' });
    expect(run([click('f', { shift: true })], { selected: new Set(), anchorId: 'gone', cursorId: 'b' })).toEqual({ selected: ['b', 'c', 'd', 'e', 'f'], anchor: 'b', cursor: 'f' });
  });
  it('↑ / ↓ move the cursor and select that row alone; they stop at the ends', () => {
    expect(run([click('c'), move('down')])).toEqual({ selected: ['d'], anchor: 'd', cursor: 'd' });
    expect(run([click('c'), move('up'), move('up'), move('up')])).toEqual({ selected: ['a'], anchor: 'a', cursor: 'a' });
    expect(run([click('h'), move('down')])).toEqual({ selected: ['h'], anchor: 'h', cursor: 'h' });
  });
  it('with no cursor yet ↓ starts at the first row and ↑ at the last', () => {
    expect(run([move('down')])).toEqual({ selected: ['a'], anchor: 'a', cursor: 'a' });
    expect(run([move('up')])).toEqual({ selected: ['h'], anchor: 'h', cursor: 'h' });
  });
  it('⇧↑ / ⇧↓ extend from the anchor, and shrink back over it', () => {
    expect(run([click('c'), move('down', true), move('down', true)])).toEqual({ selected: ['c', 'd', 'e'], anchor: 'c', cursor: 'e' });
    expect(run([click('c'), move('down', true), move('up', true), move('up', true)])).toEqual({ selected: ['b', 'c'], anchor: 'c', cursor: 'b' });
  });
  it('Home / End go to the first / last row; with ⇧ they extend to it', () => {
    expect(run([click('d'), move('end')])).toEqual({ selected: ['h'], anchor: 'h', cursor: 'h' });
    expect(run([click('d'), move('home')])).toEqual({ selected: ['a'], anchor: 'a', cursor: 'a' });
    expect(run([click('f'), move('home', true)])).toEqual({ selected: ['a', 'b', 'c', 'd', 'e', 'f'], anchor: 'f', cursor: 'a' });
  });
  it('PageUp / PageDown move by the rows a page shows, stopping at the ends; with ⇧ they extend', () => {
    expect(run([click('b'), move('pageDown')])).toEqual({ selected: ['e'], anchor: 'e', cursor: 'e' });
    expect(run([click('g'), move('pageDown')])).toEqual({ selected: ['h'], anchor: 'h', cursor: 'h' });
    expect(run([click('g'), move('pageUp')])).toEqual({ selected: ['d'], anchor: 'd', cursor: 'd' });
    expect(run([click('b'), move('pageUp')])).toEqual({ selected: ['a'], anchor: 'a', cursor: 'a' });
    expect(run([click('b'), move('pageDown', true)])).toEqual({ selected: ['b', 'c', 'd', 'e'], anchor: 'b', cursor: 'e' });
  });
  it('⌘A selects every row and keeps the anchor and the cursor; esc clears the selection and keeps the cursor', () => {
    expect(run([click('c'), { kind: 'all' }])).toEqual({ selected: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], anchor: 'c', cursor: 'c' });
    expect(run([click('c'), { kind: 'all' }, { kind: 'clear' }])).toEqual({ selected: [], anchor: null, cursor: 'c' });
    expect(run([click('c'), { kind: 'clear' }, move('down')])).toEqual({ selected: ['d'], anchor: 'd', cursor: 'd' });
  });
  it('right-click outside the selection selects that row alone; inside it keeps the selection and only moves the cursor', () => {
    const pair = reduceSelection(reduceSelection(NONE, click('b'), order), click('d', { toggle: true }), order);
    expect(run([{ kind: 'contextMenu', id: 'f' }], pair)).toEqual({ selected: ['f'], anchor: 'f', cursor: 'f' });
    const inside = reduceSelection(pair, { kind: 'contextMenu', id: 'b' }, order);
    expect(inside.selected).toBe(pair.selected); // same set: nothing redraws for a selection that did not change
    expect({ anchor: inside.anchorId, cursor: inside.cursorId }).toEqual({ anchor: 'd', cursor: 'b' });
  });
  it('an id that is not shown, or a table with no rows, changes nothing', () => {
    const one = reduceSelection(NONE, click('c'), order);
    for (const a of [click('zz'), { kind: 'contextMenu', id: 'zz' } as const]) expect(reduceSelection(one, a, order)).toBe(one);
    const empty = rowOrder([]);
    for (const a of [move('down'), { kind: 'all' } as const]) expect(reduceSelection(NONE, a, empty)).toBe(NONE);
    expect(reduceSelection(NONE, { kind: 'clear' }, order)).toBe(NONE);
  });
  it('↩ opens only a selection of one; the menu gets the selected ids in table order', () => {
    expect(openTarget(new Set(['c']))).toBe('c');
    expect(openTarget(new Set())).toBeNull();
    expect(openTarget(new Set(['c', 'a']))).toBeNull();
    expect(inOrder(new Set(['f', 'a', 'c']), order)).toEqual(['a', 'c', 'f']);
    expect(order.indexOf('d')).toBe(3);
    expect(order.indexOf('zz')).toBe(-1);
    expect(order.indexOf(null)).toBe(-1);
  });
});
