import { LearnError } from '@learn/domain';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createLineReader, createPeer, MAX_LINE_BYTES, RpcError } from './jsonrpc';

let info: MockInstance<typeof console.info>;
beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createLineReader', () => {
  it('joins a line cut across chunks, splits several lines in one chunk, drops a trailing CR', () => {
    const lines: string[] = [];
    const r = createLineReader((l) => lines.push(l), () => lines.push('OVERFLOW'));
    r.push(Buffer.from('{"a":'));
    r.push(Buffer.from('1}\r\n{"b":2}\n{"c"'));
    r.push(Buffer.from(':3}\n'));
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('a line over 8 MiB is an overflow, never a line', () => {
    const out: string[] = [];
    const r = createLineReader((l) => out.push(l), () => out.push('OVERFLOW'));
    r.push(Buffer.alloc(MAX_LINE_BYTES + 1, 0x61));
    r.push(Buffer.from('\n'));
    expect(out).toEqual(['OVERFLOW']);
  });

  it('a line of exactly 8 MiB (its CR not counted) is still a line', () => {
    const lengths: number[] = [];
    const r = createLineReader((l) => lengths.push(l.length), () => lengths.push(-1));
    r.push(Buffer.alloc(MAX_LINE_BYTES, 0x61));
    r.push(Buffer.from('\r\n'));
    expect(lengths).toEqual([MAX_LINE_BYTES]);
  });

  it('tells the overflow as soon as the line passes the limit, once, and reads nothing after it', () => {
    const out: string[] = [];
    const r = createLineReader((l) => out.push(l), () => out.push('OVERFLOW'));
    r.push(Buffer.from('{"before":1}\n'));
    r.push(Buffer.alloc(MAX_LINE_BYTES / 2, 0x61));
    expect(out).toEqual(['{"before":1}']);
    r.push(Buffer.alloc(MAX_LINE_BYTES / 2 + 2, 0x61));
    expect(out).toEqual(['{"before":1}', 'OVERFLOW']);
    r.push(Buffer.from('aaa\n{"after":1}\n'));
    expect(out).toEqual(['{"before":1}', 'OVERFLOW']);
  });

  it('joins a character cut between chunks and skips an empty line', () => {
    const lines: string[] = [];
    const r = createLineReader((l) => lines.push(l), () => lines.push('OVERFLOW'));
    const bytes = Buffer.from('{"t":"한글"}\n');
    r.push(bytes.subarray(0, 8));
    r.push(bytes.subarray(8));
    r.push(Buffer.from('\n\r\n{"u":1}\n'));
    expect(lines).toEqual(['{"t":"한글"}', '{"u":1}']);
  });
});

