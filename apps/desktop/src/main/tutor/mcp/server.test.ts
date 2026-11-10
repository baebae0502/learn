import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { newId, tutorEnvelope, type TutorEnvelope, type TutorTool } from '@learn/domain';
import { createScopeRegistry, type AcpScope, type OutlineSnapshot } from '../scope';
import { TOOL_ANNOTATIONS, TOOL_DESCRIPTIONS, callTool, type ToolCallResult, type ToolDeps } from '../tools';
import { MCP_VERSIONS, createMcpServer, toolDefinitions, type McpConnection } from './server';

const ITEM = newId();
const REVISION = newId();
const OUTLINE: OutlineSnapshot = { entries: [{ title: 'Introduction', depth: 0, pageIndex: 0 }], complete: true, total: 1 };

function scopeOf(turn = true): AcpScope {
  const s = createScopeRegistry().open({
    conversationId: newId(), itemId: ITEM, revisionId: REVISION, sha256: 'a'.repeat(64), title: 'Paper',
    pageCount: 12, outline: OUTLINE, readerPage: 0, bindMcpSession: true,
  });
  if (turn) s.activeTurn = { tutorMessageId: newId(), selection: null, pagesReturned: 0 };
  return s;
}

// get_context and get_outline never read page text: a read would be a bug in what these tests send.
const deps: ToolDeps = {
  text: {
    pages: () => { throw new Error('no page text in these tests'); },
    stateOf: () => { throw new Error('no page text in these tests'); },
  },
  prioritize: () => {},
  delay: async () => {},
  now: () => 0,
};

let scope: AcpScope;
let call: Mock<(s: AcpScope, name: TutorTool, args: unknown) => Promise<ToolCallResult>>;
let server: ReturnType<typeof createMcpServer>;
let info: MockInstance<typeof console.info>;
beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  scope = scopeOf();
  call = vi.fn((s: AcpScope, name: TutorTool, args: unknown) => callTool(s, name, args, deps));
  server = createMcpServer({ call: (s, name, args) => call(s, name, args) });
});
afterEach(() => vi.restoreAllMocks());

const conn = (): McpConnection => ({ version: null });
/** A connection that negotiated `v`. */
async function opened(v: string): Promise<McpConnection> {
  const c = conn();
  await server.handle(scope, c, { jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: v } });
  return c;
}
type CallReply = { id: unknown; result: { content: Array<{ type: string; text: string }>; isError: boolean; structuredContent?: TutorEnvelope } };

