import fs from 'node:fs/promises';
import {
  IDLE_IMPORT_STATE, LearnError, absolutePathSchema, toLearnError,
  type DuplicateCard, type DuplicateChoice, type ImportOutcome, type ImportQueueState, type ImportReport, type StorageMode,
} from '@learn/domain';
import { displayFileName, type ImportOptions } from '@learn/library';
import { mainStrings } from '../strings';
import type { JobLane } from './lane';
import { createThrottle } from './throttle';

export type ImportedOutcome = Extract<ImportOutcome, { status: 'imported' }>;

/** One put-in: a drop, an open panel's files, an edited copy, a copy the library check brings back. */
export interface ImportBatch {
  /** Absolute paths, imported in this order. */
  paths: string[];
  mode: StorageMode;
  /** The collection each imported item goes into (이 컬렉션으로 가져오기), or null. */
  collectionId: string | null;
  /** The webContents id of the window that put the files in: its duplicate questions hang on it. */
  owner: number;
  /** A title for a path instead of its file name's. */
  titles?: Record<string, string>;
  /** After each file of this batch is committed (an edited copy goes only then, once its hash is checked again). */
  afterCommit?: (outcome: ImportedOutcome) => Promise<void>;
}

export interface DuplicateQuestion {
  fileName: string;
  existing: DuplicateCard;
  /** The other duplicates of this run still to settle: above 0 the question offers one answer for all. */
  remaining: number;
}

/** `askedOn`: the window the question was answered on, where 기존 자료 열기 opens the item (null without a window). */
export interface DuplicateAnswer {
  choice: DuplicateChoice;
  applyToRest: boolean;
  askedOn: number | null;
}

/** The importer as the queue uses it (Importer; a fake in unit tests). */
export interface QueueImporter {
  importOne(inputPath: string, opts: ImportOptions): Promise<ImportOutcome>;
}

export interface ImportQueueDeps {
  lane: JobLane;
  /** The library's importer. Throws when no library is open, which fails each file with that reason. */
  importer(): QueueImporter;
  /** The live item a duplicate matched, as the question shows it; null once it has left the library (the trash). */
  card(itemId: string): DuplicateCard | null;
  /** One duplicate question on the owner window; resolves 건너뛰기 when `signal` aborts first. */
  ask(owner: number, question: DuplicateQuestion, signal: AbortSignal): Promise<DuplicateAnswer>;
  /** Files existing items into a collection: how many it did not hold yet (announced by the caller). */
  fileExisting(collectionId: string, itemIds: readonly string[]): number;
  /** libraryChanged{import} for items the run added. */
  announce(itemIds: string[]): void;
  /** A file's size in bytes as it is put in; 0 when it cannot be read (it fails later, with the reason). */
  stat?(file: string): Promise<number>;
  progressMs?: number;
  announceMs?: number;
  /** A log line: error codes only, never a path or a title. */
  warn?(line: string): void;
}

export interface ImportQueue {
  /** Puts files at the back of the queue; answers the run's total so far. */
  enqueue(batch: ImportBatch): number;
  /** The file under way stops at its next checkpoint, files not started are dropped, gathered duplicates are not asked. */
  cancel(): void;
  state(): ImportQueueState;
  onProgress(cb: (state: ImportQueueState) => void): () => void;
  /** Once per run: its report, and the window 기존 자료 열기 was answered on (null when it was not). */
  onFinished(cb: (report: ImportReport, openIn: number | null) => void): () => void;
}

/** Progress notices at most once per 100 ms: never more than 10 a second (spec 3.3). */
export const PROGRESS_MS = 100;
/** Added items are announced at most once a second: each notice makes the renderer read the list again. */
export const ANNOUNCE_MS = 1000;
const STAT_CONCURRENCY = 16;

type RunReport = Pick<ImportReport, 'imported' | 'filed' | 'filedExisting' | 'failed' | 'openItemId'>;

/** What the queue does from idle to idle: one progress toast, one report. */
interface Run {
  total: number;
  done: number;
  bytesTotal: number;
  bytesFinished: number;
  report: RunReport;
  modes: Set<StorageMode>;
  collections: Set<string | null>;
  duplicates: PendingDuplicate[];
  /** 같은 선택 for this run's remaining duplicates; 기존 자료 열기 for the rest is 건너뛰기 (one item opens). */
  sticky: 'add' | 'skip' | null;
  /** Collection id → the existing items whose duplicate was answered 건너뛰기 in an import into it. */
  skipped: Map<string, string[]>;
  openIn: number | null;
  abort: AbortController;
  cancelled: boolean;
  finished: boolean;
}

