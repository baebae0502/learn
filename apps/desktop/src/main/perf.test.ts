import { describe, expect, it } from 'vitest';
import { markPerf, perf } from './perf';

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
