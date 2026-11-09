import { describe, expect, it, vi } from 'vitest';
import { isE2E } from './deterministic';
import { registerUncaughtLog } from './uncaught-log';

describe('the uncaught-exception line under E2E', () => {
  const source = () => {
    const listeners: Array<(e: unknown) => void> = [];
    return { listeners, on: vi.fn((_event: 'uncaughtExceptionMonitor', l: (e: unknown) => void) => void listeners.push(l)) };
  };
  it('registers one monitor that writes the error and its stack as one [main] uncaught: line', () => {
    const proc = source();
    const out: string[] = [];
    expect(registerUncaughtLog(isE2E(false, { LEARN_E2E: '1' }), proc, (l) => out.push(l))).toBe(true);
    expect(proc.on).toHaveBeenCalledExactlyOnceWith('uncaughtExceptionMonitor', expect.any(Function));
    const error = new Error('boom');
    proc.listeners[0]!(error);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/^\[main\] uncaught: Error: boom \| .*\n$/);
    expect(out[0]!.trimEnd().split('\n')).toHaveLength(1);
    proc.listeners[0]!('plain');
    expect(out[1]).toBe('[main] uncaught: plain\n');
  });
  it('registers nothing in production, nor without the E2E switch', () => {
    for (const e2e of [isE2E(true, { LEARN_E2E: '1' }), isE2E(false, {})]) {
      const proc = source();
      expect(registerUncaughtLog(e2e, proc, () => {})).toBe(false);
      expect(proc.on).not.toHaveBeenCalled();
    }
  });
});