describe('createPeer', () => {
  it('pairs answers by id; a late answer and an unknown id are dropped; not JSON is fatal', async () => {
    const written: string[] = [];
    const fatal: string[] = [];
    const peer = createPeer({ write: (l) => written.push(l), onFatal: (c) => fatal.push(c) });
    vi.useFakeTimers();
    const slow = peer.request('session/new', {}, { timeoutMs: 1000 });
    const quick = peer.request('initialize', {});
    const [a, b] = written.map((l) => JSON.parse(l) as { id: number });
    vi.advanceTimersByTime(1001);
    await expect(slow).rejects.toMatchObject({ code: 'AGENT_TIMEOUT' });
    peer.receive(JSON.stringify({ jsonrpc: '2.0', id: a!.id, result: { late: true } }));
    peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 999, result: {} }));
    peer.receive(JSON.stringify({ jsonrpc: '2.0', id: b!.id, result: { ok: 1 } }));
    await expect(quick).resolves.toEqual({ ok: 1 });
    expect(fatal).toEqual([]);
    peer.receive('not json');
    expect(fatal).toEqual(['AGENT_PROTOCOL']);
    vi.useRealTimers();
  });

  it('writes one line per message, without a newline, and logs a dropped answer by its id only', async () => {
    const written: string[] = [];
    const peer = createPeer({ write: (l) => written.push(l), onFatal: () => {} });
    void peer.request('initialize', { text: 'a\nb' });
    peer.notify('session/cancel', { sessionId: 's1' });
    expect(written).toEqual([
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"text":"a\\nb"}}',
      '{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"s1"}}',
    ]);
    peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 999, result: { secret: 'answer text' } }));
    expect(info.mock.calls).toEqual([['[tutor] rpc-unknown-id req=999']]);
  });

  it('a timeout rejects with the code it was given', async () => {
    const peer = createPeer({ write: () => {}, onFatal: () => {} });
    vi.useFakeTimers();
    const r = peer.request('initialize', {}, { timeoutMs: 50, code: 'AGENT_START_FAILED' });
    vi.advanceTimersByTime(50);
    await expect(r).rejects.toBeInstanceOf(LearnError);
    await expect(r).rejects.toMatchObject({ code: 'AGENT_START_FAILED' });
  });

  it('an error answer rejects with an RpcError that keeps its code, message and data', async () => {
    const written: string[] = [];
    const peer = createPeer({ write: (l) => written.push(l), onFatal: () => {} });
    const r = peer.request('session/prompt', {});
    peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'Authentication required', data: { k: 1 } } }));
    const e: unknown = await r.catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RpcError);
    expect(e).toMatchObject({ rpcCode: -32000, message: 'Authentication required', data: { k: 1 } });
  });

  it('answers the agent: a value is the result, an RpcError the error reply, anything else -32603, no handler -32601', async () => {
    const written: string[] = [];
    const peer = createPeer({ write: (l) => written.push(l), onFatal: () => {} });
    peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'early' }));
    peer.onRequest(async (method, params) => {
      if (method === 'echo') return { got: params };
      if (method === 'none') return undefined;
      if (method === 'refuse') throw new RpcError(-32602, 'Invalid params', { why: 'x' });
      throw new Error('a message that must not be sent');
    });
    peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'echo', params: { a: 1 } }));
    peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 'two', method: 'none' }));
    peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'refuse' }));
    peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'bug' }));
    await vi.waitFor(() => expect(written).toHaveLength(5));
    expect(written.map((l) => JSON.parse(l) as unknown)).toEqual([
      { jsonrpc: '2.0', id: 0, error: { code: -32601, message: 'Method not found' } },
      { jsonrpc: '2.0', id: 1, result: { got: { a: 1 } } },
      { jsonrpc: '2.0', id: 'two', result: null },
      { jsonrpc: '2.0', id: 3, error: { code: -32602, message: 'Invalid params', data: { why: 'x' } } },
      { jsonrpc: '2.0', id: 4, error: { code: -32603, message: 'Internal error' } },
    ]);
  });

  it('a reply that cannot be written is logged, never left as an unhandled rejection', async () => {
    const peer = createPeer({ write: () => { throw new Error('write EPIPE'); }, onFatal: () => {} });
    peer.onRequest(async () => ({ ok: true }));
    peer.receive('{"jsonrpc":"2.0","id":1,"method":"m"}');
    await vi.waitFor(() => expect(info.mock.calls).toEqual([['[tutor] rpc-reply-failed code=INTERNAL']]));
  });

  it('hands notifications to their handler', () => {
    const seen: Array<[string, unknown]> = [];
    const peer = createPeer({ write: () => {}, onFatal: () => {} });
    peer.onNotification((m, p) => seen.push([m, p]));
    peer.receive(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { x: 1 } }));
    expect(seen).toEqual([['session/update', { x: 1 }]]);
  });

  it.each([
    ['a JSON value that is not an object', '[]'],
    ['another protocol version', '{"jsonrpc":"1.0","method":"x"}'],
    ['no version', '{"method":"x"}'],
    ['an id that is neither number nor string', '{"jsonrpc":"2.0","id":true,"method":"x"}'],
    ['a method that is not a string', '{"jsonrpc":"2.0","method":5}'],
    ['an error code that is not an integer', '{"jsonrpc":"2.0","id":1,"error":{"code":1.5,"message":"m"}}'],
    ['an error message that is not a string', '{"jsonrpc":"2.0","id":1,"error":{"code":1,"message":7}}'],
    ['neither a request nor an answer', '{"jsonrpc":"2.0"}'],
    ['a request with a null id', '{"jsonrpc":"2.0","id":null,"method":"x"}'],
  ])('a wrong envelope is fatal: %s', (_, line) => {
    const fatal: string[] = [];
    const notes: string[] = [];
    const peer = createPeer({ write: () => {}, onFatal: (c) => fatal.push(c) });
    peer.onNotification((m) => notes.push(m));
    peer.receive('{"jsonrpc":"2.0","method":"fine"}');
    expect([notes, fatal]).toEqual([['fine'], []]);
    peer.receive(line);
    expect(fatal).toEqual(['AGENT_PROTOCOL']);
  });

  it('an error answer with a null id (the agent could not read the request) is dropped like an unknown id', () => {
    const fatal: string[] = [];
    const peer = createPeer({ write: () => {}, onFatal: (c) => fatal.push(c) });
    peer.receive('{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}');
    expect(fatal).toEqual([]);
    expect(info.mock.calls).toEqual([['[tutor] rpc-unknown-id']]);
  });

  it('a fatal line closes the peer: waiting requests fail with AGENT_PROTOCOL, onFatal is told once, nothing more is read', async () => {
    const fatal: string[] = [];
    const notes: string[] = [];
    const peer = createPeer({ write: () => {}, onFatal: (c) => fatal.push(c) });
    peer.onNotification((m) => notes.push(m));
    const waiting = peer.request('session/prompt', {});
    peer.receive('{');
    peer.receive('{');
    peer.receive('{"jsonrpc":"2.0","method":"after"}');
    await expect(waiting).rejects.toMatchObject({ code: 'AGENT_PROTOCOL' });
    expect(fatal).toEqual(['AGENT_PROTOCOL']);
    expect(notes).toEqual([]);
  });

  it('a handler that finds a wrong type (LearnError AGENT_PROTOCOL) is fatal, for a notification and for a request', async () => {
    for (const kind of ['notification', 'request'] as const) {
      const fatal: string[] = [];
      const written: string[] = [];
      const peer = createPeer({ write: (l) => written.push(l), onFatal: (c) => fatal.push(c) });
      const bad = () => {
        throw new LearnError('AGENT_PROTOCOL', 'wrong type');
      };
      peer.onNotification(bad);
      peer.onRequest(async () => bad());
      peer.receive(JSON.stringify({ jsonrpc: '2.0', method: 'm', ...(kind === 'request' && { id: 1 }) }));
      await vi.waitFor(() => expect(fatal).toEqual(['AGENT_PROTOCOL']));
      expect(written).toEqual([]);
    }
  });

  it('a notification handler that throws anything else is logged and the peer goes on', () => {
    const fatal: string[] = [];
    const notes: unknown[] = [];
    const peer = createPeer({ write: () => {}, onFatal: (c) => fatal.push(c) });
    peer.onNotification((_, p) => {
      if (p === 1) throw new Error('a bug');
      notes.push(p);
    });
    peer.receive('{"jsonrpc":"2.0","method":"m","params":1}');
    peer.receive('{"jsonrpc":"2.0","method":"m","params":2}');
    expect(notes).toEqual([2]);
    expect(fatal).toEqual([]);
    expect(info.mock.calls).toEqual([['[tutor] rpc-handler-failed code=INTERNAL']]);
  });

  it('close rejects every waiting request with its code, and nothing is written after it', async () => {
    const written: string[] = [];
    const peer = createPeer({ write: (l) => written.push(l), onFatal: () => {} });
    let release!: () => void;
    peer.onRequest(() => new Promise((r) => (release = () => r({ late: true }))));
    peer.receive('{"jsonrpc":"2.0","id":7,"method":"session/request_permission"}');
    const a = peer.request('session/prompt', {});
    const b = peer.request('session/new', {}, { timeoutMs: 60_000 });
    expect(written).toHaveLength(2);
    peer.close('AGENT_EXITED');
    await expect(a).rejects.toMatchObject({ code: 'AGENT_EXITED' });
    await expect(b).rejects.toMatchObject({ code: 'AGENT_EXITED' });
    await expect(peer.request('initialize', {})).rejects.toMatchObject({ code: 'AGENT_EXITED' });
    peer.notify('session/cancel', { sessionId: 's1' });
    release();
    await new Promise<void>((r) => setImmediate(r));
    expect(written).toHaveLength(2);
  });
});
