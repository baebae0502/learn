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
   * one started, so a question asked after switching agents never reaches the old one. AGENT_BUSY (nothing started or touched)
   * while another key's answer streams, or while this key's answer streams in another agent. With { streaming: true } the key
   * is reserved for an answer synchronously, before the returned promise settles, and the process is marked answering before
   * anything queued behind its start runs; the reservation goes again when the supervisor fails the acquire. Without it, a key
   * that is neither on screen nor reserved is CANCELLED before `spec` runs. One start in flight per key, shared by its callers
   * (warm and ask); a start the user's glance away closed starts again while its key is still wanted. `spec` may wait
   * (detection runs in the asynchronous part). A `start` still pending when its agent exits is given up (AGENT_EXITED).
   */
  acquire(key: SessionKey, agent: AgentId, spec: () => LaunchSpec | Promise<LaunchSpec>, start: (child: ChildPort) => Promise<C>, opts?: { streaming?: boolean }): Promise<LiveAgent<C>>;
  /** A new empty session's process (and the viewed key, and a reservation) gets its conversation once the first question made one. */
  rekey(from: SessionKey, to: SessionKey): void;
  /**
   * The answer of `key` ended (or never started): the reservation goes, and a process its user left closes now. `on` reserves
   * the key; AGENT_BUSY while another key holds the reservation or streams.
   */
  streaming(key: SessionKey, on: boolean): void;
  /** Turn activity: the idle clock starts over. */
  touch(): void;
  /**
   * The login check: one at a time, never beside a session's process (a live one closes first and its group's exit is awaited);
   * it waits for a streaming *process* to end, never for a bare reservation — the reserving acquire may be waiting for this
   * very check inside its spec. Counted in processes(). Resolves with `run`'s result as soon as `run` settles; the next process
   * still starts only after the check's group has ended. A `run` still pending when its process exits is given up (AGENT_EXITED).
   */
  probe<T>(spec: LaunchSpec, run: (child: ChildPort) => Promise<T>): Promise<T>;
  /**
   * With an answer in flight: cancel(); after cancelGraceMs, if `kill` is 'always' or the answer has not ended, SIGTERM to
   * the group; after termGraceMs, SIGKILL if it still runs. Lockdown is 'always'; a user stop and a timeout 'if-not-ended'.
   */
  interrupt(cancel: () => void, o: { kill: 'always' | 'if-not-ended'; ended(): boolean }): Promise<void>;
  /** No answer in flight: stdin ends, SIGTERM to the group, SIGKILL at termGraceMs; resolves once the group has exited. */
  close(): Promise<void>;
  /**
   * The process of this conversation, live or closing, answering or not: closed as close() closes, resolved once its group has
   * exited; at once when no process is that conversation's.
   */
  closeConversation(conversationId: string): Promise<void>;
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
/** How long a reply may still be on its way after the agent exited, when its stdout does not end (a process still holds it). */
const OUTPUT_GRACE_MS = 250;

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
  /** Settles when the leader exits. */
  readonly leaderExit: Promise<void>;
  leaderExited(): void;
}
interface SessionProc<C> extends Group, LiveAgent<C> {
  readonly kind: 'session';
  key: SessionKey;
  ready: boolean;
  /** Closed because its session was no longer on screen. */
  left: boolean;
  /** Who waits for its answer to end (a login check). */
  answerWaiters: Array<() => void>;
}
interface ProbeProc extends Group { readonly kind: 'probe' }
type Proc<C> = SessionProc<C> | ProbeProc;
interface Start<C> { key: SessionKey; readonly agent: AgentId; promise: Promise<SessionProc<C>> }
/** agent null: the key is reserved for whichever agent its process runs. */
interface Reservation { key: SessionKey; readonly agent: AgentId | null }

const sameKey = (a: SessionKey | null | undefined, b: SessionKey | null | undefined): boolean =>
  a != null && b != null && a.itemId === b.itemId && a.conversationId === b.conversationId;
const copy = (k: SessionKey): SessionKey => ({ itemId: k.itemId, conversationId: k.conversationId });
const noop = () => {};
const busy = () => new LearnError('AGENT_BUSY', 'Another answer is streaming.');
const quit = () => new LearnError('AGENT_EXITED', 'Learn is quitting.');
const unwanted = () => new LearnError('CANCELLED', 'The session is no longer on screen.');

