import { describe, expect, it, vi } from 'vitest';
import type { AgentsReport } from '@learn/domain';

vi.mock('../api', async (original) => ({ ...(await original<typeof import('../api')>()), api: () => ({}) }));

const { useAgentsRun } = await import('./useAgents');
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
