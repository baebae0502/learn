import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNSTABLE_ToastQueue as ToastQueue } from 'react-aria-components';
import { DismissTimer } from './toastTimer';
import { LearnToastQueue } from './toasts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('a toast that closes by itself (Mac run 2: the drop toast stayed for good)', () => {
  it("RAC's own timer: a pause between the deadline and its task leaves the toast open for good (why we do not use it)", () => {
    const q = new ToastQueue<string>();
    q.add('자료 8개를 가져왔습니다', { timeout: 5000 });
    (q.visibleToasts[0]!.timer as unknown as { reset(ms: number): void }).reset(5000); // what the Toast does on mount
    vi.setSystemTime(Date.now() + 5010); // the deadline has passed, but an input event runs before the timer's task
    q.pauseAll(); // the pointer reaches the toasts
    vi.advanceTimersByTime(10_000);
    q.resumeAll(); // and leaves
    vi.advanceTimersByTime(60_000);
    expect(q.visibleToasts).toHaveLength(1);
  });

  it('closes after its time; time held is added, and a hold at or after the deadline closes it at once', () => {
    const done = vi.fn();
    const t = new DismissTimer(5000, done);
    t.run();
    vi.advanceTimersByTime(3000);
    t.hold();
    vi.advanceTimersByTime(20_000); // held: nothing
    expect(done).not.toHaveBeenCalled();
    t.run();
    vi.advanceTimersByTime(1999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledTimes(1);

    const late = vi.fn();
    const u = new DismissTimer(5000, late);
    u.run();
    vi.setSystemTime(Date.now() + 5010); // the same race as above
    u.hold();
    expect(late).toHaveBeenCalledTimes(1);
    u.run();
    vi.advanceTimersByTime(10_000);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('run() while counting does not start a second countdown, and stop() ends it silently', () => {
    const done = vi.fn();
    const t = new DismissTimer(5000, done);
    t.run();
    vi.advanceTimersByTime(2000);
    t.run(); // a resume while counting (RAC started a second timeout here)
    t.hold(); // and a hold: the first timeout must not fire meanwhile
    vi.advanceTimersByTime(10_000);
    expect(done).not.toHaveBeenCalled();
    t.run();
    vi.advanceTimersByTime(3000);
    expect(done).toHaveBeenCalledTimes(1);
    const s = new DismissTimer(5000, done);
    s.run();
    s.stop();
    vi.advanceTimersByTime(10_000);
    expect(done).toHaveBeenCalledTimes(1);
    expect(s.ended).toBe(true);
  });

  it('the hold ends when the last toast leaves, so the next toast counts down (final review m1)', () => {
    const q = new LearnToastQueue<string>();
    const first = q.add('자료 8개를 가져왔습니다');
    q.pauseAll(); // the pointer on the toasts, or the focus in them …
    expect(q.held).toBe(true);
    q.close(first); // … and the region is gone before RAC sees the pointer or the focus leave
    expect(q.held).toBe(false);
    const next = q.add('자료 1개를 가져왔습니다');
    const timer = new DismissTimer(5000, () => q.close(next));
    const follow = () => (q.held ? timer.hold() : timer.run());
    follow();
    q.onHold(follow);
    vi.advanceTimersByTime(4999);
    expect(q.visibleToasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(q.visibleToasts).toHaveLength(0);
  });
});
