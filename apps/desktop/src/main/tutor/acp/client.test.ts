import { LearnError } from '@learn/domain';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createAcpClient, permissionAnswer, type SessionUpdate, type ToolCallInfo } from './client';
import { createPeer, RpcError, type JsonRpcPeer } from './jsonrpc';
import { acpOut } from './schema';

const LEARN_TOOLS = new Set(['mcp__learn__get_context', 'mcp__learn__get_outline', 'mcp__learn__read_pdf_pages']);
/** Claude's marker as the agent table will pass it: the title or the tool name. */
const isLearn = (c: ToolCallInfo) => LEARN_TOOLS.has(c.title ?? '') || LEARN_TOOLS.has(c.toolName ?? '');
const READ = 'mcp__learn__read_pdf_pages';
const ASK = [{ type: 'text' as const, text: 'What does page 3 say?' }];
const opt = (optionId: string, kind: string) => ({ optionId, kind });
/** Claude's permission request, as the adapter sends it. */
const permission = (sessionId: string) => ({
  sessionId, toolCall: { toolCallId: 'toolu_9', title: 'Bash', kind: 'execute' },
  options: [{ ...opt('allow-once', 'allow_once'), name: 'Allow' }, { ...opt('allow-with-updates', 'allow_always'), name: 'Always' }, { ...opt('reject', 'reject_once'), name: 'Reject' }],
});
const REFUSED = { outcome: { outcome: 'selected', optionId: 'reject' } };
const CANCELLED = { outcome: { outcome: 'cancelled' } };

type Script = Record<string, (params: unknown) => unknown>;
interface Wire { method?: string; params?: unknown }

/** A fake agent: a second peer, each peer's lines going straight into the other's receive. */
function setup(o: { isLearnTool?: (c: ToolCallInfo) => boolean; failWrite?: (line: string) => boolean } = {}) {
  const lines: string[] = [];
  const atAgent: Array<{ method: string; params: unknown }> = [];
  const fatal: string[] = [];
  const onLockdown = vi.fn();
  let agent!: JsonRpcPeer;
  const learn = createPeer({
    write: (l) => {
      if (o.failWrite?.(l)) throw new Error('write EPIPE');
      lines.push(l);
      agent.receive(l);
    },
    onFatal: (c) => fatal.push(c),
  });
  agent = createPeer({ write: (l) => learn.receive(l), onFatal: (c) => fatal.push(`agent ${c}`) });
  const script: Script = {
    initialize: () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true }, promptCapabilities: { image: true }, sessionCapabilities: { resume: {} } } }),
    'session/new': () => ({ sessionId: 's1' }),
    'session/resume': () => ({}),
    'session/load': () => ({}),
    'session/set_mode': () => ({}),
    'session/prompt': () => ({ stopReason: 'end_turn' }),
  };
  agent.onRequest(async (method, params) => {
    const h = script[method];
    if (!h) throw new RpcError(-32601, 'Method not found');
    return h(params);
  });
  agent.onNotification((method, params) => atAgent.push({ method, params }));
  const client = createAcpClient(learn, { clientVersion: '0.1.0', isLearnTool: o.isLearnTool ?? isLearn, onLockdown });
  const update = (u: Record<string, unknown>, sessionId = 's1') => agent.notify('session/update', { sessionId, update: u });
  const sent = (method: string) => lines.map((l) => JSON.parse(l) as Wire).filter((m) => m.method === method).map((m) => m.params);
  const updates: SessionUpdate[] = [];
  const ask = (sessionId = 's1') => client.prompt(sessionId, ASK, (u) => updates.push(u));
  return { client, agent, script, lines, atAgent, fatal, onLockdown, update, sent, updates, ask };
}

const chunk = (text: string) => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
const claudeLearnCall = (id: string) => ({ sessionUpdate: 'tool_call', toolCallId: id, title: READ, kind: 'other', status: 'pending', rawInput: {}, _meta: { claudeCode: { toolName: READ } } });

let info: MockInstance<typeof console.info>;
beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const logged = (line: string) => info.mock.calls.filter((c) => c[0] === line).length;