describe('createMcpServer', () => {
  it('negotiates the version: a known one is kept, an unknown one gets Learn\'s newest', async () => {
    const c = conn();
    expect(await server.handle(scope, c, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { roots: {}, elicitation: {} }, clientInfo: { name: 'claude-code', version: '2.1.318' }, _meta: { y: 1 } } }))
      .toMatchObject({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'learn' } } });
    expect(c.version).toBe('2025-11-25');
    expect(await server.handle(scope, conn(), { jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } }))
      .toMatchObject({ result: { protocolVersion: '2025-11-25' } });
  });

  it('keeps each of its four versions, and answers initialize with exactly the strict shape', async () => {
    for (const v of MCP_VERSIONS) {
      const c = conn();
      const r = await server.handle(scope, c, { jsonrpc: '2.0', id: v, method: 'initialize', params: { protocolVersion: v, extra: true } });
      expect(r).toEqual({ jsonrpc: '2.0', id: v, result: { protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: 'learn', version: expect.any(String) } } });
      expect(c.version).toBe(v);
    }
    const versioned = createMcpServer({ call: (s, name, args) => call(s, name, args), version: '1.2.3' });
    expect(await versioned.handle(scope, conn(), { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }))
      .toMatchObject({ result: { serverInfo: { name: 'learn', version: '1.2.3' } } });
  });

  it('answers no notification, and -32601 to server/discover and any other request', async () => {
    expect(await server.handle(scope, conn(), { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3 } })).toBeNull();
    expect(await server.handle(scope, conn(), { jsonrpc: '2.0', id: 4, method: 'server/discover' })).toMatchObject({ error: { code: -32601 } });
    expect(await server.handle(scope, conn(), { jsonrpc: '2.0', id: 5, method: 'resources/list' })).toMatchObject({ error: { code: -32601 } });
  });

  it('answers notifications/initialized and a client\'s own answer with nothing', async () => {
    const c = await opened('2025-11-25');
    expect(await server.handle(scope, c, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await server.handle(scope, c, { jsonrpc: '2.0', id: 9, result: {} })).toBeNull();
    expect(await server.handle(scope, c, { jsonrpc: '2.0', id: 10, error: { code: -1, message: 'no' } })).toBeNull();
    expect(c.version).toBe('2025-11-25');
  });

  it('lists exactly the three read-only tools with strict input schemas (a renamed tool or field breaks this)', async () => {
    const r = (await server.handle(scope, conn(), { jsonrpc: '2.0', id: 6, method: 'tools/list' })) as { result: { tools: Array<{ name: string; inputSchema: { additionalProperties?: boolean }; annotations: Record<string, boolean> }> } };
    expect(r.result.tools.map((t) => t.name)).toEqual(['get_context', 'get_outline', 'read_pdf_pages']);
    expect(r.result.tools.every((t) => t.inputSchema.additionalProperties === false && t.annotations.readOnlyHint === true)).toBe(true);
    expect(r.result.tools).toMatchSnapshot();
  });

  it('builds the tool definitions from the strict zod shapes, with spec 5.1\'s descriptions and all four hints', () => {
    const defs = toolDefinitions();
    expect(defs.map((t) => t.description)).toEqual([TOOL_DESCRIPTIONS.get_context, TOOL_DESCRIPTIONS.get_outline, TOOL_DESCRIPTIONS.read_pdf_pages]);
    for (const t of defs) {
      expect(t.annotations).toEqual(TOOL_ANNOTATIONS);
      expect(t.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      // The dialect is MCP's default, so it is not named; a 2024-11-05 client reads the same keywords.
      expect(t.inputSchema).not.toHaveProperty('$schema');
    }
    expect(defs[2]!.inputSchema).toMatchObject({ required: ['from'], properties: { from: { type: 'integer', minimum: 1 }, to: { type: 'integer' }, item: { format: 'uuid' } } });
  });

  it('answers ping with an empty result', async () => {
    expect(await server.handle(scope, conn(), { jsonrpc: '2.0', id: 'p', method: 'ping' })).toEqual({ jsonrpc: '2.0', id: 'p', result: {} });
  });

  it('carries structuredContent only on 2025-06-18 and 2025-11-25, never before initialize', async () => {
    const msg = { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'get_outline', arguments: {} } };
    for (const v of ['2025-11-25', '2025-06-18'] as const) {
      const r = (await server.handle(scope, await opened(v), msg)) as CallReply;
      expect(r.result.isError).toBe(false);
      expect(r.result.content).toEqual([{ type: 'text', text: expect.stringMatching(/^get_outline · /) }]);
      expect(tutorEnvelope.parse(r.result.structuredContent)).toMatchObject({ tool: 'get_outline', item: { id: ITEM }, returned: 1 });
    }
    for (const c of [await opened('2025-03-26'), await opened('2024-11-05'), conn()]) {
      const r = (await server.handle(scope, c, msg)) as CallReply;
      expect(r.result.content[0]!.text).toMatch(/^get_outline · /);
      expect(r.result).not.toHaveProperty('structuredContent');
      expect(Object.keys(r.result).sort()).toEqual(['content', 'isError']);
    }
    expect(call).toHaveBeenCalledTimes(5);
    expect(call.mock.calls[0]).toEqual([scope, 'get_outline', {}]);
  });

  it('a tool outside the three is -32602 "Unknown tool", and the tools are never called', async () => {
    for (const name of ['read_file', 'Bash', 'toString', '__proto__', 'mcp__learn__get_context']) {
      expect(await server.handle(scope, await opened('2025-11-25'), { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name, arguments: {} } }))
        .toEqual({ jsonrpc: '2.0', id: 8, error: { code: -32602, message: 'Unknown tool' } });
    }
    expect(call).not.toHaveBeenCalled();
  });

  it('a call outside the scope is the tools\' refusal, isError true, with no envelope', async () => {
    const r = (await server.handle(scope, await opened('2025-11-25'), { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_outline', arguments: { item: newId() } } })) as CallReply;
    expect(r.result).toEqual({ content: [{ type: 'text', text: 'This material is outside this conversation.' }], isError: true });
    const idle = scopeOf(false);
    const off = (await server.handle(idle, await opened('2025-11-25'), { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'get_context' } })) as CallReply;
    expect(off.result).toEqual({ content: [{ type: 'text', text: 'This material is outside this conversation.' }], isError: true });
  });

  it('reads loosely: unknown fields and _meta are dropped, a missing arguments is no arguments', async () => {
    const r = (await server.handle(scope, await opened('2025-11-25'), {
      jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'get_context', _meta: { progressToken: 1 }, extra: 'x' }, extra: 'y',
    })) as CallReply;
    expect(r.result.isError).toBe(false);
    expect(call).toHaveBeenCalledWith(scope, 'get_context', undefined);
  });

  it('a request whose fields Learn reads have the wrong type is -32602; a message that is not JSON-RPC is -32600 with no id', async () => {
    const c = await opened('2025-11-25');
    expect(await server.handle(scope, conn(), { jsonrpc: '2.0', id: 12, method: 'initialize', params: {} })).toMatchObject({ id: 12, error: { code: -32602 } });
    expect(await server.handle(scope, conn(), { jsonrpc: '2.0', id: 13, method: 'initialize', params: { protocolVersion: 20251125 } })).toMatchObject({ id: 13, error: { code: -32602 } });
    expect(await server.handle(scope, c, { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 3 } })).toMatchObject({ id: 14, error: { code: -32602 } });
    expect(await server.handle(scope, c, { jsonrpc: '2.0', id: 15, method: 'tools/call' })).toMatchObject({ id: 15, error: { code: -32602 } });
    expect(call).not.toHaveBeenCalled();
    for (const bad of [null, 'x', [], [{ jsonrpc: '2.0', id: 1, method: 'ping' }], { jsonrpc: '1.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', id: null, method: 'ping' }, { jsonrpc: '2.0', id: {}, method: 'ping' }, { jsonrpc: '2.0' }]) {
      expect(await server.handle(scope, c, bad)).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    }
    expect(c.version).toBe('2025-11-25');
  });

  it('a failed call is -32603 with its code alone in the log; a result that breaks the strict shape is never sent', async () => {
    const failing = createMcpServer({ call: async () => { throw new Error('page text of the secret paper'); } });
    expect(await failing.handle(scope, await opened('2025-11-25'), { jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'get_context' } }))
      .toEqual({ jsonrpc: '2.0', id: 16, error: { code: -32603, message: 'Internal error' } });
    const loose = { tool: 'get_context', item: { id: ITEM, title: 't' }, returned: 0, total: 0, limited: false, next: null, provenance: { revisionId: REVISION, sha256: 'a'.repeat(64), parser: 'pdf-text-1' }, secret: 'x' };
    const malformed = createMcpServer({ call: async () => ({ isError: false, text: 'x', envelope: loose as unknown as TutorEnvelope, read: null }) });
    expect(await malformed.handle(scope, await opened('2025-11-25'), { jsonrpc: '2.0', id: 17, method: 'tools/call', params: { name: 'get_context' } }))
      .toEqual({ jsonrpc: '2.0', id: 17, error: { code: -32603, message: 'Internal error' } });
    expect(info.mock.calls).toEqual([['[tutor] mcp-call-failed code=INTERNAL'], ['[tutor] mcp-call-failed code=INTERNAL']]);
  });
});
