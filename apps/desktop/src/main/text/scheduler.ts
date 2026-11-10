import type { TextRepository } from '@learn/db';
import { TEXT_LIMITS, nowIso, toLearnError, type LibraryChangeReason } from '@learn/domain';
import type { ExtractOutcome, TextExtractor } from './extractor';
import { guardStoredText } from './page-text';

export interface TextScheduler {
  /** The main window's first ui:reportIdle. */
  firstIdle(): void;
  /** The startup check's first run ended: jobs it found running are interrupted now. */
  startupChecked(): void;
  /** An import ended, an item came back from the trash, or the work line emptied. */
  wake(): void;
  /** The trash, a restore, a purge or an import: the index progress is asked for again; a running job whose file has no live PDF left is stopped. */
  libraryChanged(reason: LibraryChangeReason): void;
  /** E2E: 'now' skips the five seconds but still waits for the startup check. */
  control(mode: 'pause' | 'resume' | 'now'): void;
  /** E2E: holds the write of the batch after the one that brought the job's written pages to `afterPages` or more; null lets go and forgets. */
  hold(afterPages: number | null): void;
  held(): boolean;
  /** Resolves when no PDF outside the trash has a queued job and nothing runs. */
  idle(): Promise<void>;
  stats(): { batchMs: number[]; pagesWritten: number; activeMs: number };
  /** What it is waiting for and what it did last (E2E's textState): flags and codes only. */
  state(): TextSchedulerState;
  /** Kills the worker; a running job is requeued and gets its attempt back (a SIGKILL leaves it to the next startup check). */
  dispose(): void;
}

export interface TextSchedulerDeps {
  repo(): TextRepository | null;
  extractor: TextExtractor;
  laneBusy(): boolean;
  laneIdle(): Promise<void>;
  /** The path of a readable copy of the file, or null when none is there. */
  file(sha256: string): string | null;
  assetsDir: string;
  announce(itemIds: string[]): void;
  /** The index progress changed (the caller throttles it). */
  progress(): void;
  /** Send the progress now: the queue emptied or a job gave up. */
  progressNow(): void;
  /** Under E2E nothing runs until control('resume' | 'now'). */
  paused: boolean;
  now?(): string;
  delay?(ms: number): Promise<void>;
}

const BATCH_TIMES_KEPT = 5000;
/** The newest steps state() reports: enough for a session's start and the run that follows. */
export const EVENTS_KEPT = 64;

/** One step of the scheduler, as state() reports it. The detail is a mode, a reason, a code or a job id's first characters, never a file name or a title. */
export interface TextSchedulerEvent {
  /** Epoch ms (Date.now), comparable with main's perf marks and a trace's wall time. */
  at: number;
  what:
    | 'firstIdle' | 'startupChecked' | 'control' | 'start-waits' | 'delay' | 'begin' | 'kick-refused' | 'wake' | 'libraryChanged'
    | 'loop-start' | 'loop-end' | 'lane-wait' | 'lane-free' | 'job-start' | 'job-skip' | 'job-end' | 'loop-error'
    | 'idle-wait' | 'idle-settled' | 'stop' | 'dispose';
  detail?: string;
}

export interface TextSchedulerState {
  live: boolean;
  paused: boolean;
  looping: boolean;
  disposed: boolean;
  sawFirstIdle: boolean;
  sawChecked: boolean;
  skipDelay: boolean;
  delayStarted: boolean;
  delayDone: boolean;
  dirty: boolean;
  /** The running job's id, its first eight characters. */
  current: string | null;
  /** Files skipped for the session: no readable copy. */
  unavailable: number;
  laneBusy: boolean;
  /** idle() calls not answered yet. */
  idleWaiters: number;
  /** The code of the last error that stopped the loop. */
  lastError: string | null;
  events: TextSchedulerEvent[];
}

/** A job id as the trail shows it: enough to tell two jobs apart. */
const short = (jobId: string): string => jobId.slice(0, 8);
/**
 * What stopped the loop, as codes only (the logging rule): toLearnError's code, with the thrown value's own code (an errno or
 * SQLite's result code) or, for an INTERNAL, its class (TypeError) — those tell apart what INTERNAL alone does not.
 */
export function errorCode(e: unknown): string {
  const code = toLearnError(e).code;
  const own = (e as { code?: unknown } | null)?.code;
  if (typeof own === 'string' && /^[A-Z][A-Z0-9_]*$/.test(own) && own !== code) return `${code}/${own}`;
  if (code === 'INTERNAL' && e instanceof Error && /^[A-Za-z]+$/.test(e.name)) return `${code}/${e.name}`;
  return code;
}

