import { useEffect } from 'react';
import type { CommandContextState } from '@learn/domain';
import { api } from '../api';
import { reportedContext, type CommandEnv } from './registry';

/** Tells main the window's command context whenever it changes (ADR-0005 §2): main enables the menu bar from it. */
export function useReportContext(env: CommandEnv): void {
  const json = JSON.stringify(reportedContext(env));
  useEffect(() => {
    // A lost report leaves the menu bar on the previous context; log the code only (no payload).
    api().ui.reportContext(JSON.parse(json) as CommandContextState).then(
      (r) => {
        if (!r.ok) console.warn(`[commands] reportContext failed: ${r.code}`);
      },
      () => console.warn('[commands] reportContext failed: INTERNAL'),
    );
  }, [json]);
}
