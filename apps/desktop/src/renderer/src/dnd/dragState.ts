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
/** Puts the tree's cursor back where the drop's capture took it from (`parkCursor`). */
let parked: (() => void) | null = null;
/** Parks the tree's cursor when React Aria asks the tree for the operation of a keyboard drop expected in this event. */
let keyboardPark: (() => void) | null = null;
function unpark(): void {
  const restore = parked;
  parked = null;
  restore?.();
}
const listeners = new Set<() => void>();
const emit = () => {
  for (const fn of listeners) fn();
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

/**
 * `<html data-dnd>` names the drag that is running — ours, or `files` while Finder's are over the window: the styles and the
 * tests read it, nothing else does.
 */
function show(): void {
  const root = typeof document === 'undefined' ? undefined : document.documentElement;
  if (!root) return; // unit tests have no document, or a stub without one
  const kind = snapshot.kind ?? (files ? 'files' : null);
  if (kind === null) delete root.dataset['dnd'];
  else root.dataset['dnd'] = kind;
}
function replace(next: DragSnapshot): void {
  snapshot = next;
  show();
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
    keyboardPark = null;
    unpark();
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
   * The drop on the tree row `key` is handed over (onItemDrop, which React Aria calls in the drop's own event, right after it has
   * recorded the drop). React Aria then moves the tree's cursor to that row with the keyboard modality — on each render once the
   * rows have changed, and again on its own 50 ms timer — and the sidebar takes the focus for the view (selection follows the
   * cursor): those moves are not the user's choice. The guard stays until the user's next pointer or key outside a drag
   * (`clearDropFocus`): no timer, and no input of the user's is ever taken for the drop's. A cursor parked for the drop goes back.
   */
  armDropFocus: (key: string) => {
    dropFocus = key;
    dropped = true;
    unpark();
  },
  /** The drag is over the row `key`: guarded as a drop will be, but only until the drag leaves the row or ends without dropping. */
  hoverDropFocus: (key: string) => {
    dropFocus = key;
    dropped = false;
  },
  /** The drag left the row `key` (drop-exit, which also follows each drop): a drop's guard stays, a hover's goes. */
  leaveDropFocus: (key: string) => {
    unpark();
    if (!dropped && dropFocus === key) dropFocus = null;
  },
  /**
   * A drop on a tree row is coming — the native drop event (a mouse drag, Finder's files), ↩ released or a screen reader's click
   * in a keyboard drag — and the sidebar has taken its cursor off the rows while React Aria records it; `restore` puts it on the
   * viewed row again. React Aria moves the cursor to the dropped-on row, and turns the keyboard modality on, only while it finds
   * the cursor where it was when it recorded the drop (useDroppableCollection's updateFocusAfterDrop): a cursor that has moved
   * since is left alone. It goes back once: when the drop is handed over (`armDropFocus`, in the drop's own event), else on the
   * drop-exit that follows a drop, or at the drag's end (a keyboard drop ends its drag in the same event).
   */
  parkCursor: (restore: () => void) => {
    parked = restore;
  },
  /**
   * ↩ released, or a screen reader's click, in a keyboard drag: React Aria's DragManager may drop in this same event. It asks the
   * target for the drop's operation and records the cursor right after, in one go: `park` runs then (`dropOperationAsked`), not
   * earlier — React would draw the parked cursor first, and the viewed row, the drag's source, which is kept on the page only as
   * the cursor's row when it is out of sight, would leave it and end the drag. Null forgets it; so does the drag's end.
   */
  expectKeyboardDrop: (park: (() => void) | null) => {
    keyboardPark = park;
  },
  /** React Aria asks the tree for the operation of a drop on a row (treeDnd's getDropOperation). */
  dropOperationAsked: () => {
    const park = keyboardPark;
    keyboardPark = null;
    park?.();
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
  setFilesOver: (v: boolean) => {
    if (files === v) return;
    files = v;
    show();
  },
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