export function createSupervisor<C>(d: { spawn(spec: LaunchSpec): ChildPort; setTimer(fn: () => void, ms: number): unknown; clearTimer(id: unknown): void }): Supervisor<C> {
  const t = { idleMs: TUTOR_LIMITS.idleCloseMs as number, cancelGraceMs: TUTOR_TIMEOUTS.cancelGraceMs as number, termGraceMs: TUTOR_TIMEOUTS.termGraceMs as number };
  /** Every process group that has not ended yet: never more than one. */
  const groups = new Set<Proc<C>>();
  /** The newest session process, from its spawn until its group has ended. */
  let session: SessionProc<C> | null = null;
  /** From the send until its answer ends (or the supervisor fails the send). */
  let answer: Reservation | null = null;
  /** undefined until the renderer first says which session is on screen. */
  let viewed: SessionKey | null | undefined;
  let idleTimer: unknown = null;
  let max = 0;
  let quitting = false;
  /** Starting a process (a session's or the login check's) waits here for the one before it. */
  let lane: Promise<void> = Promise.resolve();
  const starts = new Set<Start<C>>();
  const exitFns: Array<(key: SessionKey | 'probe', e: { code: number | null; signal: string | null }) => void> = [];

  const reservedFor = (key: SessionKey, agent: AgentId) =>
    answer !== null && sameKey(answer.key, key) && (answer.agent === null || answer.agent === agent);
  const held = (p: SessionProc<C>) => p.streaming || reservedFor(p.key, p.agent);
  /** Its key is on screen (or the renderer never said), or reserved for this agent. */
  const wanted = (key: SessionKey, agent: AgentId) => viewed === undefined || sameKey(viewed, key) || reservedFor(key, agent);

  const busyWith = (key: SessionKey): SessionKey | null => {
    if (answer !== null && !sameKey(answer.key, key)) return copy(answer.key);
    const p = session;
    if (p && p.streaming && !sameKey(p.key, key)) return copy(p.key);
    return null;
  };
  /** This key's answer belongs to another agent: switching now would close the process it streams on. */
  const otherAgentAnswers = (key: SessionKey, agent: AgentId): boolean => {
    if (answer !== null && sameKey(answer.key, key) && answer.agent !== null && answer.agent !== agent) return true;
    const p = session;
    return p !== null && sameKey(p.key, key) && p.agent !== agent && p.streaming;
  };

  /** The agent whose process will answer for `key`: the newest start in flight for it, else its live process. */
  const answeringAgent = (key: SessionKey): AgentId | null => {
    let agent: AgentId | null = null;
    for (const s of starts) if (sameKey(s.key, key)) agent = s.agent;
    if (agent !== null) return agent;
    const p = session;
    return p !== null && sameKey(p.key, key) && !p.closing ? p.agent : null;
  };
  /** A glance back restarts a start only for the agent still wanted: not when the user has since asked for another one. */
  const stillWanted = (s: Start<C>): boolean => {
    if (reservedFor(s.key, s.agent)) return true;
    for (const o of starts) if (o !== s && sameKey(o.key, s.key) && o.agent !== s.agent) return false;
    return wanted(s.key, s.agent);
  };

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
  const markAnswering = (p: SessionProc<C>) => {
    p.streaming = true;
    if (p === session) stopIdle();
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

  const onLeaderExit = (g: Proc<C>, e: { code: number | null; signal: NodeJS.Signals | null }) => {
    const key = g.kind === 'probe' ? 'probe' : copy(g.key);
    g.leaderExited();
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
    let leaderExited = noop;
    const leaderExit = new Promise<void>((resolve) => {
      leaderExited = resolve;
    });
    const base = { child, closing: false, termSent: false, killSent: false, gone: false, killTimer: null, pollTimer: null, done, finish, leaderExit, leaderExited };
    const g: Proc<C> = kind === 'probe'
      ? { ...base, kind }
      : { ...base, kind, key: key!, agent: agent!, conn: undefined as C, streaming: false, ready: false, left: false, answerWaiters: [] };
    groups.add(g);
    max = Math.max(max, groups.size);
    child.onExit((e) => onLeaderExit(g, e));
    return g;
  }

  /**
   * A start or a login check whose agent has exited will not answer: it must not hold the lane until its own time limits. A
   * reply it wrote just before exiting can still be on its way, so it is given up only once its stdout has ended (or
   * OUTPUT_GRACE_MS after the exit), and a macrotask later, after the reply's promise chain has settled.
   */
  const untilLeaderExit = <T>(work: Promise<T>, g: Proc<C>): Promise<T> => new Promise<T>((resolve, reject) => {
    let settled = false;
    work.then((v) => {
      settled = true;
      resolve(v);
    }, (e: unknown) => {
      settled = true;
      reject(e);
    });
    void g.leaderExit.then(() => {
      if (settled) return;
      let grace: unknown = null;
      let fired = false;
      const giveUp = () => {
        if (fired) return;
        fired = true;
        if (grace !== null) d.clearTimer(grace);
        d.setTimer(() => reject(new LearnError('AGENT_EXITED', 'The agent exited before it answered.')), 0);
      };
      grace = d.setTimer(giveUp, OUTPUT_GRACE_MS);
      g.child.onOutputEnd(giveUp);
    });
  });

  const inLane = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = lane.then(fn);
    lane = run.then(noop, noop);
    return run;
  };
  const firstGroup = (): Proc<C> | undefined => groups.values().next().value;
  const reusable = (key: SessionKey, agent: AgentId): SessionProc<C> | null => {
    const p = session;
    return p && p.ready && !p.closing && sameKey(p.key, key) && p.agent === agent ? p : null;
  };

  /** In the lane: the one process before it (closing or not) ends its group first, so two groups never overlap. */
  const startIn = async (s: Start<C>, launch: LaunchSpec, start: (child: ChildPort) => Promise<C>): Promise<SessionProc<C>> => {
    try {
      for (;;) {
        const live = reusable(s.key, s.agent);
        if (live) {
          if (reservedFor(live.key, live.agent)) markAnswering(live);
          return live;
        }
        if (busyWith(s.key) || otherAgentAnswers(s.key, s.agent)) throw busy();
        if (quitting) throw quit();
        if (!wanted(s.key, s.agent)) throw unwanted();
        const g = firstGroup();
        if (g) {
          await close(g);
          continue;
        }
        const p = track(d.spawn(launch), 'session', s.key, s.agent);
        session = p;
        let ok = false;
        let failure: unknown = null;
        try {
          p.conn = await untilLeaderExit(start(p.child), p);
          ok = true;
        } catch (e) {
          failure = e;
        }
        if (ok && !p.closing) {
          p.ready = true;
          // Before the lane moves on: a login check queued behind this start must see an answering process, not an idle one.
          if (reservedFor(p.key, p.agent)) markAnswering(p);
          startIdle();
          return p;
        }
        // The user looked away and back while it started: a send must not inherit a closed process.
        if (p.left && !quitting && stillWanted(s)) continue;
        void close(p);
        if (quitting) throw quit();
        if (p.left) throw unwanted();
        throw ok ? new LearnError('AGENT_EXITED', 'The agent was closed while it started.') : failure;
      }
    } finally {
      starts.delete(s);
    }
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
      if (!held(p)) {
        p.left = true;
        void close(p);
      }
    },

    current() {
      const p = session;
      return p && p.ready && !p.closing ? p : null;
    },

    busyWith,

    acquire(key, agent, spec, start, opts = {}) {
      const streaming = opts.streaming === true;
      if (busyWith(key) || otherAgentAnswers(key, agent)) return Promise.reject(busy());
      if (quitting) return Promise.reject(quit());
      if (!streaming && !wanted(key, agent)) return Promise.reject(unwanted());
      const mine: Reservation | null = streaming ? { key: copy(key), agent } : null;
      if (mine) answer = mine;
      const release = (e: unknown): never => {
        if (mine !== null && answer === mine) answer = null;
        throw e;
      };
      const live = reusable(key, agent);
      if (live) {
        if (streaming) markAnswering(live);
        return Promise.resolve(live);
      }
      for (const s of starts) {
        if (sameKey(s.key, key) && s.agent === agent) return s.promise.catch(release);
      }
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
      return s.promise.catch(release);
    },

    rekey(from, to) {
      if (session && sameKey(session.key, from)) session.key = copy(to);
      if (answer !== null && sameKey(answer.key, from)) answer.key = copy(to);
      if (viewed && sameKey(viewed, from)) viewed = copy(to);
      for (const s of starts) if (sameKey(s.key, from)) s.key = copy(to);
    },

    streaming(key, on) {
      const p = session && sameKey(session.key, key) ? session : null;
      if (on) {
        if (busyWith(key)) throw busy();
        if (answer === null || !sameKey(answer.key, key)) answer = { key: copy(key), agent: answeringAgent(key) };
        if (p && p.ready && !p.closing && reservedFor(p.key, p.agent)) markAnswering(p);
        return;
      }
      if (answer !== null && sameKey(answer.key, key)) answer = null;
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
            resolve(await untilLeaderExit(run(g.child), g));
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

    closeConversation(conversationId) {
      const p = session;
      return p !== null && p.key.conversationId === conversationId ? close(p) : Promise.resolve();
    },

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
