import type { ErrorCode } from './errors';

/** The work line's jobs besides imports (spec 8, 9): what a job:progress notice is about. */
export type JobProgressKind = 'backup' | 'restore';

/**
 * A backup or a restore as main runs it (P-20, spec 3.3): pushed as job:progress at most ten times a second, and once
 * more when it ends — idle, saying how it ended.
 */
export interface JobProgress {
  kind: JobProgressKind;
  state: 'running' | 'waiting-job' | 'idle';
  /** Bytes written and read back so far, of all the run will (each copy is written, then read again). */
  bytesDone: number;
  bytesTotal: number;
  /** Files finished, of the files the run copies: the toast's "56 / 128" (0 / 0 until the run has counted them). */
  done: number;
  total: number;
  /** The folder the run makes, its name only (the toast's line); null before it is named. */
  name: string | null;
  /** On the idle notice that ends a run. */
  outcome?: 'done' | 'cancelled' | 'failed';
  /** With outcome 'failed': the cause and the next step, for the error toast. */
  error?: { code: ErrorCode; message: string };
}

export const IDLE_BACKUP_PROGRESS: Readonly<JobProgress> = Object.freeze<JobProgress>({
  kind: 'backup',
  state: 'idle',
  bytesDone: 0,
  bytesTotal: 0,
  done: 0,
  total: 0,
  name: null,
});

/** 마지막 백업 for the settings window (app.backupInfo, spec 8.2): when, and the folder's name — never its path. */
export interface BackupInfo {
  at: string;
  folderName: string;
}
