import { useEffect } from 'react';
import type { StorageMode } from '@learn/domain';
import { api } from '../api';

/** What the handlers read from a DragEvent (a structural subset, so they can be tested without a DOM). */
export interface FileDrag {
  altKey: boolean;
  dataTransfer: { readonly types: readonly string[]; readonly files: ArrayLike<File>; dropEffect: string } | null;
  preventDefault(): void;
}

/**
 * `paths`: the dropped files' locations on disk; `unresolved`: files whose location the renderer cannot read
 * (not from the file system, e.g. a synthetic or in-memory file).
 */
export type WindowDropHandler = (paths: string[], mode: StorageMode, unresolved: number) => void;

const hasFiles = (e: FileDrag) => e.dataTransfer?.types.includes('Files') ?? false;

/** Finder → window: copy, or link with ⌥ held (design-spec 7.2). Drags without files are left alone. */
export function windowDropHandlers(onDrop: WindowDropHandler, pathForFile: (file: File) => string) {
  return {
    over(e: FileDrag): void {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = e.altKey ? 'link' : 'copy';
    },
    drop(e: FileDrag): void {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const files = Array.from(e.dataTransfer!.files);
      const paths = files.map((f) => pathForFile(f)).filter((p) => p.length > 0);
      onDrop(paths, e.altKey ? 'linked' : 'managed', files.length - paths.length);
    },
  };
}

/** Window-wide drop target while `enabled` (the library view, no import running). The overlay arrives in Task 11. */
export function useWindowDrop(enabled: boolean, onDrop: WindowDropHandler): void {
  useEffect(() => {
    if (!enabled) return;
    const h = windowDropHandlers(onDrop, (f) => api().pathForFile(f));
    const over = (e: DragEvent) => h.over(e);
    const drop = (e: DragEvent) => h.drop(e);
    addEventListener('dragover', over);
    addEventListener('drop', drop);
    return () => {
      removeEventListener('dragover', over);
      removeEventListener('drop', drop);
    };
  }, [enabled, onDrop]);
}
