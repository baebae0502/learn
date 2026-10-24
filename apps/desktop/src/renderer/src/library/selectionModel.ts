/**
 * The table's selection model (M4 spec 3.3, design-spec 7.1; Finder's list view): pure, over the rows in the table's
 * order. The store (useLibrary) holds its state; the table turns clicks and keys into actions.
 */
export interface SelectionState {
  /** The selected item ids. */
  readonly selected: ReadonlySet<string>;
  /** Where ⇧-click and ⇧-arrows extend from: the row last picked without ⇧. */
  readonly anchorId: string | null;
  /** The keyboard cursor: the row the arrows move from, and the table's one focus target. */
  readonly cursorId: string | null;
}

export type Move = 'up' | 'down' | 'home' | 'end' | 'pageUp' | 'pageDown';

export type SelectAction =
  /** A press on a row: `toggle` is ⌘ on macOS and Ctrl elsewhere. */
  | { kind: 'click'; id: string; shift: boolean; toggle: boolean }
  /** A right-click (or ⌃-click on macOS) on a row: it selects first. */
  | { kind: 'contextMenu'; id: string }
  /** An arrow, Home/End or PageUp/PageDown; `extend` with ⇧; `page` = the rows a page moves. */
  | { kind: 'move'; to: Move; extend: boolean; page: number }
  /** ⌘A, or the edit menu's 모두 선택 while the table has the focus. */
  | { kind: 'all' }
  /** esc. */
  | { kind: 'clear' };

/** The rows in the table's order with each id's place: built once per row list (a lookup per key press stays O(1)). */
export interface RowOrder {
  readonly ids: readonly string[];
  /** The id's place, -1 when it is not shown (or null). */
  indexOf(id: string | null): number;
}

export function rowOrder(ids: readonly string[]): RowOrder {
  const at = new Map<string, number>();
  ids.forEach((id, i) => at.set(id, i));
  return { ids, indexOf: (id) => (id === null ? -1 : (at.get(id) ?? -1)) };
}

const only = (id: string): SelectionState => ({ selected: new Set([id]), anchorId: id, cursorId: id });

/** The ids from place a to place b, both included, in table order. */
const span = (order: RowOrder, a: number, b: number): readonly string[] => order.ids.slice(Math.min(a, b), Math.max(a, b) + 1);

/**
 * ⇧-click or ⇧-arrow to place `to`: the range from the anchor replaces the range the previous extension made (anchor to
 * cursor), and rows picked apart from it (⌘-click) stay — Finder, NSTableView. Without an anchor on screen the cursor
 * anchors, else the target itself.
 */
function extend(state: SelectionState, order: RowOrder, to: number): SelectionState {
  let anchor = order.indexOf(state.anchorId);
  if (anchor < 0) anchor = order.indexOf(state.cursorId);
  if (anchor < 0) anchor = to;
  const next = new Set(state.selected);
  const cursor = order.indexOf(state.cursorId);
  if (cursor >= 0) for (const id of span(order, anchor, cursor)) next.delete(id);
  for (const id of span(order, anchor, to)) next.add(id);
  return { selected: next, anchorId: order.ids[anchor]!, cursorId: order.ids[to]! };
}

/** Where a move lands; without a cursor ↓ (and a page down) starts at the first row and ↑ at the last. */
function target(to: Move, from: number, last: number, page: number): number {
  switch (to) {
    case 'home':
      return 0;
    case 'end':
      return last;
    case 'up':
      return from < 0 ? last : Math.max(0, from - 1);
    case 'down':
      return from < 0 ? 0 : Math.min(last, from + 1);
    case 'pageUp':
      return Math.max(0, Math.max(from, 0) - page);
    case 'pageDown':
      return from < 0 ? 0 : Math.min(last, from + page);
  }
}

/**
 * One step of the selection model:
 * - click = that row alone (it anchors); ⇧-click = the range from the anchor; ⌘/Ctrl-click = toggle that row (it anchors);
 * - right-click: a row outside the selection becomes the selection; inside, the selection stays and the row is the cursor;
 * - ↑ ↓ Home End PageUp PageDown = move and select that row alone; with ⇧ = extend from the anchor;
 * - ⌘A = every row (anchor and cursor stay); esc = nothing selected (the cursor stays where it is).
 * A row id that is not shown changes nothing. Unchanged parts keep their identity (the store's subscribers compare them).
 */
export function reduceSelection(state: SelectionState, action: SelectAction, order: RowOrder): SelectionState {
  const last = order.ids.length - 1;
  switch (action.kind) {
    case 'click': {
      const at = order.indexOf(action.id);
      if (at < 0) return state;
      if (action.shift) return extend(state, order, at);
      if (!action.toggle) return only(action.id);
      const next = new Set(state.selected);
      if (!next.delete(action.id)) next.add(action.id);
      return { selected: next, anchorId: action.id, cursorId: action.id };
    }
    case 'contextMenu':
      if (order.indexOf(action.id) < 0) return state;
      if (!state.selected.has(action.id)) return only(action.id);
      return state.cursorId === action.id ? state : { ...state, cursorId: action.id };
    case 'move': {
      if (last < 0) return state;
      const to = target(action.to, order.indexOf(state.cursorId), last, Math.max(1, action.page));
      return action.extend ? extend(state, order, to) : only(order.ids[to]!);
    }
    case 'all':
      return last < 0 ? state : { ...state, selected: new Set(order.ids) };
    case 'clear':
      return state.selected.size === 0 && state.anchorId === null ? state : { ...state, selected: new Set(), anchorId: null };
  }
}

/** The item ↩ opens: the selection when it is exactly one row (several tabs at once are M7, spec 3.3). */
export const openTarget = (selected: ReadonlySet<string>): string | null => (selected.size === 1 ? selected.values().next().value! : null);

/** The selected ids in table order (the item menu's targets). */
export const inOrder = (selected: ReadonlySet<string>, order: RowOrder): string[] => order.ids.filter((id) => selected.has(id));
