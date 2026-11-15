import { LearnError, TUTOR_TIMEOUTS, type AgentId, type RealAgentId } from '@learn/domain';
import { createAcpClient, type AcpClient, type InitializeInfo, type PromptOutcome, type SessionUpdate } from './acp/client';
import { createPeer, type JsonRpcPeer } from './acp/jsonrpc';
import { AGENT_CATALOG } from './agents/catalog';
import type { AgentDetector } from './agents/detect';
import {
  agentCwd, agentEnv, agentHome, ceilingDir, idleDir, isLearnToolCall, isLoginRequired, launchSpec, probeDir, sessionMeta, systemPromptParam, tmpDir, workDir, type LaunchSpec,
} from './agents/isolation';
import { OUTPUT_GRACE_MS, type ChildPort } from './agents/spawn';
import { timeLastAsync } from '../perf';
import type { Supervisor } from './agents/supervisor';
import { codeOf, tutorLog } from './log';
import type { McpTransport } from './mcp/http';
import { INSTRUCTIONS } from './prompts';
import type { AcpScope, ScopeRegistry } from './scope';
import { copyKey, type SessionKey } from './session-key';

/** One ACP session: a sessionId on one agent process, with its own scope, nonce and first prompt (spec 4.1). */
export interface AgentSession {
  readonly key: SessionKey; readonly agent: AgentId;
  /** null until session/new (a new empty session warmed to initialize). */
  sessionId: string | null;
  /** One per ACP session. */
  scope: AcpScope | null;
  /** The next prompt is this ACP session's first: the instruction head goes with it. */
  firstPrompt: boolean;
  resumedBy: 'resume' | 'load' | 'new' | null;
}

export interface StartInput {
  key: SessionKey; agent: AgentId;
  /** null: stop after initialize (warming a new empty session). */
  conversation: { id: string; agentSessionId: string | null; agentOfSession: AgentId; scopeInit: Omit<Parameters<ScopeRegistry['open']>[0], 'bindMcpSession'> } | null;
  /** Reserve the key for an answer at the call — ask, resend and reground pass true. */
  streaming?: boolean;
}

export interface TutorBackend {
  start(i: StartInput): Promise<AgentSession>;
  prompt(s: AgentSession, blocks: Array<{ type: 'text'; text: string }>, on: (u: SessionUpdate) => void): Promise<PromptOutcome>;
  /** Never throws, and a second call of the same kind does nothing: the turn calls it from its timers. */
  interrupt(s: AgentSession, kill: 'always' | 'if-not-ended'): void;
  close(s: AgentSession): Promise<void>;
  killNow(): void;
  /** The detector's login check. */
  probe(agent: RealAgentId): Promise<'ok' | 'login' | 'old' | 'failed'>;
}

export type BackendConn = { client: AcpClient; info: InitializeInfo; session: AgentSession };

export interface AcpBackendDeps {
  supervisor: Supervisor<BackendConn>;
  detector: AgentDetector; transport: McpTransport; scopes: ScopeRegistry;
  userData: string; tutorHome: string; env: NodeJS.ProcessEnv; home: string; execPath: string; fakeEntry: string; appVersion: string;
  /** tutorFakeScript, LEARN_FAKE_AGENT_LOG */
  fake: () => { script: string; log: string | null };
  onLockdown(agent: AgentId): void;
}

/** The fake agent has no catalog row: whether it resumes is what its initialize announces. */
const FAKE_RESUME = { resume: true, load: true } as const;

type Session = { -readonly [K in keyof AgentSession]: AgentSession[K] };
interface SessionState {
  readonly client: AcpClient;
  opening: Promise<void> | null;
  /** Counts the prompts, so an interrupt's grace knows its own prompt ended even when another has begun. */
  prompts: number;
  prompting: boolean;
  interrupted: 'always' | 'if-not-ended' | null;
}