describe('permissionAnswer', () => {
  it('refuses every permission request: reject_once, then reject_always, else cancelled — never an allow', () => {
    expect(permissionAnswer([opt('a', 'allow_once'), opt('r1', 'reject_once'), opt('r2', 'reject_always')])).toEqual({ outcome: { outcome: 'selected', optionId: 'r1' } });
    expect(permissionAnswer([opt('a', 'allow_always'), opt('r2', 'reject_always')])).toEqual({ outcome: { outcome: 'selected', optionId: 'r2' } });
    expect(permissionAnswer([opt('a', 'allow_once'), opt('b', 'allow_always')])).toEqual({ outcome: { outcome: 'cancelled' } });
    expect(permissionAnswer([])).toEqual({ outcome: { outcome: 'cancelled' } });
  });

  it('hands out a new answer each time, so changing one never changes the next', () => {
    const first = permissionAnswer([]);
    (first.outcome as { outcome: string }).outcome = 'selected';
    expect(permissionAnswer([])).toEqual({ outcome: { outcome: 'cancelled' } });
  });
});

describe('createAcpClient', () => {
  it('initialize sends exactly the spec\'s object, every capability false, and reads what the agent offers', async () => {
    const h = setup();
    await expect(h.client.initialize()).resolves.toEqual({ protocolVersion: 1, loadSession: true, resume: true, http: true, image: true });
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).not.toContain('\n');
    expect(JSON.parse(h.lines[0]!)).toEqual({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'Learn', version: '0.1.0' } },
    });
  });

  it('a capability the agent does not announce is false', async () => {
    const h = setup();
    h.script.initialize = () => ({ protocolVersion: 1 });
    await expect(h.client.initialize()).resolves.toEqual({ protocolVersion: 1, loadSession: false, resume: false, http: false, image: false });
  });

  it('protocol version 2 is AGENT_NOT_READY', async () => {
    const h = setup();
    h.script.initialize = () => ({ protocolVersion: 2, agentCapabilities: {} });
    const e: unknown = await h.client.initialize().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(LearnError);
    expect(e).toMatchObject({ code: 'AGENT_NOT_READY' });
  });

  it('an answer with a wrong type is AGENT_PROTOCOL', async () => {
    const h = setup();
    h.script['session/new'] = () => ({ sessionId: 5 });
    await expect(h.client.newSession({ cwd: '/w/c1', mcpServers: [] })).rejects.toMatchObject({ code: 'AGENT_PROTOCOL' });
  });

  it('session/new carries the system prompt and _meta, set_mode sends { sessionId, modeId: default }', async () => {
    const h = setup();
    const systemPrompt = { mode: 'append' as const, content: [{ type: 'text' as const, text: 'You are the study tutor inside Learn.' }] };
    const meta = { claudeCode: { options: { tools: [], settingSources: [], strictMcpConfig: true } } };
    const server = { type: 'http' as const, name: 'learn' as const, url: 'http://127.0.0.1:4000/mcp', headers: [{ name: 'Authorization' as const, value: `Bearer ${'ab'.repeat(32)}` }] };
    await expect(h.client.newSession({ cwd: '/w/c1', mcpServers: [server], meta, systemPrompt })).resolves.toEqual({ sessionId: 's1' });
    await h.client.newSession({ cwd: '/w/c2', mcpServers: [] });
    expect(h.sent('session/new')).toEqual([{ cwd: '/w/c1', mcpServers: [server], systemPrompt, _meta: meta }, { cwd: '/w/c2', mcpServers: [] }]);
    await h.client.setMode('s1', 'default');
    expect(h.sent('session/set_mode')).toEqual([{ sessionId: 's1', modeId: 'default' }]);
    expect(h.lines.some((l) => l.includes('"authenticate"'))).toBe(false);
  });

  it('a resume and a load send { sessionId, cwd, mcpServers } with the system prompt and _meta', async () => {
    const h = setup();
    const systemPrompt = { mode: 'append' as const, content: [{ type: 'text' as const, text: 'x' }] };
    await h.client.resumeSession('resume', { sessionId: 's1', cwd: '/w/c1', mcpServers: [], systemPrompt, meta: { a: 1 } });
    await h.client.resumeSession('load', { sessionId: 's1', cwd: '/w/c1', mcpServers: [] });
    expect(h.sent('session/resume')).toEqual([{ sessionId: 's1', cwd: '/w/c1', mcpServers: [], systemPrompt, _meta: { a: 1 } }]);
    expect(h.sent('session/load')).toEqual([{ sessionId: 's1', cwd: '/w/c1', mcpServers: [] }]);
  });

  it('text chunks come joined in order as text; thoughts and plans come only as activity', async () => {
    const h = setup();
    h.script['session/prompt'] = () => {
      h.update(chunk('Page 3 '));
      h.update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'secret thinking' } });
      h.update({ sessionUpdate: 'plan', entries: [{ content: 'read page 3', priority: 'high', status: 'pending' }] });
      h.update(chunk('says [[p3]].'));
      return { stopReason: 'end_turn' };
    };
    const out = await h.ask();
    expect(h.sent('session/prompt')).toEqual([{ sessionId: 's1', prompt: ASK }]);
    expect(h.updates).toEqual([{ kind: 'text', text: 'Page 3 ' }, { kind: 'activity' }, { kind: 'activity' }, { kind: 'text', text: 'says [[p3]].' }]);
    expect(out).toEqual({ stopReason: 'end_turn', lockdown: false, model: null, inputTokens: null, outputTokens: null });
  });

  it('usage_update, session_info_update, a non-text chunk and an unknown kind are activity, their content dropped', async () => {
    const h = setup();
    h.script['session/prompt'] = () => {
      h.update({ sessionUpdate: 'usage_update', used: 1, size: 2, _meta: { '_claude/rateLimit': { utilization: 0.4 } } });
      h.update({ sessionUpdate: 'session_info_update', title: 'A title' });
      h.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'AA', mimeType: 'image/png' } });
      h.update({ sessionUpdate: 'some_future_kind', text: 'x' });
      return { stopReason: 'end_turn' };
    };
    await h.ask();
    expect(h.updates).toEqual([{ kind: 'activity' }, { kind: 'activity' }, { kind: 'activity' }, { kind: 'activity' }]);
  });

  it('an update for another session, or after the answer, does not reach onUpdate', async () => {
    const h = setup();
    h.script['session/prompt'] = () => {
      h.update(chunk('mine'));
      h.update(chunk('theirs'), 's2');
      return { stopReason: 'end_turn' };
    };
    await h.ask();
    h.update(chunk('late'));
    expect(h.updates).toEqual([{ kind: 'text', text: 'mine' }]);
  });

  it('an unknown stopReason is null; the five ACP ones pass', async () => {
    const h = setup();
    h.script['session/prompt'] = () => ({ stopReason: 'paused' });
    await expect(h.ask()).resolves.toMatchObject({ stopReason: null });
    for (const r of ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled']) {
      h.script['session/prompt'] = () => ({ stopReason: r });
      await expect(h.ask()).resolves.toMatchObject({ stopReason: r });
    }
  });

  it('the model is the model_usage entry with the most tokens; the tokens are the result\'s top-level usage', async () => {
    const h = setup();
    h.script['session/prompt'] = () => ({
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 20, cachedReadTokens: 3, totalTokens: 33 },
      _meta: { quota: { model_usage: [{ model: 'small', token_count: 900 }, { model: 'main', token_count: 5000 }] } },
    });
    await expect(h.ask()).resolves.toEqual({ stopReason: 'end_turn', lockdown: false, model: 'main', inputTokens: 10, outputTokens: 20 });
    h.script['session/prompt'] = () => ({ stopReason: 'end_turn', usage: null, _meta: { quota: { model_usage: [] } } });
    await expect(h.ask()).resolves.toEqual({ stopReason: 'end_turn', lockdown: false, model: null, inputTokens: null, outputTokens: null });
    h.script['session/prompt'] = () => ({ stopReason: 'end_turn', _meta: { quota: { model_usage: [{ model: 'm'.repeat(129), token_count: 1 }] } } });
    await expect(h.ask()).resolves.toMatchObject({ model: null });
  });

  it('an error answer to session/prompt rejects with its RpcError, code and data as they came', async () => {
    const h = setup();
    h.script['session/prompt'] = () => {
      throw new RpcError(-32603, 'Internal error: API Error: Connection refused', { errorKind: 'server_error' });
    };
    const e: unknown = await h.ask().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RpcError);
    expect(e).toMatchObject({ rpcCode: -32603, message: 'Internal error: API Error: Connection refused', data: { errorKind: 'server_error' } });
  });

  it('an update Learn reads with a wrong type is fatal: AGENT_PROTOCOL, and the prompt fails with it', async () => {
    const h = setup();
    h.script['session/prompt'] = () => {
      h.update(chunk('fine'));
      h.update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 3 } });
      return { stopReason: 'end_turn' };
    };
    await expect(h.ask()).rejects.toMatchObject({ code: 'AGENT_PROTOCOL' });
    expect(h.updates).toEqual([{ kind: 'text', text: 'fine' }]);
    expect(h.fatal).toEqual(['AGENT_PROTOCOL']);
  });

  it('every permission request is refused; one still up at cancel, and any after it, is answered cancelled', async () => {
    const h = setup();
    const strict = vi.spyOn(acpOut.permissionResult, 'parse');
    const answers: unknown[] = [];
    h.script['session/prompt'] = async () => {
      answers.push(await h.agent.request('session/request_permission', permission('s1')));
      const up = h.agent.request('session/request_permission', permission('s1'));
      h.client.cancel('s1');
      answers.push(await up);
      answers.push(await h.agent.request('session/request_permission', permission('s1')));
      return { stopReason: 'cancelled' };
    };
    await expect(h.ask()).resolves.toMatchObject({ stopReason: 'cancelled' });
    expect(answers).toEqual([REFUSED, CANCELLED, CANCELLED]);
    expect(h.atAgent).toEqual([{ method: 'session/cancel', params: { sessionId: 's1' } }]);
    expect(logged('[tutor] permission-refused')).toBe(3);
    // The next turn refuses again rather than cancelling.
    h.script['session/prompt'] = async () => {
      answers.push(await h.agent.request('session/request_permission', permission('s1')));
      return { stopReason: 'end_turn' };
    };
    await h.ask();
    expect(answers.at(-1)).toEqual(REFUSED);
    // Each of the four answers, refused or cancelled, was built through the strict schema.
    expect(strict).toHaveBeenCalledTimes(4);
  });

  it('a permission request with a wrong type is fatal and gets no answer', async () => {
    const h = setup();
    let answered = false;
    h.script['session/prompt'] = async () => {
      await h.agent.request('session/request_permission', { sessionId: 's1', options: 'all' }).then(() => (answered = true), () => (answered = true));
      return { stopReason: 'end_turn' };
    };
    await expect(h.ask()).rejects.toMatchObject({ code: 'AGENT_PROTOCOL' });
    expect(h.fatal).toEqual(['AGENT_PROTOCOL']);
    expect(answered).toBe(false);
  });

  it('fs/*, terminal/* and any other request get -32601, logged as AGENT_CLIENT_CALL, and the turn goes on', async () => {
    const h = setup();
    const codes: unknown[] = [];
    h.script['session/prompt'] = async () => {
      for (const m of ['fs/read_text_file', 'terminal/create', 'x/unknown']) {
        await h.agent.request(m, { sessionId: 's1', path: '/etc/hosts' }).then(() => codes.push('answered'), (e: RpcError) => codes.push(e.rpcCode));
      }
      h.update(chunk('still answering'));
      return { stopReason: 'end_turn' };
    };
    await expect(h.ask()).resolves.toMatchObject({ stopReason: 'end_turn' });
    expect(codes).toEqual([-32601, -32601, -32601]);
    expect(h.updates).toEqual([{ kind: 'text', text: 'still answering' }]);
    expect(logged('[tutor] client-call code=AGENT_CLIENT_CALL')).toBe(3);
  });

  it.each(['execute', 'read'])('a tool call without Learn\'s marker (kind %s) cancels the turn and locks down once', async (kind) => {
    const h = setup();
    h.script['session/prompt'] = () => {
      h.update({ sessionUpdate: 'tool_call', toolCallId: 'toolu_1', title: kind === 'read' ? 'Read file' : 'Terminal', kind, status: 'pending', rawInput: {} });
      h.update({ sessionUpdate: 'tool_call', toolCallId: 'toolu_2', title: 'Search', kind: 'search', status: 'pending', rawInput: {} });
      return { stopReason: 'cancelled' };
    };
    const out = await h.ask();
    expect(h.atAgent).toEqual([{ method: 'session/cancel', params: { sessionId: 's1' } }]);
    expect(h.onLockdown).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ stopReason: 'cancelled', lockdown: true });
    expect(h.client.lockedDown).toBe(true);
    expect(h.updates.map((u) => (u.kind === 'tool' ? [u.call.toolCallId, u.learn] : u.kind))).toEqual([['toolu_1', false], ['toolu_2', false]]);
  });

  it('a Learn tool call passes (positive control): no cancel, no lockdown', async () => {
    const h = setup();
    h.script['session/prompt'] = () => {
      h.update(claudeLearnCall('toolu_1'));
      h.update(chunk('Page 3 says [[p3]].'));
      return { stopReason: 'end_turn' };
    };
    const out = await h.ask();
    expect(h.updates[0]).toEqual({
      kind: 'tool', learn: true, call: { toolCallId: 'toolu_1', title: READ, kind: 'other', toolName: READ, rawInput: {} },
    });
    expect(out.lockdown).toBe(false);
    expect(h.atAgent).toEqual([]);
    expect(h.onLockdown).not.toHaveBeenCalled();
  });

  it('a first-seen tool_call_update is judged by its tool name alone; an update of a seen call is not judged again', async () => {
    const h = setup();
    const before: number[] = [];
    h.script['session/prompt'] = () => {
      h.update(claudeLearnCall('toolu_1'));
      // The adapter's real update has no title or kind but keeps the tool name; this one lacks even the tool name, and
      // still passes, because a call already judged is never judged again.
      h.update({ sessionUpdate: 'tool_call_update', toolCallId: 'toolu_1', status: 'in_progress', rawInput: { from: 3 } });
      h.update({ sessionUpdate: 'tool_call_update', toolCallId: 'toolu_2', status: 'in_progress', rawInput: { from: 4 }, _meta: { claudeCode: { toolName: READ } } });
      before.push(h.atAgent.length);
      // A title that looks like Learn's does not pass an update never seen before.
      h.update({ sessionUpdate: 'tool_call_update', toolCallId: 'toolu_3', title: READ, status: 'in_progress', rawInput: {} });
      return { stopReason: 'cancelled' };
    };
    const out = await h.ask();
    expect(before).toEqual([0]);
    expect(h.updates.map((u) => (u.kind === 'tool' ? [u.call.toolCallId, u.learn] : u.kind))).toEqual([['toolu_1', true], ['toolu_1', true], ['toolu_2', true], ['toolu_3', false]]);
    expect(h.atAgent).toEqual([{ method: 'session/cancel', params: { sessionId: 's1' } }]);
    expect(h.onLockdown).toHaveBeenCalledTimes(1);
    expect(out.lockdown).toBe(true);
  });

  it('a marker function that throws counts as a foreign call', async () => {
    const h = setup({ isLearnTool: () => { throw new Error('marker bug'); } });
    h.script['session/prompt'] = () => {
      h.update(claudeLearnCall('toolu_1'));
      return { stopReason: 'cancelled' };
    };
    await expect(h.ask()).resolves.toMatchObject({ lockdown: true });
    expect(h.onLockdown).toHaveBeenCalledTimes(1);
  });

  it('a foreign tool call after the user stopped the turn still locks down', async () => {
    const h = setup();
    h.script['session/prompt'] = () => {
      h.client.cancel('s1');
      h.update({ sessionUpdate: 'tool_call', toolCallId: 'toolu_1', title: 'Terminal', kind: 'execute', rawInput: {} });
      return { stopReason: 'cancelled' };
    };
    await expect(h.ask()).resolves.toMatchObject({ lockdown: true });
    expect(h.onLockdown).toHaveBeenCalledTimes(1);
    expect(h.atAgent).toEqual([{ method: 'session/cancel', params: { sessionId: 's1' } }, { method: 'session/cancel', params: { sessionId: 's1' } }]);
  });

  it('lockdown calls back even when its cancel cannot be written', async () => {
    const h = setup({ failWrite: (l) => l.includes('"session/cancel"') });
    h.script['session/prompt'] = () => {
      h.update({ sessionUpdate: 'tool_call', toolCallId: 'toolu_1', title: 'Terminal', kind: 'execute', rawInput: {} });
      return { stopReason: 'cancelled' };
    };
    // The write's error ends that update's handling (logged, not delivered); the turn still ends locked down.
    await expect(h.ask()).resolves.toMatchObject({ stopReason: 'cancelled', lockdown: true });
    expect(h.onLockdown).toHaveBeenCalledTimes(1);
    expect(h.atAgent).toEqual([]);
    expect(h.updates).toEqual([]);
    expect(logged('[tutor] rpc-handler-failed code=INTERNAL')).toBe(1);
  });

  it('a tool call is judged per session: the same id in another session is judged anew', async () => {
    const h = setup();
    h.script['session/prompt'] = () => {
      h.update(claudeLearnCall('toolu_1'));
      h.update({ sessionUpdate: 'tool_call_update', toolCallId: 'toolu_1', status: 'in_progress', rawInput: { from: 3 } });
      return { stopReason: 'end_turn' };
    };
    await h.ask();
    expect(h.onLockdown).not.toHaveBeenCalled();
    h.update({ sessionUpdate: 'tool_call_update', toolCallId: 'toolu_1', status: 'in_progress', rawInput: {} }, 's2');
    expect(h.atAgent).toEqual([{ method: 'session/cancel', params: { sessionId: 's2' } }]);
    expect(h.onLockdown).toHaveBeenCalledTimes(1);
  });

  it('a foreign tool call while session/resume is open locks down: a resume replays nothing', async () => {
    const h = setup();
    h.script['session/resume'] = () => {
      h.update({ sessionUpdate: 'tool_call', toolCallId: 'toolu_1', title: 'Read file', kind: 'read', rawInput: {} });
      return {};
    };
    await h.client.resumeSession('resume', { sessionId: 's1', cwd: '/w/c1', mcpServers: [] });
    expect(h.atAgent).toEqual([{ method: 'session/cancel', params: { sessionId: 's1' } }]);
    expect(h.onLockdown).toHaveBeenCalledTimes(1);
    expect(h.client.lockedDown).toBe(true);
  });

  it('a foreign tool call outside a turn still locks down', async () => {
    const h = setup();
    h.update({ sessionUpdate: 'tool_call', toolCallId: 'toolu_1', title: 'Terminal', kind: 'execute', rawInput: {} });
    expect(h.atAgent).toEqual([{ method: 'session/cancel', params: { sessionId: 's1' } }]);
    expect(h.onLockdown).toHaveBeenCalledTimes(1);
  });

  it('what session/load replays never reaches onUpdate nor the lockdown watch', async () => {
    const h = setup();
    h.script['session/prompt'] = () => {
      h.update(chunk('first'));
      return { stopReason: 'end_turn' };
    };
    await h.ask();
    h.script['session/load'] = () => {
      h.update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'old question' } });
      h.update(chunk('old answer'));
      h.update({ sessionUpdate: 'tool_call', toolCallId: 'toolu_old', title: 'Read file', kind: 'read', rawInput: {} });
      return {};
    };
    await h.client.resumeSession('load', { sessionId: 's1', cwd: '/w/c1', mcpServers: [] });
    h.script['session/prompt'] = () => {
      h.update(chunk('second'));
      return { stopReason: 'end_turn' };
    };
    await h.ask();
    expect(h.updates).toEqual([{ kind: 'text', text: 'first' }, { kind: 'text', text: 'second' }]);
    expect(h.atAgent).toEqual([]);
    expect(h.onLockdown).not.toHaveBeenCalled();
    expect(h.client.lockedDown).toBe(false);
  });

  it('the login status that came with initialize is read at once, without its label', async () => {
    const h = setup();
    const base = h.script.initialize!;
    h.script.initialize = (p) => {
      h.agent.notify('_auth/status_update', { authStatus: { kind: 'none', label: 'x@y' } });
      return base(p);
    };
    await h.client.initialize();
    await expect(h.client.authStatus(3000)).resolves.toBe('none');
    expect(info.mock.calls.flat().join('\n')).not.toContain('x@y');
  });

  it('a login status that comes while waiting is read; none within the time is null', async () => {
    vi.useFakeTimers();
    const h = setup();
    await h.client.initialize();
    const later = h.client.authStatus(3000);
    await vi.advanceTimersByTimeAsync(1000);
    h.agent.notify('_auth/status_update', { authStatus: { kind: 'account', label: 'x@y (Max)' } });
    await expect(later).resolves.toBe('account');

    const quiet = setup();
    await quiet.client.initialize();
    let result: string | null | undefined;
    void quiet.client.authStatus(3000).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(2999);
    expect(result).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBeNull();
  });

  it('the wait for the login status counts from the initialize answer, and waits for it', async () => {
    vi.useFakeTimers();
    const h = setup();
    let answer!: () => void;
    h.script.initialize = () => new Promise((r) => (answer = () => r({ protocolVersion: 1 })));
    const init = h.client.initialize();
    let result: string | null | undefined;
    void h.client.authStatus(3000).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(5000);
    expect(result).toBeUndefined();
    answer();
    await init;
    await vi.advanceTimersByTimeAsync(1000);
    let second: string | null | undefined;
    void h.client.authStatus(3000).then((r) => (second = r));
    await vi.advanceTimersByTimeAsync(1999);
    expect([result, second]).toEqual([undefined, undefined]);
    await vi.advanceTimersByTimeAsync(1);
    expect([result, second]).toEqual([null, null]);
  });
});
