import { randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { LearnError } from '@learn/domain';
import { z } from 'zod';
import { tutorLog } from '../log';
import type { AcpScope, ScopeRegistry } from '../scope';
import { readMcpMessage, rpcError, type McpConnection, type createMcpServer } from './server';

/** ACP v1's HTTP MCP server entry, as session/new and a resume carry it. */
export type AcpMcpServer = { type: 'http'; name: 'learn'; url: string; headers: Array<{ name: 'Authorization'; value: string }> };

export interface McpTransport {
  /** The one `mcpServers` entry of session/new and of a resume for this scope's token; starts the server the first time. */
  serverEntry(scope: AcpScope): Promise<AcpMcpServer>;
  close(): Promise<void>;
}

const HOST = '127.0.0.1';
const PATH = '/mcp';
const MAX_BODY = 64 * 1024;

const entrySchema = z.object({
  type: z.literal('http'),
  name: z.literal('learn'),
  url: z.string().regex(/^http:\/\/127\.0\.0\.1:\d{1,5}\/mcp$/),
  headers: z.tuple([z.object({ name: z.literal('Authorization'), value: z.string().regex(/^Bearer [0-9a-f]{64}$/) }).strict()]),
}).strict();
const sessionIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
// RFC 6750: the scheme's case does not matter.
const BEARER = /^bearer +(\S+)$/i;
const utf8 = new TextDecoder('utf-8', { fatal: true });

type Body = Buffer | 'too-large' | 'gone';

/**
 * The request's body, counted while it streams: past 64 KiB nothing more is kept or read — the 413 that follows closes
 * the connection — so a body of any size costs at most 64 KiB.
 */
function readBody(req: http.IncomingMessage): Promise<Body> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const finish = (b: Body) => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onGone);
      req.off('close', onGone);
      resolve(b);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        req.pause();
        finish('too-large');
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => finish(Buffer.concat(chunks, size));
    const onGone = () => finish('gone');
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onGone);
    req.on('close', onGone);
  });
}