interface Entry {
  path: string;
  name: string;
  size: number;
  read: number;
  sized: Promise<void>;
  batch: ImportBatch;
  run: Run;
  /** Imported again once because the item it matched had gone: a second time it is left out, not asked about. */
  retried: boolean;
}

interface PendingDuplicate {
  entry: Entry;
  existingItemId: string;
}

const SKIP: DuplicateAnswer = { choice: 'skip', applyToRest: false, askedOn: null };
const only = <T>(values: ReadonlySet<T>): T | null => (values.size === 1 ? (values.values().next().value as T) : null);
const statSize = (file: string): Promise<number> => fs.stat(file).then((s) => (s.isFile() ? s.size : 0), () => 0);
const newRun = (): Run => ({
  total: 0, done: 0, bytesTotal: 0, bytesFinished: 0,
  report: { imported: 0, filed: 0, filedExisting: 0, failed: [], openItemId: null },
  modes: new Set(), collections: new Set(), duplicates: [], sticky: null, skipped: new Map(), openIn: null,
  abort: new AbortController(), cancelled: false, finished: false,
});

/**
 * The import queue on the work line (spec 3): every window's files go into one queue and are imported one at a time.
 * Duplicates are gathered and asked at the end, in order; 취소 stops the file under way at its next checkpoint.
 */