export function createTextScheduler(d: TextSchedulerDeps): TextScheduler {
  const now = d.now ?? nowIso;
  const delay = d.delay ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let paused = d.paused;
  let sawFirstIdle = false;
  let sawChecked = false;
  let skipDelay = false;
  let delayStarted = false;
  let delayDone = false;
  let live = false;
  let looping = false;
  let dirty = false;
  let disposed = false;
  /** Files with no readable copy, left alone for the session. */
  const unavailable = new Set<string>();
  let current: { jobId: string; sha256: string } | null = null;
  /** The job whose run the trash or a purge stopped: its attempt is given back. */
  let stoppedByLibrary: string | null = null;
  let holdAfter: number | null = null;
  const holders: Array<(keepGoing: boolean) => void> = [];
  let idleWaiters: Array<() => void> = [];
  const stats = { batchMs: [] as number[], pagesWritten: 0, activeMs: 0 };
  let lastError: string | null = null;
  const events: TextSchedulerEvent[] = [];
  const note = (what: TextSchedulerEvent['what'], detail?: string): void => {
    events.push(detail === undefined ? { at: Date.now(), what } : { at: Date.now(), what, detail });
    if (events.length > EVENTS_KEPT) events.splice(0, events.length - EVENTS_KEPT);
  };

  const releaseHolders = (keepGoing: boolean): void => {
    for (const go of holders.splice(0)) go(keepGoing);
  };

  const isIdle = (): boolean => {
    if (disposed) return true;
    if (looping) return false;
    // Waiting for its first start: whatever the startup check is about to hand back is not counted yet.
    if (!live && !paused) return false;
    const repo = d.repo();
    return repo === null || repo.next(unavailable) === undefined;
  };
  const settleIdle = (): void => {
    if (idleWaiters.length === 0 || !isIdle()) return;
    note('idle-settled', String(idleWaiters.length));
    for (const go of idleWaiters.splice(0)) go();
  };

  const begin = (): void => {
    if (live || disposed || paused) return;
    live = true;
    dirty = true;
    note('begin');
    kick();
  };
  const maybeStart = (): void => {
    if (live || disposed) return;
    // What the first start still waits for: the trail shows which signal never came.
    const waits = paused ? 'paused' : !sawFirstIdle ? 'firstIdle' : !sawChecked ? 'startupChecked' : null;
    if (waits !== null) {
      note('start-waits', waits);
      return;
    }
    if (skipDelay || delayDone) {
      begin();
      return;
    }
    if (delayStarted) return;
    delayStarted = true;
    note('delay', 'start');
    void delay(TEXT_LIMITS.startDelayMs).then(() => {
      delayDone = true;
      note('delay', 'done');
      maybeStart();
    });
  };
  const kick = (): void => {
    const refused = !live ? 'not-live' : looping ? 'looping' : disposed ? 'disposed' : paused ? 'paused' : null;
    if (refused !== null) {
      note('kick-refused', refused);
      return;
    }
    void runLoop();
  };

  const stopCurrent = (): void => {
    note('stop', 'library');
    stoppedByLibrary = current?.jobId ?? null;
    d.extractor.stop();
    releaseHolders(false);
  };

  async function runJob(repo: TextRepository, job: NonNullable<ReturnType<TextRepository['next']>>): Promise<ExtractOutcome | null> {
    const file = d.file(job.sha256);
    if (file === null) {
      unavailable.add(job.sha256);
      note('job-skip', `${short(job.id)} unavailable`);
      return null;
    }
    const started = repo.start(job.id, now());
    if (started === undefined) {
      note('job-skip', `${short(job.id)} not-queued`);
      return null;
    }
    if ('gaveUp' in started) {
      note('job-skip', `${short(job.id)} gave-up`);
      d.announce(repo.itemIdsOfSha(job.sha256));
      // Nothing settles a job that gave up: its own notice, sent now, counts it as answered.
      d.progress();
      d.progressNow();
      return null;
    }
    const { payload } = started.job;
    current = { jobId: job.id, sha256: job.sha256 };
    stoppedByLibrary = null;
    note('job-start', short(job.id));
    const began = performance.now();
    try {
      return await d.extractor.run(
        {
          jobId: job.id,
          file,
          startPage: payload.nextPage,
          // The worker counts characters from zero on every run: a resumed document gets what is left of the whole.
          limits: {
            maxPages: TEXT_LIMITS.maxPages,
            maxPageChars: TEXT_LIMITS.maxPageChars,
            maxDocChars: Math.max(0, TEXT_LIMITS.maxDocChars - payload.chars),
            maxFileBytes: TEXT_LIMITS.maxFileBytes,
          },
          assetsDir: d.assetsDir,
        },
        {
          opened: (pages) => void repo.opened(job.id, pages, now()),
          pages: (from, texts) => {
            const t0 = performance.now();
            const written = repo.writePages(job.id, from, texts.map((t) => guardStoredText(t, TEXT_LIMITS.maxPageChars)), now());
            if (!written) return false;
            stats.batchMs.push(performance.now() - t0);
            if (stats.batchMs.length > BATCH_TIMES_KEPT) stats.batchMs.splice(0, stats.batchMs.length - BATCH_TIMES_KEPT);
            stats.pagesWritten += texts.length;
            d.progress();
            if (holdAfter !== null && from + texts.length >= holdAfter) return new Promise<boolean>((go) => holders.push(go));
            return true;
          },
        },
      );
    } finally {
      stats.activeMs += performance.now() - began;
      current = null;
    }
  }

  function settle(repo: TextRepository, job: { id: string; sha256: string }, outcome: ExtractOutcome): void {
    note('job-end', `${short(job.id)} ${outcome.kind}`);
    switch (outcome.kind) {
      case 'done':
        repo.finish(job.id, { pages: outcome.pages, truncated: outcome.truncated }, now());
        d.announce(repo.itemIdsOfSha(job.sha256));
        break;
      case 'failed':
        repo.fail(job.id, outcome.reason, now());
        d.announce(repo.itemIdsOfSha(job.sha256));
        break;
      case 'stopped':
        if (stoppedByLibrary === job.id) repo.requeue(job.id, now());
        else repo.release(job.id, now());
        break;
      default:
        // The state does not change for the screen: the job is back in the queue, its attempt counted.
        repo.release(job.id, now());
    }
    // Asked for after the state changed; the throttle sends it, and the end of the queue sends what is left.
    d.progress();
  }

  async function runLoop(): Promise<void> {
    looping = true;
    note('loop-start');
    let ended = 'error';
    try {
      for (;;) {
        const repo = d.repo();
        if (disposed || paused || repo === null) {
          ended = disposed ? 'disposed' : paused ? 'paused' : 'no-repo';
          return;
        }
        if (dirty) {
          dirty = false;
          repo.requeueInterrupted(now());
          repo.backfill(now());
        }
        if (d.laneBusy()) {
          note('lane-wait');
          await d.laneIdle();
          note('lane-free');
          continue;
        }
        const job = repo.next(unavailable);
        if (job === undefined) {
          ended = 'empty';
          d.progress();
          d.progressNow();
          return;
        }
        let outcome: ExtractOutcome | null;
        try {
          outcome = await runJob(repo, job);
        } catch (e) {
          if (!disposed) repo.release(job.id, now());
          throw e;
        }
        // Disposed: the database may be closed, and dispose() already put the job back.
        if (disposed) {
          ended = 'disposed';
          return;
        }
        if (outcome !== null) settle(repo, job, outcome);
      }
    } catch (e) {
      lastError = errorCode(e);
      note('loop-error', lastError);
      console.warn(`[text] the body text loop stopped: ${lastError}`); // codes only: no names in a log
    } finally {
      note('loop-end', ended);
      looping = false;
      releaseHolders(false);
      settleIdle();
    }
  }

  return {
    firstIdle() {
      sawFirstIdle = true;
      note('firstIdle');
      maybeStart();
    },
    startupChecked() {
      sawChecked = true;
      note('startupChecked');
      maybeStart();
    },
    wake() {
      dirty = true;
      note('wake');
      kick();
    },
    libraryChanged(reason) {
      if (disposed) return;
      note('libraryChanged', reason);
      // The PDF counts of the index progress moved (a file in or out of the trash, imported, purged), whether or not a job runs.
      if (reason === 'trash' || reason === 'restore' || reason === 'purge' || reason === 'import') d.progress();
      if (reason === 'import') return;
      if (reason === 'restore') {
        dirty = true;
        // Not inside the handler of the restore that announced it.
        setImmediate(kick);
        return;
      }
      const repo = d.repo();
      const running = current;
      if (!repo || !running) return;
      if (reason === 'trash') {
        if (!repo.hasLiveItem(running.sha256)) stopCurrent();
      } else if (reason === 'purge') {
        // The purge took the job away when the last asset of the file left; a purge of anything else leaves it be.
        if (!repo.hasJob(running.sha256)) stopCurrent();
      }
    },
    control(mode) {
      note('control', mode);
      if (disposed) return;
      if (mode === 'pause') {
        paused = true;
        return;
      }
      paused = false;
      if (mode === 'now') skipDelay = true;
      if (live) {
        kick();
      } else {
        maybeStart();
      }
    },
    hold(afterPages) {
      holdAfter = afterPages;
      if (afterPages === null) releaseHolders(true);
    },
    held: () => holders.length > 0,
    idle() {
      if (isIdle()) return Promise.resolve();
      note('idle-wait');
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
    stats: () => ({ batchMs: [...stats.batchMs], pagesWritten: stats.pagesWritten, activeMs: stats.activeMs }),
    state: () => ({
      live, paused, looping, disposed, sawFirstIdle, sawChecked, skipDelay, delayStarted, delayDone, dirty,
      current: current === null ? null : short(current.jobId),
      unavailable: unavailable.size,
      laneBusy: d.laneBusy(),
      idleWaiters: idleWaiters.length,
      lastError,
      events: events.map((e) => ({ ...e })),
    }),
    dispose() {
      note('dispose');
      disposed = true;
      // A quit is not a failure: the running job goes back to the queue with its attempt given back (a kill leaves it running, counted).
      const repo = d.repo();
      if (repo && current) repo.requeue(current.jobId, now());
      d.extractor.dispose();
      releaseHolders(false);
      settleIdle();
    },
  };
}
