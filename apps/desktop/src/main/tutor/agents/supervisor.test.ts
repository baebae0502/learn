import { LearnError } from '@learn/domain';
import { afterEach, describe, expect, it } from 'vitest';
import type { LaunchSpec } from './isolation';
import type { ChildPort } from './spawn';
import { createSupervisor, type SessionKey, type Supervisor } from './supervisor';

const KEY_A: SessionKey = { itemId: 'item-a', conversationId: 'conversation-a' };
const KEY_B: SessionKey = { itemId: 'item-b', conversationId: 'conversation-b' };
const spec = (entry: string): LaunchSpec => ({ command: '/learn/node', args: [entry], env: {}, cwd: '/learn/Tutor/idle' });
const SPEC = spec('fake-agent.js');
const SPEC_FAKE = SPEC;
const SPEC_CLAUDE = spec('claude-agent-acp/dist/index.js');
const SPEC_PROBE = spec('probe/claude-agent-acp/dist/index.js');
const SPEC_PROBE_2 = spec('probe-2/claude-agent-acp/dist/index.js');
const IDLE_MS = 300_000;

type ExitInfo = { code: number | null; signal: NodeJS.Signals | null };

/** A process group that records what it is sent: SIGTERM is only recorded (a test ends it with exit()), SIGKILL ends it. */
class FakeChild implements ChildPort {
  private static nextPid = 4_000;
  readonly pid = FakeChild.nextPid++;
  readonly signals: string[] = [];
  /** endInput and the signals, in order. */
  readonly events: string[] = [];
  private readonly exitFns: Array<(e: ExitInfo) => void> = [];
  private ended = false;
  private group = true;
  constructor(readonly spec: LaunchSpec) {}
  get exited(): boolean {
    return this.ended;
  }
  write(): void {}
  endInput(): void {
    this.events.push('endInput');
  }
  onLine(): void {}
  onExit(fn: (e: ExitInfo) => void): void {
    this.exitFns.push(fn);
  }
  groupAlive(): boolean {
    return this.group;
  }
  signalGroup(sig: 'SIGTERM' | 'SIGKILL'): void {
    if (!this.group) throw new Error(`${sig} sent to a process group that has ended`);
    this.signals.push(sig);
    this.events.push(sig);
    if (sig === 'SIGKILL') {
      queueMicrotask(() => {
        if (this.ended) this.group = false;
        else this.exit(null, 'SIGKILL');
      });
    }
  }
  /** The agent exits; with { groupAlive: true } a process it started (the CLI) still runs in its group. */
  exit(code: number | null, signal: NodeJS.Signals | null, o: { groupAlive?: boolean } = {}): void {
    if (this.ended) throw new Error('exited twice');
    this.ended = true;
    this.group = o.groupAlive ?? false;
    for (const fn of this.exitFns) fn({ code, signal });
  }
  /** The last process left in its group ends. */
  endGroup(): void {
    this.group = false;
  }
}

/** Timers that move only when a test moves them; every step lets the pending promises settle first. */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const settle = async () => {
    for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve));
  };
  const runUntil = async (end: number) => {
    for (;;) {
      await settle();
      let next: { id: number; at: number; fn: () => void } | null = null;
      for (const [id, t] of due) if (t.at <= end && (next === null || t.at < next.at)) next = { id, ...t };
      if (next === null) break;
      due.delete(next.id);
      now = next.at;
      next.fn();
    }
    now = end;
  };
  return {
    setTimer: (fn: () => void, ms: number): unknown => {
      seq += 1;
      due.set(seq, { at: now + ms, fn });
      return seq;
    },
    clearTimer: (id: unknown): void => {
      due.delete(id as number);
    },
    /** Lets the pending promises settle; time stands still. */
    flush: () => runUntil(now),
    advance: (ms: number) => runUntil(now + ms),
  };
}

const made: Supervisor[] = [];
afterEach(() => {
  // Not one test here ever had two process groups at a time.
  for (const sup of made.splice(0)) expect(sup.processes().max).toBeLessThanOrEqual(1);
});

