import { describe, expect, it } from 'vitest';
import { createJobLane } from './lane';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
/** Resolves when `signal` aborts (at once if it already has). */
const untilAborted = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => (signal.aborted ? resolve() : signal.addEventListener('abort', () => resolve(), { once: true })));
const ticks = async (n = 3) => {
  for (let i = 0; i < n; i++) await Promise.resolve();
};

describe('the work line (spec 3.1)', () => {
  it('runs one job at a time, in the order asked', async () => {
    const lane = createJobLane();
    const log: string[] = [];
    const first = deferred();
    const a = lane.run('import', async () => {
      log.push('import start');
      await first.promise;
      log.push('import end');
      return 1;
    });
    const b = lane.run('backup', async () => {
      log.push('backup');
      return 2;
    });
    const c = lane.run('restore', async () => {
      log.push('restore');
      return 3;
    });
    await ticks();
    expect(log).toEqual(['import start']);
    first.resolve();
    expect(await Promise.all([a, b, c])).toEqual([1, 2, 3]);
    expect(log).toEqual(['import start', 'import end', 'backup', 'restore']);
  });

  it('busy() names the running job from the moment it is asked for, and is null when idle', async () => {
    const lane = createJobLane();
    expect(lane.busy()).toBe(null);
    const hold = deferred();
    const job = lane.run('backup', () => hold.promise);
    expect(lane.busy()).toBe('backup');
    hold.resolve();
    await job;
    expect(lane.busy()).toBe(null);
  });

  it('cancelCurrent aborts the running job only: the next one still runs, with a fresh signal', async () => {
    const lane = createJobLane();
    const a = lane.run('import', (signal) => untilAborted(signal).then(() => 'stopped'));
    const b = lane.run('backup', async (signal) => (signal.aborted ? 'aborted' : 'ran'));
    await ticks();
    lane.cancelCurrent();
    expect(await a).toBe('stopped');
    expect(await b).toBe('ran');
  });

  it('cancelAll stops the running job and drops the waiting ones with CANCELLED: their work never runs', async () => {
    const lane = createJobLane();
    const ran: string[] = [];
    const a = lane.run('import', (signal) => untilAborted(signal).then(() => 'stopped'));
    const b = lane.run('backup', async () => {
      ran.push('backup');
    });
    const c = lane.run('restore', async () => {
      ran.push('restore');
    });
    lane.cancelAll();
    expect(await a).toBe('stopped');
    await expect(b).rejects.toMatchObject({ code: 'CANCELLED' });
    await expect(c).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(ran).toEqual([]);
    await lane.idle();
    expect(lane.busy()).toBe(null);
    // The line takes new work afterwards.
    expect(await lane.run('import', async () => 'again')).toBe('again');
  });

  it('idle() resolves at once when idle, else once nothing runs and nothing waits', async () => {
    const lane = createJobLane();
    await lane.idle();
    const hold = deferred();
    void lane.run('import', () => hold.promise);
    void lane.run('backup', async () => {});
    let idle = false;
    void lane.idle().then(() => {
      idle = true;
    });
    await ticks();
    expect(idle).toBe(false);
    hold.resolve();
    await lane.idle();
    expect(idle).toBe(true);
    expect(lane.busy()).toBe(null);
  });

  it('a job that fails, even before its first await, frees the line for the next', async () => {
    const lane = createJobLane();
    const a = lane.run('import', async () => {
      throw new Error('disk gone');
    });
    const b = lane.run('backup', () => {
      throw new Error('at once');
    });
    const c = lane.run('restore', async () => 'ran');
    await expect(a).rejects.toThrow('disk gone');
    await expect(b).rejects.toThrow('at once');
    expect(await c).toBe('ran');
  });
});
