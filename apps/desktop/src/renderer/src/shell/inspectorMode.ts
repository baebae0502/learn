import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api, unwrap } from '../api';
import { queryClient } from '../data/query-client';
import { saveSetting, settingKey } from '../data/saveSetting';
import { useShell } from '../state/shell-store';
import type { InspectorMode } from './layout';

/** Read before the window's first paint (Boot), so the right panel has its mode's width in its first frame. */
export const useInspectorModeSetting = (): UseQueryResult<unknown> =>
  useQuery({ queryKey: settingKey('reader.inspectorMode'), queryFn: () => unwrap(api().settings.get({ key: 'reader.inspectorMode' })) });

/** The reader's remembered mode: 정보 when it was chosen, 튜터 when nothing was (a first reader opens on the consent card) or the value is unreadable. */
export const readerMode = (stored: unknown): InspectorMode => (stored === 'info' ? 'info' : 'tutor');

/** The mode of the right panel now: the library has the info one only. */
export function useInspectorMode(): InspectorMode {
  const read = useInspectorModeSetting();
  const inReader = useShell((s) => s.view.kind === 'reader');
  return inReader ? readerMode(read.data) : 'info';
}

/** The same, for a function outside a component (the commands, the folds read it when they run). */
export function inspectorModeNow(): InspectorMode {
  if (useShell.getState().view.kind !== 'reader') return 'info';
  return readerMode(queryClient.getQueryData(settingKey('reader.inspectorMode')));
}

/** The user's choice, remembered for the next reader. */
export const chooseInspectorMode = (mode: InspectorMode): void => saveSetting('reader.inspectorMode', mode);
