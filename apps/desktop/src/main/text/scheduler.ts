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
  /** The trash, a restore or a purge: a running job whose file has no live PDF left is stopped. */
  libraryChanged(reason: LibraryChangeReason): void;
  /** E2E: 'now' skips the five seconds but still waits for the startup check. */
  control(mode: 'pause' | 'resume' | 'now'): void;
  /** E2E: holds the write of the batch after the one that brought the job's written pages to `afterPages` or more; null lets go and forgets. */
  hold(afterPages: number | null): void;
  held(): boolean;
  /** Resolves when no PDF outside the trash has a queued job and nothing runs. */
  idle(): Promise<void>;
  stats(): { batchMs: number[]; pagesWritten: number; activeMs: number };
  /** Kills the worker; a running job stays 'running' and the next startup check interrupts it. */
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
    for (const go of idleWaiters.splice(0)) go();
  };

  const begin = (): void => {
    if (live || disposed || paused) return;
    live = true;
    dirty = true;
    kick();
  };
  const maybeStart = (): void => {
    if (live || disposed || paused || !sawFirstIdle || !sawChecked) return;
    if (skipDelay || delayDone) {
      begin();
      return;
    }
    if (delayStarted) return;
    delayStarted = true;
    void delay(TEXT_LIMITS.startDelayMs).then(() => {
      delayDone = true;
      maybeStart();
    });
  };
  const kick = (): void => {
    if (!live || looping || disposed || paused) return;
    void runLoop();
  };

  const stopCurrent = (): void => {
    stoppedByLibrary = current?.jobId ?? null;
    d.extractor.stop();
    releaseHolders(false);
  };

  async function runJob(repo: TextRepository, job: NonNullable<ReturnType<TextRepository['next']>>): Promise<ExtractOutcome | null> {
    const file = d.file(job.sha256);
    if (file === null) {
      unavailable.add(job.sha256);
      return null;
    }
    const started = repo.start(job.id, now());
    if (started === undefined) return null;
    if ('gaveUp' in started) {
      d.announce(repo.itemIdsOfSha(job.sha256));
      // Nothing settles a job that gave up: its own notice, sent now, counts it as answered.
      d.progress();
      d.progressNow();
      return null;
    }
    const { payload } = started.job;
    current = { jobId: job.id, sha256: job.sha256 };
    stoppedByLibrary = null;
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
    try {
      for (;;) {
        const repo = d.repo();
        if (disposed || paused || repo === null) return;
        if (dirty) {
          dirty = false;
          repo.requeueInterrupted(now());
          repo.backfill(now());
        }
        if (d.laneBusy()) {
          await d.laneIdle();
          continue;
        }
        const job = repo.next(unavailable);
        if (job === undefined) {
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
        if (disposed) return;
        if (outcome !== null) settle(repo, job, outcome);
      }
    } catch (e) {
      console.warn(`[text] the body text loop stopped: ${toLearnError(e).code}`); // the code only: no names in a log
    } finally {
      looping = false;
      releaseHolders(false);
      settleIdle();
    }
  }

  return {
    firstIdle() {
      sawFirstIdle = true;
      maybeStart();
    },
    startupChecked() {
      sawChecked = true;
      maybeStart();
    },
    wake() {
      dirty = true;
      kick();
    },
    libraryChanged(reason) {
      if (disposed) return;
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
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
    stats: () => ({ batchMs: [...stats.batchMs], pagesWritten: stats.pagesWritten, activeMs: stats.activeMs }),
    dispose() {
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
