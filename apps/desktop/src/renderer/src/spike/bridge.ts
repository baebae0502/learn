// The spike's shared state and measuring window (window.__dnd), read by tests/evidence/dnd-spike.evidence.ts.
import { MIME_ITEMS } from './data';

export interface DropRecord {
  target: string;
  /** What RAC's drop event said. */
  operation: string;
  ids: string[];
  /** Our own tracker: the metaKey of the last dragover before the drop, and the dataTransfer.dropEffect the drop event saw. */
  meta: boolean;
  shift: boolean;
  effect: string;
  at: number;
}

export interface Bridge {
  /** Rows: ids a drag of `rowId` carries (selection in table order; a row outside the selection is picked first). */
  dragItems(rowId: string): string[];
  /** Pin the dragged row's index in the virtualizer while a drag runs (R2 mitigation, toggled by the test). */
  pin: boolean;
  draggingRowId: string | null;
  draggingCollectionId: string | null;
  starts: Array<{ ids: number; pointerToDone: number; getItems: number; preview: number; moveAt: number; doneAt: number }>;
  ends: Array<{ at: number; op: string }>;
  drops: DropRecord[];
  /** The last dragover's modifiers (window capture). */
  lastMeta: boolean;
  lastShift: boolean;
  lastPointerMove: number;
  /** Handler timings (performance.now deltas, ms). */
  overMs: number[];
  overOtherMs: number[];
  dropMs: number[];
  /** Tag drops on rows: tag id → row id + the ids it applies to. */
  tagDrops: Array<{ tagId: string; rowId: string; applied: string[] }>;
  /** Free-form event log for debugging. */
  log: string[];
  dragging: boolean;
  dropStart: number;
  lastEnterAt: number;
  lastEnterAlt: boolean;
  actions: Array<{ id: string; by: string }>;
  nativeDragends: number;
  dropTypes: string[];
  dropPayload: string;
  previews: Array<{ title: string; badge: string | null }>;
  /** A tag chip drag is running: rows take drops only then (RAC's row useDrop would otherwise swallow every dragover, Finder files included). */
  tagDragging: boolean;
  subscribe(fn: () => void): () => void;
  setTagDragging(on: boolean): void;
  /** Command keys that reached the keymap stand-in during a drag / outside one. */
  keymap: { fired: number; blocked: number };
  /** Filled by the page. */
  api: Record<string, (...a: never[]) => unknown>;
}

const listeners = new Set<() => void>();

export const bridge: Bridge = {
  dragItems: () => [],
  pin: false,
  draggingRowId: null,
  draggingCollectionId: null,
  starts: [],
  ends: [],
  drops: [],
  lastMeta: false,
  lastShift: false,
  lastPointerMove: 0,
  overMs: [],
  overOtherMs: [],
  dropMs: [],
  tagDrops: [],
  log: [],
  dragging: false,
  dropStart: 0,
  lastEnterAt: -1e9,
  lastEnterAlt: false,
  actions: [],
  nativeDragends: 0,
  dropTypes: [],
  dropPayload: '',
  previews: [],
  tagDragging: false,
  subscribe: (fn) => {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  setTagDragging: (on) => {
    bridge.tagDragging = on;
    for (const fn of listeners) fn();
  },
  keymap: { fired: 0, blocked: 0 },
  api: {},
};

declare global {
  interface Window {
    __dnd?: Bridge;
  }
}
window.__dnd = bridge;

/** The payload of a row drag: one drag item carrying our MIME. */
export const itemsPayload = (ids: readonly string[]) => ({ [MIME_ITEMS]: JSON.stringify({ itemIds: ids }), 'text/plain': `자료 ${ids.length}개` });

// Modifier tracker and handler timing: capture listeners on window, before any component's.
const track = (e: DragEvent) => {
  bridge.lastMeta = e.metaKey;
  bridge.lastShift = e.shiftKey;
};
window.addEventListener('dragenter', track, true);
window.addEventListener('dragover', track, true);
window.addEventListener('pointermove', (e) => void (bridge.lastPointerMove = e.timeStamp), true);
window.addEventListener('dragstart', () => void (bridge.dragging = true), true);
window.addEventListener('dragend', () => void (bridge.dragging = false), true);
