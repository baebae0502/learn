import type { TextMainState } from '../../apps/desktop/src/main/test-hooks';
import type { TextSchedulerState } from '../../apps/desktop/src/main/text/scheduler';

/** What textState answers (main/test-hooks.ts): the body-text scheduler, and main's steps its first start waits on. */
export interface TextStateSnapshot {
  scheduler: TextSchedulerState;
  main: TextMainState | null;
}

/** textJobs as counts by state and attempts, e.g. { "done/1": 1001, "queued/0": 20 }. */
export function jobCounts(jobs: ReadonlyArray<{ state: string; attempts: number }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const j of jobs) counts[`${j.state}/${j.attempts}`] = (counts[`${j.state}/${j.attempts}`] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

const iso = (ms: number): string => (ms > 0 ? new Date(ms).toISOString() : '-');

/**
 * The snapshot as a failure message shows it: the scheduler's flags on one line, main's steps on the next (times as ISO,
 * '-' for a mark not reached), then the scheduler's trail, oldest first, one step a line.
 */
export function describeTextState(snapshot: TextStateSnapshot): string {
  const { events, ...flags } = snapshot.scheduler;
  const main = snapshot.main && {
    ...snapshot.main,
    checkStart: iso(snapshot.main.checkStart),
    checkEnd: iso(snapshot.main.checkEnd),
    firstIdle: snapshot.main.firstIdle && { ...snapshot.main.firstIdle, at: iso(snapshot.main.firstIdle.at) },
  };
  return [
    `scheduler: ${JSON.stringify(flags)}`,
    `main: ${JSON.stringify(main)}`,
    `events (oldest first, ${events.length}):`,
    ...events.map((e) => `  ${iso(e.at)} ${e.what}${e.detail === undefined ? '' : ` ${e.detail}`}`),
  ].join('\n');
}
