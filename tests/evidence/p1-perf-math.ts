// V/p1-perf-math.ts — the arithmetic of p1-perf.json (M6 spec 14), apart from the app so it is unit-tested.
import type { Limit } from './budget';
import { median, percentile } from './percentile';

/** M6 spec 14; ms unless the name says otherwise. Linux CI fails beyond twice each (budget.ts). */
export const P1_BUDGET = {
  importAnswerMs: 50,
  progressPerSecond: 10,
  toastPaintP95Ms: 16.7,
  trashRedrawMs: 300,
  trashViewOpenMs: 300,
  purgeTransactionMs: 500,
  startupCheckMs: 2000,
} as const;

/**
 * Cold start → app-ready of an empty library, the median of five launches, at the end of M5 (spec 14 "M5 값 이하"): the
 * Linux CI run 41130036868 on main 7e3ce2b (M6's base; its evidence perf.json) and the Mac VM run 41024983289
 * (docs/mac-verification.md). A platform without a value is reported, not checked.
 */
export const M5_APP_READY_MS: Readonly<Record<string, number>> = { linux: 675, darwin: 867 };

export const tenth = (x: number): number => Math.round(x * 10) / 10;

export interface Summary {
  runs: number[];
  median: number;
  max: number;
}
/** Every run and its median and maximum, to a tenth of a millisecond. At least one run. */
export function summary(xs: readonly number[]): Summary {
  return { runs: xs.map(tenth), median: tenth(median(xs)), max: tenth(Math.max(...xs)) };
}

export interface Spread {
  samples: number;
  median: number;
  p95: number;
  max: number;
}
/** Many samples: their count, median, p95 and maximum (zeros when there are none). */
export function spread(xs: readonly number[]): Spread {
  if (xs.length === 0) return { samples: 0, median: 0, p95: 0, max: 0 };
  return { samples: xs.length, median: tenth(median(xs)), p95: tenth(percentile(xs, 95)), max: tenth(Math.max(...xs)) };
}

/** The most of `times` (ms) inside any window [t, t + windowMs): a rate cap is broken by any one second, not by the average. */
export function maxInWindow(times: readonly number[], windowMs = 1000): number {
  const t = [...times].sort((a, b) => a - b);
  let best = 0;
  for (let i = 0, j = 0; i < t.length; i++) {
    while (j < t.length && t[j]! < t[i]! + windowMs) j++;
    best = Math.max(best, j - i);
  }
  return best;
}

/** Notices per second over their span (n − 1 gaps from the first to the last), a tenth; 0 with fewer than two or no span. */
export function meanRate(times: readonly number[]): number {
  if (times.length < 2) return 0;
  const t = [...times].sort((a, b) => a - b);
  const span = t.at(-1)! - t[0]!;
  return span <= 0 ? 0 : tenth(((t.length - 1) * 1000) / span);
}

/** MB (10^6 bytes) per second, a tenth; 0 when no time passed. */
export function mbPerSecond(bytes: number, ms: number): number {
  return ms <= 0 ? 0 : tenth(bytes / 1e6 / (ms / 1000));
}

/** One job:progress notice as the page logged it (performance.now()). */
export interface JobNotice {
  t: number;
  kind: string;
  state: string;
  outcome: string | null;
}
/** A job's run: its first running notice to the idle notice after it that says done; null when it never ran or did not finish. */
export function jobSpan(log: readonly JobNotice[], kind: string): number | null {
  const start = log.find((n) => n.kind === kind && n.state === 'running');
  if (!start) return null;
  const end = log.find((n) => n.kind === kind && n.t >= start.t && n.state === 'idle' && n.outcome === 'done');
  return end ? end.t - start.t : null;
}

/** What a test hands to the Linux CI rule; lines it does not measure are left out. */
export interface P1Values {
  importPickMs?: number;
  importDropMs?: number;
  progressPerSecond?: number;
  toastPaintP95Ms?: number;
  trashRedrawMs?: number;
  trashViewOpenMs?: number;
  purgeTransactionMs?: number;
  startupCheckMs?: number;
  coldStartMs?: number;
}
/** spec 14's lines for the values given, in the table's order; cold start against the M5 value of `platform` (none: unchecked). */
export function p1Limits(v: P1Values, platform: string = process.platform): Limit[] {
  const out: Limit[] = [];
  const add = (value: number | undefined, what: string, budget: number, unit?: string): void => {
    if (value === undefined) return;
    out.push(unit === undefined ? { what, value, budget } : { what, value, budget, unit });
  };
  add(v.importPickMs, '파일 가져오기… of 1,000 files → the queue answered, median', P1_BUDGET.importAnswerMs);
  add(v.importDropMs, 'a drop of 1,000 files → the queue answered, median', P1_BUDGET.importAnswerMs);
  add(v.progressPerSecond, 'import:progress notices in any one second', P1_BUDGET.progressPerSecond, '/s');
  add(v.toastPaintP95Ms, 'progress notice → the toast painted, p95', P1_BUDGET.toastPaintP95Ms);
  add(v.trashRedrawMs, '1,000 to the trash (⌘⌫) → the table redrawn, median', P1_BUDGET.trashRedrawMs);
  add(v.trashViewOpenMs, 'the trash view of 1,000 items → painted, median', P1_BUDGET.trashViewOpenMs);
  add(v.purgeTransactionMs, 'purge of 1,000: the database transaction, median', P1_BUDGET.purgeTransactionMs);
  add(v.startupCheckMs, 'the startup check of 10,000 assets, median', P1_BUDGET.startupCheckMs);
  const m5 = M5_APP_READY_MS[platform];
  if (m5 !== undefined) add(v.coldStartMs, 'cold start → app-ready of an empty library, median (budget: the M5 value)', m5);
  return out;
}
