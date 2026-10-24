import { afterEach, describe, expect, it, vi } from 'vitest';
import { whenIdle } from './whenIdle';

afterEach(() => vi.unstubAllGlobals());

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

  it('cancels the pending callback', () => {
    vi.stubGlobal('requestIdleCallback', vi.fn(() => 7));
    const cancel = vi.fn();
    vi.stubGlobal('cancelIdleCallback', cancel);
    whenIdle(() => {}, 1000)();
    expect(cancel).toHaveBeenCalledWith(7);
  });
});
