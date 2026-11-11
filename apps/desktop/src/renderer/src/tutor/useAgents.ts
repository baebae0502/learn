import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AgentId, AgentsReport } from '@learn/domain';
import { api, unwrap } from '../api';
import { keys } from '../data/queries';
import { queryClient } from '../data/query-client';
import { useLearnEvent } from '../events';

/** How long a detection runs before the screen says it is searching (spec 8.7). */
export const SEARCHING_MS = 300;

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
 * The agents report of this run (spec 4.3): read when a screen that needs it is shown (`mode: 'cached'` — main detects once and keeps it),
 * kept for the whole run in the query cache, and read again after a turn failed on a login or a lockdown (main corrects its report before
 * it sends that `failed`, Task 12, so the report read again says 로그인 필요 with its command, or the lockdown). Only mounted after consent
 * (the chooser, the composer's agent button): nothing is asked of main before. `recheck` is one agent's row, `research` the whole search;
 * while one runs, a second press is ignored and the list that is there stays.
 */
export function useAgents(): { report: AgentsReport | null; searching: boolean; recheck(agent: AgentId): void; research(): void } {
  const query = useQuery({
    queryKey: keys.tutorAgents,
    queryFn: () => unwrap(api().tutor.agents({ mode: 'cached' })),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    retryOnMount: false,
  });
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback((input: Parameters<ReturnType<typeof api>['tutor']['agents']>[0]) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    unwrap(api().tutor.agents(input))
      .then((report) => void queryClient.setQueryData(keys.tutorAgents, report))
      // The list that is there stays; log the code only.
      .catch((e: unknown) => console.warn(`[tutor] agents failed: ${(e as { code?: string }).code ?? 'INTERNAL'}`))
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  }, []);
  useLearnEvent('tutor:turn', (e) => {
    if (e.kind === 'failed' && (e.code === 'AGENT_LOGIN' || e.code === 'AGENT_LOCKDOWN')) void queryClient.invalidateQueries({ queryKey: keys.tutorAgents });
  });
  const searching = useAfter(busy || query.isFetching, SEARCHING_MS);
  return {
    report: query.data ?? null,
    searching,
    recheck: useCallback((agent: AgentId) => run({ mode: 'recheck', agent }), [run]),
    research: useCallback(() => run({ mode: 'research' }), [run]),
  };
}
