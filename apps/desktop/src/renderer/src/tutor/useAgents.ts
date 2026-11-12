import { useCallback, useEffect, useState } from 'react';
import { hashKey, useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import type { AgentId, AgentsReport, TutorAgentsInput } from '@learn/domain';
import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { useLearnEvent } from '../events';

/** How long a detection runs before the screen says it is searching (spec 8.7). */
export const SEARCHING_MS = 300;

/** The state of a recheck or a search, one for the whole window: every screen that reads the report sees the same one. */
export const useAgentsRun = create<{ busy: boolean; failed: boolean }>()(() => ({ busy: false, failed: false }));

// A read of the report that got an answer, by whatever path (a retry, the re-read after a failed turn, a recheck, a search), ends a failure.
queryClient.getQueryCache().subscribe((event) => {
  if (event.type === 'updated' && event.action.type === 'success' && hashKey(event.query.queryKey) === hashKey(keys.tutorAgents)) useAgentsRun.setState({ failed: false });
});

/** `on`, but only once it has held for `ms`. */
function useAfter(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return late;
}

/**
 * One agent's row or the whole search, on main. The report that was being read is dropped first (an older answer must not land over a
 * newer one), a second press while one runs is ignored (null), and a failure keeps the list that is there and says so (`failed`).
 * Resolves when it has ended, whatever it found.
 */
function run(input: TutorAgentsInput): Promise<void> | null {
  if (useAgentsRun.getState().busy) return null;
  useAgentsRun.setState({ busy: true, failed: false });
  void queryClient.cancelQueries({ queryKey: keys.tutorAgents });
  return unwrap(api().tutor.agents(input))
    .then((report) => {
      queryClient.setQueryData(keys.tutorAgents, report);
      useAgentsRun.setState({ busy: false, failed: false });
    })
    .catch((e: unknown) => {
      console.warn(`[tutor] agents failed: ${(e as { code?: string }).code ?? 'INTERNAL'}`);
      useAgentsRun.setState({ busy: false, failed: true });
    });
}

/**
 * One agent checked again, as its row's 다시 확인 does — the same one check of the window, so the chooser and the agent button see it.
 * The composer waits for it before a send when the cached state is not 준비됨. Null while a check or a search already runs.
 */
export const recheckAgent = (agent: AgentId): Promise<void> | null => run({ mode: 'recheck', agent });

/**
 * Once per window (MainWindow): a turn that failed on the login or on the lockdown makes the report of this run stale. Main corrects
 * its own report before it sends that `failed`, so the next read says 로그인 필요 with its command, or the lockdown. The report is marked
 * stale whether a screen shows it or not: the next one that does reads it again.
 */
export function useAgentsReread(): void {
  useLearnEvent('tutor:turn', (e) => {
    if (e.kind === 'failed' && (e.code === 'AGENT_LOGIN' || e.code === 'AGENT_LOCKDOWN')) void queryClient.invalidateQueries({ queryKey: keys.tutorAgents });
  });
}

/**
 * The agents report of this run (spec 4.3), kept in the query cache for the whole run. `enabled`: read (`mode: 'cached'` — main detects
 * once and keeps it) only while a screen that shows it can be seen, so a folded panel asks nothing; a failed read is tried again when
 * it is shown again. `recheck` is one agent's row, `research` the whole search; while one runs the list that is there stays.
 * `failed`: the last read or press did not get an answer.
 */
export function useAgents(enabled: boolean): { report: AgentsReport | null; busy: boolean; searching: boolean; failed: boolean; recheck(agent: AgentId): void; research(): void } {
  const query = useQuery({
    queryKey: keys.tutorAgents,
    queryFn: () => unwrap(api().tutor.agents({ mode: 'cached' })),
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  const { busy, failed: runFailed } = useAgentsRun();
  const searching = useAfter(busy || (enabled && query.isFetching), SEARCHING_MS);
  return {
    report: query.data ?? null,
    busy,
    searching,
    failed: runFailed || (query.isError && query.data === undefined),
    recheck: useCallback((agent: AgentId) => void recheckAgent(agent), []),
    research: useCallback(() => void run({ mode: 'research' }), []),
  };
}
