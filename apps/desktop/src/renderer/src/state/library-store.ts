import { create } from 'zustand';
import type { LibraryScope } from '@learn/domain';
import { saveSetting } from '../data/saveSetting';
import { SCOPE_ALL, sameScope } from '../organize/scope';
import type { SelectionState } from '../library/selectionModel';

/**
 * The library view's own state: the table's selection with its anchor and keyboard cursor now; the last opened row
 * and the quick search query; the edited item joins it as those features arrive. Commands and the item panel read the selection even
 * while the table is not mounted (the reader view).
 */
export interface LibraryState extends SelectionState {
  /** Replaces the selection (programmatic picks): the first id becomes the anchor and the cursor; none keeps the cursor. */
  setSelected(ids: Iterable<string>): void;
  /** The table's selection model step (selectionModel.ts). */
  setSelection(next: SelectionState): void;
  /** Keep only ids still shown (list change, search); an anchor or cursor that is gone goes too. */
  pruneSelected(shown: ReadonlySet<string>): void;
  /** The ids the last prune took out of the selection (a new set each time): told apart from a deselect by the user. */
  pruned: ReadonlySet<string>;
  /** The item the reader last opened, by whatever path (table, palette, import): the table shows its row on return. */
  lastOpenedId: string | null;
  setLastOpened(id: string | null): void;
  /** Quick search query, this session only (spec 4.1: a restart starts empty). */
  query: string;
  setQuery(q: string): void;
  /** The item whose info is being edited, or null (inspector/InfoEditor.tsx). */
  editingId: string | null;
  setEditing(id: string | null): void;
  /** The scope the table shows (spec 3.1), as chosen. What is shown when it cannot be (organize/scope.ts resolveScope) is not stored. */
  scope: LibraryScope;
  /** False until the stored view was checked against the collections and the list; the table and the window's ready mark wait. */
  scopeReady: boolean;
  /** Counts scope changes: the table goes back to the top (or to `revealOnScope`) when it moves. */
  scopeEpoch: number;
  /** The one row a scope change shows (setScope's keepSelected), or null for the top. */
  revealOnScope: string | null;
  /**
   * Shows another scope: the selection and the tag filter are emptied (the search query stays, spec 3.5) and the view is
   * remembered. `keepSelected` is the one exception — that item stays selected and is shown.
   */
  setScope(scope: LibraryScope, opts?: { keepSelected?: string }): void;
  /** Sets the stored view at start and marks the store ready; nothing is written back. */
  restoreScope(scope: LibraryScope): void;
  /** Tags that narrow the table: an item must have all of them (spec 4.3). Session only. */
  tagFilter: ReadonlySet<string>;
  toggleTagFilter(tagId: string): void;
  clearTagFilter(): void;
}

const NONE: ReadonlySet<string> = new Set();
const NO_TAGS: ReadonlySet<string> = new Set();
const same = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((id) => b.has(id));

export const useLibrary = create<LibraryState>()((set, get) => ({
  selected: NONE,
  anchorId: null,
  cursorId: null,
  pruned: NONE,
  lastOpenedId: null,
  query: '',
  editingId: null,
  scope: SCOPE_ALL,
  scopeReady: false,
  scopeEpoch: 0,
  revealOnScope: null,
  tagFilter: NO_TAGS,
  setScope: (scope, opts) => {
    const s = get();
    const keep = opts?.keepSelected ?? null;
    const moved = !sameScope(s.scope, scope);
    if (!moved && keep === null) return;
    set({
      scope,
      tagFilter: NO_TAGS,
      selected: keep === null ? NONE : new Set([keep]),
      anchorId: keep,
      cursorId: keep,
      scopeEpoch: s.scopeEpoch + 1,
      revealOnScope: keep,
    });
    if (moved) saveSetting('library.view', scope);
  },
  restoreScope: (scope) => set({ scope, scopeReady: true }),
  toggleTagFilter: (tagId) => {
    const next = new Set(get().tagFilter);
    if (!next.delete(tagId)) next.add(tagId);
    set({ tagFilter: next });
  },
  clearTagFilter: () => {
    if (get().tagFilter.size > 0) set({ tagFilter: NO_TAGS });
  },
  setEditing: (editingId) => set({ editingId }),
  setQuery: (query) => set({ query }),
  setLastOpened: (lastOpenedId) => set({ lastOpenedId }),
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
    set({ selected: kept.size === 0 ? NONE : kept, anchorId: keep(anchorId), cursorId: keep(cursorId), pruned: new Set([...selected].filter((id) => !shown.has(id))) });
  },
}));
