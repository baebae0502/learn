import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE_IMPORT_STATE, type ImportQueueState } from '@learn/domain';
import type { ToastData } from '../ui/toasts';
import { JOB_TOAST_DELAY_MS, createProgressToast, type JobToastView } from './progressToast';

afterEach(() => {
  vi.useRealTimers();
});
const last = (over: Partial<ImportQueueState> = {}): ImportQueueState => ({ ...IDLE_IMPORT_STATE, state: 'running', done: 3, total: 3, ...over });
const DONE: ToastData = { kind: 'success', title: '자료 3개를 가져왔습니다', testId: 'import-done' };
function harness() {
  const added: string[] = [];
  const closed: string[] = [];
  const shown: ToastData[] = [];
  const views = new Map<string, JobToastView>();
  const toast = createProgressToast('import', {
    add: () => {
      const key = `k${added.length + 1}`;
      added.push(key);
      return key;
    },
    close: (key) => void closed.push(key),
    show: (data) => void shown.push(data),
    setView: (key, view) => void views.set(key, view),
  });
  return { toast, added, closed, shown, views };
}

describe('the job progress toast (spec 3.3, P-3)', () => {
  it('a run that ends within 1 s never shows it: its result is a toast of its own', () => {
    vi.useFakeTimers();
    const h = harness();
    h.toast.begin(false);
    vi.advanceTimersByTime(JOB_TOAST_DELAY_MS - 1);
    const key = h.toast.end(last());
    vi.advanceTimersByTime(5000);
    expect(key).toBeNull();
    expect(h.added).toEqual([]);
    h.toast.settle(key, DONE);
    expect(h.shown).toEqual([DONE]);
  });

  it('past 1 s one toast comes and stays; the end freezes it at its last state, and the result takes it over in place', () => {
    vi.useFakeTimers();
    const h = harness();
    h.toast.begin(false);
    vi.advanceTimersByTime(JOB_TOAST_DELAY_MS);
    expect(h.added).toEqual(['k1']);
    vi.advanceTimersByTime(60_000);
    expect(h.added).toEqual(['k1']); // one toast for the run: never closed and shown again
    const key = h.toast.end(last({ done: 3 }));
    expect(key).toBe('k1');
    expect(h.views.get('k1')).toEqual({ kind: 'progress', state: last({ done: 3 }) });
    h.toast.settle(key, DONE);
    expect(h.views.get('k1')).toEqual({ kind: 'result', data: DONE });
    expect([h.closed, h.shown]).toEqual([[], []]);
  });

  it('with nothing to say at the end, the toast that was up closes', () => {
    vi.useFakeTimers();
    const h = harness();
    h.toast.begin(false);
    vi.advanceTimersByTime(JOB_TOAST_DELAY_MS);
    h.toast.settle(h.toast.end(last()), null);
    expect(h.closed).toEqual(['k1']);
    h.toast.settle(null, null); // a short run with nothing to say: nothing at all
    expect(h.shown).toEqual([]);
  });

  it('a quiet run never shows it; the next run waits its own second', () => {
    vi.useFakeTimers();
    const h = harness();
    h.toast.begin(true);
    vi.advanceTimersByTime(10_000);
    expect(h.toast.end(last())).toBeNull();
    h.toast.begin(false);
    vi.advanceTimersByTime(JOB_TOAST_DELAY_MS - 1);
    expect(h.added).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(h.added).toEqual(['k1']);
  });

  it('a run that begins while the last one\'s end is still being shown gets a toast of its own', () => {
    vi.useFakeTimers();
    const h = harness();
    h.toast.begin(false);
    vi.advanceTimersByTime(JOB_TOAST_DELAY_MS);
    const first = h.toast.end(last());
    h.toast.begin(false);
    vi.advanceTimersByTime(JOB_TOAST_DELAY_MS);
    expect(h.added).toEqual(['k1', 'k2']);
    h.toast.settle(first, DONE);
    expect(h.views.get('k1')).toEqual({ kind: 'result', data: DONE });
    expect(h.views.has('k2')).toBe(false); // still following its own run
  });
});
