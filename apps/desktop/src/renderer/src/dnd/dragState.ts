import { useSyncExternalStore } from 'react';

export type DragKind = 'items' | 'collection' | 'tag';

export interface DragSnapshot {
  kind: DragKind | null;
  /** The rows being dragged, in table order. */
  itemIds: readonly string[];
  collectionId: string | null;
  tagId: string | null;
}

const IDLE: DragSnapshot = { kind: null, itemIds: [], collectionId: null, tagId: null };
let snapshot = IDLE;
let gate = true;
let files = false;
let alt = false;
let native = false;
let pointerDrop = false;
let dropFocus: string | null = null;
/** Whether the guard is for a drop (kept until the user's next input) or only for a drag that is over the row (gone with the drag). */
let dropped = false;
const listeners = new Set<() => void>();
const emit = () => {
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/** `<html data-dnd>` names the drag that is running: the styles and the tests read it, nothing else does. */
function show(kind: DragKind | null): void {
  if (typeof document === 'undefined') return; // unit tests have no document
  if (kind === null) delete document.documentElement.dataset['dnd'];
  else document.documentElement.dataset['dnd'] = kind;
}
function replace(next: DragSnapshot): void {
  snapshot = next;
  show(next.kind);
  emit();
}

/**
 * A drag of ours never carries Finder's files, and its ⌥ and native state are its own: what an earlier drag left behind (a Finder
 * drag that left the window sends no drop or dragend; a mouse drag whose source row unmounted ends at the detached row) is dropped.
 * A native drag sets `native` again after React Aria's start (events.ts).
 */
function begin(next: DragSnapshot): void {
  files = false;
  alt = false;
  native = false;
  replace(next);
}

/**
 * What the drag now running carries. React Aria's drop targets are asked whether they take a drag before anything can be
 * read from it (the data is sealed until the drop), and they are not told which collection or tag it is — so the
 * drag source says so here when it starts. Finder's files and ⌥ are written by the window listeners (events.ts).
 */
export const dragState = {
  get: (): DragSnapshot => snapshot,
  beginItems: (itemIds: readonly string[]) => begin({ ...IDLE, kind: 'items', itemIds }),
  beginCollection: (collectionId: string) => begin({ ...IDLE, kind: 'collection', collectionId }),
  beginTag: (tagId: string) => begin({ ...IDLE, kind: 'tag', tagId }),
  end: () => {
    if (!dropped) dropFocus = null; // a drag that ended without a drop on the row it hovered
    if (snapshot.kind !== null) replace(IDLE);
  },
  /**
   * React Aria's own end of a drag. A drag by keyboard has no native one, so this is its only end; but when a mouse drag's
   * source row leaves the page, React Aria reports the end (as a cancel) while the drag goes on, and that one is not an end.
   */
  endUnlessNative: () => {
    if (!native) dragState.end();
  },
  /**
   * The tree row a drag is over, which a drop there will be on. React Aria's drop handler runs after it has read the dropped items,
   * so a drop is handled — and `armDropFocus` called again — after its focus move may have happened already; the row is therefore
   * named while the drag is over it. React Aria moves the tree's focus to the dropped-on row, sometimes twice (a layout effect,
   * then its own 50 ms timer), and the sidebar takes focus for the view (selection follows the cursor): those moves are not the
   * user's choice. The guard stays until the user's next pointer or key outside a drag (`clearDropFocus`): no timer, and no input of
   * the user's is ever taken for the drop's.
   */
  armDropFocus: (key: string) => {
    dropFocus = key;
    dropped = true;
  },
  /** The drag is over the row `key`: guarded as a drop will be, but only until the drag leaves the row or ends without dropping. */
  hoverDropFocus: (key: string) => {
    dropFocus = key;
    dropped = false;
  },
  /** The drag left the row `key` (drop-exit): a drop's guard stays, a hover's goes. */
  leaveDropFocus: (key: string) => {
    if (!dropped && dropFocus === key) dropFocus = null;
  },
  /** The guard if `key` is the row dropped on; `pointer`: the drop was by mouse, so no keyboard ring and no scroll. */
  takeDropFocus: (key: string): { pointer: boolean } | null => (dropFocus === key ? { pointer: pointerDrop } : null),
  clearDropFocus: () => {
    dropFocus = null;
    dropped = false;
  },
  /** The drop now handled came from a native drop event (a mouse drag or Finder's files), not from React Aria's keyboard drag. */
  setPointerDrop: (v: boolean) => void (pointerDrop = v),
  native: () => native,
  setNative: (v: boolean) => void (native = v),
  filesOver: () => files,
  setFilesOver: (v: boolean) => void (files = v),
  alt: () => alt,
  setAlt: (v: boolean) => void (alt = v),
  subscribe,
};

/** A tag chip is being dragged: only then do the table's rows take drops (otherwise they would swallow Finder's files). */
export const useTagDragging = (): boolean => useSyncExternalStore(subscribe, () => snapshot.kind === 'tag');

/** Whether the window takes drops at all now: the library shows and nothing holds the window (MainWindow). */
export const useDndGate = (): boolean => useSyncExternalStore(subscribe, () => gate);
export function setDndGate(open: boolean): void {
  if (gate === open) return;
  gate = open;
  emit();
}
