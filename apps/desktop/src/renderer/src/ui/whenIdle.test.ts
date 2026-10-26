import { afterEach, describe, expect, it, vi } from 'vitest';
import { whenIdle } from './whenIdle';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('whenIdle', () => {
  it('asks for an idle callback with a timeout, so a window without idle periods still runs it', () => {
    const request = vi.fn((_cb: () => void, _options?: IdleRequestOptions) => 7);
    vi.stubGlobal('requestIdleCallback', request);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const fn = vi.fn();
    whenIdle(fn, 1000);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![1]).toEqual({ timeout: 1000 });
    request.mock.calls[0]![0]();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs once by the timeout even when the idle callback never comes, and not again when it does', () => {
    vi.useFakeTimers();
    const request = vi.fn((_cb: () => void, _options?: IdleRequestOptions) => 7);
    vi.stubGlobal('requestIdleCallback', request);
    const cancel = vi.fn();
    vi.stubGlobal('cancelIdleCallback', cancel);
    const fn = vi.fn();
    whenIdle(fn, 1000);
    vi.advanceTimersByTime(999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(7);
    request.mock.calls[0]![0]();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending callback', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestIdleCallback', vi.fn(() => 7));
    const cancel = vi.fn();
    vi.stubGlobal('cancelIdleCallback', cancel);
    const fn = vi.fn();
    whenIdle(fn, 1000)();
    expect(cancel).toHaveBeenCalledWith(7);
    vi.advanceTimersByTime(2000);
    expect(fn).not.toHaveBeenCalled();
  });
});
