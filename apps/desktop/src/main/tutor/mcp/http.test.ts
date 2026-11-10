import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { newId, type TutorEnvelope } from '@learn/domain';
import { createScopeRegistry, type AcpScope, type ScopeRegistry } from '../scope';
import type { ToolCallResult } from '../tools';
import { createMcpTransport, type AcpMcpServer, type McpTransport } from './http';
import { createMcpServer } from './server';

const ITEM = newId();
const REVISION = newId();
const ENVELOPE: TutorEnvelope = {
  tool: 'get_outline', item: { id: ITEM, title: 'Paper' }, outline: [], returned: 0, total: 0, limited: false, next: null,
  provenance: { revisionId: REVISION, sha256: 'a'.repeat(64), parser: 'pdf-text-1' },
};

type RequestRecord = { method: string; path: string; headerNames: string[]; status: number };
let reg: ScopeRegistry;
let scope: AcpScope;
let transport: McpTransport;
let records: RequestRecord[];
let info: MockInstance<typeof console.info>;
let created: MockInstance<typeof http.createServer>;
let call: Mock<() => Promise<ToolCallResult>>;

function open(bindMcpSession = true): AcpScope {
  const s = reg.open({
    conversationId: newId(), itemId: ITEM, revisionId: REVISION, sha256: 'a'.repeat(64), title: 'Paper',
    pageCount: 12, outline: { entries: [], complete: true, total: 0 }, readerPage: 0, bindMcpSession,
  });
  s.activeTurn = { tutorMessageId: newId(), selection: null, pagesReturned: 0 };
  return s;
}

beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  created = vi.spyOn(http, 'createServer');
  reg = createScopeRegistry();
  scope = open();
  records = [];
  call = vi.fn(async () => ({ isError: false, text: 'get_outline · ok', envelope: ENVELOPE, read: null }));
  transport = createMcpTransport({ server: createMcpServer({ call: () => call() }), scopes: reg, onRequest: (r) => void records.push(r) });
});
afterEach(async () => {
  await transport.close();
  vi.restoreAllMocks();
});

const poster = (entry: AcpMcpServer, auth: string = entry.headers[0]!.value) => (body: unknown, h: Record<string, string> = {}) =>
  fetch(entry.url, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', ...h }, body: typeof body === 'string' ? body : JSON.stringify(body) });

/** A request with exactly these headers (fetch would put its own Host): the status, headers and body it got. */
function raw(entry: AcpMcpServer, o: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Buffer } = {}) {
  const url = new URL(entry.url);
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: Number(url.port), method: o.method ?? 'POST', path: o.path ?? '/mcp', headers: o.headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(o.body);
  });
}

/** Claude's opening: server/discover, then initialize; the headers every later request of the bound session carries. */
async function bind(entry: AcpMcpServer, version = '2025-11-25') {
  const post = poster(entry);
  await post({ jsonrpc: '2.0', id: 0, method: 'server/discover' }, { 'MCP-Protocol-Version': '2026-07-28' });
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version } });
  expect(init.status).toBe(200);
  const sid = init.headers.get('mcp-session-id')!;
  return { post, sid, v: { 'Mcp-Session-Id': sid, 'MCP-Protocol-Version': version } };
}