export function createImportQueue(deps: ImportQueueDeps): ImportQueue {
  const stat = deps.stat ?? statSize;
  const warn = deps.warn ?? ((line: string) => console.warn(line));
  const progressListeners = new Set<(state: ImportQueueState) => void>();
  const finishedListeners = new Set<(report: ImportReport, openIn: number | null) => void>();
  /** Files not started yet: all of the active run's. */
  const pending: Entry[] = [];
  /** The run files join; null when idle, or right after 취소 while the stopped run's file is still stopping. */
  let active: Run | null = null;
  /** A stopped run whose file under way has not stopped yet: its report waits for that file. */
  let stopping: Run | null = null;
  let current: Entry | null = null;
  let phase: 'running' | 'waiting-choice' | 'waiting-job' = 'running';
  /** The lane job working through the queue; null when none is asked for. */
  let job: Promise<void> | null = null;

  function state(): ImportQueueState {
    const run = active ?? stopping;
    if (run === null) return { ...IDLE_IMPORT_STATE };
    const mine = current !== null && current.run === run ? current : null;
    return {
      state: run === active ? phase : 'running',
      done: run.done,
      total: run.total,
      bytesDone: Math.min(run.bytesTotal, run.bytesFinished + (mine?.read ?? 0)),
      bytesTotal: run.bytesTotal,
      current: mine?.name ?? null,
    };
  }

  const progress = createThrottle(() => {
    const s = state();
    for (const cb of [...progressListeners]) {
      try {
        cb(s);
      } catch (e) {
        warn(`[import] a progress listener failed: ${toLearnError(e).code}`);
      }
    }
  }, deps.progressMs ?? PROGRESS_MS);

  const added: string[] = [];
  const announcer = createThrottle(() => {
    if (added.length > 0) deps.announce(added.splice(0));
  }, deps.announceMs ?? ANNOUNCE_MS);

  /** Sizes for the bar, a few files at a time in the order put in; each file waits only for its own. */
  function sizeAll(entries: readonly Entry[], resolvers: ReadonlyArray<() => void>): void {
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < entries.length) {
        const i = next++;
        const entry = entries[i]!;
        entry.size = await stat(entry.path).catch(() => 0);
        if (!entry.run.finished) {
          entry.run.bytesTotal += entry.size;
          progress.request();
        }
        resolvers[i]!();
      }
    };
    for (let k = 0; k < Math.min(STAT_CONCURRENCY, entries.length); k++) void worker();
  }

  function enqueue(batch: ImportBatch): number {
    // The same rule as the import channel's input: a relative path would resolve against main's working folder.
    if (batch.paths.some((p) => !absolutePathSchema.safeParse(p).success)) throw new LearnError('VALIDATION_FAILED', mainStrings.badRequest);
    if (batch.paths.length === 0) return active?.total ?? 0;
    const run = (active ??= newRun());
    run.modes.add(batch.mode);
    run.collections.add(batch.collectionId);
    const resolvers: Array<() => void> = [];
    const entries = batch.paths.map(
      (p): Entry => ({
        path: p, name: displayFileName(p), size: 0, read: 0, batch, run, retried: false,
        sized: new Promise<void>((resolve) => resolvers.push(resolve)),
      }),
    );
    run.total += entries.length;
    pending.push(...entries);
    sizeAll(entries, resolvers);
    if (job === null) startJob();
    progress.request();
    return run.total;
  }

  function startJob(): void {
    phase = deps.lane.busy() === null ? 'running' : 'waiting-job';
    const started = deps.lane.run('import', work);
    job = started;
    started
      .catch((e: unknown) => {
        const code = toLearnError(e).code;
        if (code !== 'CANCELLED') warn(`[import] the queue stopped: ${code}`);
        // Dropped before it ran (quitting), or failed: the runs it was for end stopped.
        current = null;
        if (stopping !== null) finishRun(stopping);
        cancel();
      })
      .finally(() => {
        if (job === started) job = null;
        if (job === null && pending.length > 0) startJob();
      });
  }

  async function work(laneSignal: AbortSignal): Promise<void> {
    // The line's own stop (quitting) is 취소 for the queue.
    const onAbort = (): void => cancel();
    laneSignal.addEventListener('abort', onAbort);
    try {
      phase = 'running';
      progress.request();
      for (;;) {
        // Once the line is stopped, every run on this job ends stopped, files put in since included.
        if (laneSignal.aborted) cancel();
        const entry = pending.shift();
        if (entry !== undefined) {
          await importFile(entry, laneSignal);
          continue;
        }
        const run = active;
        if (run === null) return;
        const dup = run.duplicates.shift();
        if (dup !== undefined) await settleDuplicate(dup, laneSignal);
        else finishRun(run);
      }
    } finally {
      laneSignal.removeEventListener('abort', onAbort);
    }
  }

  const signalFor = (entry: Entry, laneSignal: AbortSignal): AbortSignal => AbortSignal.any([laneSignal, entry.run.abort.signal]);

  async function importOnce(entry: Entry, laneSignal: AbortSignal, extra: { allowDuplicate?: true; onBytes?: (bytes: number) => void }): Promise<ImportOutcome> {
    const { batch } = entry;
    const title = batch.titles?.[entry.path];
    const opts: ImportOptions = {
      mode: batch.mode,
      collectionId: batch.collectionId,
      signal: signalFor(entry, laneSignal),
      ...(title !== undefined ? { title } : {}),
      ...(extra.allowDuplicate ? { allowDuplicate: true } : {}),
      ...(extra.onBytes ? { onBytes: extra.onBytes } : {}),
    };
    try {
      return await deps.importer().importOne(entry.path, opts);
    } catch (e) {
      // importOne never throws; deps.importer() does when no library is open.
      const le = toLearnError(e);
      return { status: 'failed', path: entry.path, code: le.code, message: le.message };
    }
  }

  async function take(entry: Entry, outcome: ImportOutcome): Promise<void> {
    const report = entry.run.report;
    if (outcome.status === 'imported') {
      report.imported++;
      if (outcome.collectionId !== undefined) report.filed++;
      added.push(outcome.item.id);
      announcer.request();
      if (entry.batch.afterCommit) {
        try {
          await entry.batch.afterCommit(outcome);
        } catch (e) {
          warn(`[import] the step after a commit failed: ${toLearnError(e).code}`);
        }
      }
    } else if (outcome.status === 'failed' && outcome.code !== 'CANCELLED') {
      report.failed.push({ name: entry.name, message: outcome.message });
    }
  }

  /** A file's outcome into its run: a duplicate waits for the end, anything else is done. */
  async function settle(entry: Entry, outcome: ImportOutcome): Promise<void> {
    const { run } = entry;
    if (outcome.status === 'duplicate') {
      if (!run.cancelled) run.duplicates.push({ entry, existingItemId: outcome.existingItemId });
      return;
    }
    await take(entry, outcome);
    run.done++;
  }

  async function importFile(entry: Entry, laneSignal: AbortSignal): Promise<void> {
    const { run } = entry;
    current = entry;
    try {
      await entry.sized;
      if (!run.cancelled) {
        const outcome = await importOnce(entry, laneSignal, {
          onBytes: (bytes) => {
            entry.read = Math.min(entry.size, entry.read + bytes);
            progress.request();
          },
        });
        run.bytesFinished += entry.size;
        entry.read = 0;
        await settle(entry, outcome);
      }
    } finally {
      current = null;
    }
    if (run.cancelled) finishRun(run);
    progress.request();
  }

  async function ask(entry: Entry, existing: DuplicateCard, laneSignal: AbortSignal): Promise<DuplicateAnswer> {
    try {
      return await deps.ask(entry.batch.owner, { fileName: entry.name, existing, remaining: entry.run.duplicates.length }, signalFor(entry, laneSignal));
    } catch (e) {
      warn(`[import] the duplicate question failed: ${toLearnError(e).code}`);
      return SKIP;
    }
  }

  async function settleDuplicate(dup: PendingDuplicate, laneSignal: AbortSignal): Promise<void> {
    const { entry } = dup;
    const { run, batch } = entry;
    current = entry;
    try {
      const existing = deps.card(dup.existingItemId);
      if (existing === null) {
        // The item it matched left the library meanwhile (the trash): the file is no longer its duplicate.
        if (entry.retried) {
          run.done++;
          return;
        }
        entry.retried = true;
        await settle(entry, await importOnce(entry, laneSignal, {}));
        return;
      }
      let choice: DuplicateChoice;
      if (run.sticky !== null) choice = run.sticky;
      else {
        phase = 'waiting-choice';
        progress.request();
        const answer = await ask(entry, existing, laneSignal);
        phase = 'running';
        if (run.cancelled) return;
        choice = answer.choice;
        if (answer.applyToRest && run.duplicates.length > 0) run.sticky = choice === 'open' ? 'skip' : choice;
        if (choice === 'open') run.openIn = answer.askedOn;
      }
      if (choice === 'open') run.report.openItemId = dup.existingItemId;
      else if (choice === 'add') await take(entry, await importOnce(entry, laneSignal, { allowDuplicate: true }));
      else if (batch.collectionId !== null) {
        const ids = run.skipped.get(batch.collectionId) ?? [];
        ids.push(dup.existingItemId);
        run.skipped.set(batch.collectionId, ids);
      }
      run.done++;
    } finally {
      current = null;
      if (run.cancelled) finishRun(run);
      progress.request();
    }
  }

  function finishRun(run: Run): void {
    if (run.finished) return;
    run.finished = true;
    if (active === run) active = null;
    if (stopping === run) stopping = null;
    // 건너뛰기 in an import into a collection: the existing item goes there instead, once the questions are over.
    for (const [collectionId, itemIds] of run.skipped) {
      try {
        run.report.filedExisting += deps.fileExisting(collectionId, itemIds);
      } catch (e) {
        warn(`[import] filing the existing items failed: ${toLearnError(e).code}`);
      }
    }
    announcer.flush();
    const report: ImportReport = {
      ...run.report,
      failed: [...run.report.failed],
      requested: run.total,
      cancelled: run.cancelled,
      mode: only(run.modes),
      collectionId: only(run.collections),
    };
    for (const cb of [...finishedListeners]) {
      try {
        cb(report, run.openIn);
      } catch (e) {
        warn(`[import] a finished listener failed: ${toLearnError(e).code}`);
      }
    }
    progress.request();
  }

  function cancel(): void {
    const run = active;
    if (run === null) return;
    run.cancelled = true;
    active = null;
    pending.length = 0;
    run.duplicates.length = 0;
    run.abort.abort();
    // The file under way stops at its next checkpoint; the report waits for it (one it committed meanwhile still counts).
    if (current !== null && current.run === run) stopping = run;
    else finishRun(run);
    progress.request();
  }

  return {
    enqueue,
    cancel,
    state,
    onProgress(cb) {
      progressListeners.add(cb);
      return () => {
        progressListeners.delete(cb);
      };
    },
    onFinished(cb) {
      finishedListeners.add(cb);
      return () => {
        finishedListeners.delete(cb);
      };
    },
  };
}
