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
let dropFocus: { key: string; pointer: boolean } | null = null;
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
   * A drop on the sidebar's tree was handled on row `key`. React Aria then moves the tree's focus to that row, and the sidebar
   * takes focus for the view (selection follows the cursor): that one focus move is not the user's choice. It is taken once, by
   * the focus on `key` (`takeDropFocus`), and forgotten at the user's next pointer or key (`clearDropFocus`) — no timer.
   */
  armDropFocus: (key: string) => void (dropFocus = { key, pointer: pointerDrop }),
  /** The guard if `key` is the row dropped on (and then it is spent); `pointer`: the drop was by mouse, so no keyboard ring and no scroll. */
  takeDropFocus: (key: string): { pointer: boolean } | null => {
    if (dropFocus?.key !== key) return null;
    const { pointer } = dropFocus;
    dropFocus = null;
    return { pointer };
  },
  clearDropFocus: () => void (dropFocus = null),
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
