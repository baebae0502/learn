import { describe, expect, it, vi } from 'vitest';
import { createTutorQuitGate } from './quit';

function event(prevented = false) {
  const e = { defaultPrevented: prevented, preventDefault: vi.fn(() => void (e.defaultPrevented = true)) };
  return e;
}

function rig(count: number) {
  let stop = (): void => {};
  const tutor = {
    processes: vi.fn(() => ({ count, max: count, conversationIds: [] })),
    shutdown: vi.fn((_maxMs: number) => new Promise<void>((resolve) => {
      stop = resolve;
    })),
  };
  const quit = vi.fn();
  const gate = createTutorQuitGate({ tutor: () => tutor, quit, maxMs: 2000 });
  return { tutor, quit, gate, stopped: () => stop() };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('the tutor at quit', () => {
  it('a live agent: the quit waits for the shutdown (2 s at most), then quits again, and that quit goes ahead', async () => {
    const r = rig(1);
    const first = event();
    r.gate.onBeforeQuit(first);
    expect(first.preventDefault).toHaveBeenCalledTimes(1);
    expect(r.tutor.shutdown).toHaveBeenCalledWith(2000);
    // ⌘Q again while it stops: still held, and the shutdown is not asked twice.
    const again = event();
    r.gate.onBeforeQuit(again);
    expect(again.preventDefault).toHaveBeenCalledTimes(1);
    expect(r.tutor.shutdown).toHaveBeenCalledTimes(1);
    expect(r.quit).not.toHaveBeenCalled();
    r.stopped();
    await settle();
    expect(r.quit).toHaveBeenCalledTimes(1);
    const last = event();
    r.gate.onBeforeQuit(last);
    expect(last.preventDefault).not.toHaveBeenCalled();
    expect(r.tutor.shutdown).toHaveBeenCalledTimes(1);
  });

  it('no agent: the quit goes ahead at once, and the tutor is shut so nothing starts during it', () => {
    const r = rig(0);
    const e = event();
    r.gate.onBeforeQuit(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(r.tutor.shutdown).toHaveBeenCalledTimes(1);
    r.gate.onBeforeQuit(event());
    expect(r.tutor.shutdown).toHaveBeenCalledTimes(1);
    expect(r.quit).not.toHaveBeenCalled();
  });

  it('a quit another gate called off is left alone: nothing is stopped', () => {
    const r = rig(1);
    r.gate.onBeforeQuit(event(true));
    expect(r.tutor.shutdown).not.toHaveBeenCalled();
    expect(r.tutor.processes).not.toHaveBeenCalled();
  });

  it('no library, no tutor: nothing to wait for', () => {
    const quit = vi.fn();
    const gate = createTutorQuitGate({ tutor: () => null, quit, maxMs: 2000 });
    const e = event();
    gate.onBeforeQuit(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });

  it('a shutdown that fails still lets the quit go ahead', async () => {
    const tutor = { processes: () => ({ count: 1, max: 1, conversationIds: [] }), shutdown: vi.fn(async () => Promise.reject(new Error('boom'))) };
    const quit = vi.fn();
    const gate = createTutorQuitGate({ tutor: () => tutor, quit, maxMs: 2000 });
    gate.onBeforeQuit(event());
    await settle();
    expect(quit).toHaveBeenCalledTimes(1);
    const after = event();
    gate.onBeforeQuit(after);
    expect(after.preventDefault).not.toHaveBeenCalled();
  });
});