/** A start's failure as the turn tells it: the agent's own codes, a missing login, else the start failed. */
function startFailure(e: unknown): LearnError {
  if (e instanceof LearnError && (e.code.startsWith('AGENT_') || e.code === 'CANCELLED')) return e;
  if (isLoginRequired(e)) return new LearnError('AGENT_LOGIN', 'The agent needs its login.', { cause: e });
  return new LearnError('AGENT_START_FAILED', 'The agent could not be started.', { cause: e });
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new LearnError('AGENT_TIMEOUT', 'The login check took too long.')), ms);
    work.then((v) => {
      clearTimeout(timer);
      resolve(v);
    }, (e: unknown) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

export function createAcpBackend(d: AcpBackendDeps): TutorBackend {
  const states = new WeakMap<AgentSession, SessionState>();

  const launchFor = (agent: AgentId, cwd: string): LaunchSpec => {
    const found = agent === 'fake' ? 'fake' : d.detector.detected(agent);
    if (found === null) throw new LearnError('AGENT_NOT_READY', 'The agent was not detected.');
    const env = agentEnv(agent, d.env, {
      path: found === 'fake' ? (d.env.PATH ?? '') : found.path,
      agentHome: agentHome(d.tutorHome, agent),
      tmpDir: tmpDir(d.userData),
      ceiling: ceilingDir(d.userData),
      cliPath: found === 'fake' ? null : found.cliPath,
      ...(agent === 'fake' ? { fake: d.fake() } : {}),
    });
    return launchSpec(found, { execPath: d.execPath, fakeEntry: d.fakeEntry, env, cwd });
  };

  /** Detection runs here, inside the reservation: a send never waits for it before its rows are written. */
  const readySpec = async (agent: AgentId): Promise<LaunchSpec> => {
    const report = d.detector.cachedReport() ?? (await d.detector.report('cached'));
    const status = agent === 'fake' ? report.fake : report.agents.find((a) => a.id === agent);
    if (status?.state === 'login') throw new LearnError('AGENT_LOGIN', 'The agent needs its login.');
    if (status?.state !== 'ready') throw new LearnError('AGENT_NOT_READY', 'The agent is not ready.');
    try {
      // The process's own folder is empty; the conversation's folder goes to the ACP session.
      return launchFor(agent, agentCwd(idleDir(d.userData)));
    } catch (e) {
      throw startFailure(e);
    }
  };

  /**
   * The agent's stdout into a JSON-RPC peer; a protocol fault kills it, its exit closes the peer once its last line is in. A lockdown
   * outside a prompt (`prompting` false) ends the process at once: no turn is there to interrupt it, and it would live on until its
   * idle close.
   */
  const connect = (child: ChildPort, agent: AgentId, onExit: () => void, prompting: () => boolean = () => false): AcpClient => {
    const peer: JsonRpcPeer = createPeer({ write: (line) => child.write(line), onFatal: () => fault() });
    const fault = () => {
      d.supervisor.killNow();
      peer.close('AGENT_PROTOCOL');
    };
    child.onLine((line) => peer.receive(line), fault);
    child.onExit(() => {
      let done = false;
      const gone = () => {
        if (done) return;
        done = true;
        clearTimeout(grace);
        peer.close('AGENT_EXITED');
        onExit();
      };
      const grace = setTimeout(gone, OUTPUT_GRACE_MS);
      child.onOutputEnd(gone);
    });
    const onLockdown = () => {
      d.onLockdown(agent);
      if (!prompting()) d.supervisor.killNow();
    };
    return createAcpClient(peer, { clientVersion: d.appVersion, isLearnTool: (c) => isLearnToolCall(agent, c), onLockdown });
  };

  // A token never outlives its ACP session.
  const closeScope = (s: AgentSession) => {
    if (s.scope) d.scopes.close(s.scope.token);
  };

  const begin = async (child: ChildPort, key: SessionKey, agent: AgentId): Promise<BackendConn> => {
    const session: Session = { key: copyKey(key), agent, sessionId: null, scope: null, firstPrompt: true, resumedBy: null };
    const client = connect(child, agent, () => closeScope(session), () => states.get(session)?.prompting === true);
    states.set(session, { client, opening: null, prompts: 0, prompting: false, interrupted: null });
    // The process was spawned just before this (supervisor): its start to initialize's answer, timed for tutor-perf (spec 15).
    const info = await timeLastAsync('tutorInitialize', () => client.initialize());
    return { client, info, session };
  };

  /** A new ACP session on this process: a resume of the stored one when the agent can, else session/new; then the default mode. */
  const openSession = async (conn: BackendConn, s: Session, conv: NonNullable<StartInput['conversation']>): Promise<void> => {
    const entry = AGENT_CATALOG.find((e) => e.id === s.agent);
    const can = entry?.resume ?? FAKE_RESUME;
    let scope: AcpScope | null = null;
    try {
      const cwd = workDir(d.userData, conv.id);
      scope = d.scopes.open({ ...conv.scopeInit, bindMcpSession: entry?.mcpSessionBinding ?? true });
      // The lock and the instructions go with a resume too: whether they survive one is not known.
      const setup = { cwd, mcpServers: [await d.transport.serverEntry(scope)], meta: sessionMeta(s.agent), systemPrompt: systemPromptParam(INSTRUCTIONS(scope.nonce)) };
      const stored = conv.agentSessionId !== null && conv.agentOfSession === s.agent ? conv.agentSessionId : null;
      const way = stored === null ? null : conn.info.resume && can.resume ? 'resume' : conn.info.loadSession && can.load ? 'load' : null;
      let sessionId: string | null = null;
      let how: 'resume' | 'load' | 'new' = 'new';
      if (stored !== null && way !== null) {
        try {
          await conn.client.resumeSession(way, { ...setup, sessionId: stored });
          sessionId = stored;
          how = way;
        } catch (e) {
          tutorLog('session-resume-failed', { code: codeOf(e) });
        }
      }
      sessionId ??= (await conn.client.newSession(setup)).sessionId;
      // The adapter starts in auto, where an MCP tool outside the allowed list runs unasked.
      await conn.client.setMode(sessionId, 'default');
      s.sessionId = sessionId;
      s.scope = scope;
      s.resumedBy = how;
      s.firstPrompt = true;
    } catch (e) {
      if (scope) d.scopes.close(scope.token);
      throw startFailure(e);
    }
  };

  return {
    async start(i) {
      let conn: BackendConn;
      try {
        // Called before anything is awaited: the key is reserved when start is called.
        const live = await d.supervisor.acquire(i.key, i.agent, () => readySpec(i.agent), (child) => begin(child, i.key, i.agent), { streaming: i.streaming === true });
        conn = live.conn;
      } catch (e) {
        throw startFailure(e);
      }
      const s = conn.session as Session;
      // A new empty session's process now belongs to the conversation its first question made; a warm sharing the
      // same start may finish after it, so the key only ever moves to a conversation.
      if (s.key.conversationId === null && i.key.conversationId !== null) s.key = copyKey(i.key);
      if (i.conversation === null || s.sessionId !== null) return s;
      const st = states.get(s)!;
      // A warm and a question may both reach here: one session/new.
      st.opening ??= openSession(conn, s, i.conversation).finally(() => {
        st.opening = null;
      });
      await st.opening;
      return s;
    },

    async prompt(s, blocks, on) {
      const st = states.get(s);
      if (!st || s.sessionId === null) throw new LearnError('AGENT_EXITED', 'The ACP session is not open.');
      st.prompts += 1;
      st.prompting = true;
      st.interrupted = null;
      try {
        return await st.client.prompt(s.sessionId, blocks, on);
      } finally {
        st.prompting = false;
      }
    },

    interrupt(s, kill) {
      try {
        const st = states.get(s);
        if (!st || st.interrupted === 'always' || st.interrupted === kill) return;
        st.interrupted = kill;
        const sessionId = s.sessionId;
        const cancel = () => {
          if (sessionId !== null) st.client.cancel(sessionId);
        };
        // The supervisor acts on the live process: one that is closing or gone is not this session's to kill.
        if (d.supervisor.current()?.conn.session !== s) {
          cancel();
          return;
        }
        const mine = st.prompts;
        void d.supervisor.interrupt(cancel, { kill, ended: () => st.prompts !== mine || !st.prompting }).catch((e: unknown) => {
          tutorLog('interrupt-failed', { code: codeOf(e) });
        });
      } catch (e) {
        tutorLog('interrupt-failed', { code: codeOf(e) });
      }
    },

    async close(s) {
      closeScope(s);
      if (d.supervisor.current()?.conn.session === s) await d.supervisor.close();
    },

    killNow() {
      d.supervisor.killNow();
    },

    async probe(agent) {
      let spec: LaunchSpec;
      let cwd: string;
      try {
        cwd = agentCwd(probeDir(d.userData));
        spec = launchFor(agent, cwd);
      } catch (e) {
        tutorLog('probe-failed', { code: codeOf(e) });
        return 'failed';
      }
      const check = async (child: ChildPort): Promise<'ok' | 'login'> => {
        const client = connect(child, agent, () => {});
        await client.initialize();
        // The notice's label (an email and a plan) is never read; a missing notice leaves the login to the first prompt.
        if ((await client.authStatus(TUTOR_TIMEOUTS.authStatusMs)) === 'none') return 'login';
        const { sessionId } = await client.newSession({ cwd, mcpServers: [], meta: sessionMeta(agent) });
        await client.setMode(sessionId, 'default');
        return 'ok';
      };
      try {
        return await d.supervisor.probe(spec, (child) => withTimeout(check(child), TUTOR_TIMEOUTS.probeMs));
      } catch (e) {
        if (e instanceof LearnError && e.code === 'AGENT_NOT_READY') return 'old';
        if (isLoginRequired(e)) return 'login';
        tutorLog('probe-failed', { code: codeOf(e) });
        return 'failed';
      }
    },
  };
}
