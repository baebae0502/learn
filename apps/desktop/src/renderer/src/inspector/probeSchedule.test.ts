import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileFacts, Probe } from './fileFacts';
import { PROBE_DELAY_MS, scheduleProbe, scheduleProbeWhen } from './probeSchedule';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** A probe that answers when told to. */
function fake() {
  let answer!: (facts: FileFacts) => void;
  const done = new Promise<FileFacts>((resolve) => (answer = resolve));
  const probe: Probe = { done, cancel: vi.fn() };
  return { probe, answer, start: vi.fn(() => probe) };
}

describe('the page-count probe waits for a selection to stay (spec 6.4)', () => {
  it('is 150 ms, and reads nothing before it', () => {
    expect(PROBE_DELAY_MS).toBe(150);
    const f = fake();
    scheduleProbe(PROBE_DELAY_MS, f.start, vi.fn());
    vi.advanceTimersByTime(149);
    expect(f.start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(f.start).toHaveBeenCalledTimes(1);
  });
  it('a selection that moves on before the delay never opens the file', () => {
    const f = fake();
    const cancel = scheduleProbe(PROBE_DELAY_MS, f.start, vi.fn());
    vi.advanceTimersByTime(100);
    cancel();
    vi.advanceTimersByTime(1_000);
    expect(f.start).not.toHaveBeenCalled();
    expect(f.probe.cancel).not.toHaveBeenCalled(); // there was nothing to cancel
  });
  it('ten rows passed 20 ms apart read one file: the last row\'s, once the keys stop', () => {
    const rows = Array.from({ length: 10 }, fake);
    let cancel = () => {};
    for (const row of rows) {
      cancel();
      cancel = scheduleProbe(PROBE_DELAY_MS, row.start, vi.fn());
      vi.advanceTimersByTime(20);
    }
    vi.advanceTimersByTime(PROBE_DELAY_MS);
    expect(rows.map((r) => r.start.mock.calls.length)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
  });
  it('hands the facts on', async () => {
    const f = fake();
    const onFacts = vi.fn();
    scheduleProbe(PROBE_DELAY_MS, f.start, onFacts);
    vi.advanceTimersByTime(PROBE_DELAY_MS);
    f.answer({ pages: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onFacts).toHaveBeenCalledExactlyOnceWith({ pages: 3 });
  });
  it('moving on while the file is being read cancels the read and drops its answer', async () => {
    const f = fake();
    const onFacts = vi.fn();
    const cancel = scheduleProbe(PROBE_DELAY_MS, f.start, onFacts);
    vi.advanceTimersByTime(PROBE_DELAY_MS);
    cancel();
    expect(f.probe.cancel).toHaveBeenCalledTimes(1);
    f.answer({ pages: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onFacts).not.toHaveBeenCalled();
  });
});

describe('the probe of a panel that does not need the fact (several items selected)', () => {
  it('starts nothing, however long it waits, and ending it is harmless', () => {
    const f = fake();
    const end = scheduleProbeWhen(false, PROBE_DELAY_MS, f.start, vi.fn());
    vi.advanceTimersByTime(5_000);
    end();
    expect(f.start).not.toHaveBeenCalled();
  });
  it('an enabled one is the plain schedule', () => {
    const f = fake();
    scheduleProbeWhen(true, PROBE_DELAY_MS, f.start, vi.fn());
    vi.advanceTimersByTime(PROBE_DELAY_MS);
    expect(f.start).toHaveBeenCalledTimes(1);
  });
});