describe('createMcpTransport', () => {
  it('takes Claude\'s order: server/discover with its own version header, then initialize binds the token to one MCP session', async () => {
    const entry = await transport.serverEntry(scope);
    const auth = entry.headers[0]!.value;
    const post = (body: unknown, h: Record<string, string> = {}) =>
      fetch(entry.url, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', ...h }, body: JSON.stringify(body) });
    const discover = await post({ jsonrpc: '2.0', id: 0, method: 'server/discover' }, { 'MCP-Protocol-Version': '2026-07-28' });
    expect(discover.status).toBe(200);
    expect(await discover.json()).toMatchObject({ error: { code: -32601 } });
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
    const sid = init.headers.get('mcp-session-id');
    expect(sid).toMatch(/^[0-9a-f]{32}$/);
    const v = { 'Mcp-Session-Id': sid!, 'MCP-Protocol-Version': '2025-11-25' };
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, v)).status).toBe(202);
    expect((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, v)).status).toBe(200);
    expect((await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).status).toBe(400);                          // no session header
    expect((await post({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, { ...v, 'Mcp-Session-Id': 'f'.repeat(32) })).status).toBe(404);   // another session's id
    expect((await post({ jsonrpc: '2.0', id: 5, method: 'initialize', params: { protocolVersion: '2025-11-25' } })).status).toBe(403);   // a second initialize with the token
  });

  it('hands out the one mcpServers entry: http, learn, the loopback URL and the scope\'s Bearer token', async () => {
    const entry = await transport.serverEntry(scope);
    expect(entry).toEqual({ type: 'http', name: 'learn', url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/), headers: [{ name: 'Authorization', value: `Bearer ${scope.token}` }] });
    expect(scope.mcpSessionId).toBeNull();
  });

  it('listens on 127.0.0.1 only, one server for every scope, started on the first entry', async () => {
    expect(created).not.toHaveBeenCalled();
    const other = open();
    const [a, b] = await Promise.all([transport.serverEntry(scope), transport.serverEntry(other)]);
    expect(created).toHaveBeenCalledTimes(1);
    const server = created.mock.results[0]!.value as http.Server;
    expect(server.address()).toMatchObject({ address: '127.0.0.1', family: 'IPv4' });
    const port = (server.address() as AddressInfo).port;
    expect(a.url).toBe(`http://127.0.0.1:${port}/mcp`);
    expect(b.url).toBe(a.url);
    expect(b.headers[0]!.value).toBe(`Bearer ${other.token}`);
  });

  it('the full round trip: tools/call through the scope\'s tools, structuredContent on the negotiated 2025-11-25', async () => {
    const entry = await transport.serverEntry(scope);
    const { post, v } = await bind(entry);
    const list = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, v);
    expect(list.headers.get('content-type')).toBe('application/json');
    expect(((await list.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name)).toEqual(['get_context', 'get_outline', 'read_pdf_pages']);
    const r = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_outline', arguments: {} } }, v);
    expect(await r.json()).toEqual({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'get_outline · ok' }], isError: false, structuredContent: ENVELOPE } });
    expect((await post({ jsonrpc: '2.0', id: 4, method: 'ping' }, v)).status).toBe(200);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('a version that does not take structuredContent gets none', async () => {
    const entry = await transport.serverEntry(scope);
    const { post, v } = await bind(entry, '2025-03-26');
    const r = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_outline' } }, v);
    expect(await r.json()).toEqual({ jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: 'get_outline · ok' }], isError: false } });
  });

  it('a missing, wrong or closed token is 401, whatever the path or method', async () => {
    const entry = await transport.serverEntry(scope);
    const body = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } };
    expect((await fetch(entry.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(401);
    expect((await poster(entry, `Bearer ${'0'.repeat(64)}`)(body)).status).toBe(401);
    expect((await poster(entry, `Basic ${scope.token}`)(body)).status).toBe(401);
    expect((await poster(entry, scope.token)(body)).status).toBe(401);
    expect((await poster(entry, `Bearer ${scope.token}x`)(body)).status).toBe(401);
    expect((await raw(entry, { method: 'GET' })).status).toBe(401);
    expect((await raw(entry, { method: 'GET', path: '/other' })).status).toBe(401);
    const closing = open();
    const closingEntry = await transport.serverEntry(closing);
    expect((await poster(closingEntry)(body)).status).toBe(200);
    reg.close(closing.token);
    expect((await poster(closingEntry)({ jsonrpc: '2.0', id: 2, method: 'ping' })).status).toBe(401);
    expect(scope.mcpSessionId).toBeNull();
  });

  it('refuses a Host other than 127.0.0.1:<port> and any Origin with 403', async () => {
    const entry = await transport.serverEntry(scope);
    const port = new URL(entry.url).port;
    const auth = { Authorization: entry.headers[0]!.value, 'Content-Type': 'application/json' };
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect((await raw(entry, { headers: auth, body })).status).toBe(200);
    expect((await raw(entry, { headers: { ...auth, Host: `localhost:${port}` }, body })).status).toBe(403);
    expect((await raw(entry, { headers: { ...auth, Host: '127.0.0.1' }, body })).status).toBe(403);
    expect((await raw(entry, { headers: { ...auth, Host: `127.0.0.1:${Number(port) + 1}` }, body })).status).toBe(403);
    expect((await poster(entry)({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://example.com' })).status).toBe(403);
    expect((await poster(entry)({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'null' })).status).toBe(403);
    expect((await poster(entry)({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: `http://127.0.0.1:${port}` })).status).toBe(403);
  });

  it('checks Host and Origin before the token, so a request they refuse cannot tell a live token from a dead one', async () => {
    const entry = await transport.serverEntry(scope);
    const port = new URL(entry.url).port;
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    for (const auth of [entry.headers[0]!.value, `Bearer ${'0'.repeat(64)}`, '']) {
      const h: Record<string, string> = auth === '' ? {} : { Authorization: auth };
      expect((await raw(entry, { headers: { ...h, Host: `localhost:${port}` }, body })).status).toBe(403);
      expect((await raw(entry, { headers: { ...h, Origin: 'https://example.com' }, body })).status).toBe(403);
      expect((await raw(entry, { method: 'GET', path: '/other', headers: { ...h, Origin: 'https://example.com' } })).status).toBe(403);
    }
    // Positive control: with Host and Origin right, only the live token gets past 401.
    expect((await raw(entry, { headers: { Authorization: `Bearer ${'0'.repeat(64)}` }, body })).status).toBe(401);
    expect((await raw(entry, { headers: { Authorization: entry.headers[0]!.value }, body })).status).toBe(200);
  });

  it('a body over 64 KiB is 413 and a body of exactly 64 KiB is read', async () => {
    const entry = await transport.serverEntry(scope);
    const json = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const exact = json + ' '.repeat(64 * 1024 - json.length);
    expect(Buffer.byteLength(exact)).toBe(65_536);
    const ok = await poster(entry)(exact);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect((await poster(entry)(exact + ' ')).status).toBe(413);
    // Counted in bytes, not characters.
    const wide = json + 'é'.repeat(Math.floor((64 * 1024 - json.length) / 2) + 1);
    expect(wide.length).toBeLessThan(65_536);
    expect((await poster(entry)(wide)).status).toBe(413);
  });

  it('stops at the 64 KiB + 1st byte: the 413 comes while the body is still being sent', async () => {
    const entry = await transport.serverEntry(scope);
    const url = new URL(entry.url);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: Number(url.port), method: 'POST', path: '/mcp', agent: false, headers: { Authorization: entry.headers[0]!.value, 'Transfer-Encoding': 'chunked' } }, (res) => {
        res.resume();
        resolve(res.statusCode!);
        req.destroy();
      });
      req.on('error', (e: NodeJS.ErrnoException) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
      // The request is never ended: a server that waited for the whole body would never answer.
      req.write(Buffer.alloc(64 * 1024 + 1, 0x20));
    });
    expect(status).toBe(413);
  });

  it('a body that is not JSON is 400 -32700; JSON that is not one JSON-RPC message is 400 -32600', async () => {
    const entry = await transport.serverEntry(scope);
    const bad = await poster(entry)('{"jsonrpc":');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    for (const body of [[{ jsonrpc: '2.0', id: 1, method: 'ping' }], { jsonrpc: '1.0', id: 1, method: 'ping' }, 'null']) {
      const r = await poster(entry)(body);
      expect(r.status).toBe(400);
      expect(await r.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    }
    // A byte that is not UTF-8 is not read as U+FFFD: the message is refused, not answered.
    const ping = Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    const notUtf8 = await raw(entry, { headers: { Authorization: entry.headers[0]!.value }, body: Buffer.concat([ping.subarray(0, -3), Buffer.from([0xff]), ping.subarray(-3)]) });
    expect(notUtf8.status).toBe(400);
    expect(JSON.parse(notUtf8.body)).toMatchObject({ error: { code: -32700 } });
  });

  it('a notification or a client\'s answer is 202 with no body', async () => {
    const entry = await transport.serverEntry(scope);
    const { post, v } = await bind(entry);
    for (const body of [{ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 3 } }, { jsonrpc: '2.0', id: 7, result: {} }]) {
      const r = await post(body, v);
      expect(r.status).toBe(202);
      expect(await r.text()).toBe('');
    }
  });

  it('GET /mcp (Claude\'s SSE attempt) is 405; DELETE /mcp is 405 even with the session header, and the binding stays', async () => {
    const entry = await transport.serverEntry(scope);
    const { post, v, sid } = await bind(entry);
    const auth = { Authorization: entry.headers[0]!.value };
    const get = await raw(entry, { method: 'GET', headers: { ...auth, Accept: 'text/event-stream', ...v } });
    expect(get.status).toBe(405);
    expect(get.headers.allow).toBe('POST');
    const del = await raw(entry, { method: 'DELETE', headers: { ...auth, ...v } });
    expect(del.status).toBe(405);
    expect(scope.mcpSessionId).toBe(sid);
    expect((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, v)).status).toBe(200);
  });

  it('any other path or method is 404', async () => {
    const entry = await transport.serverEntry(scope);
    const auth = { Authorization: entry.headers[0]!.value };
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect((await raw(entry, { path: '/', headers: auth, body })).status).toBe(404);
    expect((await raw(entry, { path: '/mcp/', headers: auth, body })).status).toBe(404);
    expect((await raw(entry, { path: '/.well-known/oauth-protected-resource', method: 'GET', headers: auth })).status).toBe(404);
    expect((await raw(entry, { method: 'PUT', headers: auth, body })).status).toBe(404);
    expect((await raw(entry, { method: 'OPTIONS', headers: auth })).status).toBe(404);
    expect((await raw(entry, { headers: auth, body })).status).toBe(200);
  });

  it('after initialize, a version header other than the negotiated one is 400; before it, none is looked at', async () => {
    const entry = await transport.serverEntry(scope);
    const post = poster(entry);
    expect((await post({ jsonrpc: '2.0', id: 0, method: 'ping' }, { 'MCP-Protocol-Version': '1999-01-01' })).status).toBe(200);
    const { v } = await bind(entry);
    expect((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { ...v, 'MCP-Protocol-Version': '2025-06-18' })).status).toBe(400);
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { ...v, 'MCP-Protocol-Version': '2026-07-28' })).status).toBe(400);
    expect((await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'Mcp-Session-Id': v['Mcp-Session-Id'] })).status).toBe(200);
    expect((await post({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, v)).status).toBe(200);
  });

  it('an initialize that fails binds nothing; the next one binds', async () => {
    const entry = await transport.serverEntry(scope);
    const post = poster(entry);
    const failed = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(failed.status).toBe(200);
    expect(await failed.json()).toMatchObject({ error: { code: -32602 } });
    expect(failed.headers.get('mcp-session-id')).toBeNull();
    expect(scope.mcpSessionId).toBeNull();
    const ok = await post({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
    expect(ok.headers.get('mcp-session-id')).toBe(scope.mcpSessionId);
  });

  it('binds each token to its own session: one scope\'s session id does not open another\'s', async () => {
    const other = open();
    const a = await bind(await transport.serverEntry(scope));
    const b = await bind(await transport.serverEntry(other));
    expect(a.sid).not.toBe(b.sid);
    expect([scope.mcpSessionId, other.mcpSessionId]).toEqual([a.sid, b.sid]);
    expect((await b.post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, a.v)).status).toBe(404);
    expect((await a.post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, b.v)).status).toBe(404);
    expect((await b.post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, b.v)).status).toBe(200);
  });

  it('a scope without binding takes requests with no session header, and a second initialize', async () => {
    const loose = open(false);
    const entry = await transport.serverEntry(loose);
    const post = poster(entry);
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect(init.status).toBe(200);
    expect(init.headers.get('mcp-session-id')).toBeNull();
    expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    expect((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).status).toBe(200);
    expect((await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'Mcp-Session-Id': 'f'.repeat(32) })).status).toBe(200);
    const call2 = await post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_outline' } }, { 'MCP-Protocol-Version': '2025-06-18' });
    expect(await call2.json()).toMatchObject({ result: { structuredContent: ENVELOPE } });
    expect((await post({ jsonrpc: '2.0', id: 5, method: 'initialize', params: { protocolVersion: '2025-11-25' } })).status).toBe(200);
    expect(loose.mcpSessionId).toBeNull();
    // Still the token, Host and Origin checks.
    expect((await poster(entry, `Bearer ${'0'.repeat(64)}`)({ jsonrpc: '2.0', id: 6, method: 'ping' })).status).toBe(401);
    expect((await post({ jsonrpc: '2.0', id: 7, method: 'ping' }, { Origin: 'https://example.com' })).status).toBe(403);
    expect((await post('x')).status).toBe(400);
  });

  it('logs the second initialize by its code alone: no token, session id or path in any log line', async () => {
    const entry = await transport.serverEntry(scope);
    const { post, sid } = await bind(entry);
    info.mockClear();
    expect((await post({ jsonrpc: '2.0', id: 5, method: 'initialize', params: { protocolVersion: '2025-11-25' } })).status).toBe(403);
    expect(info.mock.calls).toEqual([['[tutor] mcp-reinit code=MCP_SESSION_BOUND']]);
    // Every refusal on the way is logged too, and none of them carries a value either.
    await poster(entry, `Bearer ${'0'.repeat(64)}`)({ jsonrpc: '2.0', id: 6, method: 'ping' });
    await post({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, { 'Mcp-Session-Id': 'f'.repeat(32) });
    expect(info.mock.calls.length).toBe(3);
    const logged = JSON.stringify(info.mock.calls);
    for (const secret of [scope.token, sid, '/mcp', '0'.repeat(64), 'f'.repeat(32), 'Bearer']) expect(logged).not.toContain(secret);
    expect(scope.mcpSessionId).toBe(sid);
  });

  it('tells onRequest each request\'s method, path, status and header names as received, never a value', async () => {
    const entry = await transport.serverEntry(scope);
    const { post, v, sid } = await bind(entry);
    await raw(entry, { method: 'GET', headers: { Authorization: entry.headers[0]!.value, Accept: 'text/event-stream' } });
    await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, v);
    await raw(entry, { method: 'GET', path: '/elsewhere?token=x', headers: { authorization: entry.headers[0]!.value } });
    expect(records.map((r) => [r.method, r.path, r.status])).toEqual([
      ['POST', '/mcp', 200], ['POST', '/mcp', 200], ['GET', '/mcp', 405], ['POST', '/mcp', 200], ['GET', '/elsewhere', 404],
    ]);
    expect(records[3]!.headerNames).toEqual(expect.arrayContaining(['Authorization', 'Mcp-Session-Id', 'MCP-Protocol-Version', 'Content-Type', 'host']));
    expect(records[4]!.headerNames).toContain('authorization');
    const told = JSON.stringify(records);
    for (const value of [scope.token, sid, '2025-11-25', 'application/json', 'text/event-stream', 'token=x']) expect(told).not.toContain(value);
  });

  it('close() ends the server and its kept-alive connections; no entry after it', async () => {
    const entry = await transport.serverEntry(scope);
    const { post, v } = await bind(entry);
    expect((await post({ jsonrpc: '2.0', id: 2, method: 'ping' }, v)).status).toBe(200);
    const server = created.mock.results[0]!.value as http.Server;
    await transport.close();
    expect(server.listening).toBe(false);
    await expect(fetch(entry.url, { method: 'POST', headers: { Authorization: entry.headers[0]!.value }, body: '{}' })).rejects.toThrow();
    await expect(transport.serverEntry(scope)).rejects.toThrow();
    await transport.close();
  });

  it('close() before any entry starts nothing', async () => {
    const fresh = createMcpTransport({ server: createMcpServer({ call: () => call() }), scopes: reg });
    await fresh.close();
    await expect(fresh.serverEntry(scope)).rejects.toThrow();
    expect(created).not.toHaveBeenCalled();
  });

  it('takes its session ids from newSessionId', async () => {
    const own = createMcpTransport({ server: createMcpServer({ call: () => call() }), scopes: reg, newSessionId: () => 'ab'.repeat(16) });
    try {
      const { sid } = await bind(await own.serverEntry(scope));
      expect(sid).toBe('ab'.repeat(16));
      expect(scope.mcpSessionId).toBe('ab'.repeat(16));
    } finally {
      await own.close();
    }
  });

  it('before initialize, a live token lists and calls nothing and binds nothing; the later initialize binds as usual', async () => {
    const entry = await transport.serverEntry(scope);
    const post = poster(entry);
    const early = await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_outline', arguments: {} } });
    expect(early.status).toBe(200);
    expect(await early.json()).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Server not initialized' } });
    expect(await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()).toEqual({ jsonrpc: '2.0', id: 2, error: { code: -32600, message: 'Server not initialized' } });
    expect(call).not.toHaveBeenCalled();
    expect(scope.mcpSessionId).toBeNull();
    // Positive control: the CLI's initialize still binds the token, and its tools/call runs.
    const { v, sid } = await bind(entry);
    expect(scope.mcpSessionId).toBe(sid);
    const r = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_outline' } }, v);
    expect(await r.json()).toMatchObject({ result: { isError: false, structuredContent: ENVELOPE } });
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('two initializes at once on one token: exactly one binds (200 with a session id), the other is 403', async () => {
    const real = createMcpServer({ call: () => call() });
    let held = 0;
    let letGo!: () => void;
    const gate = new Promise<void>((resolve) => {
      letGo = resolve;
    });
    // The answer to an initialize waits until the other request is refused (or, were both let through, until both are
    // held), so the second is checked while the first is unanswered.
    const own = createMcpTransport({
      scopes: reg,
      server: {
        handle: async (s, c, m) => {
          held += 1;
          if (held === 2) letGo();
          await gate;
          return real.handle(s, c, m);
        },
      },
      onRequest: (r) => { if (r.status === 403) letGo(); },
    });
    try {
      const post = poster(await own.serverEntry(scope));
      const init = (id: number) => post({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
      const answers = await Promise.all([init(1), init(2)]);
      expect(answers.map((a) => a.status).sort()).toEqual([200, 403]);
      const won = answers.find((a) => a.status === 200)!;
      expect(won.headers.get('mcp-session-id')).toBe(scope.mcpSessionId);
      expect(scope.mcpSessionId).toMatch(/^[0-9a-f]{32}$/);
      expect(answers.find((a) => a.status === 403)!.headers.get('mcp-session-id')).toBeNull();
      expect(held).toBe(1);
      expect(info.mock.calls).toContainEqual(['[tutor] mcp-reinit code=MCP_SESSION_BOUND']);
    } finally {
      letGo();
      await own.close();
    }
  });

  it('bounds slow requests and connections: 10 s to receive a request, 32 connections', async () => {
    await transport.serverEntry(scope);
    const server = created.mock.results[0]!.value as http.Server;
    expect([server.headersTimeout, server.requestTimeout, server.maxConnections]).toEqual([10_000, 10_000, 32]);
  });

  it('a request that never finishes its body is ended by the server and recorded with status 0; a slow answer is not cut', async () => {
    const slow = vi.fn(async () => {
      // The answer outlasts the request limit several times over: the limit is on receiving, not on answering.
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { isError: false, text: 'get_outline · ok', envelope: ENVELOPE, read: null } satisfies ToolCallResult;
    });
    const seen: RequestRecord[] = [];
    const own = createMcpTransport({ server: createMcpServer({ call: () => slow() }), scopes: reg, onRequest: (r) => void seen.push(r), requestTimeoutMs: 150 });
    try {
      const entry = await own.serverEntry(scope);
      const url = new URL(entry.url);
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: Number(url.port), method: 'POST', path: '/mcp', agent: false, headers: { Authorization: entry.headers[0]!.value, 'Transfer-Encoding': 'chunked' } }, (res) => {
          res.resume();
          resolve(res.statusCode!);
        });
        req.on('error', reject);
        req.write('{"jsonrpc":"2.0",');
      });
      expect(status).toBe(408);
      await vi.waitFor(() => expect(seen).toContainEqual(expect.objectContaining({ method: 'POST', path: '/mcp', status: 0 })));
      const { post, v } = await bind(entry);
      const r = await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_outline' } }, v);
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ result: { isError: false } });
      expect(slow).toHaveBeenCalledTimes(1);
    } finally {
      await own.close();
    }
  });

  it('a client gone in the middle of its body is recorded with status 0, and nothing is handled', async () => {
    const handle = vi.fn(async () => null);
    const seen: RequestRecord[] = [];
    const own = createMcpTransport({ server: { handle }, scopes: reg, onRequest: (r) => void seen.push(r) });
    try {
      const entry = await own.serverEntry(scope);
      const url = new URL(entry.url);
      const req = http.request({ host: '127.0.0.1', port: Number(url.port), method: 'POST', path: '/mcp', agent: false, headers: { Authorization: entry.headers[0]!.value, 'Content-Length': '100' } });
      req.on('error', () => {});
      req.write('{"jsonrpc":"2.0",', () => req.destroy());
      await vi.waitFor(() => expect(seen).toEqual([expect.objectContaining({ method: 'POST', path: '/mcp', status: 0 })]));
      expect(handle).not.toHaveBeenCalled();
    } finally {
      await own.close();
    }
  });

  it('once close() has begun, a request whose body is already read is refused with 503 and never handled', async () => {
    const handle = vi.fn(async () => null);
    // close() begins from inside the request, after its body was read and before it would be handled.
    const own: McpTransport = createMcpTransport({
      server: { handle }, scopes: reg, newSessionId: () => { void own.close(); return 'ab'.repeat(16); },
    });
    try {
      const r = await poster(await own.serverEntry(scope))({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
      expect(r.status).toBe(503);
      expect(r.headers.get('mcp-session-id')).toBeNull();
      expect(handle).not.toHaveBeenCalled();
      expect(scope.mcpSessionId).toBeNull();
    } finally {
      await own.close();
    }
  });

  it('a Content-Length over 64 KiB is 413 before a byte of the body is read', async () => {
    const handle = vi.fn(async () => null);
    const own = createMcpTransport({ server: { handle }, scopes: reg });
    try {
      const entry = await own.serverEntry(scope);
      const url = new URL(entry.url);
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: Number(url.port), method: 'POST', path: '/mcp', agent: false, headers: { Authorization: entry.headers[0]!.value, 'Content-Length': String(10 * 1024 * 1024) } }, (res) => {
          res.resume();
          resolve(res.statusCode!);
          req.destroy();
        });
        req.on('error', (e: NodeJS.ErrnoException) => (e.code === 'ECONNRESET' ? undefined : reject(e)));
        // Only the headers go: the answer comes without the server waiting for, or reading, any of the body.
        req.flushHeaders();
      });
      expect(status).toBe(413);
      expect(handle).not.toHaveBeenCalled();
    } finally {
      await own.close();
    }
  });
});
