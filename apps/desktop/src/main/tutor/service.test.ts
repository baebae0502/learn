import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsRepository, LibraryRepository, TextRepository, type Db } from '@learn/db';
import {
  CONSENT_VERSION, LearnError, type AgentId, type AgentsReport, type AgentState, type AgentStatus, type ErrorCode, type PdfSpanAnchor, type SessionsChanged,
  type TutorAskInput, type TutorTurnEvent,
} from '@learn/domain';
import { freshDb, seedItem } from '../../../../../packages/db/test/fixtures';
import type { LibraryContext } from '../library-context';
import { openPrefsStore, type PrefsStore } from '../prefs';
import type { PromptOutcome, SessionUpdate } from './acp/client';
import { RpcError } from './acp/jsonrpc';
import type { AgentDetector } from './agents/detect';
import { historyDirs } from './agents/isolation';
import type { SessionKey, Supervisor } from './agents/supervisor';
import type { AgentSession, StartInput, TutorBackend } from './backend';
import { INSTRUCTIONS, regroundInstruction } from './prompts';
import { createScopeRegistry, type ScopeRegistry } from './scope';
import { createTutorService, type TutorService } from './service';
import { tutorLog } from './log';

vi.mock('./log', () => ({ tutorLog: vi.fn() }));

const NOW = '2026-11-10T09:31:00.000Z';
const SENT = { selection: 0, replayedTurns: 0, preamble: true } as const;
const READER = { pageIndex: 2, pageCount: 12, outline: [{ title: 'Intro', depth: 0, pageIndex: 0 }], outlineComplete: true, outlineTotal: 1 };
const OK: PromptOutcome = { stopReason: 'end_turn', lockdown: false, model: null, inputTokens: null, outputTokens: null };
const ANSWER = '답입니다.';
const span = (revisionId: string, pageIndex = 1): PdfSpanAnchor => ({
  kind: 'pdf', revisionId, precision: 'span', pageIndex, quads: [[0, 0, 1, 0, 0, 1, 1, 1]], coordinateSpace: 'pdf-user-space', text: { quote: { exact: 'q', prefix: '', suffix: '' } },
});
const sameKey = (a: SessionKey, b: SessionKey) => a.itemId === b.itemId && a.conversationId === b.conversationId;
const status = (id: AgentId, state: AgentState): AgentStatus => ({ id, name: id, state, cliVersion: null, adapterVersion: null, minimum: null, command: null, note: null });
const report = (claude: AgentState = 'ready', fake: AgentState = 'ready'): AgentsReport => ({ agents: [status('claude', claude)], fake: status('fake', fake) });

/** A promise the test settles by hand. */
function gate<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { p, resolve, reject };
}

/** Timers that never fire on their own: the turn's clocks stay quiet unless a test needs them. */
const quietTimers = { setTimer: () => ({}), clearTimer: () => {} };

/** The supervisor's answer reservation and its live process, as far as the service uses them. */
function fakeSupervisor() {
  let answer: SessionKey | null = null;
  let live: { key: SessionKey; agent: AgentId; streaming: boolean } | null = null;
  /** A closed process is gone: the next start is a new process and a new ACP session. */
  let generation = 0;
  const log = { views: [] as Array<SessionKey | null>, ended: [] as SessionKey[], rekeys: [] as Array<[SessionKey, SessionKey]>, closes: 0, shutdowns: [] as number[], touches: 0, timeouts: [] as unknown[] };
  const sup = {
    view: (k: SessionKey | null) => log.views.push(k),
    current: () => live,
    busyWith: (key: SessionKey) => (answer && !sameKey(answer, key) ? { ...answer } : null),
    rekey(from: SessionKey, to: SessionKey) {
      log.rekeys.push([{ ...from }, { ...to }]);
      if (answer && sameKey(answer, from)) answer = { ...to };
    },
    streaming(key: SessionKey, on: boolean) {
      if (on) answer = { ...key };
      else {
        log.ended.push({ ...key });
        if (answer && sameKey(answer, key)) answer = null;
        if (live && sameKey(live.key, key)) live = { ...live, streaming: false };
      }
    },
    touch: () => {
      log.touches += 1;
    },
    close: async () => {
      log.closes += 1;
      live = null;
      generation += 1;
    },
    shutdown: async (ms: number) => {
      log.shutdowns.push(ms);
    },
    killNow: () => {},
    processes: () => ({ count: 0, max: 0, conversationIds: [] }),
    resetMax: () => {},
    setTimeouts: (t: unknown) => log.timeouts.push(t),
  };
  return {
    sup: sup as unknown as Supervisor<unknown>, log,
    /** What the real backend's acquire does at the call: the key is reserved for an answer. */
    reserve: (key: SessionKey) => {
      answer = { ...key };
    },
    setLive: (l: typeof live) => {
      live = l;
    },
    generation: () => generation,
  };
}

