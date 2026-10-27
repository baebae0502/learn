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
let droppedAt = Number.NEGATIVE_INFINITY;
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
 * What the drag now running carries. React Aria's drop targets are asked whether they take a drag before anything can be
 * read from it (the data is sealed until the drop), and they are not told which collection or tag it is — so the
 * drag source says so here when it starts. Finder's files and ⌥ are written by the window listeners (events.ts).
 */
export const dragState = {
  get: (): DragSnapshot => snapshot,
  beginItems: (itemIds: readonly string[]) => replace({ ...IDLE, kind: 'items', itemIds }),
  beginCollection: (collectionId: string) => replace({ ...IDLE, kind: 'collection', collectionId }),
  beginTag: (tagId: string) => replace({ ...IDLE, kind: 'tag', tagId }),
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
   * A drop on the sidebar's tree was handled. React Aria then moves the tree's focus to the row dropped on, and the sidebar
   * takes focus for the view (selection follows the cursor): for the next moments that focus is not the user's choice.
   */
  markDrop: () => void (droppedAt = performance.now()),
  justDropped: (withinMs = 500): boolean => performance.now() - droppedAt < withinMs,
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
