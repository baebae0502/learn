import { TEXT_LIMITS } from '@learn/domain';
import { checkWorkerMessage, type ExtractRequest, type WorkerMessage } from './messages';

/** One worker process as the extractor sees it (fork.ts makes the real one; tests make a fake). */
export interface WorkerPort {
  readonly pid: number | undefined;
  postMessage(m: ExtractRequest): void;
  kill(): boolean;
  onMessage(fn: (m: unknown) => void): void;
  onExit(fn: (code: number) => void): void;
}

export interface ExtractEvents {
  opened(pages: number): void;
  /** false stops the job: the worker is killed and the run ends 'stopped'. */
  pages(from: number, texts: string[]): boolean | Promise<boolean>;
}

export type ExtractOutcome =
  | { kind: 'done'; pages: number; truncated: boolean }
  | { kind: 'failed'; reason: 'locked' | 'damaged' | 'too-large' }
  | { kind: 'crashed' }
  | { kind: 'timeout' }
  | { kind: 'bad-message' }
  | { kind: 'stopped' };

export interface TextExtractor {
  /** One job at a time. */
  run(req: Omit<ExtractRequest, 'type'>, events: ExtractEvents): Promise<ExtractOutcome>;
  /** Kills the worker now; the running job ends 'stopped'. */
  stop(): void;
  /** For quitting and library switches. */
  dispose(): void;
}

interface Timing {
  messageGapMs: number;
  jobMs: number;
  restartEvery: number;
  idleMs: number;
}

interface Active {
  port: WorkerPort;
  jobId: string;
  events: ExtractEvents;
  nextPage: number;
  pages: number | null;
  queue: unknown[];
  pumping: boolean;
  exitedWith: number | null;
  settled: boolean;
  gapTimer: unknown;
  jobTimer: unknown;
  settle(outcome: ExtractOutcome): void;
  fail(error: unknown): void;
}

