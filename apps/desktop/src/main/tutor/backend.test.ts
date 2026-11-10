import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LearnError, type AgentId, type AgentsReport, type AgentState, type AgentStatus } from '@learn/domain';
import type { AcpClient, InitializeInfo } from './acp/client';
import { createPeer, RpcError, type JsonRpcPeer } from './acp/jsonrpc';
import { AGENT_CATALOG } from './agents/catalog';
import type { AgentDetector, Detected } from './agents/detect';
import { sessionMeta, systemPromptParam, type LaunchSpec } from './agents/isolation';
import type { ChildPort } from './agents/spawn';
import type { LiveAgent, SessionKey, Supervisor } from './agents/supervisor';
import { createAcpBackend, type AgentSession, type StartInput } from './backend';
import type { AcpMcpServer, McpTransport } from './mcp/http';
import { INSTRUCTIONS } from './prompts';
import { tutorLog } from './log';
import { createScopeRegistry } from './scope';

vi.mock('./log', () => ({ tutorLog: vi.fn() }));

const ITEM = '0d4f5b8e-1c2a-4e7f-9a3b-5c6d7e8f9a01';
const CONV_ID = '6a1b2c3d-4e5f-4a7b-8c9d-0e1f2a3b4c5d';
const KEY: SessionKey = { itemId: ITEM, conversationId: CONV_ID };
const SCOPE_INIT = {
  conversationId: CONV_ID, itemId: ITEM, revisionId: '9f8e7d6c-5b4a-4321-8fed-cba987654321', sha256: 'a'.repeat(64), title: 'Attention',
  pageCount: 12, outline: { entries: [], complete: true, total: 0 }, readerPage: 0,
};
const CONV: NonNullable<StartInput['conversation']> = { id: CONV_ID, agentSessionId: null, agentOfSession: 'claude', scopeInit: SCOPE_INIT };
const STORED = (agentOfSession: AgentId = 'claude'): NonNullable<StartInput['conversation']> => ({ ...CONV, agentSessionId: 'stored-1', agentOfSession });
const ASK = [{ type: 'text' as const, text: 'q' }];

const TRANSPORT: McpTransport = {
  serverEntry: async (scope): Promise<AcpMcpServer> => ({
    type: 'http', name: 'learn', url: 'http://127.0.0.1:4100/mcp', headers: [{ name: 'Authorization', value: `Bearer ${scope.token}` }],
  }),
  close: async () => {},
};

let ROOT = '';
let USERDATA = '';
const roots: string[] = [];
const adapterRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-backend-adapter-'));
const ADAPTER = path.join(adapterRoot, 'dist', 'index.js');
fs.mkdirSync(path.dirname(ADAPTER), { recursive: true });
fs.writeFileSync(ADAPTER, '');
const DETECTED: Detected = {
  entry: AGENT_CATALOG[0]!, path: '/found/bin', cliPath: '/found/bin/claude', cliVersion: '2.1.318', adapterEntry: ADAPTER, adapterVersion: '0.103.0',
};
beforeEach(() => {
  ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'learn-backend-'));
  roots.push(ROOT);
  USERDATA = path.join(ROOT, 'userData');
  fs.mkdirSync(USERDATA);
});
afterEach(() => {
  vi.useRealTimers();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});
afterAll(() => fs.rmSync(adapterRoot, { recursive: true, force: true }));

type Handler = (params: unknown, child: FakeChild) => unknown;
type Script = Record<string, Handler>;
type Conn = { client: AcpClient; info: InitializeInfo; session: AgentSession };

