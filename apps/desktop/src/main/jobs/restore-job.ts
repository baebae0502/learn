import fs from 'node:fs';
import path from 'node:path';
import {
  IDLE_RESTORE_PROGRESS, LearnError, toLearnError, type ErrorCode, type JobProgress, type RestoreDoneSheet, type RestoreIssue, type SheetResult,
} from '@learn/domain';
import { datedFolderName, readBackupManifest, restoreBackup, type RestoreHooks, type RestoreResult } from '@learn/library';
import { checkLibraryFolder, insideFolder } from '../library-folder';
import { mainStrings } from '../strings';
import { PROGRESS_MS } from './import-queue';
import type { JobLane } from './lane';
import { createThrottle } from './throttle';

/** Names under each problem line of the result sheet before 외 N개 (the check sheet's rule, P-26). */
export const RESTORE_ISSUE_NAMES = 2;

export interface RestoreJobDeps<W> {
  lane: Pick<JobLane, 'run' | 'busy'>;
  /** The library in use: the second panel opens beside it, and nothing is restored inside it. Not the open library: a path. */
  libraryRoot(): string;
  /** The folder panels over `owner` (sheets on macOS): the backup, then the folder to restore into. null: cancelled. */
  pickBackup(owner: W | null, opts: { defaultPath: string }): Promise<string | null>;
  pickParent(owner: W | null, opts: { defaultPath: string }): Promise<string | null>;
  /** Where backups were made last (prefs.backupDir): the backup panel opens there. */
  backupDir(): string | null;
  documentsDir(): string;
  homeDir(): string;
  /** job:progress to every window. */
  progress(p: JobProgress): void;
  /** The result sheet over `owner` (or another main window); its answer, null when it closed with none. */
  showResult(owner: W | null, payload: RestoreDoneSheet): Promise<SheetResult | null>;
  /** 이 라이브러리로 전환하고 다시 시작: saved as the library folder, then the restart (library-folder.ts switchLibrary). */
  switchTo(root: string): void;
  /** The switch could not be made (the prefs file cannot be written, the folder is gone): said over `owner`. */
  switchFailed(owner: W | null, error: { code: ErrorCode; message: string }): void;
  now?(): Date;
  progressMs?: number;
}

export interface RestoreJob<W> {
  /**
   * 파일 › 백업에서 복원…: asks for the backup and checks it, asks where, checks that, and puts the restore on the work
   * line; answers once it is there (started), not when it ends. false: a panel was cancelled, or a restore is on the line.
   */
  start(owner: W | null): Promise<{ started: boolean }>;
  /** The toast's 취소: the restore stops at its next checkpoint, or never starts; no folder is left. */
  cancel(): void;
  state(): JobProgress;
  /** E2E only (test-hooks.ts): restoreBackup's fault point. */
  setHooks(hooks: RestoreHooks | undefined): void;
}

interface Run {
  abort: AbortController;
  ended: boolean;
}

/** A stop, not a failure: 취소, the line stopped for a quit, or a run the quit dropped before it began. */
function stopped(e: unknown, run: Run): boolean {
  return run.abort.signal.aborted || (e as { name?: unknown } | null)?.name === 'AbortError' || toLearnError(e).code === 'CANCELLED';
}

/**
 * The result sheet's facts (spec 9.3): what came back, and for each kind of problem how many files and whose they were.
 * A record that disagrees is said once: not again when its file is already said to be missing or damaged.
 */
export function restoreSheet(result: RestoreResult, location: string, homeDir: string): RestoreDoneSheet {
  const missing = new Set(result.missingAssets);
  const damaged = new Set(result.hashMismatches);
  const records = result.recordMismatches.filter((id) => !missing.has(id) && !damaged.has(id));
  const issue = (ids: readonly string[]): RestoreIssue | null => {
    if (ids.length === 0) return null;
    const wanted = new Set(ids);
    // problemItems come live first, then the trash's: the names shown are the ones the user can still see.
    const titles = result.problemItems.filter((i) => wanted.has(i.assetId)).map((i) => i.title);
    return { count: ids.length, titles: titles.slice(0, RESTORE_ISSUE_NAMES), more: Math.max(0, titles.length - RESTORE_ISSUE_NAMES) };
  };
  return {
    kind: 'restoreDone',
    backupAt: result.backupCreatedAt,
    items: result.counts.items,
    trashed: result.counts.trashedItems,
    collections: result.counts.collections,
    tags: result.counts.tags,
    files: result.managedFiles,
    verified: result.verifiedAssets,
    missing: issue(result.missingAssets),
    damaged: issue(result.hashMismatches),
    records: issue(records),
    countsMatch: result.countsMatch,
    location,
    homeDir,
  };
}

/**
 * 백업에서 복원… on main's work line (spec 9.1, P-20): one restore at a time, behind whatever runs first, into a new folder
 * — the library in use is never touched. Its state goes to every window as job:progress, its end as the result sheet
 * (done) or the toast's own end (cancelled, failed).
 */
