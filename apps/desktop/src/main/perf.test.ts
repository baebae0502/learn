import { describe, expect, it } from 'vitest';
import { lastMs, markPerf, perf, timeLast, timeLastAsync } from './perf';

describe('cold-start marks', () => {
  it('start from the process start and are published for app.evaluate', () => {
    expect(perf.processStart).toBe(Math.round(performance.timeOrigin));
    expect((globalThis as { __learnPerf?: unknown }).__learnPerf).toBe(perf);
  });
  it('keep the first time only', async () => {
    expect(perf.ready).toBe(0);
    markPerf('ready');
    const first = perf.ready;
    expect(first).toBeGreaterThanOrEqual(perf.processStart);
    await new Promise((r) => setTimeout(r, 5));
    markPerf('ready');
    expect(perf.ready).toBe(first);
    expect(perf.firstPaint).toBe(0);
  });
});

describe('main-side timings for the evidence (M6 spec 14)', () => {
  it('keep the newest duration of a step, pass its result through, and are published for app.evaluate', () => {
    expect((globalThis as { __learnLastMs?: unknown }).__learnLastMs).toBe(lastMs);
    expect(timeLast('purge', () => 42)).toBe(42);
    expect(lastMs.purge).toBeGreaterThanOrEqual(0);
    timeLast('purge', () => {
      const until = performance.now() + 5;
      while (performance.now() < until) {
        // a step that takes 5 ms
      }
    });
    expect(lastMs.purge!).toBeGreaterThanOrEqual(5);
  });
  it('time a step that throws, and an async one', async () => {
    delete lastMs.emptyTrash;
    expect(() =>
      timeLast('emptyTrash', () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(lastMs.emptyTrash).toBeGreaterThanOrEqual(0);
    delete lastMs.purgeFiles;
    await expect(timeLastAsync('purgeFiles', () => new Promise<string>((r) => setTimeout(() => r('done'), 5)))).resolves.toBe('done');
    expect(lastMs.purgeFiles!).toBeGreaterThanOrEqual(4);
  });
});