/** An agent process: its stdin and stdout are a second JSON-RPC peer that answers from the script. */
class FakeChild implements ChildPort {
  private static nextPid = 7_000;
  readonly pid = FakeChild.nextPid++;
  readonly agent: JsonRpcPeer;
  readonly saw: Array<{ method: string; params: unknown }> = [];
  private lineFn: ((line: string) => void) | null = null;
  private overflowFn: (() => void) | null = null;
  private readonly exitFns: Array<(e: { code: number | null; signal: NodeJS.Signals | null }) => void> = [];
  private readonly outputEndFns: Array<() => void> = [];
  private ended = false;
  private outputEnded = false;
  constructor(readonly spec: LaunchSpec, script: Script) {
    this.agent = createPeer({ write: (line) => this.lineFn?.(line), onFatal: () => {} });
    this.agent.onRequest(async (method, params) => {
      this.saw.push({ method, params });
      const h = script[method];
      if (!h) throw new RpcError(-32601, 'Method not found');
      return h(params, this);
    });
    this.agent.onNotification((method, params) => this.saw.push({ method, params }));
  }
  get exited(): boolean {
    return this.ended;
  }
  write(line: string): void {
    if (!this.ended) this.agent.receive(line);
  }
  endInput(): void {}
  onLine(fn: (line: string) => void, onOverflow: () => void): void {
    this.lineFn = fn;
    this.overflowFn = onOverflow;
  }
  onExit(fn: (e: { code: number | null; signal: NodeJS.Signals | null }) => void): void {
    this.exitFns.push(fn);
  }
  onOutputEnd(fn: () => void): void {
    if (this.outputEnded) queueMicrotask(fn);
    else this.outputEndFns.push(fn);
  }
  signalGroup(): void {}
  groupAlive(): boolean {
    return !this.ended;
  }
  /** A raw line on its stdout. */
  emit(line: string): void {
    this.lineFn?.(line);
  }
  /** Its stdout passed the line limit. */
  overflow(): void {
    this.overflowFn?.();
  }
  /** With { outputOpen: true } its stdout has not ended yet: a line written after the exit can still arrive. */
  exit(o: { outputOpen?: boolean } = {}): void {
    this.ended = true;
    for (const fn of this.exitFns) fn({ code: 0, signal: null });
    if (!o.outputOpen) this.endOutput();
  }
  endOutput(): void {
    this.outputEnded = true;
    for (const fn of this.outputEndFns.splice(0)) fn();
  }
}

const sameKey = (a: SessionKey, b: SessionKey) => a.itemId === b.itemId && a.conversationId === b.conversationId;

/** Hands out one live process per key and agent, as the real supervisor does, and records what it is asked. */
function fakeSupervisor(spawn: (spec: LaunchSpec) => FakeChild) {
  let live: LiveAgent<Conn> | null = null;
  let starting: { key: SessionKey; agent: AgentId; p: Promise<LiveAgent<Conn>> } | null = null;
  const log = {
    acquire: [] as Array<{ key: SessionKey; agent: AgentId; streaming: boolean }>,
    specs: [] as LaunchSpec[],
    killNow: 0,
    close: 0,
    interrupt: [] as Array<{ kill: 'always' | 'if-not-ended'; ended(): boolean }>,
    probes: [] as FakeChild[],
  };
  const sup = {
    async acquire(key: SessionKey, agent: AgentId, spec: () => LaunchSpec | Promise<LaunchSpec>, start: (c: ChildPort) => Promise<Conn>, opts: { streaming?: boolean } = {}) {
      log.acquire.push({ key: { ...key }, agent, streaming: opts.streaming === true });
      if (live && !live.child.exited && sameKey(live.key, key) && live.agent === agent) return live;
      // One start in flight per key and agent, shared by its callers.
      if (starting && sameKey(starting.key, key) && starting.agent === agent) return starting.p;
      const p = (async () => {
        const launch = await spec();
        log.specs.push(launch);
        const child = spawn(launch);
        const conn = await start(child);
        live = { key: { ...key }, agent, child, conn, streaming: false };
        return live;
      })().finally(() => {
        starting = null;
      });
      starting = { key: { ...key }, agent, p };
      return p;
    },
    current: () => (live && !live.child.exited ? live : null),
    rekey(from: SessionKey, to: SessionKey) {
      if (live && sameKey(live.key, from)) live = { ...live, key: { ...to } };
    },
    async close() {
      log.close += 1;
      live = null;
    },
    killNow() {
      log.killNow += 1;
    },
    async interrupt(cancel: () => void, o: { kill: 'always' | 'if-not-ended'; ended(): boolean }) {
      log.interrupt.push(o);
      cancel();
    },
    async probe<T>(spec: LaunchSpec, run: (c: ChildPort) => Promise<T>): Promise<T> {
      log.specs.push(spec);
      const child = spawn(spec);
      log.probes.push(child);
      return run(child);
    },
  };
  return { sup: sup as unknown as Supervisor<Conn>, log, rekey: sup.rekey };
}

