import { LearnError, type ErrorCode } from '@learn/domain';
import { tutorLog } from '../log';
import { acpIn, acpOut } from './schema';

export const MAX_LINE_BYTES = 8 * 1024 * 1024;
const LF = 0x0a;
const CR = 0x0d;

export type RpcId = number | string;

/** An error reply: thrown by Learn's handlers, and the rejection of request() when the agent answers with an error (`data` kept for classifyFailure). */
export class RpcError extends Error {
  constructor(readonly rpcCode: number, message: string, readonly data?: unknown) {
    super(message);
    this.name = 'RpcError';
  }
}

export interface JsonRpcPeer {
  /** Rejects with LearnError(code ?? 'AGENT_TIMEOUT') when no answer comes in `timeoutMs`; a late answer is dropped. */
  request(method: string, params: unknown, opts?: { timeoutMs?: number; code?: ErrorCode }): Promise<unknown>;
  notify(method: string, params: unknown): void;
  /** Answers the agent's requests: a value is the result, a thrown RpcError the error reply. */
  onRequest(fn: (method: string, params: unknown) => Promise<unknown>): void;
  onNotification(fn: (method: string, params: unknown) => void): void;
  receive(line: string): void;
  /** Rejects every waiting request with `code`; nothing is written after it. */
  close(code: ErrorCode): void;
}

interface Waiting {
  resolve(value: unknown): void;
  reject(e: unknown): void;
  timer: ReturnType<typeof setTimeout> | null;
}

/** A handler that found a field Learn reads with the wrong type: the agent broke the protocol. */
const isProtocolError = (e: unknown) => e instanceof LearnError && e.code === 'AGENT_PROTOCOL';

export function createPeer(o: { write(line: string): void; onFatal(code: 'AGENT_PROTOCOL'): void }): JsonRpcPeer {
  const waiting = new Map<RpcId, Waiting>();
  let nextId = 1;
  let closedWith: ErrorCode | null = null;
  let requestHandler: ((method: string, params: unknown) => Promise<unknown>) | null = null;
  let notificationHandler: ((method: string, params: unknown) => void) | null = null;

  // JSON.stringify escapes every newline inside a string, so a message is always one line.
  const send = (message: object) => {
    if (closedWith === null) o.write(JSON.stringify(message));
  };
  const sendError = (id: RpcId, code: number, message: string, data?: unknown) => {
    send({ jsonrpc: '2.0', id, error: acpOut.errorReply.parse(data === undefined ? { code, message } : { code, message, data }) });
  };

  const close = (code: ErrorCode) => {
    if (closedWith !== null) return;
    closedWith = code;
    const all = [...waiting.values()];
    waiting.clear();
    for (const w of all) {
      if (w.timer) clearTimeout(w.timer);
      w.reject(new LearnError(code, 'The agent connection closed.'));
    }
  };
  const fatal = () => {
    if (closedWith !== null) return;
    close('AGENT_PROTOCOL');
    o.onFatal('AGENT_PROTOCOL');
  };

  const answerRequest = (id: RpcId, method: string, params: unknown) => {
    const handler = requestHandler;
    if (!handler) {
      sendError(id, -32601, 'Method not found');
      return;
    }
    let pending: Promise<unknown>;
    try {
      pending = handler(method, params);
    } catch (e) {
      pending = Promise.reject(e);
    }
    pending.then(
      (result) => send({ jsonrpc: '2.0', id, result: result === undefined ? null : result }),
      (e: unknown) => {
        if (e instanceof RpcError) sendError(id, e.rpcCode, e.message, e.data);
        else if (isProtocolError(e)) fatal();
        else {
          // The error's own message stays here: it may hold what the agent sent.
          tutorLog('rpc-handler-failed', { code: 'INTERNAL' });
          sendError(id, -32603, 'Internal error');
        }
      },
    ).catch(() => tutorLog('rpc-reply-failed', { code: 'INTERNAL' }));
  };

  const receive = (line: string) => {
    if (closedWith !== null) return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      fatal();
      return;
    }
    const parsed = acpIn.envelope.safeParse(raw);
    if (!parsed.success) {
      fatal();
      return;
    }
    const m = parsed.data;
    if (m.method !== undefined) {
      if (m.id === null) fatal();
      else if (m.id === undefined) {
        try {
          notificationHandler?.(m.method, m.params);
        } catch (e) {
          if (isProtocolError(e)) fatal();
          else tutorLog('rpc-handler-failed', { code: 'INTERNAL' });
        }
      } else answerRequest(m.id, m.method, m.params);
      return;
    }
    if (m.id === undefined) {
      fatal();
      return;
    }
    const w = m.id === null ? undefined : waiting.get(m.id);
    if (!w) {
      // A late answer (its request timed out) or an id Learn never sent. Learn's ids are numbers; a string id is the
      // agent's own text, which the log never holds.
      tutorLog('rpc-unknown-id', typeof m.id === 'number' ? { req: m.id } : {});
      return;
    }
    waiting.delete(m.id!);
    if (w.timer) clearTimeout(w.timer);
    if (m.error) w.reject(new RpcError(m.error.code, m.error.message ?? '', m.error.data));
    else w.resolve(m.result);
  };

  return {
    request(method, params, opts = {}) {
      if (closedWith !== null) return Promise.reject(new LearnError(closedWith, 'The agent connection closed.'));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = opts.timeoutMs === undefined ? null : setTimeout(() => {
          waiting.delete(id);
          reject(new LearnError(opts.code ?? 'AGENT_TIMEOUT', `No answer to ${method} in time.`));
        }, opts.timeoutMs);
        waiting.set(id, { resolve, reject, timer });
        try {
          send({ jsonrpc: '2.0', id, method, params });
        } catch (e) {
          waiting.delete(id);
          if (timer) clearTimeout(timer);
          reject(e);
        }
      });
    },
    notify(method, params) {
      send({ jsonrpc: '2.0', method, params });
    },
    onRequest(fn) {
      requestHandler = fn;
    },
    onNotification(fn) {
      notificationHandler = fn;
    },
    receive,
    close,
  };
}

/**
 * Splits the agent's stdout into lines: a line cut across chunks is joined, one chunk may hold several, a trailing CR
 * is dropped and an empty line skipped. A line over MAX_LINE_BYTES is told to `onOverflow` as soon as it passes the
 * limit — the caller kills the agent — and nothing is read after it.
 */
export function createLineReader(onLine: (line: string) => void, onOverflow: () => void): { push(chunk: Buffer): void } {
  let parts: Buffer[] = [];
  let size = 0;
  let overflowed = false;
  const overflow = () => {
    overflowed = true;
    parts = [];
    onOverflow();
  };
  return {
    push(chunk) {
      let start = 0;
      while (!overflowed) {
        const nl = chunk.indexOf(LF, start);
        const piece = chunk.subarray(start, nl === -1 ? chunk.length : nl);
        size += piece.length;
        // + 1: the line's CR, which is not counted, may still be in it.
        if (size > MAX_LINE_BYTES + 1) return overflow();
        if (nl === -1) {
          if (piece.length > 0) parts.push(piece);
          return;
        }
        const line = parts.length === 0 ? piece : Buffer.concat([...parts, piece], size);
        parts = [];
        size = 0;
        start = nl + 1;
        const end = line.length > 0 && line[line.length - 1] === CR ? line.length - 1 : line.length;
        if (end > MAX_LINE_BYTES) return overflow();
        // Decoded whole, so a character cut between chunks is joined first.
        if (end > 0) onLine(line.toString('utf8', 0, end));
      }
    },
  };
}