function harness() {
  const timers = fakeTimers();
  const spawned: FakeChild[] = [];
  const sup = createSupervisor<unknown>({
    spawn: (launch) => {
      if (spawned.some((c) => c.groupAlive())) throw new Error('a second process group was started while one still runs');
      const child = new FakeChild(launch);
      spawned.push(child);
      return child;
    },
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  made.push(sup);
  return { sup, spawned, timers };
}

describe('one agent process at a time', () => {
  it('never keeps two processes: another session waits as AGENT_BUSY while an answer streams, and gets its own once that answer ends', async () => {
    const { sup, spawned, timers } = harness();
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}), { streaming: true });
    sup.view(KEY_A);
    sup.view(KEY_B);                                   // the user left while the answer streams
    expect(sup.processes().count).toBe(1);
    expect(sup.busyWith(KEY_B)).toEqual(KEY_A);
    await expect(sup.acquire(KEY_B, 'fake', () => SPEC, async () => ({}))).rejects.toMatchObject({ code: 'AGENT_BUSY' });
    expect(spawned).toHaveLength(1);
    sup.streaming(KEY_A, false);                       // that answer ended: its process closes now (stdin, SIGTERM)
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    spawned[0]!.exit(null, 'SIGTERM');
    await timers.flush();
    expect(sup.processes().count).toBe(0);
    await sup.acquire(KEY_B, 'fake', () => SPEC, async () => ({}));
    expect(sup.processes()).toEqual({ count: 1, max: 1, conversationIds: [KEY_B.conversationId] });
  });

  it('a session switched to another agent gets a new process, only once the old group has exited (C1, I1)', async () => {
    const { sup, spawned, timers } = harness();
    sup.resetMax();
    const a = await sup.acquire(KEY_A, 'claude', () => SPEC_CLAUDE, async () => ({ who: 'claude' }));
    const next = sup.acquire(KEY_A, 'fake', () => SPEC_FAKE, async () => ({ who: 'fake' }));
    await timers.flush();
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    expect(spawned).toHaveLength(1);                     // the old group still runs: nothing new yet
    expect(sup.processes().count).toBe(1);               // a closing process still counts
    spawned[0]!.exit(null, 'SIGTERM');
    const b = await next;
    expect(spawned.map((c) => c.spec.args[0])).toEqual([SPEC_CLAUDE.args[0], SPEC_FAKE.args[0]]);
    expect(b.conn).toEqual({ who: 'fake' });
    expect(a).not.toBe(b);
    expect(sup.processes().max).toBe(1);
  });

  it('a send reserves its session synchronously, before any process exists (I3)', async () => {
    const { sup, spawned } = harness();
    const live = sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}), { streaming: true });
    expect(sup.busyWith(KEY_B)).toEqual(KEY_A);
    expect(sup.busyWith(KEY_A)).toBeNull();
    expect(spawned).toHaveLength(0);
    await expect(sup.acquire(KEY_B, 'fake', () => SPEC, async () => ({}))).rejects.toMatchObject({ code: 'AGENT_BUSY' });
    await expect(live).resolves.toMatchObject({ key: KEY_A, streaming: true });
    expect(spawned).toHaveLength(1);
  });

  it("a send does not mark another session's idle process as answering: leaving that session closes it at once (I3)", async () => {
    const { sup, spawned } = harness();
    sup.view(KEY_B);
    const b = await sup.acquire(KEY_B, 'fake', () => SPEC, async () => ({}));
    let release!: (s: LaunchSpec) => void;
    const live = sup.acquire(KEY_A, 'fake', () => new Promise<LaunchSpec>((resolve) => { release = resolve; }), async () => ({}), { streaming: true });
    expect(sup.busyWith(KEY_B)).toEqual(KEY_A);
    expect(b.streaming).toBe(false);
    sup.view(KEY_A);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    spawned[0]!.exit(null, 'SIGTERM');
    release(SPEC);
    await expect(live).resolves.toMatchObject({ key: KEY_A, streaming: true });
    expect(spawned).toHaveLength(2);
  });

  it('warm and ask of one session share one start (I3)', async () => {
    const { sup, spawned } = harness();
    let specs = 0;
    let starts = 0;
    const launch = () => {
      specs += 1;
      return SPEC;
    };
    const start = async () => ({ n: ++starts });
    const warm = sup.acquire(KEY_A, 'fake', launch, start);
    const ask = sup.acquire(KEY_A, 'fake', launch, start, { streaming: true });
    const [w, a] = await Promise.all([warm, ask]);
    expect(w).toBe(a);
    expect(spawned).toHaveLength(1);
    expect(specs).toBe(1);
    expect(starts).toBe(1);
    expect(a.streaming).toBe(true);
  });

  it('leaving a session whose answer streams keeps its process; the end of an answer that never started elsewhere changes nothing', async () => {
    const { sup, spawned } = harness();
    sup.view(KEY_A);
    const a = await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}), { streaming: true });
    sup.view(KEY_B);
    await expect(sup.acquire(KEY_B, 'fake', () => SPEC, async () => ({}), { streaming: true })).rejects.toMatchObject({ code: 'AGENT_BUSY' });
    sup.streaming(KEY_B, false);                         // the service drops B's send that never started
    expect(spawned[0]!.signals).toEqual([]);
    expect(a.streaming).toBe(true);
    expect(sup.busyWith(KEY_B)).toEqual(KEY_A);
    sup.streaming(KEY_A, false);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
  });

  it("a warm whose spec was still waiting when another session's send reserved the process starts nothing", async () => {
    const { sup, spawned, timers } = harness();
    let release!: (s: LaunchSpec) => void;
    const warm = sup.acquire(KEY_B, 'fake', () => new Promise<LaunchSpec>((resolve) => { release = resolve; }), async () => ({}));
    let outcome: unknown = null;
    warm.catch((e: unknown) => { outcome = e; });
    const a = await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}), { streaming: true });
    release(SPEC);
    await timers.flush();
    expect(outcome).toMatchObject({ code: 'AGENT_BUSY' });
    expect(spawned[0]!.signals).toEqual([]);
    expect(spawned).toHaveLength(1);
    expect(sup.current()).toBe(a);
  });

  it('rekey moves the process, the reservation and the session on screen to the new conversation (I3)', async () => {
    const { sup, spawned } = harness();
    const NEW: SessionKey = { itemId: KEY_A.itemId, conversationId: null };
    sup.view(NEW);
    const live = await sup.acquire(NEW, 'fake', () => SPEC, async () => ({}), { streaming: true });
    sup.rekey(NEW, KEY_A);
    expect(live.key).toEqual(KEY_A);
    expect(sup.busyWith(KEY_B)).toEqual(KEY_A);
    expect(sup.processes().conversationIds).toEqual([KEY_A.conversationId]);
    sup.streaming(KEY_A, false);                         // its session is still the one on screen: it stays
    expect(sup.busyWith(KEY_B)).toBeNull();
    sup.view(KEY_A);
    expect(spawned[0]!.signals).toEqual([]);
    sup.view(NEW);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
  });

  it('another session on screen closes an idle process at once, and it counts until its group has ended', async () => {
    const { sup, spawned, timers } = harness();
    sup.view(KEY_A);
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    sup.view(KEY_B);
    expect(spawned[0]!.events).toEqual(['endInput', 'SIGTERM']);
    expect(sup.current()).toBeNull();
    expect(sup.processes()).toEqual({ count: 1, max: 1, conversationIds: [KEY_A.conversationId] });
    spawned[0]!.exit(null, 'SIGTERM');
    await timers.flush();
    expect(sup.processes()).toEqual({ count: 0, max: 1, conversationIds: [] });
  });

  it('no session on screen (view(null)) closes it at once', async () => {
    const { sup, spawned } = harness();
    sup.view(KEY_A);
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    expect(sup.current()).not.toBeNull();
    sup.view(null);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    expect(sup.current()).toBeNull();
  });

  it('an agent that ignores SIGTERM: the next session gets its process only after the SIGKILL at 2 s has ended the old group (I1)', async () => {
    const { sup, spawned, timers } = harness();
    sup.view(KEY_A);
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    sup.view(KEY_B);
    const next = sup.acquire(KEY_B, 'fake', () => SPEC, async () => ({}));
    await timers.advance(1_999);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    expect(spawned).toHaveLength(1);
    await timers.advance(1);
    expect(spawned[0]!.signals).toEqual(['SIGTERM', 'SIGKILL']);
    await expect(next).resolves.toMatchObject({ key: KEY_B });
    expect(spawned).toHaveLength(2);
  });

  it('a session that is no longer on screen gets no process', async () => {
    const { sup, spawned } = harness();
    sup.view(KEY_B);
    await expect(sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}))).rejects.toMatchObject({ code: 'AGENT_EXITED' });
    expect(spawned).toHaveLength(0);
    await sup.acquire(KEY_B, 'fake', () => SPEC, async () => ({}));
    expect(spawned).toHaveLength(1);
  });

  it('a process whose session is left while it starts closes at once, and its start fails', async () => {
    const { sup, spawned, timers } = harness();
    sup.view(KEY_A);
    let ready!: () => void;
    const live = sup.acquire(KEY_A, 'fake', () => SPEC, () => new Promise<object>((resolve) => { ready = () => resolve({}); }));
    await timers.flush();
    expect(spawned).toHaveLength(1);
    sup.view(KEY_B);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    ready();
    await expect(live).rejects.toMatchObject({ code: 'AGENT_EXITED' });
    spawned[0]!.exit(null, 'SIGTERM');
    await timers.flush();
    expect(sup.processes().count).toBe(0);
  });

  it('a start that fails closes its process', async () => {
    const { sup, spawned, timers } = harness();
    const live = sup.acquire(KEY_A, 'fake', () => SPEC, async () => {
      throw new LearnError('AGENT_TIMEOUT', 'initialize took too long');
    });
    await expect(live).rejects.toMatchObject({ code: 'AGENT_TIMEOUT' });
    expect(spawned[0]!.events).toEqual(['endInput', 'SIGTERM']);
    expect(sup.current()).toBeNull();
    spawned[0]!.exit(null, 'SIGTERM');
    await timers.flush();
    expect(sup.processes().count).toBe(0);
  });

  it('max is the high-water mark since resetMax, which starts it at 0', async () => {
    const { sup, spawned, timers } = harness();
    sup.resetMax();
    expect(sup.processes()).toEqual({ count: 0, max: 0, conversationIds: [] });
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    expect(sup.processes().max).toBe(1);
    void sup.close();
    spawned[0]!.exit(null, 'SIGTERM');
    await timers.flush();
    expect(sup.processes()).toEqual({ count: 0, max: 1, conversationIds: [] });
    sup.resetMax();
    expect(sup.processes().max).toBe(0);
  });
});

