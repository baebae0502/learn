import { useEffect } from 'react';
import type { CommandContextState } from '@learn/domain';
import { api } from '../api';
import { contextOf, type CommandEnv } from './registry';

/** Tells main the window's command context whenever it changes (ADR-0005 §2): main enables the menu bar from it. */
export function useReportContext(env: CommandEnv): void {
  const json = JSON.stringify(contextOf(env));
  useEffect(() => {
    void api().ui.reportContext(JSON.parse(json) as CommandContextState);
  }, [json]);
}
