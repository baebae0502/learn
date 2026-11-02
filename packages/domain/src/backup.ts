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

export const IDLE_RESTORE_PROGRESS: Readonly<JobProgress> = Object.freeze<JobProgress>({
  kind: 'restore',
  state: 'idle',
  bytesDone: 0,
  bytesTotal: 0,
  done: 0,
  total: 0,
  name: null,
});

/**
 * Why a folder cannot be restored from (spec 9.1–9.3): the backup's own faults, each with what to do next. They reach
 * the page in the restore's error toast; strings.test.ts checks them with the rest of the copy.
 */
export const RESTORE_COPY = {
  unknownFormat: '백업 폴더가 아니거나 형식을 알 수 없습니다. 백업 만들기로 만든 폴더를 고르세요.',
  newerVersion: '이 백업은 더 새로운 버전의 앱에서 만들어졌습니다. 앱을 업데이트한 뒤 다시 복원하세요.',
  damagedList: '백업의 파일 목록이 손상되었습니다. 다른 백업을 고르세요.',
  damagedDatabase: '백업의 라이브러리 데이터가 손상되었습니다. 다른 백업을 고르세요.',
  notEmpty: '복원할 폴더가 비어 있지 않습니다. 빈 폴더를 고르세요.',
} as const;
