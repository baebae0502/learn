import { LearnError, TUTOR_TIMEOUTS, type StopReason } from '@learn/domain';
import type { z } from 'zod';
import { tutorLog } from '../log';
import type { AcpMcpServer } from '../mcp/http';
import { RpcError, type JsonRpcPeer } from './jsonrpc';
import { ACP_STOP_REASONS, acpIn, acpOut, resumeCapable, type AcpStopReason } from './schema';

export interface InitializeInfo { protocolVersion: 1; loadSession: boolean; resume: boolean; http: boolean; image: boolean }
/** _auth/status_update's authStatus.kind; its label (an email and a plan) is never read. */
export type AuthStatus = 'none' | 'account';
/** toolName: _meta.claudeCode.toolName, one of the two _meta paths Learn reads. */
export interface ToolCallInfo { toolCallId: string; title: string | null; kind: string | null; toolName: string | null; rawInput: unknown }
/** activity: any other session/update (usage_update, session_info_update, …) — it restarts the update timers and is dropped. */
export type SessionUpdate = { kind: 'text'; text: string } | { kind: 'tool'; call: ToolCallInfo; learn: boolean } | { kind: 'activity' };
/** model: the _meta.quota.model_usage entry with the largest token_count.totalTokens; tokens: the result's top-level usage. */
export interface PromptOutcome { stopReason: StopReason | null; lockdown: boolean; model: string | null; inputTokens: number | null; outputTokens: number | null }
export interface AcpSessionParams { cwd: string; mcpServers: AcpMcpServer[]; meta?: Record<string, unknown>; systemPrompt?: { mode: 'append'; content: Array<{ type: 'text'; text: string }> } }
export interface AcpClient {
  initialize(): Promise<InitializeInfo>;
  /** The _auth/status_update kind if it came within `ms` of the initialize answer, else null. */
  authStatus(ms: number): Promise<AuthStatus | null>;
  newSession(p: AcpSessionParams): Promise<{ sessionId: string }>;
  resumeSession(how: 'resume' | 'load', p: AcpSessionParams & { sessionId: string }): Promise<void>;
  setMode(sessionId: string, modeId: 'default'): Promise<void>;
  prompt(sessionId: string, blocks: Array<{ type: 'text'; text: string }>, onUpdate: (u: SessionUpdate) => void): Promise<PromptOutcome>;
  cancel(sessionId: string): void;
  readonly lockedDown: boolean;
}

type PermissionResult = z.output<typeof acpOut.permissionResult>;
/** The longest model name the messages table holds; a longer one is dropped, not fatal — it is only kept, never used. */
const MODEL_MAX = 128;

/** ACP v1's refusal: the reject_once option, else reject_always, else cancelled. An allow option is never chosen. */
export function permissionAnswer(options: ReadonlyArray<{ optionId: string; kind: string }>):
  { outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' } } {
  const pick = options.find((o) => o.kind === 'reject_once') ?? options.find((o) => o.kind === 'reject_always');
  return pick ? { outcome: { outcome: 'selected', optionId: pick.optionId } } : { outcome: { outcome: 'cancelled' } };
}

/** What the agent sent, read with `schema`; a field Learn reads with the wrong type is AGENT_PROTOCOL. */
function read<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) throw new LearnError('AGENT_PROTOCOL', 'The agent sent a message Learn cannot read.');
  return r.data;
}

/** Every permission answer, refused or cancelled, is built new and checked by the strict schema before it is sent. */
const refusal = (options: ReadonlyArray<{ optionId: string; kind: string }>): PermissionResult => acpOut.permissionResult.parse(permissionAnswer(options));
const cancelledAnswer = (): PermissionResult => refusal([]);

const isAcpStop = (s: string): s is AcpStopReason => (ACP_STOP_REASONS as readonly string[]).includes(s);

function sessionSetup(p: AcpSessionParams) {
  return {
    cwd: p.cwd,
    mcpServers: p.mcpServers,
    ...(p.systemPrompt !== undefined && { systemPrompt: p.systemPrompt }),
    ...(p.meta !== undefined && { _meta: p.meta }),
  };
}