const status = (id: AgentId, state: AgentState): AgentStatus =>
  ({ id, name: id, state, cliVersion: null, adapterVersion: null, minimum: null, command: null, note: null });
const report = (claude: AgentState = 'ready', fake: AgentState = 'ready'): AgentsReport => ({ agents: [status('claude', claude)], fake: status('fake', fake) });

function fakeDetector(o: { cached?: AgentsReport | null; report?: () => Promise<AgentsReport> } = {}) {
  return {
    report: vi.fn(o.report ?? (async () => report())),
    cachedReport: vi.fn(() => (o.cached === undefined ? report() : o.cached)),
    detected: vi.fn((): Detected | null => DETECTED),
    markLockedOut: vi.fn(),
    markLogin: vi.fn(),
  } satisfies AgentDetector;
}

function harness(o: { resume?: boolean; load?: boolean; protocolVersion?: number; script?: Script; detector?: ReturnType<typeof fakeDetector>; spawnFails?: boolean } = {}) {
  const children: FakeChild[] = [];
  let n = 0;
  const script: Script = {
    initialize: () => ({
      protocolVersion: o.protocolVersion ?? 1,
      agentCapabilities: { loadSession: o.load ?? true, mcpCapabilities: { http: true }, sessionCapabilities: (o.resume ?? true) ? { resume: {} } : {} },
    }),
    'session/new': () => ({ sessionId: `acp-${++n}` }),
    'session/resume': () => ({}),
    'session/load': () => ({}),
    'session/set_mode': () => ({}),
    'session/prompt': () => ({ stopReason: 'end_turn' }),
    ...o.script,
  };
  const spawn = (spec: LaunchSpec) => {
    if (o.spawnFails) throw new LearnError('AGENT_START_FAILED', 'spawn failed');
    const c = new FakeChild(spec, script);
    children.push(c);
    return c;
  };
  const { sup, log, rekey } = fakeSupervisor(spawn);
  const scopes = createScopeRegistry();
  const detector = o.detector ?? fakeDetector();
  const onLockdown = vi.fn();
  const backend = createAcpBackend({
    supervisor: sup, detector, transport: TRANSPORT, scopes, userData: USERDATA, tutorHome: path.join(USERDATA, 'Tutor'),
    env: { PATH: '/usr/bin', HOME: '/h', ANTHROPIC_API_KEY: 'k' }, home: '/h', execPath: '/learn/electron', fakeEntry: '/learn/fake-agent.js', appVersion: '0.1.0',
    fake: () => ({ script: '/learn/script.json', log: null }), onLockdown,
  });
  const agentSaw = (method: string) => children.flatMap((c) => c.saw.filter((m) => m.method === method).map((m) => ({ params: m.params })));
  return { backend, agentSaw, children, log, scopes, detector, script, rekey, onLockdown };
}

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
const settle = () => new Promise<void>((r) => setImmediate(r));
const mode = (p: string) => fs.statSync(p).mode & 0o777;

