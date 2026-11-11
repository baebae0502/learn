import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isLearnToolCall } from '../agents/isolation';
import { createAcpClient, type SessionUpdate, type ToolCallInfo } from './client';
import { createPeer, RpcError, type JsonRpcPeer } from './jsonrpc';

/*
 * What claude-agent-acp 0.103.0 really sent in the spike (Claude Code 2.1.318), one entry per distinct shape; the
 * login label's email is replaced. A schema that passes the fake agent but not these is the bug this file guards.
 */
interface Entry { for?: string; msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { code: number; message: string; data?: unknown } } }
const FIXTURE: Entry[] = readFileSync(join(__dirname, '__fixtures__', 'claude-agent-acp-0.103.0.jsonl'), 'utf8')
  .split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Entry);

const resultOf = (method: string, stopReason?: string) => {
  const e = FIXTURE.find((x) => x.for === method && x.msg.result !== undefined && (stopReason === undefined || x.msg.result.stopReason === stopReason));
  if (!e) throw new Error(`fixture has no ${method} result`);
  return e.msg.result!;
};
const updateOf = (e: Entry) => (e.msg.params?.update ?? {}) as Record<string, unknown>;
const kindOf = (e: Entry) => String(updateOf(e).sessionUpdate);
const updates = FIXTURE.filter((e) => e.msg.method === 'session/update');
const toolName = (e: Entry) => ((updateOf(e)._meta as { claudeCode?: { toolName?: string } } | undefined)?.claudeCode?.toolName ?? '');
const isLearnEntry = (e: Entry) => !['tool_call', 'tool_call_update'].includes(kindOf(e)) || toolName(e).startsWith('mcp__learn__');

function setup() {
  const fatal: string[] = [];
  const onLockdown = vi.fn();
  let agent!: JsonRpcPeer;
  const learn = createPeer({ write: (l) => agent.receive(l), onFatal: (c) => fatal.push(c) });
  agent = createPeer({ write: (l) => learn.receive(l), onFatal: (c) => fatal.push(`agent ${c}`) });
  const client = createAcpClient(learn, { clientVersion: '0.1.0', isLearnTool: (c: ToolCallInfo) => isLearnToolCall('claude', c), onLockdown });
  return { agent, client, fatal, onLockdown };
}

describe('the spike\'s recorded adapter messages', () => {
  it('the fixture holds every shape the brief names', () => {
    const kinds = new Set(updates.map(kindOf));
    for (const k of ['agent_message_chunk', 'tool_call', 'tool_call_update', 'usage_update', 'available_commands_update', 'session_info_update']) expect(kinds).toContain(k);
    for (const m of ['initialize', 'session/new', 'session/resume', 'session/load', 'session/set_mode']) expect(resultOf(m)).toBeDefined();
    expect(resultOf('session/prompt', 'end_turn')).toBeDefined();
    expect(resultOf('session/prompt', 'cancelled')).toBeDefined();
    expect(FIXTURE.some((e) => e.msg.method === 'session/request_permission')).toBe(true);
    expect(FIXTURE.some((e) => e.msg.method === '_auth/status_update')).toBe(true);
    expect(FIXTURE.flatMap((e) => (e.msg.error ? [e.msg.error.code] : []))).toEqual(expect.arrayContaining([-32000, -32603, -32002]));
    expect(JSON.stringify(FIXTURE)).not.toMatch(/gmail|baejs/);
  });

  it('initialize, the login status, a session, the mode and a prompt run as Claude answers them', async () => {
    const h = setup();
    const sessionId = String(resultOf('session/new').sessionId);
    h.agent.onRequest(async (method) => {
      switch (method) {
        case 'initialize': return resultOf('initialize');
        case 'session/new': return resultOf('session/new');
        case 'session/set_mode': return resultOf('session/set_mode');
        case 'session/prompt': {
          for (const e of updates) {
            if (!isLearnEntry(e) || kindOf(e) === 'user_message_chunk') continue;
            h.agent.notify('session/update', { ...e.msg.params, sessionId });
          }
          return resultOf('session/prompt', 'end_turn');
        }
        default: throw new RpcError(-32601, 'Method not found');
      }
    });
    const init = await h.client.initialize();
    expect(init).toEqual({ protocolVersion: 1, loadSession: true, resume: true, http: true, image: true });
    const auth = FIXTURE.filter((e) => e.msg.method === '_auth/status_update');
    for (const e of auth) h.agent.notify('_auth/status_update', e.msg.params);
    await expect(h.client.authStatus(1_000)).resolves.toMatch(/^(none|account)$/);
    await expect(h.client.newSession({ cwd: '/work', mcpServers: [] })).resolves.toEqual({ sessionId });
    await h.client.setMode(sessionId, 'default');
    const seen: SessionUpdate[] = [];
    const outcome = await h.client.prompt(sessionId, [{ type: 'text', text: 'q' }], (u) => seen.push(u));
    expect(outcome).toEqual({ stopReason: 'end_turn', lockdown: false, model: 'claude-opus-5-5', inputTokens: 6, outputTokens: 145 });
    expect(seen.filter((u) => u.kind === 'text').length).toBeGreaterThan(0);
    expect(seen.filter((u) => u.kind === 'tool' && u.learn).length).toBeGreaterThan(0);
    expect(h.fatal).toEqual([]);
    expect(h.onLockdown).not.toHaveBeenCalled();
  });

  it('a cancelled prompt result reads too', async () => {
    const h = setup();
    h.agent.onRequest(async () => resultOf('session/prompt', 'cancelled'));
    await expect(h.client.prompt('s', [{ type: 'text', text: 'q' }], () => {})).resolves.toMatchObject({ stopReason: 'cancelled', model: 'claude-opus-5-5' });
  });

  it('every recorded update goes through the client without a fatal error, and only Learn\'s tools are judged', async () => {
    const h = setup();
    h.agent.onRequest(async () => resultOf('session/prompt', 'end_turn'));
    const run = h.client.prompt('s1', [{ type: 'text', text: 'q' }], () => {});
    for (const e of updates) h.agent.notify('session/update', { ...e.msg.params, sessionId: 's1' });
    await run;
    expect(h.fatal).toEqual([]);
    expect(h.onLockdown).not.toHaveBeenCalled();
  });

  it('the session/request_permission is refused with the reject option', async () => {
    const h = setup();
    const e = FIXTURE.find((x) => x.msg.method === 'session/request_permission')!;
    const r = await h.agent.request('session/request_permission', e.msg.params);
    expect(r).toEqual({ outcome: { outcome: 'selected', optionId: 'reject' } });
    expect(h.fatal).toEqual([]);
  });
});