export function createTextExtractor(o: {
  fork: () => WorkerPort;
  timing?: Partial<Timing>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}): TextExtractor {
  const timing: Timing = {
    messageGapMs: TEXT_LIMITS.messageGapMs,
    jobMs: TEXT_LIMITS.jobMs,
    restartEvery: TEXT_LIMITS.restartEvery,
    idleMs: TEXT_LIMITS.idleMs,
    ...o.timing,
  };
  const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));

  let worker: WorkerPort | null = null;
  let jobsOnWorker = 0;
  let idleTimer: unknown = null;
  let active: Active | null = null;
  let disposed = false;

  const clearIdle = (): void => {
    if (idleTimer !== null) clearTimer(idleTimer);
    idleTimer = null;
  };
  const killWorker = (): void => {
    clearIdle();
    const w = worker;
    worker = null;
    jobsOnWorker = 0;
    if (w) {
      try {
        w.kill();
      } catch {
        // Already gone.
      }
    }
  };

  /** The gap clock runs only while the worker owes main a message: nothing queued, nothing being handled, no end message yet. */
  const armGap = (a: Active): void => {
    if (a.gapTimer !== null) clearTimer(a.gapTimer);
    a.gapTimer = null;
    if (a.settled || a.pumping || a.queue.length > 0) return;
    a.gapTimer = setTimer(() => {
      a.gapTimer = null;
      killWorker();
      a.settle({ kind: 'timeout' });
    }, timing.messageGapMs);
  };

  const pump = async (a: Active): Promise<void> => {
    if (a.pumping) return;
    a.pumping = true;
    try {
      while (!a.settled && a.queue.length > 0) {
        const m: WorkerMessage | null = checkWorkerMessage(a.queue.shift(), { jobId: a.jobId, nextPage: a.nextPage, pages: a.pages });
        if (m === null) {
          killWorker();
          a.settle({ kind: 'bad-message' });
          return;
        }
        if (m.type === 'opened') {
          a.pages = m.pages;
          a.events.opened(m.pages);
        } else if (m.type === 'pages') {
          const from = m.from;
          const keepGoing = await a.events.pages(from, m.texts);
          if (a.settled) return;
          a.nextPage = from + m.texts.length;
          if (!keepGoing) {
            killWorker();
            a.settle({ kind: 'stopped' });
            return;
          }
        } else if (m.type === 'done') {
          a.settle({ kind: 'done', pages: m.pages, truncated: m.truncated });
          return;
        } else {
          a.settle({ kind: 'failed', reason: m.reason });
          return;
        }
      }
    } catch (error) {
      killWorker();
      a.fail(error);
      return;
    } finally {
      a.pumping = false;
    }
    if (a.settled) return;
    if (a.exitedWith !== null) a.settle({ kind: 'crashed' });
    else armGap(a);
  };

  function run(req: Omit<ExtractRequest, 'type'>, events: ExtractEvents): Promise<ExtractOutcome> {
    if (disposed) return Promise.resolve({ kind: 'stopped' });
    if (active) return Promise.reject(new Error('text extractor: a job is running already'));
    clearIdle();
    let port: WorkerPort;
    try {
      if (!worker) {
        const fresh = o.fork();
        worker = fresh;
        jobsOnWorker = 0;
        fresh.onMessage((m) => {
          const a = active;
          if (!a || a.port !== fresh || a.settled) return;
          a.queue.push(m);
          if (a.gapTimer !== null) clearTimer(a.gapTimer);
          a.gapTimer = null;
          void pump(a);
        });
        fresh.onExit((code) => {
          if (worker === fresh) {
            worker = null;
            jobsOnWorker = 0;
          }
          const a = active;
          if (!a || a.port !== fresh || a.settled) return;
          a.exitedWith = code;
          // Messages already queued come first: a done followed by exit 0 is a finished job.
          if (!a.pumping && a.queue.length === 0) a.settle({ kind: 'crashed' });
        });
      }
      port = worker;
    } catch {
      return Promise.resolve({ kind: 'crashed' });
    }
    return new Promise<ExtractOutcome>((resolve, reject) => {
      const a: Active = {
        port,
        jobId: req.jobId,
        events,
        nextPage: req.startPage,
        pages: null,
        queue: [],
        pumping: false,
        exitedWith: null,
        settled: false,
        gapTimer: null,
        jobTimer: null,
        settle(outcome) {
          if (a.settled) return;
          a.settled = true;
          if (a.gapTimer !== null) clearTimer(a.gapTimer);
          if (a.jobTimer !== null) clearTimer(a.jobTimer);
          a.gapTimer = a.jobTimer = null;
          if (active === a) active = null;
          if (outcome.kind === 'done') {
            jobsOnWorker += 1;
            if (jobsOnWorker >= timing.restartEvery) killWorker();
            else if (worker === port) idleTimer = setTimer(() => {
              idleTimer = null;
              killWorker();
            }, timing.idleMs);
          } else {
            // After a failure the next job gets a new worker, and a dead or stuck one is not left running.
            if (worker === port) killWorker();
            else {
              try {
                port.kill();
              } catch {
                // Already gone.
              }
            }
          }
          resolve(outcome);
        },
        fail(error) {
          if (a.settled) return;
          a.settled = true;
          if (a.gapTimer !== null) clearTimer(a.gapTimer);
          if (a.jobTimer !== null) clearTimer(a.jobTimer);
          if (active === a) active = null;
          reject(error);
        },
      };
      active = a;
      a.jobTimer = setTimer(() => {
        a.jobTimer = null;
        killWorker();
        a.settle({ kind: 'timeout' });
      }, timing.jobMs);
      try {
        port.postMessage({ type: 'extract', ...req });
      } catch {
        killWorker();
        a.settle({ kind: 'crashed' });
        return;
      }
      armGap(a);
    });
  }

  return {
    run,
    stop() {
      const a = active;
      killWorker();
      a?.settle({ kind: 'stopped' });
    },
    dispose() {
      disposed = true;
      const a = active;
      killWorker();
      a?.settle({ kind: 'stopped' });
    },
  };
}
