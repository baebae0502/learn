import { STOP_REASONS } from '@learn/domain';
import { describe, expect, it } from 'vitest';
import { ACP_STOP_REASONS, acpIn, acpOut, resumeCapable } from './schema';

const extra = { unknownField: 'x', _meta: { anything: 1 } };
const text = (t: string) => ({ type: 'text', text: t });

/** One update of each kind the adapters were seen to send, plus one nobody knows. */
const UPDATES = {
  agent_message_chunk: { sessionUpdate: 'agent_message_chunk', content: text('Hello') },
  tool_call: {
    sessionUpdate: 'tool_call', toolCallId: 'toolu_1', title: 'mcp__learn__get_context', kind: 'other', status: 'pending', rawInput: {},
    _meta: { claudeCode: { toolName: 'mcp__learn__get_context' } },
  },
  tool_call_update: { sessionUpdate: 'tool_call_update', toolCallId: 'toolu_1', status: 'completed', rawInput: { from: 1 }, rawOutput: 'page text' },
  agent_thought_chunk: { sessionUpdate: 'agent_thought_chunk', content: text('thinking') },
  plan: { sessionUpdate: 'plan', entries: [{ content: 'read page 3', priority: 'high', status: 'pending' }] },
  available_commands_update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'd' }] },
  current_mode_update: { sessionUpdate: 'current_mode_update', currentModeId: 'default' },
  user_message_chunk: { sessionUpdate: 'user_message_chunk', content: text('old question') },
  usage_update: { sessionUpdate: 'usage_update', used: 1200, size: 200000, _meta: { '_claude/rateLimit': { utilization: 0.4 }, '_claude/model': 'm' } },
  session_info_update: { sessionUpdate: 'session_info_update', title: 'A session title' },
  some_future_kind: { sessionUpdate: 'some_future_kind', whatever: [1, 2] },
} as const;

