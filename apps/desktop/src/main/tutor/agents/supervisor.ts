import { LearnError, TUTOR_LIMITS, TUTOR_TIMEOUTS, type AgentId } from '@learn/domain';
import type { LaunchSpec } from './isolation';
import type { ChildPort } from './spawn';

export interface SessionKey { itemId: string; conversationId: string | null }
export interface LiveAgent<C = unknown> { readonly key: SessionKey; readonly agent: AgentId; readonly child: ChildPort; conn: C; streaming: boolean }
export interface Supervisor<C = unknown> {
  /** The session on screen (tutor:view); null: none. A process that is not this one's closes now, or when its answer ends. */
  view(key: SessionKey | null): void;
  current(): LiveAgent<C> | null;
  /** The key whose answer streams now, if it is not `key` (ask's busy check — synchronous). */
  busyWith(key: SessionKey): SessionKey | null;
  /**
   * The process of (key, agent): the live one if both match; a live one of the same key but another agent is closed and a new
   * one started, so a question asked after switching agents never reaches the old one. AGENT_BUSY (nothing started) while
   * another key's answer streams. With { streaming: true } the key is reserved for an answer synchronously, before the returned
   * promise settles. One start in flight per key, shared by its callers (warm and ask). `spec` may wait (detection runs in the
   * asynchronous part). `start` must settle: its requests carry their own time limits.
   */
  acquire(key: SessionKey, agent: AgentId, spec: () => LaunchSpec | Promise<LaunchSpec>, start: (child: ChildPort) => Promise<C>, opts?: { streaming?: boolean }): Promise<LiveAgent<C>>;
  /** A new empty session's process (and the viewed key, and a reservation) gets its conversation once the first question made one. */
  rekey(from: SessionKey, to: SessionKey): void;
  /** The answer of `key` ended (or never started): the reservation goes, and a process its user left closes now. */
  streaming(key: SessionKey, on: boolean): void;
  /** Turn activity: the idle clock starts over. */
  touch(): void;
  /**
   * The login check: one at a time, never beside a session's process (a live one closes first and its group's exit is awaited);
   * it waits for a streaming *process* to end, never for a bare reservation — the reserving acquire may be waiting for this
   * very check inside its spec. Counted in processes(). Resolves with `run`'s result as soon as `run` settles; the next process
   * still starts only after the check's group has ended. `run` must settle: its caller bounds it with probeMs.
   */
  probe<T>(spec: LaunchSpec, run: (child: ChildPort) => Promise<T>): Promise<T>;
  /**
   * With an answer in flight: cancel(); after cancelGraceMs, if `kill` is 'always' or the answer has not ended, SIGTERM to
   * the group; after termGraceMs, SIGKILL if it still runs. Lockdown is 'always'; a user stop and a timeout 'if-not-ended'.
   */
  interrupt(cancel: () => void, o: { kill: 'always' | 'if-not-ended'; ended(): boolean }): Promise<void>;
  /** No answer in flight: stdin ends, SIGTERM to the group, SIGKILL at termGraceMs; resolves once the group has exited. */
  close(): Promise<void>;
  /** The quit: the same order within maxMs (an answer in flight is cancelled first), SIGKILL for what is left; nothing starts after it. */
  shutdown(maxMs: number, cancel?: () => void): Promise<void>;
  /** A protocol fault, tutorKillAgent and will-quit's last resort. */
  killNow(): void;
  /** count: 0 or 1 always — a closing process counts until its group has exited, the login check too; max: the high-water mark since resetMax(). */
  processes(): { count: number; max: number; conversationIds: Array<string | null> };
  resetMax(): void;
  onExit(fn: (key: SessionKey | 'probe', e: { code: number | null; signal: string | null }) => void): void;
  /** The tutorTimeouts test hook. */
  setTimeouts(t: Partial<{ idleMs: number; cancelGraceMs: number; termGraceMs: number }>): void;
}

/** How often a group whose leader has exited is looked at again, until its last process has gone. */
const GROUP_POLL_MS = 50;