export function createRestoreJob<W>(deps: RestoreJobDeps<W>): RestoreJob<W> {
  const now = deps.now ?? (() => new Date());
  let current: JobProgress = { ...IDLE_RESTORE_PROGRESS };
  let pending: Run | null = null;
  let asking = false;
  let hooks: RestoreHooks | undefined;
  const notice = createThrottle(() => deps.progress({ ...current }), deps.progressMs ?? PROGRESS_MS);
  const show = (next: JobProgress, flush = false): void => {
    current = next;
    notice.request();
    if (flush) notice.flush();
  };

  function end(run: Run, outcome: NonNullable<JobProgress['outcome']>, error?: JobProgress['error']): void {
    if (run.ended) return;
    run.ended = true;
    if (pending === run) pending = null;
    show({ ...IDLE_RESTORE_PROGRESS, outcome, ...(error ? { error } : {}) }, true);
  }

  /** The sheet's answer: 전환 saves the folder and restarts on it; one that cannot be made is said. */
  function answered(answer: SheetResult | null, target: string, owner: W | null): void {
    if (answer?.kind !== 'restoreDone' || !answer.switch) return;
    try {
      deps.switchTo(target);
    } catch (e) {
      const le = toLearnError(e, mainStrings.restore.failed);
      console.error(`[restore] switch failed: ${le.code}`);
      deps.switchFailed(owner, { code: le.code, message: le.message });
    }
  }

  /** The two panels and their checks (spec 9.1); null when one was cancelled. */
  async function ask(owner: W | null): Promise<{ backupDir: string; parent: string } | null> {
    const picked = await deps.pickBackup(owner, { defaultPath: deps.backupDir() ?? deps.documentsDir() });
    if (picked === null) return null;
    const backupDir = path.resolve(picked);
    // Checked before the second panel: a folder this app cannot restore from is said at once.
    await readBackupManifest(backupDir);
    const root = path.resolve(deps.libraryRoot());
    const chosen = await deps.pickParent(owner, { defaultPath: path.dirname(root) });
    if (chosen === null) return null;
    const parent = path.resolve(chosen);
    const check = checkLibraryFolder(parent);
    if (!check.ok) throw new LearnError('VALIDATION_FAILED', check.message);
    if (insideFolder(parent, root)) throw new LearnError('VALIDATION_FAILED', mainStrings.restore.inLibrary);
    // The backup stays as it was made: a library restored into it would change what the next restore reads.
    if (insideFolder(parent, backupDir)) throw new LearnError('VALIDATION_FAILED', mainStrings.restore.inBackup);
    return { backupDir, parent };
  }

  async function work(run: Run, where: { backupDir: string; parent: string }, owner: W | null, laneSignal: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([laneSignal, run.abort.signal]);
    signal.throwIfAborted();
    const name = datedFolderName(mainStrings.restore.folderPrefix, now(), (n) => fs.existsSync(path.join(where.parent, n)));
    const target = path.join(where.parent, name);
    show({ ...IDLE_RESTORE_PROGRESS, state: 'running', name });
    const result = await restoreBackup({
      backupDir: where.backupDir,
      targetRoot: target,
      signal,
      hooks,
      onProgress: (p) => show({ ...current, bytesDone: p.bytesDone, bytesTotal: p.bytesTotal, done: p.filesDone, total: p.filesTotal }),
    });
    end(run, 'done');
    // The sheet waits for its answer off the line: the next job does not wait for the user.
    void deps.showResult(owner, restoreSheet(result, target, deps.homeDir())).then(
      (answer) => answered(answer, target, owner),
      (e: unknown) => {
        console.error(`[restore] result sheet failed: ${toLearnError(e).code}`);
        // A restore started since owns the one progress channel: writing here would overwrite its state and settle its toast early.
        if (pending !== null) return;
        // The run's toast closed with it: it opens and settles once more, now naming the folder, so the user still learns
        // that the restore finished and where it is.
        show({ ...IDLE_RESTORE_PROGRESS, state: 'running', name }, true);
        show({ ...IDLE_RESTORE_PROGRESS, outcome: 'done', name }, true);
      },
    );
  }

  return {
    async start(owner) {
      if (pending !== null || asking) return { started: false };
      asking = true;
      let where: { backupDir: string; parent: string } | null;
      try {
        where = await ask(owner);
      } finally {
        asking = false;
      }
      if (where === null) return { started: false };
      const chosen = where;
      const run: Run = { abort: new AbortController(), ended: false };
      pending = run;
      // Behind an import or a backup the restore waits its turn (spec 3.1); its toast says so.
      show({ ...IDLE_RESTORE_PROGRESS, state: deps.lane.busy() === null ? 'running' : 'waiting-job' });
      void deps.lane.run('restore', (signal) => work(run, chosen, owner, signal)).catch((e: unknown) => {
        if (stopped(e, run)) {
          end(run, 'cancelled');
          return;
        }
        const le = toLearnError(e, mainStrings.restore.failed);
        console.error(`[restore] failed: ${le.code}`);
        end(run, 'failed', { code: le.code, message: le.message });
      });
      return { started: true };
    },
    cancel() {
      const run = pending;
      if (run === null) return;
      run.abort.abort();
      // Not begun yet: it ends now (its turn on the line finds it stopped and does nothing).
      if (current.state === 'waiting-job') end(run, 'cancelled');
    },
    state: () => ({ ...current }),
    setHooks(next) {
      hooks = next;
    },
  };
}
