import { create } from 'zustand';
import { IDLE_BACKUP_PROGRESS, IDLE_IMPORT_STATE, IDLE_RESTORE_PROGRESS, type ImportQueueState, type JobProgress } from '@learn/domain';
import { api } from '../api';
import { t } from '../strings';
import type { JobState, JobToastView, ProgressJob } from './progressToast';

/** Work main runs on its work line, as this window knows it (spec 3: the window is not held meanwhile). */
export interface JobProgressState {
  /** Main's import queue as last pushed (import:progress). */
  import: ImportQueueState;
  /** main's backup as last pushed (job:progress). */
  backup: JobProgress;
  /** main's restore as last pushed (job:progress). */
  restore: JobProgress;
  /** Files this window has handed to main and main has not answered for yet (a drop between its event and the reply). */
  sending: number;
  /** Runs whose end is being shown (the list read again, the result toast): the busy screen and waitImportIdle wait. */
  settling: number;
  /** The busy screen's N while a run's end is shown: main's state is idle by then. */
  shownTotal: number;
  /** The run going now is the E2E setup helper's quiet one: no busy screen (window.__learnQuietImports). */
  quiet: boolean;
  /** Job toasts that stopped following their job, by toast key: their run's last state, then their result. */
  views: Readonly<Record<string, JobToastView>>;
  setImport(state: ImportQueueState): void;
  setBackup(progress: JobProgress): void;
  setRestore(progress: JobProgress): void;
  addSending(delta: number): void;
  addSettling(delta: number): void;
  setQuiet(quiet: boolean): void;
  setView(key: string, view: JobToastView | undefined): void;
}

export const useJobProgress = create<JobProgressState>()((set) => ({
  import: { ...IDLE_IMPORT_STATE },
  backup: { ...IDLE_BACKUP_PROGRESS },
  restore: { ...IDLE_RESTORE_PROGRESS },
  sending: 0,
  settling: 0,
  shownTotal: 0,
  quiet: false,
  views: {},
  setBackup: (backup) => set({ backup }),
  setRestore: (restore) => set({ restore }),
  setImport: (state) => set((s) => ({ import: state, shownTotal: state.state !== 'idle' ? state.total : s.shownTotal })),
  addSending: (delta) =>
    set((s) => {
      const sending = Math.max(0, s.sending + delta);
      return { sending, shownTotal: s.import.state === 'idle' && sending > 0 ? sending : s.shownTotal };
    }),
  addSettling: (delta) => set((s) => ({ settling: Math.max(0, s.settling + delta) })),
  setQuiet: (quiet) => set({ quiet }),
  setView: (key, view) =>
    set((s) => {
      const views = { ...s.views };
      if (view) views[key] = view;
      else delete views[key];
      return { views };
    }),
}));

/** An import is going as this window sees it: main's queue works, files are still being handed over, or an end is shown. */
export const importBusy = (s: JobProgressState): boolean => s.import.state !== 'idle' || s.sending > 0 || s.settling > 0;

/** The empty library's "자료 N개를 가져오는 중…" N (spec 3.2: the queue's total); null when the screen does not show it. */
export function importBusyTotal(s: JobProgressState): number | null {
  if (s.quiet) return null;
  if (s.import.state !== 'idle') return s.import.total;
  if (s.sending > 0) return s.sending;
  return s.settling > 0 ? s.shownTotal : null;
}

/** The progress toast's words and numbers (spec 3.3, mockup importToast and jobToasts). */
export interface JobToastText {
  state: JobState['state'];
  /** The pause icon instead of the spinner: a question is open, or another job runs first. */
  waiting: boolean;
  title: string;
  /** " · 7 / 12" after the title. */
  count: string;
  /** The file under way or asked about (cut in the middle); null while nothing is. */
  file: string | null;
  /** A sentence instead of a file name (waiting for the work before it). */
  note: string | null;
  /** The bar is drawn: not while the job waits for the one before it (nothing to measure yet). */
  bar: boolean;
  /** Main's percent as it is (the same progress as the count, never 100 before the end). */
  percent: number;
  valueText: string;
  testId: string;
  cancelTestId: string;
}

/** The job ahead of a waiting one, when this window knows which (Q-4e): the one running now. */
export type AheadJob = 'import' | 'backup' | 'restore' | null;

