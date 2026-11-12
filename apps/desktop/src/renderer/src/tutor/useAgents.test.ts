import { describe, expect, it, vi } from 'vitest';
import type { AgentsReport } from '@learn/domain';

/** tutor:agents as the test answers it: each call waits until the test settles it. */
const calls: Array<{ input: unknown; settle(r: { ok: true; data: AgentsReport } | { ok: false; code: string; message: string; retryable: boolean }): void }> = [];
vi.mock('../api', async (original) => ({
  ...(await original<typeof import('../api')>()),
  api: () => ({ tutor: { agents: (input: unknown) => new Promise((settle) => calls.push({ input, settle })) } }),
}));

const { recheckAgent, useAgentsRun } = await import('./useAgents');
const { queryClient } = await import('../data/query-client');
const { keys } = await import('../data/queries');

const REPORT: AgentsReport = { agents: [], fake: null };

describe('the failure line of the agents report', () => {
  it('ends when any read of the report gets an answer, not only at the next press', () => {
    useAgentsRun.setState({ busy: false, failed: true });
    queryClient.setQueryData(keys.tutorAgents, REPORT); // a retry on show, the re-read after a failed turn, a recheck, a search
    expect(useAgentsRun.getState().failed).toBe(false);
  });
  it('is not touched by an answer for another query', () => {
    useAgentsRun.setState({ busy: false, failed: true });
    queryClient.setQueryData(['prefs'], {});
    expect(useAgentsRun.getState().failed).toBe(true);
    useAgentsRun.setState({ failed: false });
  });
});

describe('the recheck the composer waits for before a send (R7)', () => {
  const READY: AgentsReport = { agents: [{ id: 'claude', name: 'Claude Code', state: 'ready', cliVersion: '2.1.318', adapterVersion: '0.103.0', minimum: null, command: null, note: null }], fake: null };
  it('is the window\'s one check: the shared state is busy while it runs, a second ask gets none, and it ends with the report in the cache', async () => {
    calls.length = 0;
    const first = recheckAgent('claude');
    expect(first).not.toBeNull();
    expect(calls.map((c) => c.input)).toEqual([{ mode: 'recheck', agent: 'claude' }]);
    expect(useAgentsRun.getState().busy).toBe(true); // what the chooser and the agent button read
    expect(recheckAgent('claude')).toBeNull(); // a second ↩ while it checks does nothing
    expect(calls).toHaveLength(1);
    calls[0]!.settle({ ok: true, data: READY });
    await first;
    expect(useAgentsRun.getState()).toEqual({ busy: false, failed: false });
    expect(queryClient.getQueryData(keys.tutorAgents)).toEqual(READY);
  });
  it('ends too when the check fails, so the send goes on to main, which answers for itself', async () => {
    calls.length = 0;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const run = recheckAgent('claude')!;
    calls[0]!.settle({ ok: false, code: 'INTERNAL', message: 'x', retryable: false });
    await expect(run).resolves.toBeUndefined();
    expect(useAgentsRun.getState()).toEqual({ busy: false, failed: true });
    expect(warn).toHaveBeenCalledWith('[tutor] agents failed: INTERNAL');
    warn.mockRestore();
    useAgentsRun.setState({ failed: false });
  });
});
