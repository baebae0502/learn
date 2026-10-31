import { create } from 'zustand';
import { IDLE_IMPORT_STATE, type ImportQueueState } from '@learn/domain';
import { t } from '../strings';
import type { JobToastView, ProgressJob } from './progressToast';

/** Work main runs on its work line, as this window knows it (spec 3: the window is not held meanwhile). */
export interface JobProgressState {
  /** Main's import queue as last pushed (import:progress). */
  import: ImportQueueState;
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
  addSending(delta: number): void;
  addSettling(delta: number): void;
  setQuiet(quiet: boolean): void;
  setView(key: string, view: JobToastView | undefined): void;
}

export const useJobProgress = create<JobProgressState>()((set) => ({
  import: { ...IDLE_IMPORT_STATE },
  sending: 0,
  settling: 0,
  shownTotal: 0,
  quiet: false,
  views: {},
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
  state: ImportQueueState['state'];
  /** The pause icon instead of the spinner: a question is open, or another job runs first. */
  waiting: boolean;
  title: string;
  /** " · 7 / 12" after the title. */
  count: string;
  /** The file under way or asked about (cut in the middle); null while nothing is. */
  file: string | null;
  /** A sentence instead of a file name (waiting for the work before it). */
  note: string | null;
  /** The hashed bytes of the files so far, floored: never 100 before the end. */
  percent: number;
  valueText: string;
  testId: string;
  cancelTestId: string;
}

export function describeJob(_job: ProgressJob, s: ImportQueueState): JobToastText {
  const percent = s.bytesTotal > 0 ? Math.min(100, Math.floor((s.bytesDone * 100) / s.bytesTotal)) : 0;
  const waitingJob = s.state === 'waiting-job';
  return {
    state: s.state,
    waiting: s.state === 'waiting-choice' || waitingJob,
    title: s.state === 'waiting-choice' ? t.jobs.waitingChoice : waitingJob ? t.jobs.waitingJob : t.jobs.importing,
    count: t.jobs.count(s.done, s.total),
    file: waitingJob ? null : s.current,
    note: waitingJob ? t.jobs.waitingJobNote : null,
    percent,
    valueText: t.jobs.progressValue(s.done, s.total, percent),
    testId: 'import-progress',
    cancelTestId: 'import-cancel',
  };
}
