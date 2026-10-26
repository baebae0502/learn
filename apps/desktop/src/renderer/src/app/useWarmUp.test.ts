import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// No DOM in renderer tests: react's useEffect is replaced by a harness that runs the effect and keeps its cleanup.
let cleanup: (() => void) | void;
vi.mock('react', () => ({
  useEffect: (effect: () => (() => void) | void) => {
    cleanup = effect();
  },
}));
const warmUp = vi.fn();
vi.mock('./warmUp', () => ({ warmUp: (...a: unknown[]) => warmUp(...a) }));

import { useWarmUp } from './useWarmUp';

let idle: (() => void) | undefined;
const cancelIdle = vi.fn();
const cancelWarm = vi.fn();

beforeEach(() => {
  idle = undefined;
  warmUp.mockReset().mockReturnValue(cancelWarm);
  cancelIdle.mockReset();
  cancelWarm.mockReset();
  vi.stubGlobal('document', {});
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => ((idle = cb), 3));
  vi.stubGlobal('cancelIdleCallback', cancelIdle);
});
afterEach(() => vi.unstubAllGlobals());

describe('useWarmUp', () => {
  it('waits for the list to settle', () => {
    useWarmUp(false);
    expect(idle).toBeUndefined();
  });

  it('runs the probe once at the idle moment, and cancels it on unmount', () => {
    useWarmUp(true);
    expect(warmUp).not.toHaveBeenCalled();
    idle!();
    expect(warmUp).toHaveBeenCalledTimes(1);
    (cleanup as () => void)();
    expect(cancelWarm).toHaveBeenCalledTimes(1);
  });

  it('unmounted before the idle moment: the idle request is cancelled and no probe was added', () => {
    useWarmUp(true);
    (cleanup as () => void)();
    expect(cancelIdle).toHaveBeenCalledWith(3);
    expect(warmUp).not.toHaveBeenCalled();
    expect(cancelWarm).not.toHaveBeenCalled();
  });
});