/** The session id is the second secret of a bound token (the first is on the agent's command line): compared in constant time. */
function sameSession(given: string, bound: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(bound, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

const closedError = () => new LearnError('INTERNAL', 'The tutor\'s MCP server is closed.');

/** One loopback server for the app's life, started on first use. */
export function createMcpTransport(d: {
  server: ReturnType<typeof createMcpServer>;
  scopes: ScopeRegistry;
  newSessionId?: () => string;
  /** Tests only (the live test's R1 record): each request's method, path, header names as received (rawHeaders, never values) and status. */
  onRequest?(r: { method: string; path: string; headerNames: string[]; status: number }): void;
}): McpTransport {
  const newSessionId = d.newSessionId ?? (() => randomBytes(16).toString('hex'));
  // By scope, so a closed scope's connection goes with it; a token binds one MCP session, so this is that session's.
  const conns = new WeakMap<AcpScope, McpConnection>();
  let server: http.Server | null = null;
  let port = 0;
  let starting: Promise<number> | null = null;
  let closing: Promise<void> | null = null;

  const connOf = (scope: AcpScope): McpConnection => {
    let c = conns.get(scope);
    if (c === undefined) {
      c = { version: null };
      conns.set(scope, c);
    }
    return c;
  };
  const scopeOf = (authorization: string | undefined): AcpScope | null => {
    const m = BEARER.exec(authorization ?? '');
    return m === null ? null : d.scopes.find(m[1]!);
  };

  /*
   * The order of the checks: Host, then Origin, then the token — a request Host or Origin refuses learns nothing of
   * whether its token is live — then path and method, the body (size, JSON, one JSON-RPC message), the MCP session
   * the token is bound to, and the version header.
   */
  async function serve(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const path = (req.url ?? '').split('?', 1)[0]!;
    const send = (status: number, o: { body?: Record<string, unknown>; headers?: Record<string, string>; refused?: string } = {}) => {
      if (o.refused !== undefined) tutorLog('mcp-refused', { code: o.refused });
      // Told before the answer is written, so it is in the record by the time the client has the answer.
      try {
        d.onRequest?.({ method: req.method ?? '', path, headerNames: req.rawHeaders.filter((_, i) => i % 2 === 0), status });
      } catch {
        // A test's hook never breaks a request.
      }
      const body = o.body === undefined ? undefined : JSON.stringify(o.body);
      res.writeHead(status, body === undefined ? { ...o.headers } : { ...o.headers, 'Content-Type': 'application/json' });
      res.end(body);
    };

    // A browser cannot pass these two, so a page the user opens never reaches the tools (spec 5.6).
    if (req.headers.host !== `${HOST}:${port}`) return send(403, { refused: 'MCP_HOST' });
    if (req.headers.origin !== undefined) return send(403, { refused: 'MCP_ORIGIN' });
    const scope = scopeOf(req.headers.authorization);
    if (scope === null) return send(401, { refused: 'MCP_TOKEN' });
    if (path !== PATH) return send(404, { refused: 'MCP_NOT_FOUND' });
    // GET is Claude's try at an SSE stream; DELETE a client ending its session, which the server does not take.
    if (req.method === 'GET' || req.method === 'DELETE') return send(405, { headers: { Allow: 'POST' } });
    if (req.method !== 'POST') return send(404, { refused: 'MCP_NOT_FOUND' });

    const body = await readBody(req);
    if (body === 'gone') return;
    if (body === 'too-large') return send(413, { headers: { Connection: 'close' }, refused: 'MCP_TOO_LARGE' });
    let raw: unknown;
    try {
      raw = JSON.parse(utf8.decode(body));
    } catch {
      return send(400, { body: rpcError(null, -32700, 'Parse error'), refused: 'MCP_PARSE' });
    }
    const m = readMcpMessage(raw);
    if (m === null) return send(400, { body: rpcError(null, -32600, 'Invalid Request'), refused: 'MCP_INVALID' });

    const conn = connOf(scope);
    const initialize = m.kind === 'request' && m.method === 'initialize';
    let binding: string | null = null;
    if (scope.bindMcpSession) {
      if (initialize) {
        if (scope.mcpSessionId !== null) {
          tutorLog('mcp-reinit', { code: 'MCP_SESSION_BOUND' });
          return send(403);
        }
        binding = sessionIdSchema.parse(newSessionId());
        // Bound before the answer is awaited: an initialize racing this one finds the token taken.
        scope.mcpSessionId = binding;
      } else if (scope.mcpSessionId !== null) {
        const given = req.headers['mcp-session-id'];
        if (typeof given !== 'string') return send(400, { body: rpcError(null, -32000, 'Bad Request: Mcp-Session-Id header is required'), refused: 'MCP_SESSION_MISSING' });
        if (!sameSession(given, scope.mcpSessionId)) return send(404, { body: rpcError(null, -32001, 'Session not found'), refused: 'MCP_SESSION_UNKNOWN' });
      }
      // Before initialize — Claude's server/discover — no session exists yet, so none is asked for.
    }
    // Claude's server/discover carries a version of its own before anything is negotiated, so the header is read only after.
    if (!initialize && conn.version !== null) {
      const v = req.headers['mcp-protocol-version'];
      if (v !== undefined && v !== conn.version) return send(400, { body: rpcError(null, -32000, 'Bad Request: Unsupported protocol version'), refused: 'MCP_VERSION' });
    }

    let answer: Record<string, unknown> | null = null;
    try {
      answer = await d.server.handle(scope, conn, raw);
    } finally {
      // An initialize not answered with a result (its params unreadable) binds nothing.
      if (binding !== null && (answer === null || !('result' in answer))) {
        if (scope.mcpSessionId === binding) scope.mcpSessionId = null;
        binding = null;
      }
    }
    if (answer === null) return send(202);
    return send(200, { body: answer, headers: binding === null ? {} : { 'Mcp-Session-Id': binding } });
  }

  function start(): Promise<number> {
    if (starting !== null) return starting;
    const s = http.createServer((req, res) => {
      serve(req, res).catch(() => {
        tutorLog('mcp-failed', { code: 'INTERNAL' });
        if (!res.headersSent) res.writeHead(500).end();
        else res.destroy();
      });
    });
    server = s;
    starting = new Promise<number>((resolve, reject) => {
      const failed = (e: Error) => {
        starting = null;
        server = null;
        reject(new LearnError('INTERNAL', 'The tutor\'s MCP server could not start.', { cause: e }));
      };
      s.once('error', failed);
      s.listen(0, HOST, () => {
        s.off('error', failed);
        s.on('error', () => tutorLog('mcp-server-error', { code: 'INTERNAL' }));
        port = (s.address() as AddressInfo).port;
        resolve(port);
      });
    });
    return starting;
  }

  return {
    async serverEntry(scope) {
      if (closing !== null) throw closedError();
      const p = await start();
      if (closing !== null) throw closedError();
      return entrySchema.parse({ type: 'http', name: 'learn', url: `http://${HOST}:${p}${PATH}`, headers: [{ name: 'Authorization', value: `Bearer ${scope.token}` }] });
    },
    close() {
      closing ??= (async () => {
        if (starting === null) return;
        await starting.catch(() => undefined);
        const s = server;
        if (s === null || !s.listening) return;
        await new Promise<void>((resolve) => {
          s.close(() => resolve());
          // Kept-alive connections would hold close() open; a call still running answers into a closed socket.
          s.closeAllConnections();
        });
      })();
      return closing;
    },
  };
}