interface Group {
  readonly child: ChildPort;
  /** stdin ended or a signal sent: it will not be handed out again. */
  closing: boolean;
  termSent: boolean;
  killSent: boolean;
  gone: boolean;
  killTimer: unknown;
  pollTimer: unknown;
  readonly done: Promise<void>;
  finish(): void;
}
interface SessionProc<C> extends Group, LiveAgent<C> {
  readonly kind: 'session';
  key: SessionKey;
  ready: boolean;
  /** Who waits for its answer to end (a login check). */
  answerWaiters: Array<() => void>;
}
interface ProbeProc extends Group { readonly kind: 'probe' }
type Proc<C> = SessionProc<C> | ProbeProc;
interface Start<C> { key: SessionKey; readonly agent: AgentId; promise: Promise<SessionProc<C>> }

const sameKey = (a: SessionKey | null | undefined, b: SessionKey | null | undefined): boolean =>
  a != null && b != null && a.itemId === b.itemId && a.conversationId === b.conversationId;
const copy = (k: SessionKey): SessionKey => ({ itemId: k.itemId, conversationId: k.conversationId });
const noop = () => {};
const busy = () => new LearnError('AGENT_BUSY', 'Another session is receiving an answer.');

export function createSupervisor<C>(d: { spawn(spec: LaunchSpec): ChildPort; setTimer(fn: () => void, ms: number): unknown; clearTimer(id: unknown): void }): Supervisor<C> {
  const t = { idleMs: TUTOR_LIMITS.idleCloseMs as number, cancelGraceMs: TUTOR_TIMEOUTS.cancelGraceMs as number, termGraceMs: TUTOR_TIMEOUTS.termGraceMs as number };
  /** Every process group that has not ended yet: never more than one. */
  const groups = new Set<Proc<C>>();
  /** The newest session process, from its spawn until its group has ended. */
  let session: SessionProc<C> | null = null;
  /** The key reserved for an answer, from the send until its answer ends. */
  let answerKey: SessionKey | null = null;
  /** undefined until the renderer first says which session is on screen. */
  let viewed: SessionKey | null | undefined;
  let idleTimer: unknown = null;
  let max = 0;
  let quitting = false;
  /** Starting a process (a session's or the login check's) waits here for the one before it. */
  let lane: Promise<void> = Promise.resolve();
  const starts = new Set<Start<C>>();
  const exitFns: Array<(key: SessionKey | 'probe', e: { code: number | null; signal: string | null }) => void> = [];

  const held = (p: SessionProc<C>) => p.streaming || sameKey(answerKey, p.key);

  const stopIdle = () => {
    if (idleTimer !== null) d.clearTimer(idleTimer);
    idleTimer = null;
  };
  const startIdle = () => {
    stopIdle();
    const p = session;
    if (!p || !p.ready || p.closing || held(p)) return;
    idleTimer = d.setTimer(() => {
      idleTimer = null;
      if (session === p && !p.closing && !held(p)) void close(p);
    }, t.idleMs);
  };

  const flushAnswerWaiters = (p: SessionProc<C>) => {
    for (const w of p.answerWaiters.splice(0)) w();
  };

  const checkGone = (g: Proc<C>) => {
    g.pollTimer = null;
    if (g.gone) return;
    if (g.child.groupAlive()) {
      g.pollTimer = d.setTimer(() => checkGone(g), GROUP_POLL_MS);
      return;
    }
    g.gone = true;
    if (g.killTimer !== null) d.clearTimer(g.killTimer);
    g.killTimer = null;
    groups.delete(g);
    if (g === session) {
      session = null;
      stopIdle();
    }
    if (g.kind === 'session') flushAnswerWaiters(g);
    g.finish();
  };

  const kill = (g: Proc<C>) => {
    if (g.gone || g.killSent) return;
    g.killSent = true;
    if (g.killTimer !== null) d.clearTimer(g.killTimer);
    g.killTimer = null;
    if (g.child.groupAlive()) g.child.signalGroup('SIGKILL');
  };
  const terminate = (g: Proc<C>): Promise<void> => {
    if (!g.gone && !g.termSent) {
      g.termSent = true;
      if (g.child.groupAlive()) g.child.signalGroup('SIGTERM');
      g.killTimer = d.setTimer(() => {
        g.killTimer = null;
        kill(g);
      }, t.termGraceMs);
    }
    return g.done;
  };
  const beginClose = (g: Proc<C>) => {
    if (g.closing) return;
    g.closing = true;
    if (g === session) stopIdle();
  };
  // stdin alone ends the adapter in 35 ms but leaves its CLI for up to a second, so SIGTERM goes with it.
  const close = (g: Proc<C>): Promise<void> => {
    if (g.closing) return g.done;
    beginClose(g);
    g.child.endInput();
    return terminate(g);
  };

  const onChildExit = (g: Proc<C>, e: { code: number | null; signal: NodeJS.Signals | null }) => {
    const key = g.kind === 'probe' ? 'probe' : copy(g.key);
    // An agent that ended by itself leaves its CLI orphaned in the group: it is ended with it.
    if (!g.closing) {
      beginClose(g);
      void terminate(g);
    }
    checkGone(g);
    for (const fn of exitFns) fn(key, { code: e.code, signal: e.signal });
  };

  function track(child: ChildPort, kind: 'probe'): ProbeProc;
  function track(child: ChildPort, kind: 'session', key: SessionKey, agent: AgentId): SessionProc<C>;
  function track(child: ChildPort, kind: 'session' | 'probe', key?: SessionKey, agent?: AgentId): Proc<C> {
    let finish = noop;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const base = { child, closing: false, termSent: false, killSent: false, gone: false, killTimer: null, pollTimer: null, done, finish };
    const g: Proc<C> = kind === 'probe'
      ? { ...base, kind }
      : { ...base, kind, key: key!, agent: agent!, conn: undefined as C, streaming: false, ready: false, answerWaiters: [] };
    groups.add(g);
    max = Math.max(max, groups.size);
    child.onExit((e) => onChildExit(g, e));
    return g;
  }

  const inLane = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lane.then(fn);
    lane = run.then(noop, noop);
    return run;
  };
  const firstGroup = (): Proc<C> | undefined => groups.values().next().value;
  const quit = () => new LearnError('AGENT_EXITED', 'Learn is quitting.');

  const busyWith = (key: SessionKey): SessionKey | null => {
    if (answerKey !== null && !sameKey(answerKey, key)) return copy(answerKey);
    const p = session;
    if (p && p.streaming && !sameKey(p.key, key)) return copy(p.key);
    return null;
  };
  const reusable = (key: SessionKey, agent: AgentId): SessionProc<C> | null => {
    const p = session;
    return p && p.ready && !p.closing && sameKey(p.key, key) && p.agent === agent ? p : null;
  };

  /** In the lane: the one process before it (closing or not) ends its group first, so two groups never overlap. */
  const startIn = async (s: Start<C>, launch: LaunchSpec, start: (child: ChildPort) => Promise<C>): Promise<SessionProc<C>> => {
    for (;;) {
      const live = reusable(s.key, s.agent);
      if (live) return live;
      if (busyWith(s.key)) throw busy();
      if (quitting) throw quit();
      if (viewed !== undefined && !sameKey(viewed, s.key) && !sameKey(answerKey, s.key)) {
        throw new LearnError('AGENT_EXITED', 'The session is no longer on screen.');
      }
      const g = firstGroup();
      if (!g) break;
      await close(g);
    }
    const p = track(d.spawn(launch), 'session', s.key, s.agent);
    session = p;
    try {
      p.conn = await start(p.child);
    } catch (e) {
      void close(p);
      throw e;
    }
    if (p.closing) throw new LearnError('AGENT_EXITED', 'The agent was closed while it started.');
    p.ready = true;
    startIdle();
    return p;
  };

  const closeSession = (): Promise<void> => {
    const p = session;
    return p ? close(p) : Promise.resolve();
  };

  return {
    view(key) {
      viewed = key === null ? null : copy(key);
      const p = session;
      if (!p || p.closing || sameKey(p.key, key)) return;
      if (!held(p)) void close(p);
    },

    current() {
      const p = session;
      return p && p.ready && !p.closing ? p : null;
    },

    busyWith,

    acquire(key, agent, spec, start, opts = {}) {
      if (busyWith(key)) return Promise.reject(busy());
      if (quitting) return Promise.reject(quit());
      const streaming = opts.streaming === true;
      if (streaming) answerKey = copy(key);
      const mark = (p: SessionProc<C>): LiveAgent<C> => {
        if (streaming && !p.gone && sameKey(answerKey, p.key)) {
          p.streaming = true;
          if (p === session) stopIdle();
        }
        return p;
      };
      const live = reusable(key, agent);
      if (live) return Promise.resolve(mark(live));
      for (const s of starts) if (sameKey(s.key, key) && s.agent === agent) return s.promise.then(mark);
      // Registered before its body runs: a spec that throws at once still removes it.
      const s = { key: copy(key), agent } as Start<C>;
      starts.add(s);
      s.promise = (async () => {
        try {
          const launch = await spec();
          return await inLane(() => startIn(s, launch, start));
        } finally {
          starts.delete(s);
        }
      })();
      return s.promise.then(mark);
    },

    rekey(from, to) {
      if (session && sameKey(session.key, from)) session.key = copy(to);
      if (sameKey(answerKey, from)) answerKey = copy(to);
      if (viewed && sameKey(viewed, from)) viewed = copy(to);
      for (const s of starts) if (sameKey(s.key, from)) s.key = copy(to);
    },

    streaming(key, on) {
      const p = session && sameKey(session.key, key) ? session : null;
      if (on) {
        answerKey = copy(key);
        if (p && p.ready && !p.closing) {
          p.streaming = true;
          stopIdle();
        }
        return;
      }
      if (sameKey(answerKey, key)) answerKey = null;
      if (!p) return;
      p.streaming = false;
      flushAnswerWaiters(p);
      if (p.closing) return;
      if (viewed !== undefined && !sameKey(viewed, p.key)) void close(p);
      else startIdle();
    },

    touch() {
      startIdle();
    },

    probe<T>(spec: LaunchSpec, run: (child: ChildPort) => Promise<T>): Promise<T> {
      if (quitting) return Promise.reject(quit());
      return new Promise<T>((resolve, reject) => {
        void inLane(async () => {
          for (;;) {
            const g = firstGroup();
            if (!g) break;
            if (g.kind === 'session' && g.streaming && !g.closing) {
              await new Promise<void>((wake) => g.answerWaiters.push(wake));
            } else await close(g);
          }
          if (quitting) return reject(quit());
          let g: ProbeProc;
          try {
            g = track(d.spawn(spec), 'probe');
          } catch (e) {
            return reject(e);
          }
          try {
            resolve(await run(g.child));
          } catch (e) {
            reject(e);
          }
          await close(g);
        });
      });
    },

    async interrupt(cancel, o) {
      const p = session;
      try {
        cancel();
      } catch {
        // The kill below must still follow: a lockdown kills the agent whatever happens to the cancel.
      }
      if (!p) return;
      await new Promise<void>((wake) => d.setTimer(wake, t.cancelGraceMs));
      if (p.gone) return;
      if (o.kill === 'always' || !o.ended()) {
        beginClose(p);
        await terminate(p);
      }
    },

    close: closeSession,

    async shutdown(maxMs, cancel) {
      quitting = true;
      stopIdle();
      const all = [...groups];
      if (all.length === 0) return;
      const ended = Promise.all(all.map((g) => g.done)).then(noop);
      let reachDeadline = noop;
      const deadline = new Promise<void>((resolve) => {
        reachDeadline = resolve;
      });
      const deadlineTimer = d.setTimer(() => {
        for (const g of all) {
          beginClose(g);
          kill(g);
        }
        reachDeadline();
      }, maxMs);
      const p = session;
      if (cancel && p && p.streaming && !p.closing) {
        try {
          cancel();
        } catch {
          // The signals below still follow.
        }
        // The cancel gets the first half at most, so SIGTERM still has time before the SIGKILL.
        let graceTimer: unknown = null;
        await Promise.race([ended, new Promise<void>((wake) => {
          graceTimer = d.setTimer(wake, Math.min(t.cancelGraceMs, Math.floor(maxMs / 2)));
        })]);
        d.clearTimer(graceTimer);
      }
      for (const g of all) void close(g);
      await Promise.race([ended, deadline]);
      d.clearTimer(deadlineTimer);
    },

    killNow() {
      stopIdle();
      for (const g of groups) {
        beginClose(g);
        kill(g);
      }
    },

    processes() {
      const conversationIds: Array<string | null> = [];
      for (const g of groups) if (g.kind === 'session') conversationIds.push(g.key.conversationId);
      return { count: groups.size, max, conversationIds };
    },

    resetMax() {
      max = groups.size;
    },

    onExit(fn) {
      exitFns.push(fn);
    },

    setTimeouts(next) {
      if (next.idleMs !== undefined) t.idleMs = next.idleMs;
      if (next.cancelGraceMs !== undefined) t.cancelGraceMs = next.cancelGraceMs;
      if (next.termGraceMs !== undefined) t.termGraceMs = next.termGraceMs;
    },
  };
}