/** What a job's toast draws live. */
export function liveState(s: JobProgressState, job: ProgressJob): JobState {
  return job === 'import' ? s.import : job === 'backup' ? s.backup : s.restore;
}

/** The job running ahead of `job` on main's work line, as this window knows it (one runs at a time). */
export function jobAhead(s: JobProgressState, job: ProgressJob): AheadJob {
  if (job !== 'backup' && s.backup.state === 'running') return 'backup';
  if (job !== 'restore' && s.restore.state === 'running') return 'restore';
  // The import queue is on the line in any state but idle (asking about a duplicate, or itself in front of the line).
  if (job !== 'import' && s.import.state !== 'idle') return 'import';
  return null;
}

/** Floored, so the bar never reads 100 before the work has ended; 0 before the sizes are known. */
const percentOf = (done: number, total: number): number => (total > 0 ? Math.min(100, Math.floor((done * 100) / total)) : 0);

export function describeJob(job: ProgressJob, s: JobState, ahead: AheadJob = null): JobToastText {
  // Each job's toast is handed its own job's state (liveState, or the view its controller froze).
  return job === 'import' ? describeImport(s as ImportQueueState, ahead) : describeLineJob(job, s as JobProgress, ahead);
}

function describeImport(s: ImportQueueState, ahead: AheadJob): JobToastText {
  const waitingJob = s.state === 'waiting-job';
  return {
    state: s.state,
    waiting: s.state === 'waiting-choice' || waitingJob,
    title: s.state === 'waiting-choice' ? t.jobs.waitingChoice : waitingJob ? t.jobs.waitingJob : t.jobs.importing,
    count: waitingJob ? t.jobs.countTotal(s.total) : t.jobs.count(s.done, s.total),
    file: waitingJob ? null : s.current,
    note: waitingJob ? (ahead === 'backup' ? t.jobs.importAfter.backup : ahead === 'restore' ? t.jobs.importAfter.restore : t.jobs.waitingJobNote) : null,
    bar: !waitingJob,
    percent: s.percent,
    valueText: t.jobs.progressValue(s.done, s.total, s.percent),
    testId: 'import-progress',
    cancelTestId: 'import-cancel',
  };
}

/** A backup's or a restore's title, and the line it shows while it waits (Q-4e: the job ahead by name when known). */
function lineWords(job: 'backup' | 'restore', ahead: AheadJob): { title: string; after: string } {
  if (job === 'backup') {
    return { title: t.jobs.backingUp, after: ahead === 'import' ? t.jobs.backupAfter.import : ahead === 'restore' ? t.jobs.backupAfter.restore : t.jobs.backupAfter.other };
  }
  return { title: t.jobs.restoring, after: ahead === 'import' ? t.jobs.restoreAfter.import : ahead === 'backup' ? t.jobs.restoreAfter.backup : t.jobs.restoreAfter.other };
}

/** A backup's or a restore's toast (job:progress): files done of total, the folder it makes, its bytes as the bar. */
function describeLineJob(job: 'backup' | 'restore', s: JobProgress, ahead: AheadJob): JobToastText {
  const percent = percentOf(s.bytesDone, s.bytesTotal);
  const waitingJob = s.state === 'waiting-job';
  const words = lineWords(job, ahead);
  return {
    state: s.state,
    waiting: waitingJob,
    title: waitingJob ? t.jobs.waitingJob : words.title,
    count: !waitingJob && s.total > 0 ? t.jobs.count(s.done, s.total) : '',
    file: waitingJob ? null : s.name,
    note: waitingJob ? words.after : null,
    bar: !waitingJob,
    percent,
    valueText: t.jobs.progressValue(s.done, s.total, percent),
    testId: `${job}-progress`,
    cancelTestId: `${job}-cancel`,
  };
}

/** Toast 취소 presses on an import, counted at the click: a drop's loop sees them before main's count (which stays authoritative for the other ways to cancel) can reach it. */
let importCancelsHere = 0;
export const importCancelsAskedHere = (): number => importCancelsHere;

/** The toast's 취소: the job stops (spec 3.5); the backup's and the restore's name their job (backup:cancel, Q-10b). A refused call changes nothing the user could act on, so it says nothing. */
export function cancelJob(job: ProgressJob): void {
  if (job === 'import') importCancelsHere += 1;
  void (job === 'import' ? api().library.cancelImport() : api().backup.cancel({ job }));
}