/** One ACP session per key and agent; a stored session opened by the same agent is resumed. */
function fakeBackend(sup: ReturnType<typeof fakeSupervisor>, scopes: ScopeRegistry, order: string[]) {
  const starts: StartInput[] = [];
  const prompts: Array<Array<{ type: 'text'; text: string }>> = [];
  const interrupts: Array<'always' | 'if-not-ended'> = [];
  const sessions = new Map<string, AgentSession>();
  let closes = 0;
  let n = 0;
  const open = (i: StartInput): AgentSession => {
    const id = `${sup.generation()}|${i.key.itemId}|${i.key.conversationId}|${i.agent}`;
    let s = sessions.get(id);
    if (!s) {
      const c = i.conversation;
      const resumed = c !== null && c.agentSessionId !== null && c.agentOfSession === i.agent;
      s = {
        key: i.key, agent: i.agent, sessionId: c === null ? null : resumed ? c.agentSessionId : `acp-${++n}`,
        scope: c === null ? null : scopes.open({ ...c.scopeInit, bindMcpSession: true }), firstPrompt: true, resumedBy: c === null ? null : resumed ? 'resume' : 'new',
      };
      sessions.set(id, s);
    }
    return s;
  };
  const ctl = {
    start: async (i: StartInput): Promise<AgentSession> => open(i),
    prompt: async (_s: AgentSession, _b: unknown, on: (u: SessionUpdate) => void): Promise<PromptOutcome> => {
      on({ kind: 'text', text: ANSWER });
      return OK;
    },
  };
  const backend: TutorBackend = {
    start(i) {
      starts.push(i);
      if (i.streaming) sup.reserve(i.key);
      sup.setLive({ key: { ...i.key }, agent: i.agent, streaming: i.streaming === true });
      return ctl.start(i);
    },
    prompt(s, b, on) {
      prompts.push(b);
      order.push('prompt');
      return ctl.prompt(s, b, on);
    },
    interrupt(_s, k) {
      interrupts.push(k);
    },
    async close() {
      closes += 1;
    },
    killNow: () => {},
    probe: async () => 'ok',
  };
  return { backend, ctl, starts, prompts, interrupts, sessions, open, closes: () => closes };
}

