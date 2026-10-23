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
  | `toast:${string}`;

const IMPORT_MARKS: readonly PerfMark[] = ['import:start', 'import:sent', 'import:answered', 'import:listed', 'import:busy-text', 'import:end', 'toast:import-done'];

export function perfMark(name: PerfMark): void {
  try {
    performance.mark(`learn:${name}`);
  } catch {
    // No timeline: nothing to record.
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