describe('the idle clock', () => {
  it('closes the process on screen after five idle minutes', async () => {
    const { sup, spawned, timers } = harness();
    sup.view(KEY_A);
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    await timers.advance(IDLE_MS - 1);
    expect(spawned[0]!.signals).toEqual([]);
    await timers.advance(1);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
  });

  it('turn activity starts it over', async () => {
    const { sup, spawned, timers } = harness();
    sup.view(KEY_A);
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    await timers.advance(IDLE_MS - 1);
    sup.touch();
    await timers.advance(IDLE_MS - 1);
    expect(spawned[0]!.signals).toEqual([]);
    await timers.advance(1);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
  });

  it('does not run while an answer streams, and starts when it ends', async () => {
    const { sup, spawned, timers } = harness();
    sup.view(KEY_A);
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}), { streaming: true });
    await timers.advance(IDLE_MS * 2);
    expect(spawned[0]!.signals).toEqual([]);
    sup.streaming(KEY_A, false);
    await timers.advance(IDLE_MS - 1);
    expect(spawned[0]!.signals).toEqual([]);
    await timers.advance(1);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
  });

  it('setTimeouts shortens the idle clock and the grace periods', async () => {
    const { sup, spawned, timers } = harness();
    sup.setTimeouts({ idleMs: 50 });
    sup.view(KEY_A);
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    await timers.advance(49);
    expect(spawned[0]!.signals).toEqual([]);
    await timers.advance(1);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    spawned[0]!.exit(null, 'SIGTERM');
    sup.setTimeouts({ cancelGraceMs: 10, termGraceMs: 20 });
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}), { streaming: true });
    void sup.interrupt(() => {}, { kill: 'always', ended: () => true });
    await timers.advance(10);
    expect(spawned[1]!.signals).toEqual(['SIGTERM']);
    await timers.advance(20);
    expect(spawned[1]!.signals).toEqual(['SIGTERM', 'SIGKILL']);
  });
});

