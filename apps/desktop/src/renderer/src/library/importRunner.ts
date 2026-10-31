import type { ImportPathsInput, ImportQueueState, ImportReport, PickAndImportInput, Result, StorageMode } from '@learn/domain';
import { unwrap } from '../api';
import type { ProgressToast } from '../jobs/progressToast';
import type { ImportTarget } from '../sidebar/importTarget';
import { t } from '../strings';
import type { PerfMark } from '../ui/perfMarks';
import type { ToastData } from '../ui/toasts';
import { failureLines, importToast } from './import-flow';

/** importPathsInput's limit (P-2): a bigger drop goes in as several calls, one after another, into the one queue. */
export const IMPORT_CALL_PATHS = 500;

export function inImportCalls<T>(list: readonly T[], size = IMPORT_CALL_PATHS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export interface ImportRunnerDeps {
  importPaths(input: ImportPathsInput): Promise<Result<{ queued: number }>>;
  pickAndImport(input: PickAndImportInput): Promise<Result<{ queued: number }>>;
  /** Files this window is handing to main (the busy screen counts them before main has): +n, then −n as answered. */
  sending(delta: number): void;
  /** A run's end is being shown: the busy screen and waitImportIdle wait for it. */
  settling(delta: number): void;
  /** The run going now is a quiet one (no busy screen). */
  setQuiet(quiet: boolean): void;
  /** 파일 가져오기…'s open panel is up: it holds the window. */
  setPanel(open: boolean): void;
  showToast(data: ToastData): void;
  /** Reads the list again after a run added items, waited for at most LIST_REFRESH_WAIT_MS. */
  refreshList(): Promise<void>;
  /** One painted frame, then whatever the busy screen still holds (its text's minimum time). */
  screenSettled(): Promise<void>;
  /** A live collection's name, from the organize model; null once it is gone. */
  collectionName(id: string): string | null;
  /** E2E only: whether the run that begins now was asked to be quiet (window.__learnQuietImports, Q-4b). */
  takeQuiet(): boolean;
  toast: ProgressToast;
  mark(name: PerfMark): void;
  clearMarks(drop: boolean): void;
}

export interface ImportRunner {
  /** 파일 가져오기… / 외부 파일 연결… / 이 컬렉션으로 가져오기…: main's open panel, then the queue. */
  pick(mode: StorageMode, into: ImportTarget | null): Promise<void>;
  /** A drop (the window, a sidebar row): sent once `ready` (the overlay-less frame), 500 paths a call. */
  drop(paths: readonly string[], mode: StorageMode, into: ImportTarget | null, ready: Promise<void>): Promise<void>;
  /** import:progress. */
  progress(state: ImportQueueState): void;
  /** import:finished: the list read again, then the result in place of the progress toast, and the failures. */
  finished(report: ImportReport): Promise<void>;
}

/**
 * The window's side of main's import queue (spec 3): it puts files in and shows what main reports. Nothing here waits for
 * a run to end before the window can be used again — only the open panel holds it, while it is up.
 */
export function createImportRunner(d: ImportRunnerDeps): ImportRunner {
  /** A run is going as far as this window knows: from its first busy notice to its report. */
  let inRun = false;
  let quiet = false;
  let last: ImportQueueState | null = null;
  const refused = (e: unknown): void => d.showToast({ kind: 'error', title: t.toast.importFailed, body: (e as Error).message, testId: 'import-failures' });
  return {
    async pick(mode, into) {
      d.clearMarks(false);
      d.mark('import:start');
      d.setPanel(true);
      try {
        await unwrap(d.pickAndImport({ mode, ...(into ? { collectionId: into.id } : {}) }));
        d.mark('import:answered');
      } catch (e) {
        refused(e);
      } finally {
        d.setPanel(false);
      }
    },
    async drop(paths, mode, into, ready) {
      d.mark('import:start');
      d.sending(paths.length);
      let left = paths.length;
      try {
        await ready;
        d.mark('import:sent');
        for (const call of inImportCalls(paths)) {
          await unwrap(d.importPaths({ paths: call, mode, ...(into ? { collectionId: into.id } : {}) }));
          left -= call.length;
          d.sending(-call.length);
        }
        d.mark('import:answered');
      } catch (e) {
        refused(e);
      } finally {
        if (left > 0) d.sending(-left);
      }
    },
    progress(state) {
      if (state.state === 'idle') return;
      last = state;
      if (inRun) return;
      inRun = true;
      quiet = d.takeQuiet();
      d.setQuiet(quiet);
      d.toast.begin(quiet);
    },
    async finished(report) {
      const key = d.toast.end(last);
      const quietRun = quiet;
      inRun = false;
      quiet = false;
      last = null;
      d.settling(1);
      try {
        // The toast says "가져왔습니다" over the rows it brought, never over an empty list (critique T13R2-m1).
        if (report.imported > 0) await d.refreshList();
        d.mark('import:listed');
        if (quietRun) {
          d.toast.settle(key, null);
          return;
        }
        await d.screenSettled();
        const name = report.collectionId === null ? null : d.collectionName(report.collectionId);
        d.toast.settle(key, importToast(report, name === null ? null : { name }));
        if (report.failed.length > 0) {
          const { lines, hints } = failureLines(report.failed);
          d.showToast({ kind: 'error', title: t.toast.failedTitle(report.failed.length), lines, body: hints.join(' ') || undefined, testId: 'import-failures' });
        }
      } finally {
        d.mark('import:end');
        if (!inRun) d.setQuiet(false);
        d.settling(-1);
      }
    },
  };
}