describe('acpIn: incoming messages are read loosely', () => {
  it.each(Object.entries(UPDATES))('a %s session/update passes, with unknown fields and _meta besides', (_, update) => {
    const r = acpIn.sessionUpdate.safeParse({ sessionId: 's1', update: { ...update, ...extra }, ...extra });
    expect(r.success).toBe(true);
    expect(r.data?.update.sessionUpdate).toBe(update.sessionUpdate);
  });

  it('a text chunk keeps its text and nothing else', () => {
    expect(acpIn.messageChunk.parse({ ...UPDATES.agent_message_chunk, ...extra, content: { ...text('Hi'), annotations: { a: 1 } } })).toEqual({
      sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hi' },
    });
    expect(acpIn.messageChunk.parse({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', data: 'AAAA', mimeType: 'image/png' } })).toEqual({
      sessionUpdate: 'agent_message_chunk', content: { type: 'image' },
    });
  });

  it('a tool call keeps _meta.claudeCode.toolName and drops every other _meta', () => {
    const call = {
      ...UPDATES.tool_call, ...extra, name: 'mcp__learn__get_context',
      _meta: { anything: 1, claudeCode: { toolName: 'mcp__learn__get_context', toolResponse: { text: 'page text' } } },
    };
    expect(acpIn.toolCall.parse(call)).toEqual({
      sessionUpdate: 'tool_call', toolCallId: 'toolu_1', title: 'mcp__learn__get_context', kind: 'other', rawInput: {},
      _meta: { claudeCode: { toolName: 'mcp__learn__get_context' } },
    });
    expect(acpIn.toolCall.parse({ ...UPDATES.tool_call_update, ...extra })).toEqual({
      sessionUpdate: 'tool_call_update', toolCallId: 'toolu_1', rawInput: { from: 1 }, _meta: {},
    });
  });

  it('the login status keeps its kind and never its label', () => {
    const read = acpIn.authStatus.parse({ authStatus: { kind: 'account', label: 'someone@example.com (Max)' }, ...extra });
    expect(read).toEqual({ authStatus: { kind: 'account' } });
    expect(JSON.stringify(read)).not.toContain('example.com');
  });

  it('every other message passes with unknown fields and _meta, and keeps only what Learn reads', () => {
    expect(acpIn.envelope.parse({ jsonrpc: '2.0', id: 1, result: { a: 1 }, ...extra })).toEqual({ jsonrpc: '2.0', id: 1, result: { a: 1 } });
    expect(acpIn.initializeResult.parse({
      protocolVersion: 1, authMethods: [], ...extra,
      agentCapabilities: {
        loadSession: true, ...extra,
        mcpCapabilities: { http: true, sse: false, acp: false, ...extra },
        promptCapabilities: { image: true, audio: false, embeddedContext: true, ...extra },
        sessionCapabilities: { resume: {}, delete: {}, systemPrompt: { mode: { override: {} } }, ...extra },
      },
    })).toEqual({
      protocolVersion: 1,
      agentCapabilities: { loadSession: true, mcpCapabilities: { http: true }, promptCapabilities: { image: true }, sessionCapabilities: { resume: {} } },
    });
    expect(acpIn.newSessionResult.parse({ sessionId: 's1', modes: { currentModeId: 'auto' }, ...extra })).toEqual({ sessionId: 's1' });
    expect(acpIn.promptResult.parse({
      stopReason: 'end_turn', ...extra,
      usage: { inputTokens: 10, outputTokens: 20, cachedReadTokens: 5, totalTokens: 35 },
    })).toEqual({ stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 20 }, _meta: {} });
    expect(acpIn.promptResult.parse({
      stopReason: 'end_turn', _meta: { anything: 1, quota: { plan: 'max', model_usage: [{ model: 'main', token_count: { totalTokens: 5000, outputTokens: 3 }, cost: 1 }] } },
    })).toEqual({ stopReason: 'end_turn', _meta: { quota: { model_usage: [{ model: 'main', token_count: { totalTokens: 5000 } }] } } });
    expect(acpIn.permissionRequest.parse({
      sessionId: 's1', ...extra, toolCall: { toolCallId: 't', title: 'Bash' },
      options: [{ optionId: 'reject', kind: 'reject_once', name: 'Reject', ...extra }],
    })).toEqual({ sessionId: 's1', options: [{ optionId: 'reject', kind: 'reject_once' }] });
  });

  it('the shapes of a turn that failed offline pass: no usage, an empty model list', () => {
    expect(acpIn.promptResult.safeParse({ stopReason: 'end_turn', usage: null, _meta: { quota: { model_usage: [] } } }).success).toBe(true);
  });

  it('usage and model usage are display-only: a wrong type reads as absent, the result still passes', () => {
    expect(acpIn.promptResult.parse({ stopReason: 'end_turn', usage: { inputTokens: 1.5, outputTokens: 2 } })).toEqual({ stopReason: 'end_turn', usage: { inputTokens: null, outputTokens: 2 } });
    expect(acpIn.promptResult.parse({ stopReason: 'end_turn', usage: 'x', _meta: 5 })).toEqual({ stopReason: 'end_turn', usage: null, _meta: null });
    expect(acpIn.promptResult.parse({ stopReason: 'end_turn', _meta: { quota: { model_usage: [{ model: 3, token_count: { totalTokens: 1 } }, { model: 'm', token_count: 900 }] } } }))
      .toEqual({ stopReason: 'end_turn', _meta: { quota: { model_usage: [null, null] } } });
  });

  it.each([
    ['a session id that is a number', acpIn.newSessionResult, { sessionId: 5 }],
    ['an empty session id', acpIn.newSessionResult, { sessionId: '' }],
    ['a session id over 256 characters', acpIn.newSessionResult, { sessionId: 's'.repeat(257) }],
    ['a stop reason that is a number', acpIn.promptResult, { stopReason: 7 }],
    ['a stop reason over 64 characters', acpIn.promptResult, { stopReason: 'x'.repeat(65) }],
    ['chunk text that is a number', acpIn.messageChunk, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 3 } }],
    ['a text chunk without its text', acpIn.messageChunk, { sessionUpdate: 'agent_message_chunk', content: { type: 'text' } }],
    ['a tool name that is not a string', acpIn.toolCall, { sessionUpdate: 'tool_call', toolCallId: 't', _meta: { claudeCode: { toolName: 1 } } }],
    ['a tool call without its id', acpIn.toolCall, { sessionUpdate: 'tool_call', title: 'x' }],
    ['a protocol version that is a string', acpIn.initializeResult, { protocolVersion: '1' }],
    ['a capability that is not a boolean', acpIn.initializeResult, { protocolVersion: 1, agentCapabilities: { loadSession: 'yes' } }],
    ['permission options that are not a list', acpIn.permissionRequest, { sessionId: 's1', options: {} }],
    ['an option kind that is not a string', acpIn.permissionRequest, { sessionId: 's1', options: [{ optionId: 'a', kind: 1 }] }],
    ['a login kind that is not a string', acpIn.authStatus, { authStatus: { kind: null } }],
    ['an update without its session', acpIn.sessionUpdate, { update: { sessionUpdate: 'plan' } }],
    ['an update kind that is not a string', acpIn.sessionUpdate, { sessionId: 's1', update: { sessionUpdate: 4 } }],
  ])('a field Learn reads with the wrong type or range fails: %s', (_, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });

  it('resumeCapable reads agentCapabilities.sessionCapabilities.resume', () => {
    const at = (caps: unknown) => resumeCapable(acpIn.initializeResult.parse({ protocolVersion: 1, agentCapabilities: caps }));
    expect(at({ sessionCapabilities: { resume: {} } })).toBe(true);
    expect(at({ sessionCapabilities: { resume: null } })).toBe(false);
    expect(at({ sessionCapabilities: {} })).toBe(false);
    expect(at({ loadSession: true })).toBe(false);
    expect(at(undefined)).toBe(false);
  });

  it('the ACP stop reasons are the domain\'s first five', () => {
    expect(ACP_STOP_REASONS).toEqual(STOP_REASONS.slice(0, 5));
  });
});

