import { LearnError } from '@learn/domain';
import { mainStrings } from '../strings';

/** What the work line runs (spec 3.1). */
export type JobKind = 'import' | 'backup' | 'restore';

export interface JobLane {
  /**
   * Runs `work` once every job asked for before it has ended, and settles as it does. Its signal aborts on
   * cancelCurrent or cancelAll: the work stops at its next checkpoint. A job cancelAll drops before it started rejects
   * with CANCELLED, and its work never runs.
   */
  run<T>(kind: JobKind, work: (signal: AbortSignal) => Promise<T>): Promise<T>;
  /** The running job's kind (from the moment it is asked for on an idle line); null when nothing runs. */
  busy(): JobKind | null;
  /** Aborts the running job's signal; the jobs waiting behind it still run. */
  cancelCurrent(): void;
  /** Quitting: aborts the running job and drops every waiting one. */
  cancelAll(): void;
  /** Resolves once nothing runs and nothing waits (at once when idle). */
  idle(): Promise<void>;
}

interface Waiting {
  start(): void;
  drop(reason: unknown): void;
}

/**
 * The main process's one work line (`library-jobs`): imports, backups and restores, one at a time, in the order asked —
 * one writer to the library and a predictable disk.
 */
export function createJobLane(): JobLane {
  const waiting: Waiting[] = [];
  let current: { kind: JobKind; abort: AbortController } | null = null;
  let idleWaiters: Array<() => void> = [];

  const next = (): void => {
    if (current !== null) return;
    const job = waiting.shift();
    if (job) {
      job.start();
      return;
    }
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiters) resolve();
  };

  return {
    run<T>(kind: JobKind, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        waiting.push({
          start: () => {
            const abort = new AbortController();
            current = { kind, abort };
            // On a later microtask: the caller's own bookkeeping after run() returns comes first, and a work that
            // throws at once is a rejection like any other.
            // The line is free before the caller hears: its continuation sees busy() null.
            const end = (settle: () => void): void => {
              current = null;
              settle();
              next();
            };
            Promise.resolve()
              .then(() => work(abort.signal))
              .then(
                (value) => end(() => resolve(value)),
                (error: unknown) => end(() => reject(error)),
              );
          },
          drop: reject,
        });
        next();
      });
    },
    busy: () => current?.kind ?? null,
    cancelCurrent: () => current?.abort.abort(),
    cancelAll() {
      for (const job of waiting.splice(0)) job.drop(new LearnError('CANCELLED', mainStrings.jobs.cancelled));
      current?.abort.abort();
      next(); // with nothing running, the idle waiters hear it now
    },
    idle: () => (current === null && waiting.length === 0 ? Promise.resolve() : new Promise<void>((resolve) => idleWaiters.push(resolve))),
  };
}
