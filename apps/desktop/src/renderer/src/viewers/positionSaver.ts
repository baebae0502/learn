import type { ReadingLocator } from '@learn/domain';

export type SavePolicy = { kind: 'debounce'; ms: number } | { kind: 'throttle'; ms: number };

export interface SaverDeps {
  policy: SavePolicy;
  /** Performs the save. A rejection is reported through onError and never thrown to callers. */
  send(locator: ReadingLocator, progress: number | null): Promise<unknown>;
  onError?(e: unknown): void;
  /** The locator already stored (or the default start): saving an equal locator is skipped. */
  initial: ReadingLocator;
  now?(): number;
  setTimer?(fn: () => void, ms: number): unknown;
  clearTimer?(id: unknown): void;
}

export interface PositionSaver {
  /** Record the latest position and save according to the policy. */
  update(locator: ReadingLocator, progress: number | null): void;
  /** Save the latest unsent position immediately (pause, seeked, unmount, beforeunload). */
  flush(): void;
  /** Drop timers; pending data is discarded unless flush() was called first. */
  dispose(): void;
}

const keyOf = (l: ReadingLocator) => JSON.stringify(l);

export function createPositionSaver(deps: SaverDeps): PositionSaver {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let lastKey = keyOf(deps.initial);
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let pending: { locator: ReadingLocator; progress: number | null } | null = null;
  let timer: unknown = null;

  const stopTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const sendPending = () => {
    stopTimer();
    const p = pending;
    pending = null;
    if (!p) return;
    const key = keyOf(p.locator);
    if (key === lastKey) return;
    const previous = lastKey;
    lastKey = key;
    lastSentAt = now();
    deps.send(p.locator, p.progress).catch((e: unknown) => {
      if (lastKey === key) lastKey = previous; // let the next change retry
      deps.onError?.(e);
    });
  };

  return {
    update(locator, progress) {
      pending = { locator, progress };
      const { policy } = deps;
      if (policy.kind === 'debounce') {
        stopTimer();
        timer = setTimer(sendPending, policy.ms);
        return;
      }
      const wait = lastSentAt + policy.ms - now();
      if (wait <= 0) sendPending();
      else if (timer === null) timer = setTimer(sendPending, wait);
    },
    flush: sendPending,
    dispose: stopTimer,
  };
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Progress in [0, 1], or null while the total is unknown. */
export function ratio(done: number, total: number): number | null {
  return Number.isFinite(done) && Number.isFinite(total) && total > 0 ? clamp01(done / total) : null;
}

/** 0-based page to open: the saved page clamped into the document; first page when nothing is saved. */
export function restorePageIndex(saved: ReadingLocator | null | undefined, pageCount: number): number {
  if (!saved || saved.kind !== 'pdf' || pageCount < 1) return 0;
  return Math.min(Math.max(0, saved.pageIndex), pageCount - 1);
}

/** Seconds to seek to once metadata is loaded; a (nearly) finished video starts over. */
export function restoreVideoSeconds(saved: ReadingLocator | null | undefined, durationSec: number): number {
  if (!saved || saved.kind !== 'video' || !(saved.timeMs > 0)) return 0;
  if (Number.isFinite(durationSec) && durationSec > 0 && saved.timeMs / 1000 / durationSec >= 0.95) return 0;
  return saved.timeMs / 1000;
}
