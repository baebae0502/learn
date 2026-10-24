import { describe, expect, it } from 'vitest';
import type { Result } from '@learn/domain';
import { ApiError } from '../api';
import type { ToastData } from '../ui/toasts';
import { FILE_BUSY_DELAY_MS, busyToast, fileActionRunner, whenPanelCloses, type BusyToastDeps } from './fileActions';

/** Fake timers and toasts: `tick(ms)` runs what has come due, then lets promise callbacks run. */
function harness() {
  let now = 0;
  let nextId = 1;
  const timers: Array<{ at: number; fn: () => void; id: number }> = [];
  const shown: Array<{ key: string; data: ToastData }> = [];
  const closed: string[] = [];
  const deps: BusyToastDeps = {
    show: (data) => {
      const key = `t${shown.length + 1}`;
      shown.push({ key, data });
      return key;
    },
    close: (key) => void closed.push(key),
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const tick = async (ms: number) => {
    now += ms;
    for (const t of timers.filter((x) => x.at <= now)) {
      timers.splice(timers.indexOf(t), 1);
      t.fn();
    }
    await flush();
  };
  return { run: fileActionRunner(deps), shown, closed, tick };
}
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
/** A call main has not answered yet. */
function pending<T>() {
  let answer: (r: Result<T>) => void = () => {};
  const promise = new Promise<Result<T>>((r) => (answer = r));
  return { promise, answer: (r: Result<T>) => answer(r) };
}

describe('a slow first copy says so (P-12; nothing under 300 ms)', () => {
  it('a call that answers within 300 ms shows nothing', async () => {
    const h = harness();
    const call = pending<void>();
    const done = h.run('open', '세포 신호', () => call.promise);
    await h.tick(FILE_BUSY_DELAY_MS - 1);
    call.answer({ ok: true, data: undefined });
    await done;
    await h.tick(1000);
    expect(h.shown).toEqual([]);
  });

  it('past 300 ms: 여는 중… with the item title, taken down when main answers; the data comes back', async () => {
    const h = harness();
    const call = pending<number>();
    const done = h.run('reveal', '세포 신호', () => call.promise);
    await h.tick(FILE_BUSY_DELAY_MS);
    expect(h.shown.map((s) => s.data)).toEqual([{ kind: 'busy', title: '여는 중…', lines: ['세포 신호'], testId: 'file-busy' }]);
    call.answer({ ok: true, data: 7 });
    expect(await done).toBe(7);
    expect(h.closed).toEqual(['t1']);
  });

  it('a refusal comes back as an ApiError and takes the busy toast down too', async () => {
    const h = harness();
    const call = pending<{ saved: boolean }>();
    const done = h.run('export', '세포 신호', () => call.promise);
    await h.tick(400);
    expect(h.shown[0]!.data.title).toBe('내보내는 중…');
    call.answer({ ok: false, code: 'DISK_FULL', message: '디스크 공간이 부족합니다.', retryable: true });
    await expect(done).rejects.toBeInstanceOf(ApiError);
    expect(h.closed).toEqual(['t1']);
  });

  it('countFrom: the time before it (the user in the save panel) is not work and is not counted', async () => {
    const h = harness();
    const call = pending<{ saved: boolean }>();
    let panelClosed: () => void = () => {};
    const countFrom = new Promise<void>((r) => (panelClosed = r));
    const done = h.run('export', '세포 신호', () => call.promise, { countFrom });
    await h.tick(2000);
    expect(h.shown).toEqual([]);
    panelClosed();
    await flush();
    await h.tick(FILE_BUSY_DELAY_MS - 1);
    expect(h.shown).toEqual([]);
    await h.tick(1);
    expect(h.shown).toHaveLength(1);
    call.answer({ ok: true, data: { saved: true } });
    await done;
    expect(h.closed).toEqual(['t1']);
  });

  it('a call that ends while its panel is still counted as up (a cancel) never shows anything', async () => {
    const h = harness();
    const call = pending<{ saved: boolean }>();
    const done = h.run('export', '세포 신호', () => call.promise, { countFrom: new Promise<void>(() => {}) });
    call.answer({ ok: true, data: { saved: false } });
    expect(await done).toEqual({ saved: false });
    await h.tick(5000);
    expect(h.shown).toEqual([]);
  });

  it('no title known: the busy toast has its title line only', () => {
    expect(busyToast('open', '')).toEqual({ kind: 'busy', title: '여는 중…', testId: 'file-busy' });
  });
});

describe('the save panel closing, from the windowState push', () => {
  function pushes() {
    const subs = new Set<(s: { sheetOpen: boolean }) => void>();
    return {
      subscribe: (cb: (s: { sheetOpen: boolean }) => void) => {
        subs.add(cb);
        return () => void subs.delete(cb);
      },
      push: (sheetOpen: boolean) => [...subs].forEach((cb) => cb({ sheetOpen })),
      count: () => subs.size,
    };
  }

  it('resolves when the sheet that came has gone (not on a closed state before it came) and stops listening', async () => {
    const p = pushes();
    const w = whenPanelCloses(p.subscribe);
    let closed = false;
    void w.closed.then(() => (closed = true));
    p.push(false);
    await flush();
    expect(closed).toBe(false);
    p.push(true);
    await flush();
    expect(closed).toBe(false);
    p.push(false);
    await flush();
    expect(closed).toBe(true);
    expect(p.count()).toBe(0);
  });

  it('stop unsubscribes when no panel came (the item was missing, or main refused first)', () => {
    const p = pushes();
    whenPanelCloses(p.subscribe).stop();
    expect(p.count()).toBe(0);
  });
});