describe('the login check', () => {
  it('a login check that a reserving acquire waits for inside its spec runs at once (I2)', async () => {
    const { sup, spawned, timers } = harness();
    let probed: string | null = null;
    const live = sup.acquire(KEY_A, 'claude', async () => {
      probed = await sup.probe(SPEC_PROBE, async () => 'ok');   // detection's login check, from inside the spec
      return SPEC_CLAUDE;
    }, async () => ({}), { streaming: true });
    await timers.flush();
    expect(spawned.map((c) => c.spec.args[0])).toEqual([SPEC_PROBE.args[0]]);   // a bare reservation does not hold the check back
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);                            // the check ended: its process closes
    spawned[0]!.exit(null, 'SIGTERM');
    await expect(live).resolves.toMatchObject({ key: KEY_A });
    expect(probed).toBe('ok');
    expect(spawned.map((c) => c.spec.args[0])).toEqual([SPEC_PROBE.args[0], SPEC_CLAUDE.args[0]]);   // the session's process after the check's exit
    expect(sup.processes().max).toBe(1);
  });

  it("a send that switches its session's agent runs the check inside its spec: the old idle process closes, nothing waits on the reservation (C1, I2)", async () => {
    const { sup, spawned, timers } = harness();
    sup.view(KEY_A);
    await sup.acquire(KEY_A, 'claude', () => SPEC_CLAUDE, async () => ({}));
    let probed: string | null = null;
    const live = sup.acquire(KEY_A, 'fake', async () => {
      probed = await sup.probe(SPEC_PROBE, async () => 'ok');
      return SPEC_FAKE;
    }, async () => ({}), { streaming: true });
    await timers.flush();
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    spawned[0]!.exit(null, 'SIGTERM');
    await timers.flush();
    expect(spawned[1]!.signals).toEqual(['SIGTERM']);
    spawned[1]!.exit(null, 'SIGTERM');
    await expect(live).resolves.toMatchObject({ key: KEY_A, agent: 'fake', streaming: true });
    expect(probed).toBe('ok');
    expect(spawned.map((c) => c.spec.args[0])).toEqual([SPEC_CLAUDE.args[0], SPEC_PROBE.args[0], SPEC_FAKE.args[0]]);
  });

  it('waits for an answer in flight to end, then closes that process before it starts', async () => {
    const { sup, spawned, timers } = harness();
    sup.view(KEY_A);
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}), { streaming: true });
    const check = sup.probe(SPEC_PROBE, async () => 'ok');
    await timers.flush();
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.signals).toEqual([]);
    sup.streaming(KEY_A, false);
    await timers.flush();
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    expect(spawned).toHaveLength(1);
    spawned[0]!.exit(null, 'SIGTERM');
    await expect(check).resolves.toBe('ok');
    expect(spawned.map((c) => c.spec.args[0])).toEqual([SPEC.args[0], SPEC_PROBE.args[0]]);
    expect(spawned[1]!.signals).toEqual(['SIGTERM']);
  });

  it('two checks run one after the other', async () => {
    const { sup, spawned, timers } = harness();
    let finishFirst!: (v: string) => void;
    const first = sup.probe(SPEC_PROBE, () => new Promise<string>((resolve) => { finishFirst = resolve; }));
    const second = sup.probe(SPEC_PROBE_2, async () => 'second');
    await timers.flush();
    expect(spawned).toHaveLength(1);
    finishFirst('first');
    await expect(first).resolves.toBe('first');
    await timers.flush();
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    expect(spawned).toHaveLength(1);                     // the first check's group still runs
    spawned[0]!.exit(null, 'SIGTERM');
    await expect(second).resolves.toBe('second');
    expect(spawned.map((c) => c.spec.args[0])).toEqual([SPEC_PROBE.args[0], SPEC_PROBE_2.args[0]]);
  });

  it("is the one process while it runs, and a session's process starts after it (M18)", async () => {
    const { sup, spawned, timers } = harness();
    let finish!: (v: string) => void;
    const check = sup.probe(SPEC_PROBE, () => new Promise<string>((resolve) => { finish = resolve; }));
    await timers.flush();
    expect(sup.processes()).toEqual({ count: 1, max: 1, conversationIds: [] });
    const live = sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    await timers.flush();
    expect(spawned).toHaveLength(1);
    finish('ok');
    await check;
    spawned[0]!.exit(null, 'SIGTERM');
    await expect(live).resolves.toMatchObject({ key: KEY_A });
    expect(spawned.map((c) => c.spec.args[0])).toEqual([SPEC_PROBE.args[0], SPEC.args[0]]);
  });

  it("starts only once another session's idle process has ended its group (I1)", async () => {
    const { sup, spawned, timers } = harness();
    sup.view(KEY_B);
    await sup.acquire(KEY_B, 'fake', () => SPEC, async () => ({}));
    const check = sup.probe(SPEC_PROBE, async () => 'ok');
    await timers.flush();
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    expect(spawned).toHaveLength(1);
    spawned[0]!.exit(null, 'SIGTERM');
    await expect(check).resolves.toBe('ok');
    expect(spawned).toHaveLength(2);
  });

  it("tells each exit to its listeners: the session's key, or 'probe' for the check", async () => {
    const { sup, spawned, timers } = harness();
    const exits: Array<[SessionKey | 'probe', { code: number | null; signal: string | null }]> = [];
    sup.onExit((key, e) => exits.push([key, e]));
    await sup.probe(SPEC_PROBE, async () => 'ok');
    spawned[0]!.exit(0, null);
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    spawned[1]!.exit(1, null);
    await timers.flush();
    expect(exits).toEqual([['probe', { code: 0, signal: null }], [KEY_A, { code: 1, signal: null }]]);
  });
});

