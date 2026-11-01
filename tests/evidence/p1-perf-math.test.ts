import { describe, expect, it } from 'vitest';
import { limitFailures } from './budget';
import { M5_APP_READY_MS, P1_BUDGET, jobSpan, maxInWindow, mbPerSecond, meanRate, p1Limits, spread, summary, type JobNotice } from './p1-perf-math';

describe('p1-perf arithmetic (M6 spec 14)', () => {
  it('the most notices inside any one second, the window half-open', () => {
    const tenPerSecond = Array.from({ length: 10 }, (_, i) => i * 100);
    expect(maxInWindow(tenPerSecond)).toBe(10);
    expect(maxInWindow([...tenPerSecond, 1000])).toBe(10); // 1000 starts the next second
    expect(maxInWindow([...tenPerSecond, 950])).toBe(11);
    expect(maxInWindow([900, 0, 500])).toBe(3); // unsorted input
    expect(maxInWindow([])).toBe(0);
    expect(maxInWindow([0, 30, 60], 50)).toBe(2);
  });
  it('the mean rate over the span of the notices', () => {
    expect(meanRate([0, 100, 200, 300])).toBe(10);
    expect(meanRate([300, 0, 150])).toBe(6.7);
    expect(meanRate([5])).toBe(0);
    expect(meanRate([5, 5])).toBe(0);
  });
  it('MB per second (10^6 bytes), a tenth; nothing for no time', () => {
    expect(mbPerSecond(64_000_000, 1000)).toBe(64);
    expect(mbPerSecond(67_108_864, 500)).toBe(134.2);
    expect(mbPerSecond(1, 0)).toBe(0);
  });
  it("a job's span: its first running notice to its idle notice that says done", () => {
    const log: JobNotice[] = [
      { t: 10, kind: 'backup', state: 'running', outcome: null },
      { t: 110, kind: 'backup', state: 'running', outcome: null },
      { t: 1010, kind: 'backup', state: 'idle', outcome: 'done' },
      { t: 2000, kind: 'restore', state: 'running', outcome: null },
      { t: 2500, kind: 'restore', state: 'idle', outcome: 'cancelled' },
    ];
    expect(jobSpan(log, 'backup')).toBe(1000);
    expect(jobSpan(log, 'restore')).toBeNull(); // cancelled: no throughput
    expect(jobSpan(log, 'import')).toBeNull();
  });
  it('summary and spread round to a tenth; a spread of nothing is zeros', () => {
    expect(summary([3.14, 1.26, 2.25])).toEqual({ runs: [3.1, 1.3, 2.3], median: 2.3, max: 3.1 });
    expect(spread([1, 2, 3, 4, 100])).toEqual({ samples: 5, median: 3, p95: 100, max: 100 });
    expect(spread([])).toEqual({ samples: 0, median: 0, p95: 0, max: 0 });
  });
  it('names every spec 14 budget it is given — the rate in /s — and cold start against the M5 value of the platform', () => {
    const all = p1Limits(
      { importPickMs: 1, importDropMs: 1, progressPerSecond: 1, toastPaintP95Ms: 1, trashRedrawMs: 1, trashViewOpenMs: 1, purgeTransactionMs: 1, startupCheckMs: 1, coldStartMs: 1 },
      'linux',
    );
    expect(all.map((l) => l.budget)).toEqual([50, 50, 10, 16.7, 300, 300, 500, 2000, 675]);
    expect(all.filter((l) => l.unit === '/s').map((l) => l.what)).toEqual(['import:progress notices in any one second']);
    expect(p1Limits({ coldStartMs: 1 }, 'darwin')).toEqual([expect.objectContaining({ budget: M5_APP_READY_MS['darwin'] })]);
    expect(p1Limits({ coldStartMs: 1 }, 'win32')).toEqual([]);
    expect(p1Limits({}, 'linux')).toEqual([]);
    expect(P1_BUDGET).toEqual({ importAnswerMs: 50, progressPerSecond: 10, toastPaintP95Ms: 16.7, trashRedrawMs: 300, trashViewOpenMs: 300, purgeTransactionMs: 500, startupCheckMs: 2000 });
  });
  it('with limitFailures: a line fails beyond twice its budget, in its own unit', () => {
    expect(limitFailures(p1Limits({ importPickMs: 100, progressPerSecond: 20, toastPaintP95Ms: 33.4 }, 'linux'))).toEqual([]);
    expect(limitFailures(p1Limits({ importPickMs: 101, progressPerSecond: 21 }, 'linux'))).toEqual([
      '파일 가져오기… of 1,000 files → the queue answered, median: 101 ms against the Linux CI limit 100 ms (budget 50 ms)',
      'import:progress notices in any one second: 21 /s against the Linux CI limit 20 /s (budget 10 /s)',
    ]);
    expect(limitFailures(p1Limits({ coldStartMs: 1351 }, 'linux'))).toEqual([
      'cold start → app-ready of an empty library, median (budget: the M5 value): 1351 ms against the Linux CI limit 1350 ms (budget 675 ms)',
    ]);
  });
});
