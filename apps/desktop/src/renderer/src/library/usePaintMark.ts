import { useLayoutEffect } from 'react';
import { perfMark, perfMarkLatest, type PerfMark } from '../ui/perfMarks';

/** Names already marked once in this window (the first rows after the list arrived). */
const firstMarked = new Set<PerfMark>();

/**
 * `learn:<name>` at the start of the frame that paints a commit in which `key` changed: the first animation frame after
 * the commit, whose paint follows its callbacks (spec 9: input → paint, sort → paint, list → first rows end there).
 * Keyed on identity: `key` must change only with what is drawn (useLibraryRows' memoised rows). `first` is also marked,
 * once per window. `null`: nothing is drawn yet (the table waits for its stored columns and sort), nothing is marked.
 * A window that draws no frames records nothing; it only measures.
 */
export function usePaintMark(name: PerfMark, key: unknown, first?: PerfMark): void {
  useLayoutEffect(() => {
    if (key === null) return;
    const id = requestAnimationFrame(() => {
      perfMarkLatest(name);
      if (first && !firstMarked.has(first)) {
        firstMarked.add(first);
        perfMark(first);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [name, key, first]);
}