describe('stopping and closing', () => {
  it('after a lockdown the group is killed even though the agent answered the cancel; a stop kills only an agent that ignores it (C2)', async () => {
    const { sup, spawned, timers } = harness();
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}), { streaming: true });
    let ended = false;
    const done = sup.interrupt(() => { ended = true; }, { kill: 'always', ended: () => ended });
    await timers.advance(2_999);
    expect(spawned[0]!.signals).toEqual([]);
    await timers.advance(1);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    await timers.advance(2_000);
    expect(spawned[0]!.signals).toEqual(['SIGTERM', 'SIGKILL']);           // this fake ignores SIGTERM
    await done;
    const h2 = harness();
    await h2.sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}), { streaming: true });
    let ended2 = false;
    void h2.sup.interrupt(() => { ended2 = true; }, { kill: 'if-not-ended', ended: () => ended2 });
    await h2.timers.advance(3_000);
    expect(h2.spawned[0]!.signals).toEqual([]);                            // the answer ended on the cancel: nothing killed
  });

  it('a stop kills an agent that does not stop: SIGTERM 3 s after the cancel, SIGKILL 2 s later', async () => {
    const { sup, spawned, timers } = harness();
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}), { streaming: true });
    let cancels = 0;
    const done = sup.interrupt(() => { cancels += 1; }, { kill: 'if-not-ended', ended: () => false });
    expect(cancels).toBe(1);
    await timers.advance(2_999);
    expect(spawned[0]!.signals).toEqual([]);
    await timers.advance(1);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    await timers.advance(1_999);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    await timers.advance(1);
    expect(spawned[0]!.signals).toEqual(['SIGTERM', 'SIGKILL']);
    await done;
    expect(sup.processes().count).toBe(0);
  });

  it('close: stdin ends and SIGTERM follows at once, SIGKILL at 2 s while the group lives; it resolves only when the group has ended (I1)', async () => {
    const { sup, spawned, timers } = harness();
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    let closed = false;
    const closing = sup.close().then(() => { closed = true; });
    expect(spawned[0]!.events).toEqual(['endInput', 'SIGTERM']);
    spawned[0]!.exit(0, null, { groupAlive: true });   // the adapter ended; the CLI it started has not
    await timers.advance(1_999);
    expect(closed).toBe(false);
    expect(sup.processes().count).toBe(1);
    await timers.advance(1);
    expect(spawned[0]!.signals).toEqual(['SIGTERM', 'SIGKILL']);
    await closing;
    expect(sup.processes().count).toBe(0);
  });

  it('a group that ends after its leader, before the SIGKILL, is seen within 50 ms and gets no more signals', async () => {
    const { sup, spawned, timers } = harness();
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    let closed = false;
    void sup.close().then(() => { closed = true; });
    spawned[0]!.exit(0, null, { groupAlive: true });
    await timers.advance(500);
    expect(closed).toBe(false);
    spawned[0]!.endGroup();
    await timers.advance(50);
    expect(closed).toBe(true);
    await timers.advance(2_000);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
  });

  it('an agent that exits by itself: what is left of its group gets SIGTERM, and it counts until that has ended', async () => {
    const { sup, spawned, timers } = harness();
    sup.view(KEY_A);
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    spawned[0]!.exit(1, null, { groupAlive: true });
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    expect(sup.current()).toBeNull();
    expect(sup.processes().count).toBe(1);
    spawned[0]!.endGroup();
    await timers.advance(50);
    expect(sup.processes().count).toBe(0);
  });

  it('sends no signal to a group that has already ended', async () => {
    const { sup, spawned, timers } = harness();
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    spawned[0]!.exit(0, null);
    await timers.flush();
    expect(sup.processes().count).toBe(0);
    await sup.close();
    sup.killNow();
    await sup.shutdown(2_000);
    await timers.advance(5_000);
    expect(spawned[0]!.signals).toEqual([]);
  });

  it('shutdown(2000): stdin and SIGTERM at once, SIGKILL at 2 s', async () => {
    const { sup, spawned, timers } = harness();
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}));
    let done = false;
    const quitting = sup.shutdown(2_000).then(() => { done = true; });
    expect(spawned[0]!.events).toEqual(['endInput', 'SIGTERM']);
    await timers.advance(1_999);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    expect(done).toBe(false);
    await timers.advance(1);
    expect(spawned[0]!.signals).toEqual(['SIGTERM', 'SIGKILL']);
    await quitting;
    expect(sup.processes().count).toBe(0);
  });

  it('shutdown with an answer in flight: the cancel first, SIGTERM halfway, SIGKILL at 2 s', async () => {
    const { sup, spawned, timers } = harness();
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}), { streaming: true });
    let cancels = 0;
    const quitting = sup.shutdown(2_000, () => { cancels += 1; });
    expect(cancels).toBe(1);
    await timers.advance(999);
    expect(spawned[0]!.signals).toEqual([]);
    await timers.advance(1);
    expect(spawned[0]!.events).toEqual(['endInput', 'SIGTERM']);
    await timers.advance(999);
    expect(spawned[0]!.signals).toEqual(['SIGTERM']);
    await timers.advance(1);
    expect(spawned[0]!.signals).toEqual(['SIGTERM', 'SIGKILL']);
    await quitting;
  });

  it('after shutdown nothing new starts, not even a start that was already waiting', async () => {
    const { sup, spawned, timers } = harness();
    let release!: (s: LaunchSpec) => void;
    const waiting = sup.acquire(KEY_A, 'fake', () => new Promise<LaunchSpec>((resolve) => { release = resolve; }), async () => ({}));
    await sup.shutdown(2_000);
    release(SPEC);
    await expect(waiting).rejects.toMatchObject({ code: 'AGENT_EXITED' });
    await expect(sup.probe(SPEC_PROBE, async () => 'ok')).rejects.toMatchObject({ code: 'AGENT_EXITED' });
    await timers.flush();
    expect(spawned).toHaveLength(0);
  });

  it('killNow: SIGKILL at once', async () => {
    const { sup, spawned, timers } = harness();
    await sup.acquire(KEY_A, 'fake', () => SPEC, async () => ({}), { streaming: true });
    sup.killNow();
    expect(spawned[0]!.signals).toEqual(['SIGKILL']);
    await timers.flush();
    expect(sup.processes().count).toBe(0);
  });
});