let db: Db;
let dir: string;
beforeEach(() => {
  db = freshDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-tutor-service-'));
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

interface RigOptions { consent?: boolean; agent?: AgentId | null; cached?: AgentsReport | null; online?: boolean; network?: 'online' | 'offline' | null; fakeAvailable?: boolean; emitThrows?: boolean }
function rig(o: RigOptions = {}) {
  const seed = seedItem(db);
  const ctx = { db, repo: new LibraryRepository(db), conversations: new ConversationsRepository(db), text: new TextRepository(db) } as unknown as LibraryContext;
  const repo = ctx.conversations;
  const prefs: PrefsStore = openPrefsStore(fs.mkdtempSync(path.join(dir, 'prefs-')));
  if (o.consent !== false) prefs.set({ tutor: { consent: { version: CONSENT_VERSION, at: NOW }, agent: o.agent === undefined ? 'claude' : o.agent } });
  const order: string[] = [];
  const events: TutorTurnEvent[] = [];
  const sessions: SessionsChanged[] = [];
  const supCtl = fakeSupervisor();
  const scopes = createScopeRegistry();
  const be = fakeBackend(supCtl, scopes, order);
  let cached: AgentsReport | null = o.cached === undefined ? report() : o.cached;
  const detector = {
    report: vi.fn(async () => cached ?? report()),
    cachedReport: vi.fn(() => cached),
    detected: vi.fn(() => null),
    markLockedOut: vi.fn((a: AgentId) => order.push(`markLockedOut:${a}`)),
    markLogin: vi.fn((a: AgentId) => order.push(`markLogin:${a}`)),
  } satisfies AgentDetector;
  const net = { online: o.online ?? true, network: o.network ?? null };
  const prefsChanged = vi.fn();
  const prioritize = vi.fn();
  const userData = path.join(dir, 'userData');
  const service: TutorService = createTutorService({
    context: () => ctx, prefs, prefsChanged, backend: be.backend, detector, supervisor: supCtl.sup, scopes,
    isOnline: () => net.online, network: () => net.network, prioritize,
    emitTurn: (e) => {
      order.push(e.kind === 'failed' ? `emit:failed:${e.code}` : `emit:${e.kind}`);
      events.push(e);
      if (o.emitThrows) throw new Error('the window is gone');
    },
    emitSessions: (e) => {
      sessions.push(e);
      if (o.emitThrows) throw new Error('the window is gone');
    },
    userData, tutorHome: path.join(userData, 'Tutor'), home: path.join(dir, 'home'), fakeAvailable: o.fakeAvailable ?? true, now: () => NOW, timers: quietTimers,
  });
  const ask = (over: Partial<TutorAskInput> = {}): ReturnType<TutorService['ask']> =>
    service.ask({ itemId: seed.itemId, conversationId: null, text: '어텐션이 뭐야?', selection: null, reader: READER, ...over });
  const count = (table = 'messages') => db.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get() as number;
  /** The turn has ended: its answer was released to the supervisor. */
  const ended = (n = 1) => vi.waitFor(() => expect(supCtl.log.ended.length).toBeGreaterThanOrEqual(n), { interval: 1 });
  /** A conversation with one answered question, written as the repository would after a turn. */
  const answered = (text = ANSWER, over: { status?: 'complete' | 'stopped' | 'failed'; code?: ErrorCode | null; attached?: boolean } = {}) => {
    const t = repo.beginTurn({
      conversationId: null, itemId: seed.itemId, revisionId: seed.revisionId, agent: 'claude', openedAtPage: 0,
      user: { kind: 'question', text: '어텐션이 뭐야?', sent: SENT, attached: over.attached ? { anchor: span(seed.revisionId), quote: '붙인 구간의 글', label: '2쪽' } : null }, now: NOW,
    });
    const status = over.status ?? 'complete';
    repo.finishTurn(t.tutorMessageId, {
      status, text, stopReason: status === 'failed' ? null : 'end_turn', errorCode: status === 'failed' ? (over.code ?? 'AGENT_EXITED') : null, revisionId: seed.revisionId, verified: [],
    }, NOW);
    return t;
  };
  return { service, seed, ctx, repo, prefs, prefsChanged, prioritize, detector, supCtl, be, events, sessions, order, ask, count, ended, answered, net, scopes, setCached: (r: AgentsReport | null) => { cached = r; }, userData };
}

const askIds = (a: Awaited<ReturnType<TutorService['ask']>>) => {
  if ('busyWith' in a) throw new Error('the ask waited for another answer');
  return a;
};
const code = async (p: Promise<unknown>): Promise<ErrorCode | 'resolved'> => p.then(() => 'resolved' as const, (e: unknown) => (e instanceof LearnError ? e.code : 'INTERNAL'));

describe('the tutor service', () => {
  describe('consent (J9, M4)', () => {
    it('before consent: agents, chooseAgent, ask, resend and reground refuse, view, stop and warm do nothing — no detection, no process', async () => {
      const r = rig({ consent: false });
      expect(await code(r.service.agents({ mode: 'cached' }))).toBe('TUTOR_CONSENT_REQUIRED');
      expect(await code(r.service.chooseAgent('claude'))).toBe('TUTOR_CONSENT_REQUIRED');
      expect(await code(r.ask())).toBe('TUTOR_CONSENT_REQUIRED');
      const id = '0d4f5b8e-1c2a-4e7f-9a3b-5c6d7e8f9a01';
      expect(await code(r.service.resend({ messageId: id, reader: READER }))).toBe('TUTOR_CONSENT_REQUIRED');
      expect(await code(r.service.reground({ messageId: id, reader: READER }))).toBe('TUTOR_CONSENT_REQUIRED');
      await expect(r.service.warm({ itemId: r.seed.itemId, conversationId: null })).resolves.toBeUndefined();
      r.service.view({ itemId: r.seed.itemId, conversationId: null });
      r.service.stop(id);
      expect(r.be.starts).toEqual([]);
      expect(r.detector.report).not.toHaveBeenCalled();
      expect(r.supCtl.log.views).toEqual([]);
      expect(r.count()).toBe(0);
    });

    it('consent writes prefs.tutor.consent with its version and tells the windows', () => {
      const r = rig({ consent: false });
      r.service.consent();
      expect(r.prefs.get().tutor).toEqual({ consent: { version: CONSENT_VERSION, at: NOW }, agent: null });
      expect(r.prefsChanged).toHaveBeenCalledTimes(1);
    });
  });

  describe('choosing the agent', () => {
    it('writes prefs.tutor.agent for a ready agent; AGENT_NOT_READY for one that is not', async () => {
      const r = rig({ agent: null, cached: report('login') });
      expect(await code(r.service.chooseAgent('claude'))).toBe('AGENT_NOT_READY');
      expect(r.prefs.get().tutor.agent).toBeNull();
      await r.service.chooseAgent('fake');
      expect(r.prefs.get().tutor.agent).toBe('fake');
      expect(r.prefsChanged).toHaveBeenCalledTimes(1);
      const packaged = rig({ agent: null, fakeAvailable: false });
      expect(await code(packaged.service.chooseAgent('fake'))).toBe('AGENT_NOT_READY');
    });

    it('closes the idle process of another agent, not one that is answering (C1)', async () => {
      const r = rig();
      const key = { itemId: r.seed.itemId, conversationId: null };
      r.supCtl.setLive({ key, agent: 'claude', streaming: true });
      await r.service.chooseAgent('fake');
      expect(r.supCtl.log.closes).toBe(0);
      r.supCtl.setLive({ key, agent: 'claude', streaming: false });
      await r.service.chooseAgent('claude');
      expect(r.supCtl.log.closes).toBe(0);
      await r.service.chooseAgent('fake');
      expect(r.supCtl.log.closes).toBe(1);
    });
  });

  describe('a question\'s refusals before any row (J49, P-28, P-35)', () => {
    it('offline: OFFLINE, no row, no start — the fake agent skips the real check but follows the test hook', async () => {
      const r = rig({ online: false });
      expect(await code(r.ask())).toBe('OFFLINE');
      expect([r.count(), r.be.starts.length]).toEqual([0, 0]);
      r.net.network = 'online';
      askIds(await r.ask());
      await r.ended();

      const f = rig({ agent: 'fake', online: false });
      askIds(await f.ask());
      await f.ended();
      f.net.network = 'offline';
      const before = f.count();
      expect(await code(f.ask())).toBe('OFFLINE');
      expect(f.count()).toBe(before);
    });

    it('a chosen agent the cached report has as not ready: AGENT_NOT_READY (AGENT_LOGIN for a login), no row', async () => {
      const r = rig({ cached: report('adapter') });
      expect(await code(r.ask())).toBe('AGENT_NOT_READY');
      r.setCached(report('login'));
      expect(await code(r.ask())).toBe('AGENT_LOGIN');
      expect([r.count(), r.be.starts.length]).toEqual([0, 0]);
      const none = rig({ agent: null });
      expect(await code(none.ask())).toBe('AGENT_NOT_READY');
    });

    it('no cached report (I5): the rows are written and answered at once; a detection that finds it not ready fails before the answer, leaving no row', async () => {
      const r = rig({ cached: null });
      const started = gate<AgentSession>();
      r.be.ctl.start = () => started.p;
      const a = askIds(await r.ask());
      expect(r.count()).toBe(2);
      expect(r.detector.report).not.toHaveBeenCalled();
      started.reject(new LearnError('AGENT_NOT_READY', 'not ready'));
      await r.ended();
      expect(r.events).toEqual([{ conversationId: a.conversationId, messageId: a.tutorMessageId, kind: 'failed', phase: 'before', code: 'AGENT_NOT_READY' }]);
      expect(r.count()).toBe(0);
      expect(r.count('conversations')).toBe(0);
      expect(r.sessions.map((s) => s.reason)).toEqual(['created', 'deleted']);
    });

    it('another session is answering: the turn it waits for, no row (P-35)', async () => {
      const r = rig();
      const started = gate<AgentSession>();
      r.be.ctl.start = () => started.p;
      const first = askIds(await r.ask());
      const other = seedItem(db);
      const rows = r.count();
      await expect(r.ask({ itemId: other.itemId })).resolves.toEqual({ busyWith: { conversationId: first.conversationId, messageId: first.tutorMessageId } });
      expect(r.count()).toBe(rows);
      expect(r.be.starts).toHaveLength(1);
    });

    it('a conversation of another item, a trashed item, or a passage of another revision: VALIDATION_FAILED, no row', async () => {
      const r = rig();
      const a = r.answered();
      const other = seedItem(db);
      const rows = r.count();
      expect(await code(r.ask({ itemId: other.itemId, conversationId: a.conversationId }))).toBe('VALIDATION_FAILED');
      expect(await code(r.ask({ selection: { anchor: span(other.revisionId), text: '구간' } }))).toBe('VALIDATION_FAILED');
      const video = seedItem(db, { type: 'video' });
      expect(await code(r.ask({ itemId: video.itemId }))).toBe('VALIDATION_FAILED');
      r.ctx.repo.trash([other.itemId]);
      expect(await code(r.ask({ itemId: other.itemId }))).toBe('VALIDATION_FAILED');
      expect(r.count()).toBe(rows);
      expect(r.be.starts).toEqual([]);
    });
  });

  describe('a question', () => {
    it('answers with the rows before the agent starts, the key reserved at that moment (I3)', async () => {
      const r = rig();
      const started = gate<AgentSession>();
      r.be.ctl.start = () => started.p;
      const a = askIds(await r.ask());
      expect(r.repo.message(a.userMessageId)).toMatchObject({ role: 'user', kind: 'question', text: '어텐션이 뭐야?' });
      expect(r.repo.message(a.tutorMessageId)).toMatchObject({ role: 'tutor', status: 'streaming' });
      const key = { itemId: r.seed.itemId, conversationId: a.conversationId };
      expect(r.supCtl.sup.busyWith({ itemId: 'another', conversationId: null })).toEqual(key);
      expect(r.supCtl.log.rekeys).toEqual([[{ itemId: r.seed.itemId, conversationId: null }, key]]);
      expect(r.be.starts[0]).toMatchObject({ key, agent: 'claude', streaming: true, conversation: { id: a.conversationId, agentSessionId: null, agentOfSession: 'claude' } });
      expect(r.sessions).toEqual([{ reason: 'created', itemIds: [r.seed.itemId], conversationIds: [a.conversationId] }]);
      started.resolve(r.be.open(r.be.starts[0]!));
      await r.ended();
      expect(r.supCtl.log.ended).toEqual([key]);
      expect(r.supCtl.sup.busyWith({ itemId: 'another', conversationId: null })).toBeNull();
    });

    it('sends the instructions, the passage and the question; keeps what was sent, the session it opened, and the answer (P-15)', async () => {
      const r = rig();
      const a = askIds(await r.ask({ selection: { anchor: span(r.seed.revisionId), text: '붙인 구간의 글' } }));
      await r.ended();
      const s = r.be.sessions.values().next().value!;
      const blocks = r.be.prompts[0]!.map((b) => b.text);
      expect(blocks[0]).toBe(INSTRUCTIONS(s.scope!.nonce));
      expect(blocks[1]).toContain('page 2');
      expect(blocks[1]).toContain('붙인 구간의 글');
      expect(blocks.at(-1)).toBe('어텐션이 뭐야?');
      expect(r.repo.thread(a.conversationId).messages.map((m) => [m.role, m.status, m.text, m.sent])).toEqual([
        ['user', 'complete', '어텐션이 뭐야?', { selection: 1, replayedTurns: 0, preamble: true }],
        ['tutor', 'complete', ANSWER, null],
      ]);
      expect(r.repo.conversation(a.conversationId)).toMatchObject({ agent: 'claude', agentSessionId: s.sessionId });
      expect(s.scope).toMatchObject({ pageCount: 12, readerPage: 2, outline: { entries: READER.outline, complete: true, total: 1 }, activeTurn: null });
      expect(s.firstPrompt).toBe(false);
      expect(r.prioritize).toHaveBeenCalledWith(r.seed.asset.sha256);
      expect(r.events.map((e) => e.kind)).toEqual(['text', 'done']);
      expect(r.sessions.map((e) => e.reason)).toEqual(['created', 'updated']);
      expect(r.supCtl.log.touches).toBe(1);
    });

    it('the scope holds the turn while it runs', async () => {
      const r = rig();
      const answer = gate<PromptOutcome>();
      r.be.ctl.prompt = () => answer.p;
      const a = askIds(await r.ask({ selection: { anchor: span(r.seed.revisionId), text: '붙인 구간의 글' } }));
      await vi.waitFor(() => expect(r.be.prompts).toHaveLength(1), { interval: 1 });
      const s = r.be.sessions.values().next().value!;
      expect(s.scope!.activeTurn).toEqual({ tutorMessageId: a.tutorMessageId, selection: { anchor: span(r.seed.revisionId), text: '붙인 구간의 글' }, pagesReturned: 0 });
      answer.resolve(OK);
      await r.ended();
      expect(s.scope!.activeTurn).toBeNull();
    });

    it('a start that fails before the answer leaves no row and tells failed{before}', async () => {
      const r = rig();
      r.be.ctl.start = async () => {
        throw new LearnError('AGENT_START_FAILED', 'no');
      };
      const a = askIds(await r.ask());
      await r.ended();
      expect(r.events).toEqual([{ conversationId: a.conversationId, messageId: a.tutorMessageId, kind: 'failed', phase: 'before', code: 'AGENT_START_FAILED' }]);
      expect([r.count(), r.count('conversations')]).toEqual([0, 0]);
      expect(r.sessions.map((s) => s.reason)).toEqual(['created', 'deleted']);
    });

    it('a question to a switched agent opens a new ACP session, replays the earlier turns and records the new agent (J23)', async () => {
      const r = rig();
      const a = askIds(await r.ask());
      await r.ended();
      expect(r.repo.conversation(a.conversationId)).toMatchObject({ agent: 'claude', agentSessionId: 'acp-1' });
      await r.service.chooseAgent('fake');
      askIds(await r.ask({ conversationId: a.conversationId, text: '다음 질문' }));
      await r.ended(2);
      expect(r.be.starts[1]).toMatchObject({ agent: 'fake', conversation: { id: a.conversationId, agentSessionId: 'acp-1', agentOfSession: 'claude' } });
      const blocks = r.be.prompts[1]!.map((b) => b.text);
      const s = [...r.be.sessions.values()].find((x) => x.agent === 'fake')!;
      expect(blocks[0]).toBe(INSTRUCTIONS(s.scope!.nonce));
      expect(blocks[1]).toContain(`LEARN-HISTORY ${s.scope!.nonce}`);
      expect(blocks[1]).toContain('어텐션이 뭐야?');
      expect(blocks[1]).toContain(ANSWER);
      expect(blocks.at(-1)).toBe('다음 질문');
      expect(r.repo.conversation(a.conversationId)).toMatchObject({ agent: 'fake', agentSessionId: 'acp-2' });
      expect(r.repo.thread(a.conversationId).messages[2]!.sent).toEqual({ selection: 0, replayedTurns: 1, preamble: true });
    });

    it('stop interrupts the running turn once, if-not-ended; another message is not stopped', async () => {
      const r = rig();
      const answer = gate<PromptOutcome>();
      r.be.ctl.prompt = () => answer.p;
      const a = askIds(await r.ask());
      await vi.waitFor(() => expect(r.be.prompts).toHaveLength(1), { interval: 1 });
      r.service.stop(a.userMessageId);
      expect(r.be.interrupts).toEqual([]);
      r.service.stop(a.tutorMessageId);
      expect(r.be.interrupts).toEqual(['if-not-ended']);
      answer.resolve({ ...OK, stopReason: 'cancelled' });
      await r.ended();
      expect(r.events.at(-1)).toMatchObject({ kind: 'done', status: 'stopped' });
    });

    it('a stop before the ACP session is ready ends the answer stopped and costs the session nothing: its next prompt still carries the head and the replay', async () => {
      const r = rig();
      const prior = r.answered();
      const setSent = vi.spyOn(r.repo, 'setSent');
      const started = gate<AgentSession>();
      r.be.ctl.start = () => started.p;
      const a = askIds(await r.ask({ conversationId: prior.conversationId }));
      r.service.stop(a.tutorMessageId);
      const s = r.be.open(r.be.starts[0]!);
      started.resolve(s);
      await r.ended();
      expect(r.be.prompts).toEqual([]);
      expect(r.events).toEqual([{ conversationId: prior.conversationId, messageId: a.tutorMessageId, kind: 'done', status: 'stopped', stopReason: 'cancelled', sources: [] }]);
      const thread = r.repo.thread(prior.conversationId).messages;
      expect(thread.map((m) => [m.id, m.status, m.text, m.stopReason])).toEqual([
        [prior.userMessageId, 'complete', '어텐션이 뭐야?', null], [prior.tutorMessageId, 'complete', ANSWER, 'end_turn'],
        [a.userMessageId, 'complete', '어텐션이 뭐야?', null], [a.tutorMessageId, 'stopped', '', 'cancelled'],
      ]);
      expect(setSent).not.toHaveBeenCalled();
      expect(thread[2]!.sent).toEqual({ selection: 0, replayedTurns: 0, preamble: false });
      expect(r.repo.conversation(prior.conversationId)!.agentSessionId).toBeNull();
      expect(s.firstPrompt).toBe(true);
      expect(s.scope!.activeTurn).toBeNull();

      r.be.ctl.start = async (i) => r.be.open(i);
      askIds(await r.ask({ conversationId: prior.conversationId, text: '다시 묻기' }));
      await r.ended(2);
      const blocks = r.be.prompts[0]!.map((b) => b.text);
      expect(blocks[0]).toBe(INSTRUCTIONS(s.scope!.nonce));
      expect(blocks[1]).toContain(`LEARN-HISTORY ${s.scope!.nonce}`);
      expect(blocks.at(-1)).toBe('다시 묻기');
      expect(s.firstPrompt).toBe(false);
    });

    it('a turn whose storage fails ends anyway: failed INTERNAL, the key released, the scope\'s turn cleared', async () => {
      const r = rig();
      vi.spyOn(r.repo, 'finishTurn').mockImplementationOnce(() => {
        throw new LearnError('INTERNAL', 'disk');
      });
      const a = askIds(await r.ask());
      await r.ended();
      const s = r.be.sessions.values().next().value!;
      expect(r.events.at(-1)).toEqual({ conversationId: a.conversationId, messageId: a.tutorMessageId, kind: 'failed', phase: 'during', code: 'INTERNAL' });
      expect(r.repo.message(a.tutorMessageId)).toMatchObject({ status: 'failed', errorCode: 'INTERNAL' });
      expect(s.scope!.activeTurn).toBeNull();
      expect(r.supCtl.sup.busyWith({ itemId: 'another', conversationId: null })).toBeNull();
      askIds(await r.ask());
      await r.ended(2);
      expect(r.events.at(-1)).toMatchObject({ kind: 'done', status: 'complete' });
    });

    it('a window that cannot be told strands nothing: an emit that throws is logged by its code and the turn still ends', async () => {
      const r = rig({ emitThrows: true });
      vi.mocked(tutorLog).mockClear();
      const a = askIds(await r.ask());
      await r.ended();
      expect(r.repo.message(a.tutorMessageId)).toMatchObject({ status: 'complete', text: ANSWER });
      expect(r.events.map((e) => e.kind)).toEqual(['text', 'done']);
      expect(r.sessions.map((e) => e.reason)).toEqual(['created', 'updated']);
      expect(vi.mocked(tutorLog).mock.calls.filter(([event]) => event === 'emit-failed')).toEqual([
        ['emit-failed', { code: 'Error' }], ['emit-failed', { code: 'Error' }], ['emit-failed', { code: 'Error' }], ['emit-failed', { code: 'Error' }],
      ]);
      expect(r.supCtl.sup.busyWith({ itemId: 'another', conversationId: null })).toBeNull();
      r.be.ctl.start = async () => {
        throw new LearnError('AGENT_START_FAILED', 'no');
      };
      askIds(await r.ask());
      await r.ended(2);
      expect(r.count('conversations')).toBe(1);
      expect(r.events.at(-1)).toMatchObject({ kind: 'failed', phase: 'before', code: 'AGENT_START_FAILED' });
    });

    it('a lockdown marks the agent locked out before the failure is told (P-26)', async () => {
      const r = rig();
      r.be.ctl.prompt = async (_s, _b, on) => {
        on({ kind: 'tool', call: { toolCallId: 'b', title: 'Bash', kind: 'execute', toolName: null, rawInput: null }, learn: false });
        return { ...OK, stopReason: 'cancelled', lockdown: true };
      };
      askIds(await r.ask());
      await r.ended();
      expect(r.detector.markLockedOut).toHaveBeenCalledWith('claude');
      expect(r.order.slice(-2)).toEqual(['markLockedOut:claude', 'emit:failed:AGENT_LOCKDOWN']);
    });

    it('a turn that got no answer leaves the next prompt the session\'s first (M12)', async () => {
      const r = rig();
      const prior = r.answered();
      r.be.ctl.prompt = async () => {
        throw new LearnError('AGENT_TIMEOUT', 'late');
      };
      askIds(await r.ask({ conversationId: prior.conversationId }));
      await r.ended();
      const s = r.be.sessions.values().next().value!;
      expect(r.events.at(-1)).toMatchObject({ kind: 'failed', phase: 'before', code: 'AGENT_TIMEOUT' });
      expect(s.firstPrompt).toBe(true);
      r.be.ctl.prompt = async (_s, _b, on) => {
        on({ kind: 'text', text: ANSWER });
        return OK;
      };
      askIds(await r.ask({ conversationId: prior.conversationId }));
      await r.ended(2);
      expect(r.be.prompts[1]![0]!.text).toBe(INSTRUCTIONS(s.scope!.nonce));
      expect(s.firstPrompt).toBe(false);
    });

    it('an answer that ends AGENT_EXITED closes that process, so the next question resumes on a new one (P-38)', async () => {
      const r = rig();
      askIds(await r.ask());
      await r.ended();
      expect(r.be.closes()).toBe(0);
      r.be.ctl.prompt = async () => {
        throw new RpcError(-32002, 'Resource not found', { sessionId: 'acp-1' });
      };
      askIds(await r.ask());
      await r.ended(2);
      expect(r.events.at(-1)).toMatchObject({ kind: 'failed', code: 'AGENT_EXITED' });
      expect(r.be.closes()).toBe(1);
    });

    it('a login the agent reports at its first prompt: markLogin once, before the failure is told (I3)', async () => {
      const r = rig();
      r.be.ctl.prompt = async () => {
        throw new RpcError(-32000, 'Authentication required');
      };
      askIds(await r.ask());
      await r.ended();
      expect(r.detector.markLogin).toHaveBeenCalledTimes(1);
      expect(r.detector.markLogin).toHaveBeenCalledWith('claude');
      expect(r.order).toEqual(['prompt', 'markLogin:claude', 'emit:failed:AGENT_LOGIN']);
      expect(r.events.at(-1)).toMatchObject({ kind: 'failed', phase: 'before', code: 'AGENT_LOGIN' });

      const s = rig();
      s.be.ctl.start = async () => {
        throw new LearnError('AGENT_LOGIN', 'login');
      };
      askIds(await s.ask());
      await s.ended();
      expect(s.detector.markLogin).toHaveBeenCalledTimes(1);
      expect(s.order).toEqual(['markLogin:claude', 'emit:failed:AGENT_LOGIN']);
    });

    it('a quit while the agent starts: when the start then resolves nothing is written, started or told, the answer stays streaming (I2)', async () => {
      const r = rig();
      const setSent = vi.spyOn(r.repo, 'setSent');
      const setAgentSession = vi.spyOn(r.repo, 'setAgentSession');
      const started = gate<AgentSession>();
      r.be.ctl.start = () => started.p;
      const a = askIds(await r.ask());
      await r.service.shutdown(2000);
      expect(r.be.interrupts).toEqual([]);
      started.resolve(r.be.open(r.be.starts[0]!));
      await r.ended();
      expect(setSent).not.toHaveBeenCalled();
      expect(setAgentSession).not.toHaveBeenCalled();
      expect(r.prioritize).not.toHaveBeenCalled();
      expect(r.be.prompts).toEqual([]);
      expect(r.events).toEqual([]);
      expect(r.sessions.map((e) => e.reason)).toEqual(['created']);
      expect(r.repo.message(a.tutorMessageId)).toMatchObject({ status: 'streaming' });
    });

    it('once quitting began nothing new is asked, detected or started: CANCELLED, no row', async () => {
      const r = rig();
      const failed = r.answered('부분', { status: 'failed' });
      const doubted = r.answered('x [[p2]]');
      const rows = r.count();
      await r.service.shutdown(2000);
      expect(await code(r.ask())).toBe('CANCELLED');
      expect(await code(r.service.resend({ messageId: failed.tutorMessageId, reader: READER }))).toBe('CANCELLED');
      expect(await code(r.service.reground({ messageId: doubted.tutorMessageId, reader: READER }))).toBe('CANCELLED');
      expect(await code(r.service.agents({ mode: 'recheck', agent: 'claude' }))).toBe('CANCELLED');
      expect(await code(r.service.chooseAgent('fake'))).toBe('CANCELLED');
      await expect(r.service.warm({ itemId: r.seed.itemId, conversationId: null })).resolves.toBeUndefined();
      expect(r.count()).toBe(rows);
      expect(r.be.starts).toEqual([]);
      expect(r.detector.report).not.toHaveBeenCalled();
      expect(r.prefs.get().tutor.agent).toBe('claude');
      expect(r.repo.message(failed.tutorMessageId)).toMatchObject({ status: 'failed' });
    });

    it('a quit in the middle of a turn writes and tells nothing: the answer stays streaming (I2)', async () => {
      const r = rig();
      const answer = gate<PromptOutcome>();
      r.be.ctl.prompt = () => answer.p;
      const a = askIds(await r.ask());
      await vi.waitFor(() => expect(r.be.prompts).toHaveLength(1), { interval: 1 });
      await r.service.shutdown(2000);
      expect(r.be.interrupts).toEqual(['if-not-ended']);
      expect(r.supCtl.log.shutdowns).toEqual([2000]);
      answer.resolve({ ...OK, stopReason: 'cancelled' });
      await r.ended();
      expect(r.repo.message(a.tutorMessageId)).toMatchObject({ status: 'streaming' });
      expect(r.events).toEqual([]);
      expect(r.sessions.map((s) => s.reason)).toEqual(['created']);
    });
  });

  describe('a resend (I1, P-41, J47)', () => {
    it('offline, waiting or not ready: refused before the failed answer is touched', async () => {
      const r = rig();
      const t = r.answered('부분', { status: 'failed' });
      const retry = vi.spyOn(r.repo, 'retryTurn');
      r.net.online = false;
      expect(await code(r.service.resend({ messageId: t.tutorMessageId, reader: READER }))).toBe('OFFLINE');
      r.net.online = true;
      r.supCtl.reserve({ itemId: 'another', conversationId: 'another' });
      expect(await code(r.service.resend({ messageId: t.tutorMessageId, reader: READER }))).toBe('AGENT_BUSY');
      r.supCtl.sup.streaming({ itemId: 'another', conversationId: 'another' }, false);
      r.setCached(report('old'));
      expect(await code(r.service.resend({ messageId: t.tutorMessageId, reader: READER }))).toBe('AGENT_NOT_READY');
      expect(retry).not.toHaveBeenCalled();
      expect(r.repo.message(t.tutorMessageId)).toMatchObject({ status: 'failed', text: '부분' });
    });

    it('only a failed answer that is not a lockdown is resent', async () => {
      const r = rig();
      const done = r.answered();
      const locked = r.answered('', { status: 'failed', code: 'AGENT_LOCKDOWN' });
      for (const t of [done, locked]) expect(await code(r.service.resend({ messageId: t.tutorMessageId, reader: READER }))).toBe('VALIDATION_FAILED');
      expect(await code(r.service.resend({ messageId: done.userMessageId, reader: READER }))).toBe('VALIDATION_FAILED');
      expect(r.be.starts).toEqual([]);
    });

    it('asks the same question with its passage again, in a new answer row', async () => {
      const r = rig();
      const t = r.answered('부분', { status: 'failed', attached: true });
      const { tutorMessageId } = await r.service.resend({ messageId: t.tutorMessageId, reader: READER });
      expect(tutorMessageId).not.toBe(t.tutorMessageId);
      await r.ended();
      const blocks = r.be.prompts[0]!.map((b) => b.text);
      expect(blocks.some((b) => b.includes('page 2') && b.includes('붙인 구간의 글'))).toBe(true);
      expect(blocks.at(-1)).toBe('어텐션이 뭐야?');
      expect(r.repo.thread(t.conversationId).messages.map((m) => [m.id, m.status, m.text])).toEqual([
        [t.userMessageId, 'complete', '어텐션이 뭐야?'],
        [tutorMessageId, 'complete', ANSWER],
      ]);
      expect(r.be.starts[0]).toMatchObject({ streaming: true });
    });

    it('restarts the agent: a process that outlived the failed turn is closed first, and the resend runs in a new ACP session with the head (J47)', async () => {
      const r = rig();
      r.be.ctl.prompt = async (_s, _b, on) => {
        on({ kind: 'text', text: '부분' });
        throw new LearnError('AGENT_TIMEOUT', 'late');
      };
      const a = askIds(await r.ask());
      await r.ended();
      expect(r.repo.message(a.tutorMessageId)).toMatchObject({ status: 'failed', errorCode: 'AGENT_TIMEOUT' });
      const first = r.be.sessions.values().next().value!;
      expect(r.supCtl.sup.current()).toMatchObject({ agent: 'claude', streaming: false });
      r.be.ctl.prompt = async (_s, _b, on) => {
        on({ kind: 'text', text: ANSWER });
        return OK;
      };
      const { tutorMessageId } = await r.service.resend({ messageId: a.tutorMessageId, reader: READER });
      expect(r.supCtl.log.closes).toBe(1);
      await r.ended(2);
      const second = [...r.be.sessions.values()].find((x) => x !== first);
      expect(second).toMatchObject({ sessionId: 'acp-1', resumedBy: 'resume' });
      expect(second!.scope!.nonce).not.toBe(first.scope!.nonce);
      expect(r.be.prompts[1]![0]!.text).toBe(INSTRUCTIONS(second!.scope!.nonce));
      expect(r.repo.message(tutorMessageId)).toMatchObject({ status: 'complete', text: ANSWER });
    });

    it('a resent turn that fails before its answer keeps the question and leaves a failed answer that can be resent again', async () => {
      const r = rig();
      const t = r.answered('부분', { status: 'failed' });
      r.be.ctl.start = async () => {
        throw new LearnError('AGENT_START_FAILED', 'no');
      };
      const first = await r.service.resend({ messageId: t.tutorMessageId, reader: READER });
      await r.ended();
      expect(r.events).toEqual([{ conversationId: t.conversationId, messageId: first.tutorMessageId, kind: 'failed', phase: 'during', code: 'AGENT_START_FAILED' }]);
      expect(r.repo.thread(t.conversationId).messages.map((m) => [m.id, m.status, m.errorCode])).toEqual([
        [t.userMessageId, 'complete', null],
        [first.tutorMessageId, 'failed', 'AGENT_START_FAILED'],
      ]);
      r.be.ctl.prompt = async () => {
        throw new LearnError('AGENT_TIMEOUT', 'late');
      };
      r.be.ctl.start = async (i) => r.be.open(i);
      const second = await r.service.resend({ messageId: first.tutorMessageId, reader: READER });
      await r.ended(2);
      expect(r.events.at(-1)).toEqual({ conversationId: t.conversationId, messageId: second.tutorMessageId, kind: 'failed', phase: 'during', code: 'AGENT_TIMEOUT' });
      expect(r.repo.message(second.tutorMessageId)).toMatchObject({ status: 'failed', errorCode: 'AGENT_TIMEOUT' });
      expect(r.repo.message(t.userMessageId)).toBeDefined();
    });
  });

  describe('a reground (I1, M6, P-10)', () => {
    it('only an answer with an unverified cite inside the document is asked again', async () => {
      const r = rig();
      const failed = r.answered('x [[p2]]', { status: 'failed' });
      const outside = r.answered('x [[p999]]');
      const clean = r.answered('x');
      for (const t of [failed, outside, clean]) expect(await code(r.service.reground({ messageId: t.tutorMessageId, reader: READER }))).toBe('VALIDATION_FAILED');
      r.supCtl.reserve({ itemId: 'another', conversationId: 'another' });
      const doubted = r.answered('x [[p2]] y [[p999]]');
      expect(await code(r.service.reground({ messageId: doubted.tutorMessageId, reader: READER }))).toBe('AGENT_BUSY');
      expect(r.count()).toBe(8);
    });

    it('asks with the reground instruction as a visible user turn', async () => {
      const r = rig();
      const t = r.answered('x [[p2]] y [[p5]] z [[p999]]');
      const g = await r.service.reground({ messageId: t.tutorMessageId, reader: READER });
      await r.ended();
      const instruction = regroundInstruction([2, 5]);
      expect(r.repo.message(g.userMessageId)).toMatchObject({ kind: 'reground', text: instruction, seq: 2 });
      expect(r.be.prompts[0]!.at(-1)!.text).toBe(instruction);
      expect(r.repo.message(g.tutorMessageId)).toMatchObject({ status: 'complete' });
    });

    it('a reground that fails before its answer drops only its own pair', async () => {
      const r = rig();
      const t = r.answered('x [[p2]]');
      r.be.ctl.start = async () => {
        throw new LearnError('AGENT_START_FAILED', 'no');
      };
      const g = await r.service.reground({ messageId: t.tutorMessageId, reader: READER });
      await r.ended();
      expect(r.events).toEqual([{ conversationId: t.conversationId, messageId: g.tutorMessageId, kind: 'failed', phase: 'before', code: 'AGENT_START_FAILED' }]);
      expect(r.repo.thread(t.conversationId).messages.map((m) => m.id)).toEqual([t.userMessageId, t.tutorMessageId]);
      expect(r.sessions.map((s) => s.reason)).toEqual(['updated']);
    });
  });

  describe('warm, view and the rest', () => {
    it('warm starts the chosen ready agent without reserving, prioritizes a pending body, and stays quiet when it cannot', async () => {
      const r = rig();
      await r.service.warm({ itemId: r.seed.itemId, conversationId: null });
      expect(r.be.starts).toEqual([{ key: { itemId: r.seed.itemId, conversationId: null }, agent: 'claude', conversation: null }]);
      expect(r.prioritize).toHaveBeenCalledWith(r.seed.asset.sha256);
      const t = r.answered();
      await r.service.warm({ itemId: r.seed.itemId, conversationId: t.conversationId });
      expect(r.be.starts[1]).toMatchObject({ key: { itemId: r.seed.itemId, conversationId: t.conversationId }, conversation: { id: t.conversationId, agentOfSession: 'claude' } });
      expect(r.be.starts[1]!.streaming).toBeFalsy();

      r.supCtl.reserve({ itemId: 'another', conversationId: 'another' });
      await r.service.warm({ itemId: r.seed.itemId, conversationId: null });
      r.supCtl.sup.streaming({ itemId: 'another', conversationId: 'another' }, false);
      r.setCached(null);
      await r.service.warm({ itemId: r.seed.itemId, conversationId: null });
      r.setCached(report('login'));
      await r.service.warm({ itemId: r.seed.itemId, conversationId: null });
      r.be.ctl.start = async () => {
        throw new LearnError('AGENT_START_FAILED', 'no');
      };
      r.setCached(report());
      await expect(r.service.warm({ itemId: r.seed.itemId, conversationId: null })).resolves.toBeUndefined();
      expect(r.be.starts).toHaveLength(3);
    });

    it('view goes to the supervisor once consented; the process numbers and the kill are the supervisor\'s', () => {
      const r = rig();
      r.service.view({ itemId: r.seed.itemId, conversationId: null });
      r.service.view(null);
      expect(r.supCtl.log.views).toEqual([{ itemId: r.seed.itemId, conversationId: null }, null]);
      expect(r.service.processes()).toEqual({ count: 0, max: 0, conversationIds: [] });
      r.service.setTimeouts({ idleMs: 5, firstUpdateMs: 10 });
      expect(r.supCtl.log.timeouts).toEqual([{ idleMs: 5 }]);
    });

    it('removes a work folder and Claude\'s records of it, with no conversation row left (P-40, N3)', async () => {
      const r = rig();
      const id = '2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091';
      const work = path.join(r.userData, 'Tutor', 'work', id);
      const [projects, cache] = historyDirs({ agentHome: path.join(r.userData, 'Tutor', 'agents', 'claude'), work, home: path.join(dir, 'home') });
      for (const p of [work, projects!, cache!]) {
        fs.mkdirSync(p, { recursive: true });
        fs.writeFileSync(path.join(p, 'f'), 'x');
      }
      expect(r.repo.conversation(id)).toBeUndefined();
      await r.service.removeWorkFolders([id]);
      for (const p of [work, projects!, cache!]) expect(fs.existsSync(p)).toBe(false);
      await expect(r.service.removeWorkFolders(['../escape'])).resolves.toBeUndefined();
    });
  });
});
