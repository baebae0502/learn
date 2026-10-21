import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadingLocator } from '@learn/domain';
import { createPositionSaver, ratio, restorePageIndex, restoreVideoSeconds, type SavePolicy } from './positionSaver';

const pdf = (pageIndex: number): ReadingLocator => ({ kind: 'pdf', pageIndex });
const video = (timeMs: number): ReadingLocator => ({ kind: 'video', timeMs });

function make(policy: SavePolicy, initial: ReadingLocator, send = vi.fn(() => Promise.resolve())) {
  const onError = vi.fn();
  return { send, onError, saver: createPositionSaver({ policy, initial, send, onError }) };
}

describe('position saver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces page changes by 300 ms and sends only the last one', () => {
    const { saver, send } = make({ kind: 'debounce', ms: 300 }, pdf(0));
    saver.update(pdf(1), 0.2);
    vi.advanceTimersByTime(200);
    saver.update(pdf(2), 0.3);
    vi.advanceTimersByTime(299);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(pdf(2), 0.3);
  });

  it('skips a save equal to the last saved locator, including the initial one', () => {
    const { saver, send } = make({ kind: 'debounce', ms: 300 }, pdf(0));
    saver.update(pdf(0), 0.1);
    vi.advanceTimersByTime(300);
    expect(send).not.toHaveBeenCalled();
    saver.update(pdf(3), 0.4);
    vi.advanceTimersByTime(300);
    saver.update(pdf(3), 0.4);
    vi.advanceTimersByTime(300);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('throttles video time to one save per 2 s with a trailing save', () => {
    const { saver, send } = make({ kind: 'throttle', ms: 2000 }, video(0));
    saver.update(video(1000), 0.1);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(500);
    saver.update(video(1500), 0.15);
    vi.advanceTimersByTime(500);
    saver.update(video(2000), 0.2);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(video(2000), 0.2);
  });

  it('a flush cancels the trailing throttle timer and the next update is throttled again', () => {
    const { saver, send } = make({ kind: 'throttle', ms: 2000 }, video(0));
    saver.update(video(1000), 0.1);
    vi.advanceTimersByTime(500);
    saver.update(video(1500), 0.15); // trailing timer pending
    saver.flush(); // e.g. pause
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(3000);
    expect(send).toHaveBeenCalledTimes(2); // trailing timer was cancelled
    saver.update(video(5000), 0.5);
    expect(send).toHaveBeenCalledTimes(3); // window long past: leading save
    vi.advanceTimersByTime(100);
    saver.update(video(5100), 0.51);
    expect(send).toHaveBeenCalledTimes(3); // throttled again
    vi.advanceTimersByTime(1900);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('flush sends the pending value immediately and cancels the timer', () => {
    const { saver, send } = make({ kind: 'debounce', ms: 300 }, pdf(0));
    saver.update(pdf(4), 0.5);
    saver.flush();
    expect(send).toHaveBeenCalledWith(pdf(4), 0.5);
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(1);
    saver.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports send failures without throwing and retries on the next change', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    const { saver, onError } = make({ kind: 'debounce', ms: 10 }, pdf(0), send);
    saver.update(pdf(1), null);
    saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledTimes(1);
    saver.update(pdf(1), null);
    saver.flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('dispose drops pending work', () => {
    const { saver, send } = make({ kind: 'debounce', ms: 300 }, pdf(0));
    saver.update(pdf(2), 0.5);
    saver.dispose();
    vi.advanceTimersByTime(1000);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('position math', () => {
  it('computes progress clamped to [0,1], null when the total is unknown', () => {
    expect(ratio(3, 10)).toBe(0.3);
    expect(ratio(12, 10)).toBe(1);
    expect(ratio(-1, 10)).toBe(0);
    expect(ratio(1, 0)).toBeNull();
    expect(ratio(1, Number.NaN)).toBeNull();
    expect(ratio(1, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('restores the PDF page clamped to the document, defaulting to the first page', () => {
    expect(restorePageIndex(pdf(4), 10)).toBe(4);
    expect(restorePageIndex(pdf(99), 10)).toBe(9);
    expect(restorePageIndex(null, 10)).toBe(0);
    expect(restorePageIndex(video(5), 10)).toBe(0);
  });

  it('restores video time, starting over at 95% or more', () => {
    expect(restoreVideoSeconds(video(30_000), 100)).toBe(30);
    expect(restoreVideoSeconds(video(94_000), 100)).toBe(94);
    expect(restoreVideoSeconds(video(95_000), 100)).toBe(0);
    expect(restoreVideoSeconds(video(99_000), 100)).toBe(0);
    expect(restoreVideoSeconds(null, 100)).toBe(0);
    expect(restoreVideoSeconds(video(5000), Number.NaN)).toBe(5);
    expect(restoreVideoSeconds(video(5000), Number.POSITIVE_INFINITY)).toBe(5);
    expect(ratio(5, Number.NaN)).toBeNull();
  });
});