describe('the ACP backend', () => {
  it('opens every ACP session with the lockdown _meta and the instructions, then switches the mode to default', async () => {
    const { backend, agentSaw } = harness({ resume: false, load: false });
    const s = await backend.start({ key: KEY, agent: 'claude', conversation: CONV });
    const n = agentSaw('session/new')[0]!.params as { cwd: string; mcpServers: unknown[]; systemPrompt: unknown; _meta: unknown };
    expect(n.cwd).toBe(path.join(USERDATA, 'Tutor', 'work', CONV.id));
    expect(n.mcpServers).toEqual([await TRANSPORT.serverEntry(s.scope!)]);
    expect(n._meta).toEqual(sessionMeta('claude'));
    expect(n.systemPrompt).toEqual(systemPromptParam(INSTRUCTIONS(s.scope!.nonce)));
    expect(agentSaw('session/set_mode')).toEqual([{ params: { sessionId: s.sessionId, modeId: 'default' } }]);
    expect(s.firstPrompt).toBe(true);
  });

  it('a session/new: its work folder is private, its scope is new and bound to the MCP session, the session is the conversation\'s', async () => {
    const { backend, scopes } = harness({ resume: false, load: false });
    const s = await backend.start({ key: KEY, agent: 'claude', conversation: CONV });
    expect(mode(path.join(USERDATA, 'Tutor', 'work', CONV.id))).toBe(0o700);
    expect(s).toMatchObject({ key: KEY, agent: 'claude', sessionId: 'acp-1', resumedBy: 'new', firstPrompt: true });
    expect(scopes.find(s.scope!.token)).toBe(s.scope);
    expect(s.scope).toMatchObject({ ...SCOPE_INIT, bindMcpSession: AGENT_CATALOG[0]!.mcpSessionBinding, activeTurn: null });
  });

  it('warming a new empty session stops after initialize; the process runs in the empty idle folder and Claude gets a private temp folder (R4)', async () => {
    const { backend, agentSaw, log, children, rekey } = harness();
    const s = await backend.start({ key: { itemId: ITEM, conversationId: null }, agent: 'claude', conversation: null });
    expect(agentSaw('initialize')).toHaveLength(1);
    expect(agentSaw('session/new')).toEqual([]);
    expect(s).toMatchObject({ sessionId: null, scope: null, resumedBy: null });
    const idle = path.join(USERDATA, 'Tutor', 'idle');
    const tmp = path.join(USERDATA, 'Tutor', 'tmp');
    expect(log.specs[0]).toMatchObject({ command: '/learn/electron', args: [fs.realpathSync(ADAPTER)], cwd: idle });
    expect(fs.readdirSync(idle)).toEqual([]);
    expect(mode(tmp)).toBe(0o700);
    expect(log.specs[0]!.env).toMatchObject({ CLAUDE_CODE_TMPDIR: tmp, CLAUDE_CONFIG_DIR: path.join(USERDATA, 'Tutor', 'agents', 'claude'), PATH: DETECTED.path });
    expect(log.specs[0]!.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(log.acquire).toEqual([{ key: { itemId: ITEM, conversationId: null }, agent: 'claude', streaming: false }]);

    // The first question made the conversation: the same process opens its session.
    rekey({ itemId: ITEM, conversationId: null }, KEY);
    const asked = await backend.start({ key: KEY, agent: 'claude', conversation: CONV, streaming: true });
    expect(asked).toBe(s);
    expect(asked.key).toEqual(KEY);
    expect(children).toHaveLength(1);
    expect(agentSaw('session/new')).toHaveLength(1);
    expect(log.acquire[1]).toEqual({ key: KEY, agent: 'claude', streaming: true });
  });

  it('a warm and a question started together open one ACP session', async () => {
    const { backend, agentSaw } = harness({ resume: false, load: false });
    const [a, b] = await Promise.all([
      backend.start({ key: KEY, agent: 'claude', conversation: CONV }),
      backend.start({ key: KEY, agent: 'claude', conversation: CONV, streaming: true }),
    ]);
    expect(a).toBe(b);
    expect(agentSaw('session/new')).toHaveLength(1);
    expect(agentSaw('session/set_mode')).toHaveLength(1);
  });

  describe('resuming the conversation\'s stored session (J23)', () => {
    const resumedWith = (params: unknown) => {
      const p = params as Record<string, unknown>;
      expect(p.sessionId).toBe('stored-1');
      expect(p._meta).toEqual(sessionMeta('claude'));
      expect(p.systemPrompt).toBeDefined();
      expect(p.cwd).toBe(path.join(USERDATA, 'Tutor', 'work', CONV_ID));
      expect(p.mcpServers).toHaveLength(1);
    };

    it('session/resume when the agent announced it', async () => {
      const { backend, agentSaw } = harness({ resume: true, load: true });
      const s = await backend.start({ key: KEY, agent: 'claude', conversation: STORED() });
      expect(agentSaw('session/resume')).toHaveLength(1);
      resumedWith(agentSaw('session/resume')[0]!.params);
      expect((agentSaw('session/resume')[0]!.params as { systemPrompt: unknown }).systemPrompt).toEqual(systemPromptParam(INSTRUCTIONS(s.scope!.nonce)));
      expect([agentSaw('session/load'), agentSaw('session/new')]).toEqual([[], []]);
      expect(agentSaw('session/set_mode')).toEqual([{ params: { sessionId: 'stored-1', modeId: 'default' } }]);
      expect(s).toMatchObject({ sessionId: 'stored-1', resumedBy: 'resume', firstPrompt: true });
    });

    it('session/load when only loadSession was announced', async () => {
      const { backend, agentSaw } = harness({ resume: false, load: true });
      const s = await backend.start({ key: KEY, agent: 'claude', conversation: STORED() });
      expect(agentSaw('session/load')).toHaveLength(1);
      resumedWith(agentSaw('session/load')[0]!.params);
      expect([agentSaw('session/resume'), agentSaw('session/new')]).toEqual([[], []]);
      expect(agentSaw('session/set_mode')).toEqual([{ params: { sessionId: 'stored-1', modeId: 'default' } }]);
      expect(s).toMatchObject({ sessionId: 'stored-1', resumedBy: 'load', firstPrompt: true });
    });

    it('session/new when neither was announced, or the resume failed, or another agent opened the stored session', async () => {
      for (const [h, conversation] of [
        [harness({ resume: false, load: false }), STORED()],
        [harness({ resume: true, script: { 'session/resume': () => { throw new RpcError(-32002, 'Resource not found'); } } }), STORED()],
        [harness({ resume: true, load: true }), STORED('fake')],
      ] as const) {
        const s = await h.backend.start({ key: KEY, agent: 'claude', conversation });
        const n = h.agentSaw('session/new');
        expect(n).toHaveLength(1);
        expect((n[0]!.params as { _meta: unknown })._meta).toEqual(sessionMeta('claude'));
        expect((n[0]!.params as { systemPrompt: unknown }).systemPrompt).toEqual(systemPromptParam(INSTRUCTIONS(s.scope!.nonce)));
        expect(h.agentSaw('session/set_mode')).toEqual([{ params: { sessionId: 'acp-1', modeId: 'default' } }]);
        expect(s).toMatchObject({ sessionId: 'acp-1', resumedBy: 'new', firstPrompt: true });
      }
    });

    it('a resumed session on a new process is a new ACP session: its first prompt again, a new scope and nonce, the old scope closed', async () => {
      const { backend, children, scopes } = harness({ resume: true });
      const first = await backend.start({ key: KEY, agent: 'claude', conversation: CONV });
      first.firstPrompt = false;
      const old = first.scope!;
      children[0]!.exit();
      await settle();
      const again = await backend.start({ key: KEY, agent: 'claude', conversation: { ...CONV, agentSessionId: first.sessionId } });
      expect(children).toHaveLength(2);
      expect(again).not.toBe(first);
      expect(again).toMatchObject({ sessionId: first.sessionId, resumedBy: 'resume', firstPrompt: true });
      expect(again.scope!.nonce).not.toBe(old.nonce);
      expect(again.scope!.token).not.toBe(old.token);
      expect(scopes.find(old.token)).toBeNull();
      expect(scopes.find(again.scope!.token)).toBe(again.scope);
    });
  });

  it('the same key with another agent asks the supervisor for that agent, which starts it anew (C1)', async () => {
    const { backend, log } = harness({ resume: false, load: false });
    const a = await backend.start({ key: KEY, agent: 'claude', conversation: CONV });
    const b = await backend.start({ key: KEY, agent: 'fake', conversation: CONV });
    expect(log.acquire.map((x) => x.agent)).toEqual(['claude', 'fake']);
    expect(b).not.toBe(a);
    expect(b.agent).toBe('fake');
    expect(log.specs[1]).toMatchObject({ command: '/learn/electron', args: ['/learn/fake-agent.js'] });
    expect(log.specs[1]!.env).toMatchObject({ LEARN_FAKE_AGENT_SCRIPT: '/learn/script.json' });
  });

  describe('readiness before a start', () => {
    it('refuses an agent that is not ready, AGENT_LOGIN when it needs its login — nothing is started', async () => {
      for (const [state, code] of [['adapter', 'AGENT_NOT_READY'], ['old', 'AGENT_NOT_READY'], ['login', 'AGENT_LOGIN']] as const) {
        const h = harness({ detector: fakeDetector({ cached: report(state) }) });
        await expect(h.backend.start({ key: KEY, agent: 'claude', conversation: CONV })).rejects.toMatchObject({ code });
        expect(h.children).toEqual([]);
      }
      const nofake = harness({ detector: fakeDetector({ cached: { agents: [status('claude', 'ready')], fake: null } }) });
      await expect(nofake.backend.start({ key: KEY, agent: 'fake', conversation: CONV })).rejects.toMatchObject({ code: 'AGENT_NOT_READY' });
    });

    it('with no report yet, waits for the detection the start shares (I5)', async () => {
      const detection = gate<AgentsReport>();
      const detector = fakeDetector({ cached: null, report: () => detection.p });
      const h = harness({ detector });
      const started = h.backend.start({ key: KEY, agent: 'claude', conversation: CONV, streaming: true });
      expect(h.log.acquire).toHaveLength(1);
      await settle();
      expect(detector.report).toHaveBeenCalledWith('cached');
      expect(h.children).toEqual([]);
      detection.resolve(report('login'));
      await expect(started).rejects.toMatchObject({ code: 'AGENT_LOGIN' });
    });

    it('a start that cannot open its session fails AGENT_START_FAILED and closes the scope it made', async () => {
      const h = harness({ resume: false, load: false, script: { 'session/new': () => { throw new RpcError(-32603, 'Internal error'); } } });
      await expect(h.backend.start({ key: KEY, agent: 'claude', conversation: CONV })).rejects.toMatchObject({ code: 'AGENT_START_FAILED' });
      expect(h.scopes.size()).toBe(0);
    });
  });

  describe('a prompt, an interrupt and a close', () => {
    it('prompts the session; an interrupt cancels it through the supervisor once per kind, and knows when the prompt has ended', async () => {
      const answer = gate<unknown>();
      const h = harness({ resume: false, load: false, script: { 'session/prompt': () => answer.p } });
      const s = await h.backend.start({ key: KEY, agent: 'claude', conversation: CONV });
      const prompted = h.backend.prompt(s, ASK, () => {});
      await settle();
      expect(h.agentSaw('session/prompt')).toEqual([{ params: { sessionId: 'acp-1', prompt: ASK } }]);
      h.backend.interrupt(s, 'if-not-ended');
      h.backend.interrupt(s, 'if-not-ended');
      await settle();
      expect(h.log.interrupt.map((i) => i.kill)).toEqual(['if-not-ended']);
      expect(h.agentSaw('session/cancel')).toEqual([{ params: { sessionId: 'acp-1' } }]);
      expect(h.log.interrupt[0]!.ended()).toBe(false);
      h.backend.interrupt(s, 'always');
      h.backend.interrupt(s, 'if-not-ended');
      expect(h.log.interrupt.map((i) => i.kill)).toEqual(['if-not-ended', 'always']);
      answer.resolve({ stopReason: 'cancelled' });
      await expect(prompted).resolves.toMatchObject({ stopReason: 'cancelled' });
      expect(h.log.interrupt[0]!.ended()).toBe(true);
    });

    it('an interrupt never throws, even with no process left', async () => {
      const h = harness({ resume: false, load: false });
      const s = await h.backend.start({ key: KEY, agent: 'claude', conversation: CONV });
      h.children[0]!.exit();
      await settle();
      expect(() => h.backend.interrupt(s, 'always')).not.toThrow();
      expect(h.log.interrupt).toEqual([]);
    });

    it('a close ends the scope and the process', async () => {
      const h = harness({ resume: false, load: false });
      const s = await h.backend.start({ key: KEY, agent: 'claude', conversation: CONV });
      const token = s.scope!.token;
      await h.backend.close(s);
      expect(h.scopes.find(token)).toBeNull();
      expect(h.log.close).toBe(1);
    });
  });

  describe('a broken agent', () => {
    it('a line that is not JSON, or one over the limit, kills the agent once and fails the prompt AGENT_PROTOCOL (C2)', async () => {
      for (const breakIt of [(c: FakeChild) => c.emit('not json'), (c: FakeChild) => c.overflow()]) {
        const h = harness({ resume: false, load: false, script: { 'session/prompt': () => new Promise(() => {}) } });
        const s = await h.backend.start({ key: KEY, agent: 'claude', conversation: CONV });
        const prompted = h.backend.prompt(s, ASK, () => {});
        await settle();
        expect(h.log.killNow).toBe(0);
        breakIt(h.children[0]!);
        await expect(prompted).rejects.toMatchObject({ code: 'AGENT_PROTOCOL' });
        expect(h.log.killNow).toBe(1);
      }
    });

    it('a reply the agent wrote as it exited still arrives: the connection closes when stdout ends, or 250 ms after the exit', async () => {
      vi.useFakeTimers();
      const h = harness({ resume: false, load: false, script: {
        'session/prompt': (_p, c) => {
          c.exit({ outputOpen: true });
          return { stopReason: 'end_turn' };
        },
      } });
      const s = await h.backend.start({ key: KEY, agent: 'claude', conversation: CONV });
      const token = s.scope!.token;
      await expect(h.backend.prompt(s, ASK, () => {})).resolves.toMatchObject({ stopReason: 'end_turn' });
      await vi.advanceTimersByTimeAsync(249);
      expect(h.scopes.find(token)).toBe(s.scope);
      const late = expect(h.backend.prompt(s, ASK, () => {})).rejects.toMatchObject({ code: 'AGENT_EXITED' });
      await vi.advanceTimersByTimeAsync(1);
      await late;
      expect(h.scopes.find(token)).toBeNull();

      const ended = harness({ resume: false, load: false });
      const t = await ended.backend.start({ key: KEY, agent: 'claude', conversation: CONV });
      ended.children[0]!.exit({ outputOpen: true });
      await vi.advanceTimersByTimeAsync(10);
      expect(ended.scopes.find(t.scope!.token)).toBe(t.scope);
      ended.children[0]!.endOutput();
      await vi.advanceTimersByTimeAsync(0);
      expect(ended.scopes.find(t.scope!.token)).toBeNull();
    });

    it('when the agent exits, its scope closes and its prompt fails AGENT_EXITED (5.4)', async () => {
      const h = harness({ resume: false, load: false, script: { 'session/prompt': () => new Promise(() => {}) } });
      const s = await h.backend.start({ key: KEY, agent: 'claude', conversation: CONV });
      const token = s.scope!.token;
      expect(h.scopes.find(token)).toBe(s.scope);
      const prompted = h.backend.prompt(s, ASK, () => {});
      await settle();
      h.children[0]!.exit();
      await expect(prompted).rejects.toMatchObject({ code: 'AGENT_EXITED' });
      expect(h.scopes.find(token)).toBeNull();
    });
  });

  describe('the login check (P-37, M13)', () => {
    const noticeAtInit = (kind: string): Handler => (_p, c) => {
      c.agent.notify('_auth/status_update', { authStatus: { kind, label: 'x@y (Max)' } });
      return { protocolVersion: 1, agentCapabilities: {} };
    };

    it('kind none: login, and nothing is sent after it', async () => {
      const h = harness({ script: { initialize: noticeAtInit('none') } });
      await expect(h.backend.probe('claude')).resolves.toBe('login');
      expect(h.agentSaw('session/new')).toEqual([]);
      expect(h.agentSaw('session/prompt')).toEqual([]);
      expect(h.log.specs[0]!.cwd).toBe(path.join(USERDATA, 'Tutor', 'probe'));
      expect(fs.statSync(path.join(USERDATA, 'Tutor', 'probe')).isDirectory()).toBe(true);
    });

    it('kind account: a session/new with the lockdown _meta in the probe folder and the default mode, then ok — no prompt', async () => {
      const h = harness({ script: { initialize: noticeAtInit('account') } });
      await expect(h.backend.probe('claude')).resolves.toBe('ok');
      expect(h.agentSaw('session/new')).toEqual([{ params: { cwd: path.join(USERDATA, 'Tutor', 'probe'), mcpServers: [], _meta: sessionMeta('claude') } }]);
      expect(h.agentSaw('session/set_mode')).toEqual([{ params: { sessionId: 'acp-1', modeId: 'default' } }]);
      expect(h.agentSaw('session/prompt')).toEqual([]);
    });

    it('no notice in three seconds counts as logged in', async () => {
      vi.useFakeTimers();
      const h = harness();
      let result: string | undefined;
      void h.backend.probe('claude').then((r) => (result = r));
      await vi.advanceTimersByTimeAsync(2_999);
      expect(result).toBeUndefined();
      expect(h.agentSaw('session/new')).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(result).toBe('ok'));
      expect(h.agentSaw('session/new')).toHaveLength(1);
      expect(h.agentSaw('session/prompt')).toEqual([]);
    });

    it('the notice\'s label (an email and a plan) reaches no log line', async () => {
      const lines = [vi.spyOn(console, 'info'), vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')].map((spy) => spy.mockImplementation(() => {}));
      vi.mocked(tutorLog).mockClear();
      for (const kind of ['none', 'account']) {
        const h = harness({ script: { initialize: noticeAtInit(kind) } });
        await h.backend.probe('claude');
      }
      const broken = harness({ script: { initialize: (p, c) => {
        c.agent.notify('_auth/status_update', { authStatus: { kind: 'account', label: 'x@y (Max)' } });
        throw new RpcError(-32603, 'Internal error x@y (Max)');
      } } });
      await expect(broken.backend.probe('claude')).resolves.toBe('failed');
      expect(vi.mocked(tutorLog)).toHaveBeenCalled();
      const said = JSON.stringify([vi.mocked(tutorLog).mock.calls, ...lines.map((l) => l.mock.calls)]);
      expect(said).not.toContain('x@y');
      expect(said).not.toContain('Max');
      for (const l of lines) l.mockRestore();
    });

    it('another ACP version is old; an agent that cannot be started, or fails, is failed', async () => {
      const old = harness({ protocolVersion: 2 });
      await expect(old.backend.probe('claude')).resolves.toBe('old');
      const unstarted = harness({ spawnFails: true });
      await expect(unstarted.backend.probe('claude')).resolves.toBe('failed');
      const broken = harness({ script: { initialize: () => { throw new RpcError(-32603, 'Internal error'); } } });
      await expect(broken.backend.probe('claude')).resolves.toBe('failed');
      for (const h of [old, broken]) expect(h.agentSaw('session/prompt')).toEqual([]);
    });
  });
});
