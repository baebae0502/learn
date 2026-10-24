import { create } from 'zustand';
import type { SelectionState } from '../library/selectionModel';

/**
 * The library view's own state: the table's selection with its anchor and keyboard cursor now; the last opened row,
 * the query and the edited item join it as those features arrive. Commands and the item panel read the selection even
 * while the table is not mounted (the reader view).
 */
export interface LibraryState extends SelectionState {
  /** Replaces the selection (programmatic picks): the first id becomes the anchor and the cursor; none keeps the cursor. */
  setSelected(ids: Iterable<string>): void;
  /** The table's selection model step (selectionModel.ts). */
  setSelection(next: SelectionState): void;
  /** Keep only ids still shown (list change, search); an anchor or cursor that is gone goes too. */
  pruneSelected(shown: ReadonlySet<string>): void;
}

const NONE: ReadonlySet<string> = new Set();
const same = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((id) => b.has(id));

export const useLibrary = create<LibraryState>()((set, get) => ({
  selected: NONE,
  anchorId: null,
  cursorId: null,
  setSelected: (ids) => {
    const next = new Set(ids);
    if (same(next, get().selected)) return;
    const first: string | null = next.values().next().value ?? null;
    set({ selected: next.size === 0 ? NONE : next, anchorId: first, cursorId: first ?? get().cursorId });
  },
  setSelection: (next) => {
    const s = get();
    if (next.selected === s.selected && next.anchorId === s.anchorId && next.cursorId === s.cursorId) return;
    set({ selected: next.selected.size === 0 ? NONE : next.selected, anchorId: next.anchorId, cursorId: next.cursorId });
  },
  pruneSelected: (shown) => {
    const { selected, anchorId, cursorId } = get();
    const keep = (id: string | null) => (id !== null && shown.has(id) ? id : null);
    const kept = [...selected].every((id) => shown.has(id)) ? selected : new Set([...selected].filter((id) => shown.has(id)));
    if (kept === selected && keep(anchorId) === anchorId && keep(cursorId) === cursorId) return;
    set({ selected: kept.size === 0 ? NONE : kept, anchorId: keep(anchorId), cursorId: keep(cursorId) });
  },
}));
