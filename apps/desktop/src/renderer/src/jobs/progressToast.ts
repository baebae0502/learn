import type { ImportQueueState, JobProgress } from '@learn/domain';
import type { ToastData } from '../ui/toasts';

/** design-spec 6 "1초를 넘는 작업은 진행 토스트", spec 3.3: a run that has not ended by then gets its toast. */
export const JOB_TOAST_DELAY_MS = 1000;

/** The jobs with a progress toast (P-3): the import queue's, the backup's, the restore's. */
export type ProgressJob = 'import' | 'backup' | 'restore';
/** What a job's toast draws live: the import queue's state, or a backup's (job:progress). */
export type JobState = ImportQueueState | JobProgress;

/** What a job's toast shows once it no longer follows its job: its run's last state, then the result that took it over. */
export type JobToastView = { kind: 'progress'; state: JobState } | { kind: 'result'; data: ToastData };

export interface ProgressToastDeps {
  /** Puts the job's toast in the region (it draws the job's live state until it is given a view); answers its key. */
  add(job: ProgressJob): string;
  close(key: string): void;
  /** A toast of its own: the result of a run that had no progress toast. */
  show(data: ToastData): void;
  setView(key: string, view: JobToastView): void;
  delayMs?: number;
}

export interface ProgressToast {
  /** A run began. Its toast comes once it has run JOB_TOAST_DELAY_MS; a quiet run (the E2E setup helper) has none. */
  begin(quiet: boolean): void;
  /** The run's end reached this window: no toast comes for it now; the one up keeps `last` and is answered (null: none). */
  end(last: JobState | null): string | null;
  /** The run's result takes its toast over in place, or is a toast of its own; null closes the toast. */
  settle(key: string | null, result: ToastData | null): void;
}

/**
 * One progress toast per run of a job (P-3): never closed and shown again while the run goes, so it does not flicker; the
 * same toast becomes the result. A run that begins while the last one's end is still being shown gets its own.
 */
export function createProgressToast(job: ProgressJob, deps: ProgressToastDeps): ProgressToast {
  const delay = deps.delayMs ?? JOB_TOAST_DELAY_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shown: string | null = null;
  const stop = (): void => {
    clearTimeout(timer);
    timer = undefined;
  };
  return {
    begin(quiet) {
      stop();
      if (quiet) return;
      timer = setTimeout(() => {
        timer = undefined;
        shown ??= deps.add(job);
      }, delay);
    },
    end(last) {
      stop();
      const key = shown;
      shown = null;
      if (key !== null && last !== null) deps.setView(key, { kind: 'progress', state: last });
      return key;
    },
    settle(key, result) {
      if (key === null) {
        if (result !== null) deps.show(result);
        return;
      }
      if (result !== null) deps.setView(key, { kind: 'result', data: result });
      else deps.close(key);
    },
  };
}