describe('acpOut: what Learn sends is strict', () => {
  const SERVER = { type: 'http', name: 'learn', url: 'http://127.0.0.1:4000/mcp', headers: [{ name: 'Authorization', value: `Bearer ${'ab'.repeat(32)}` }] };
  const init = {
    protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'Learn', version: '0.1.0' },
  };

  it('builds each message Learn sends', () => {
    const system = { mode: 'append', content: [text('You are the study tutor')] };
    expect(acpOut.initializeParams.parse(init)).toEqual(init);
    const session = { cwd: '/w/c1', mcpServers: [SERVER], systemPrompt: system, _meta: { claudeCode: { options: { tools: [] } } } };
    expect(acpOut.newSessionParams.parse(session)).toEqual(session);
    expect(acpOut.resumeParams.parse({ sessionId: 's1', cwd: '/w/c1', mcpServers: [] })).toEqual({ sessionId: 's1', cwd: '/w/c1', mcpServers: [] });
    expect(acpOut.setModeParams.parse({ sessionId: 's1', modeId: 'default' })).toEqual({ sessionId: 's1', modeId: 'default' });
    expect(acpOut.promptParams.parse({ sessionId: 's1', prompt: [text('q')] })).toEqual({ sessionId: 's1', prompt: [text('q')] });
    expect(acpOut.cancelParams.parse({ sessionId: 's1' })).toEqual({ sessionId: 's1' });
    expect(acpOut.permissionResult.parse({ outcome: { outcome: 'cancelled' } })).toEqual({ outcome: { outcome: 'cancelled' } });
    expect(acpOut.errorReply.parse({ code: -32601, message: 'Method not found' })).toEqual({ code: -32601, message: 'Method not found' });
  });

  it.each([
    ['an unknown key in initialize', acpOut.initializeParams, { ...init, extra: true }],
    ['an unknown key in a capability', acpOut.initializeParams, { ...init, clientCapabilities: { ...init.clientCapabilities, extra: 1 } }],
    ['a file capability', acpOut.initializeParams, { ...init, clientCapabilities: { ...init.clientCapabilities, fs: { readTextFile: true, writeTextFile: false } } }],
    ['a terminal capability', acpOut.initializeParams, { ...init, clientCapabilities: { ...init.clientCapabilities, terminal: true } }],
    ['another protocol version', acpOut.initializeParams, { ...init, protocolVersion: 2 }],
    ['an unknown key in session/new', acpOut.newSessionParams, { cwd: '/w', mcpServers: [], extra: 1 }],
    ['a system prompt that replaces', acpOut.newSessionParams, { cwd: '/w', mcpServers: [], systemPrompt: { mode: 'override', content: [text('x')] } }],
    ['an unknown key in a resume', acpOut.resumeParams, { sessionId: 's1', cwd: '/w', mcpServers: [], extra: 1 }],
    ['an MCP server of another shape', acpOut.newSessionParams, { cwd: '/w', mcpServers: [{ type: 'http', name: 'learn' }] }],
    ['an MCP server off the loopback', acpOut.newSessionParams, { cwd: '/w', mcpServers: [{ ...SERVER, url: 'http://10.0.0.1:4000/mcp' }] }],
    ['an MCP server with another header', acpOut.resumeParams, { sessionId: 's1', cwd: '/w', mcpServers: [{ ...SERVER, headers: [...SERVER.headers, { name: 'X', value: 'y' }] }] }],
    ['a second MCP server', acpOut.newSessionParams, { cwd: '/w', mcpServers: [SERVER, SERVER] }],
    ['a mode other than default', acpOut.setModeParams, { sessionId: 's1', modeId: 'bypassPermissions' }],
    ['an image block in a prompt', acpOut.promptParams, { sessionId: 's1', prompt: [{ type: 'image', data: 'AA', mimeType: 'image/png' }] }],
    ['an empty prompt', acpOut.promptParams, { sessionId: 's1', prompt: [] }],
    ['an unknown key in a cancel', acpOut.cancelParams, { sessionId: 's1', extra: 1 }],
    ['an allow in a permission answer', acpOut.permissionResult, { outcome: { outcome: 'allowed' } }],
    ['an unknown key in an error reply', acpOut.errorReply, { code: 1, message: 'm', extra: 1 }],
  ])('refuses %s', (_, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
