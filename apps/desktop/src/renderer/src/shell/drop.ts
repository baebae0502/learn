import type { StorageMode } from '@learn/domain';
import { t } from '../strings';

export interface DropSummary {
  files: number;
  pdf: number;
  video: number;
  other: number;
}

/** DataTransferItem kinds/types during dragenter (Finder gives the MIME type from the extension). */
export function summarizeDrop(items: ReadonlyArray<{ kind: string; type: string }>): DropSummary {
  const s: DropSummary = { files: 0, pdf: 0, video: 0, other: 0 };
  for (const i of items) {
    if (i.kind !== 'file') continue;
    s.files++;
    if (i.type === 'application/pdf') s.pdf++;
    else if (i.type.startsWith('video/')) s.video++;
    else s.other++;
  }
  return s;
}

/** "파일 3개(PDF 2 · 동영상 1)"; other files are named only next to a known kind (alone they are just "파일 N개"). */
export function dropSummaryText(s: DropSummary): string {
  const known = s.pdf + s.video > 0;
  const parts = [s.pdf ? `${t.drop.pdf} ${s.pdf}` : '', s.video ? `${t.drop.video} ${s.video}` : '', known && s.other ? `${t.drop.other} ${s.other}` : ''].filter(Boolean);
  return parts.length ? `${t.drop.files(s.files)}(${parts.join(' · ')})` : t.drop.files(s.files);
}

/** What the handlers read from a DragEvent (a structural subset, so they can be tested without a DOM). */
export interface FileDrag {
  altKey: boolean;
  target: EventTarget | null;
  dataTransfer: {
    readonly types: readonly string[];
    readonly items: ArrayLike<{ readonly kind: string; readonly type: string }>;
    readonly files: ArrayLike<File>;
    dropEffect: string;
  } | null;
  preventDefault(): void;
}

/**
 * `paths`: the dropped files' locations on disk; `unresolved`: files whose location the renderer cannot read
 * (not from the file system, e.g. a synthetic or in-memory file).
 */
export type WindowDropHandler = (paths: string[], mode: StorageMode, unresolved: number) => void;

/** The overlay while a file drag is over the window: the mode the drop would take (⌥ = link) and the counts. */
export interface DropState {
  link: boolean;
  summary: DropSummary;
}

const hasFiles = (e: FileDrag) => e.dataTransfer?.types.includes('Files') ?? false;
/** An element that left the document gets no dragleave that would reach the window (the palette's scrim). */
const connected = (target: EventTarget) => (target as { isConnected?: boolean }).isConnected !== false;

/**
 * Finder → window (design-spec 7.2): window-level dragenter/dragover/dragleave/drop for the drop overlay. Drags
 * without files are left alone. The overlay goes when the drag has left every element it entered: dragenter and
 * dragleave come per element (the next element's enter before the last one's leave), so the elements are tracked, not
 * counted, and those that left the document meanwhile are dropped from the set.
 */
export function windowDropTarget(opts: {
  /** The overlay's state: shown (copy or link, with the counts) or gone (null). Called on changes only. */
  show(state: DropState | null): void;
  /** A file drag has come in: it is a new intent, so the ⌘K palette closes (as before a menu command). */
  entered(): void;
  drop: WindowDropHandler;
  pathForFile(file: File): string;
}) {
  const inside = new Set<EventTarget>();
  let state: DropState | null = null;
  const set = (next: DropState | null) => {
    state = next;
    opts.show(next);
  };
  const reset = () => {
    inside.clear();
    if (state) set(null);
  };
  const come = (e: FileDrag) => {
    if (e.target) inside.add(e.target);
    if (state) return;
    opts.entered();
    set({ link: e.altKey, summary: summarizeDrop(Array.from(e.dataTransfer?.items ?? [])) });
  };
  return {
    enter(e: FileDrag): void {
      if (!hasFiles(e)) return;
      e.preventDefault();
      come(e);
    },
    over(e: FileDrag): void {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = e.altKey ? 'link' : 'copy';
      // No dragenter when the window became a drop target in the middle of the drag (an import just ended).
      if (!state) come(e);
      else if (state.link !== e.altKey) set({ ...state, link: e.altKey });
    },
    leave(e: FileDrag): void {
      if (!hasFiles(e)) return;
      if (e.target) inside.delete(e.target);
      for (const target of inside) if (!connected(target)) inside.delete(target);
      if (inside.size === 0) reset();
    },
    drop(e: FileDrag): void {
      if (!hasFiles(e)) return;
      e.preventDefault();
      reset();
      const files = Array.from(e.dataTransfer!.files);
      const paths = files.map((f) => opts.pathForFile(f)).filter((p) => p.length > 0);
      opts.drop(paths, e.altKey ? 'linked' : 'managed', files.length - paths.length);
    },
    /** The window stopped being a drop target (or the overlay unmounted): no overlay, no drag remembered. */
    reset,
  };
}
