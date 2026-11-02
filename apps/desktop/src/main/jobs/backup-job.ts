import fs from 'node:fs';
import path from 'node:path';
import { IDLE_BACKUP_PROGRESS, LearnError, toLearnError, type BackupDoneSheet, type ErrorCode, type JobProgress } from '@learn/domain';
import type { Db, LibraryRepository, SettingsRepository } from '@learn/db';
import { createBackup, datedFolderName, type BackupHooks, type LibraryLayout } from '@learn/library';
import { checkLibraryFolder, insideFolder } from '../library-folder';
import { mainStrings } from '../strings';
import { PROGRESS_MS } from './import-queue';
import type { JobLane } from './lane';
import { createThrottle } from './throttle';

export interface BackupLibrary {
  layout: LibraryLayout;
  db: Db;
  repo: LibraryRepository;
  settings: SettingsRepository;
}

export interface BackupJobDeps<W> {
  lane: Pick<JobLane, 'run' | 'busy'>;
  /** The open library (LIBRARY_UNAVAILABLE when there is none). */
  library(): BackupLibrary;
  /** The folder panel over `owner` (a sheet on macOS), opened on `defaultPath`: the folder chosen, or null. */
  pickFolder(owner: W | null, opts: { defaultPath: string }): Promise<string | null>;
  /** prefs.backupDir: the folder chosen last (spec 8.1), and keeping a new one (every window hears of it). */
  backupDir(): string | null;
  rememberDir(dir: string): void;
  documentsDir(): string;
  homeDir(): string;
  /** job:progress to every window. */
  progress(p: JobProgress): void;
  /** backup.last was written: settingsChanged, so a settings window shows it. */
  stored(): void;
  /** The result sheet over the window that asked (or another main window). */
  showResult(owner: W | null, payload: BackupDoneSheet): void;
  now?(): Date;
  progressMs?: number;
}

export interface BackupJob<W> {
  /**
   * 파일 › 백업 만들기…: asks for the folder, checks it, remembers it and puts the backup on the work line; answers once
   * it is there (started), not when it ends. false: the panel was cancelled, or a backup is on the line already.
   */
  start(owner: W | null): Promise<{ started: boolean }>;
  /** The toast's 취소 (spec 8.1): the backup stops at its next checkpoint, or never starts. */
  cancel(): void;
  state(): JobProgress;
  /** E2E only (test-hooks.ts): createBackup's fault points. */
  setHooks(hooks: BackupHooks | undefined): void;
}

interface Run {
  abort: AbortController;
  ended: boolean;
}

/** What a failed run says: its own cause and next step; a copy that read back different has a sentence of its own. */
function failure(e: unknown): { code: ErrorCode; message: string } {
  const le = toLearnError(e, mainStrings.backup.failed);
  return { code: le.code, message: le.code === 'HASH_MISMATCH' ? mainStrings.backup.copyMismatch : le.message };
}

/** A stop, not a failure: 취소, the line stopped for a quit, or a run the quit dropped before it began. */
function stopped(e: unknown, run: Run): boolean {
  return run.abort.signal.aborted || (e as { name?: unknown } | null)?.name === 'AbortError' || toLearnError(e).code === 'CANCELLED';
}

/**
 * 백업 만들기… on main's work line (spec 8.1, P-20): one backup at a time, behind whatever runs first; its state goes to
 * every window as job:progress, its end as a result sheet (done) or the toast's own end (cancelled, failed).
 */
export function createBackupJob<W>(deps: BackupJobDeps<W>): BackupJob<W> {
  const now = deps.now ?? (() => new Date());
  let current: JobProgress = { ...IDLE_BACKUP_PROGRESS };
  let pending: Run | null = null;
  let asking = false;
  let hooks: BackupHooks | undefined;
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
    show({ ...IDLE_BACKUP_PROGRESS, outcome, ...(error ? { error } : {}) }, true);
  }

  async function work(run: Run, parent: string, owner: W | null, laneSignal: AbortSignal): Promise<void> {
    const signal = AbortSignal.any([laneSignal, run.abort.signal]);
    signal.throwIfAborted();
    const lib = deps.library();
    if (insideFolder(parent, lib.layout.root)) throw new LearnError('VALIDATION_FAILED', mainStrings.backup.inLibrary);
    const when = now();
    const name = datedFolderName(mainStrings.backup.folderPrefix, when, (n) => fs.existsSync(path.join(parent, n)));
    show({ ...IDLE_BACKUP_PROGRESS, state: 'running', name });
    const { summary } = await createBackup({
      layout: lib.layout,
      db: lib.db,
      repo: lib.repo,
      destDir: path.join(parent, name),
      includeAssets: true,
      signal,
      hooks,
      createdAt: when,
      onProgress: (p) => show({ ...current, bytesDone: p.bytesDone, bytesTotal: p.bytesTotal, done: p.filesDone, total: p.filesTotal }),
    });
    try {
      lib.settings.set('backup.last', { at: summary.createdAt, folder: summary.folder });
      deps.stored();
    } catch (e) {
      // The backup is whole; only 마지막 백업 will not say so.
      console.warn(`[backup] backup.last not saved: ${toLearnError(e).code}`);
    }
    end(run, 'done');
    deps.showResult(owner, {
      kind: 'backupDone',
      at: summary.createdAt,
      tookMs: Math.max(0, now().getTime() - when.getTime()),
      items: summary.items,
      trashed: summary.trashedItems,
      files: summary.files,
      bytes: summary.bytes,
      linked: summary.linkedItems,
      missing: summary.missingItems,
      location: summary.folder,
      homeDir: deps.homeDir(),
    });
  }

  return {
    async start(owner) {
      if (pending !== null || asking) return { started: false };
      deps.library(); // no library: nothing is asked
      asking = true;
      let chosen: string | null;
      try {
        chosen = await deps.pickFolder(owner, { defaultPath: deps.backupDir() ?? deps.documentsDir() });
      } finally {
        asking = false;
      }
      if (chosen === null) return { started: false };
      const parent = path.resolve(chosen);
      const check = checkLibraryFolder(parent);
      if (!check.ok) throw new LearnError('VALIDATION_FAILED', check.message);
      // The library can change while the panel is up (a restore): the check and the backup use the one open now.
      if (insideFolder(parent, deps.library().layout.root)) throw new LearnError('VALIDATION_FAILED', mainStrings.backup.inLibrary);
      try {
        deps.rememberDir(parent);
      } catch (e) {
        // A device that cannot save its prefs still backs up; the panel just opens elsewhere next time.
        console.warn(`[backup] backupDir not saved: ${toLearnError(e).code}`);
      }
      const run: Run = { abort: new AbortController(), ended: false };
      pending = run;
      // Behind an import or a restore the backup waits its turn (spec 3.1); its toast says so.
      show({ ...IDLE_BACKUP_PROGRESS, state: deps.lane.busy() === null ? 'running' : 'waiting-job' });
      void deps.lane.run('backup', (signal) => work(run, parent, owner, signal)).catch((e: unknown) => {
        if (stopped(e, run)) {
          end(run, 'cancelled');
          return;
        }
        const f = failure(e);
        console.error(`[backup] failed: ${f.code}`);
        end(run, 'failed', f);
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
