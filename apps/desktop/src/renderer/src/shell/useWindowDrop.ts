import { useEffect } from 'react';
import type { StorageMode } from '@learn/domain';
import { api } from '../api';

const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;

/** Finder → window: copy, or link with ⌥ held (design-spec 7.2). The overlay arrives in Task 11. */
export function useWindowDrop(enabled: boolean, onDrop: (paths: string[], mode: StorageMode) => void): void {
  useEffect(() => {
    if (!enabled) return;
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = e.altKey ? 'link' : 'copy';
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      const paths = Array.from(e.dataTransfer!.files).map((f) => api().pathForFile(f)).filter((p) => p.length > 0);
      onDrop(paths, e.altKey ? 'linked' : 'managed');
    };
    addEventListener('dragover', over);
    addEventListener('drop', drop);
    return () => {
      removeEventListener('dragover', over);
      removeEventListener('drop', drop);
    };
  }, [enabled, onDrop]);
}