export function createAcpClient(peer: JsonRpcPeer, o: {
  clientVersion: string;
  isLearnTool(call: ToolCallInfo): boolean;
  onLockdown(): void;
}): AcpClient {
  let lockedDown = false;
  /** The turn whose updates go to onUpdate; one at a time, as there is one session per agent process. */
  let turn: { sessionId: string; onUpdate: (u: SessionUpdate) => void } | null = null;
  /** Sessions whose session/load is replaying history Learn already holds (a session/resume replays nothing). */
  const replaying = new Set<string>();
  /** Every tool call seen, by session and id, with whether it was Learn's: an update of a seen call is not judged again. */
  const judged = new Map<string, boolean>();
  const callKey = (sessionId: string, toolCallId: string) => `${sessionId}\u0000${toolCallId}`;
  /** Sessions cancelled since their last prompt: a permission request in them is answered cancelled. */
  const cancelled = new Set<string>();
  const unanswered = new Set<{ sessionId: string; answer: (r: PermissionResult) => void }>();

  let auth: AuthStatus | null = null;
  const authWaiters = new Set<(a: AuthStatus) => void>();
  let initAnsweredAt: number | null = null;
  const initAnswerWaiters = new Set<() => void>();

  const lockdown = (sessionId: string) => {
    if (lockedDown) return;
    lockedDown = true;
    // The agent is killed from onLockdown, so a cancel that cannot be written must not keep it from being called.
    try {
      client.cancel(sessionId);
    } finally {
      o.onLockdown();
    }
  };

  const isLearn = (call: ToolCallInfo) => {
    try {
      return o.isLearnTool(call);
    } catch {
      return false;
    }
  };

  /** The lockdown watch: any tool call that is not Learn's, whatever its kind, stops the turn at once. */
  const watch = (sessionId: string, u: z.output<typeof acpIn.toolCall>): SessionUpdate => {
    const call: ToolCallInfo = {
      toolCallId: u.toolCallId, title: u.title ?? null, kind: u.kind ?? null, toolName: u._meta?.claudeCode?.toolName ?? null, rawInput: u.rawInput ?? null,
    };
    const key = callKey(sessionId, call.toolCallId);
    const seen = judged.get(key);
    if (u.sessionUpdate === 'tool_call_update' && seen !== undefined) return { kind: 'tool', call, learn: seen };
    // An update of a call never announced carries no title Learn can trust: its tool name alone decides.
    const learn = u.sessionUpdate === 'tool_call'
      ? isLearn(call)
      : call.toolName !== null && isLearn({ toolCallId: call.toolCallId, title: null, kind: null, toolName: call.toolName, rawInput: null });
    judged.set(key, learn);
    if (!learn) lockdown(sessionId);
    return { kind: 'tool', call, learn };
  };

  const onSessionUpdate = (params: unknown) => {
    const { sessionId, update } = read(acpIn.sessionUpdate, params);
    // The history session/load replays is Learn's own record already, and none of it is a new tool call.
    if (replaying.has(sessionId)) return;
    let u: SessionUpdate;
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') u = watch(sessionId, read(acpIn.toolCall, update));
    else if (update.sessionUpdate === 'agent_message_chunk') {
      const { content } = read(acpIn.messageChunk, update);
      u = content.type === 'text' && content.text !== undefined ? { kind: 'text', text: content.text } : { kind: 'activity' };
    } else u = { kind: 'activity' };
    if (turn?.sessionId === sessionId) turn.onUpdate(u);
  };

  const onAuthStatus = (params: unknown) => {
    const { kind } = read(acpIn.authStatus, params).authStatus;
    // Another kind tells Learn nothing it can act on; the first prompt's error still tells a missing login.
    if (kind !== 'none' && kind !== 'account') return;
    auth = kind;
    for (const w of [...authWaiters]) w(kind);
  };

  const onPermission = (params: unknown): Promise<PermissionResult> => {
    const req = read(acpIn.permissionRequest, params);
    tutorLog('permission-refused');
    if (cancelled.has(req.sessionId)) return Promise.resolve(cancelledAnswer());
    // Decided when answered, not when received, so a cancel that comes first turns it into cancelled.
    return new Promise((resolve) => {
      const entry = { sessionId: req.sessionId, answer: resolve };
      unanswered.add(entry);
      queueMicrotask(() => {
        if (unanswered.delete(entry)) resolve(refusal(req.options));
      });
    });
  };

  peer.onNotification((method, params) => {
    if (method === 'session/update') onSessionUpdate(params);
    else if (method === '_auth/status_update') onAuthStatus(params);
  });
  peer.onRequest(async (method, params) => {
    if (method === 'session/request_permission') return onPermission(params);
    tutorLog('client-call', { code: 'AGENT_CLIENT_CALL' });
    throw new RpcError(-32601, 'Method not found');
  });

  const markInitAnswered = () => {
    if (initAnsweredAt !== null) return;
    initAnsweredAt = Date.now();
    for (const w of [...initAnswerWaiters]) w();
  };

  const client: AcpClient = {
    async initialize() {
      let raw: unknown;
      try {
        const params = acpOut.initializeParams.parse({
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
          clientInfo: { name: 'Learn', version: o.clientVersion },
        });
        raw = await peer.request('initialize', params, { timeoutMs: TUTOR_TIMEOUTS.initializeMs });
      } finally {
        markInitAnswered();
      }
      const r = read(acpIn.initializeResult, raw);
      if (r.protocolVersion !== 1) throw new LearnError('AGENT_NOT_READY', `The agent speaks ACP version ${r.protocolVersion}, not 1.`);
      const caps = r.agentCapabilities;
      return {
        protocolVersion: 1,
        loadSession: caps?.loadSession === true,
        resume: resumeCapable(r),
        http: caps?.mcpCapabilities?.http === true,
        image: caps?.promptCapabilities?.image === true,
      };
    },

    authStatus(ms) {
      if (auth !== null) return Promise.resolve(auth);
      return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout> | null = null;
        const done = (a: AuthStatus | null) => {
          authWaiters.delete(done);
          initAnswerWaiters.delete(startClock);
          if (timer) clearTimeout(timer);
          resolve(a);
        };
        // The time counts from the initialize answer, after which the adapter sends its status.
        const startClock = () => {
          initAnswerWaiters.delete(startClock);
          timer = setTimeout(() => done(null), Math.max(0, initAnsweredAt! + ms - Date.now()));
        };
        authWaiters.add(done);
        if (initAnsweredAt === null) initAnswerWaiters.add(startClock);
        else startClock();
      });
    },

    async newSession(p) {
      const params = acpOut.newSessionParams.parse(sessionSetup(p));
      const r = read(acpIn.newSessionResult, await peer.request('session/new', params, { timeoutMs: TUTOR_TIMEOUTS.sessionMs }));
      return { sessionId: r.sessionId };
    },

    async resumeSession(how, p) {
      const params = acpOut.resumeParams.parse({ sessionId: p.sessionId, ...sessionSetup(p) });
      const load = how === 'load';
      if (load) replaying.add(p.sessionId);
      try {
        await peer.request(load ? 'session/load' : 'session/resume', params, { timeoutMs: TUTOR_TIMEOUTS.sessionMs });
      } finally {
        if (load) replaying.delete(p.sessionId);
      }
    },

    async setMode(sessionId, modeId) {
      await peer.request('session/set_mode', acpOut.setModeParams.parse({ sessionId, modeId }), { timeoutMs: TUTOR_TIMEOUTS.sessionMs });
    },

    async prompt(sessionId, blocks, onUpdate) {
      const params = acpOut.promptParams.parse({ sessionId, prompt: blocks });
      cancelled.delete(sessionId);
      const mine = { sessionId, onUpdate };
      turn = mine;
      let raw: unknown;
      try {
        raw = await peer.request('session/prompt', params);
      } finally {
        if (turn === mine) turn = null;
      }
      const r = read(acpIn.promptResult, raw);
      let top: { model: string; total: number } | null = null;
      for (const u of r._meta?.quota?.model_usage ?? []) if (u && (!top || u.token_count.totalTokens > top.total)) top = { model: u.model, total: u.token_count.totalTokens };
      return {
        stopReason: isAcpStop(r.stopReason) ? r.stopReason : null,
        lockdown: lockedDown,
        model: top && top.model.length >= 1 && top.model.length <= MODEL_MAX ? top.model : null,
        inputTokens: r.usage?.inputTokens ?? null,
        outputTokens: r.usage?.outputTokens ?? null,
      };
    },

    cancel(sessionId) {
      cancelled.add(sessionId);
      peer.notify('session/cancel', acpOut.cancelParams.parse({ sessionId }));
      for (const u of [...unanswered]) {
        if (u.sessionId !== sessionId) continue;
        unanswered.delete(u);
        u.answer(cancelledAnswer());
      }
    },

    get lockedDown() {
      return lockedDown;
    },
  };
  return client;
}
