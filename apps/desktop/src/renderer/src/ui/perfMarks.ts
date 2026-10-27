/**
 * User Timing marks the evidence reads (tests/evidence/perf.evidence.ts, `learn:` marks), so a Mac run can show where
 * a drop's time goes (Mac run 3, critique n6: the screen held 0.55 s after a drop). For one drop, in order:
 * - `learn:drop`: the drop event reached the window;
 * - `learn:drop:clear`: the first painted frame without the overlay;
 * - `learn:import:start` / `learn:import:sent`: the import began / its request went to main;
 * - `learn:import:answered`: main answered; `learn:import:listed`: the list has what it brought;
 * - `learn:import:busy-text`: the first painted frame of "자료 N개를 가져오는 중…", only when it showed;
 * - `learn:toast:import-done`: the success toast's first painted frame; `learn:import:end`: the import let go.
 * A new drop or import clears the previous set, so the timeline holds the last one only.
 * The table and the item panel (spec 9 budgets; perfMarkLatest, one each):
 * - `learn:table:render`: the library view began a render; `learn:inspector:render`: the item panel did;
 * - `learn:table:painted`: the frame that paints rows that changed has begun (usePaintMark);
 * - `learn:table:first-paint`: the same, once per window — the first rows after the list arrived.
 * Drag and drop (spec 12 "100행 드롭 → 대상 개수"):
 * - `learn:dnd:drop`: the drop's handler began (rows onto a collection, a tag onto rows);
 * - `learn:dnd:filed`: the memberships or tags are in the cache — the sidebar's counts (`nav-collection-<id> .count`) draw next;
 * - `learn:dnd:preview` (a measure): building the drag image of a row drag.
 */
export type PerfMark =
  | 'drop'
  | 'drop:clear'
  | 'import:start'
  | 'import:sent'
  | 'import:answered'
  | 'import:listed'
  | 'import:busy-text'
  | 'import:end'
  | 'table:render'
  | 'table:painted'
  | 'table:first-paint'
  | 'inspector:render'
  | 'dnd:drop'
  | 'dnd:filed'
  | `toast:${string}`;

/** Timed calls (performance.measure): one quick search over the library, and building its index (spec 9). */
export type PerfMeasure = 'search' | 'search:index' | 'dnd:preview';

const IMPORT_MARKS: readonly PerfMark[] = ['import:start', 'import:sent', 'import:answered', 'import:listed', 'import:busy-text', 'import:end', 'toast:import-done'];

export function perfMark(name: PerfMark): void {
  try {
    performance.mark(`learn:${name}`);
  } catch {
    // No timeline: nothing to record.
  }
}

/** A mark that recurs with every search, sort or list change: only the newest is kept, so a long session holds one. */
export function perfMarkLatest(name: PerfMark): void {
  try {
    performance.clearMarks(`learn:${name}`);
    performance.mark(`learn:${name}`);
  } catch {
    // No timeline.
  }
}

/** Runs `run` and records how long it took as the measure `learn:<name>` (the newest only); its result or throw passes through. */
export function timed<T>(name: PerfMeasure, run: () => T): T {
  const start = performance.now();
  try {
    return run();
  } finally {
    try {
      performance.clearMeasures(`learn:${name}`);
      performance.measure(`learn:${name}`, { start, end: performance.now() });
    } catch {
      // No timeline.
    }
  }
}

/** Forgets the marks of an earlier import; `drop` also those of an earlier drop. */
export function clearImportMarks(drop = false): void {
  try {
    for (const name of drop ? ['drop', 'drop:clear', ...IMPORT_MARKS] : IMPORT_MARKS) performance.clearMarks(`learn:${name}`);
  } catch {
    // No timeline.
  }
}
