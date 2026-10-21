import { useRef } from 'react';
import type { AppInfo } from '@learn/domain';
import { ApiError } from '../api';
import { FatalScreen } from '../components/FatalScreen';
import { useAppInfo, usePanes, usePrefs, usePrefsSync } from '../data/queries';
import { parsePanes } from '../shell/layout';
import { useShell } from '../state/shell-store';
import { MainWindow } from './MainWindow';

/** Info, prefs and the pane layout before the first paint of the shell (no layout jump, no theme flash). */
export function Boot() {
  const info = useAppInfo();
  const prefs = usePrefs();
  usePrefsSync();
  if (info.isError) {
    const e = info.error;
    return <FatalScreen code={e instanceof ApiError ? e.code : 'INTERNAL'} message={e.message} libraryRoot={null} />;
  }
  if (!info.data || !prefs.data) return null;
  if (info.data.libraryError) return <FatalScreen code={info.data.libraryError.code} message={info.data.libraryError.message} libraryRoot={info.data.libraryRoot} />;
  return <PanesGate info={info.data} />;
}

function PanesGate({ info }: { info: AppInfo }) {
  const panes = usePanes();
  const seeded = useRef(false);
  if (panes.isPending) return null;
  if (!seeded.current) {
    seeded.current = true; // a failed read falls back to the defaults
    useShell.getState().setSidebar(parsePanes(panes.data ?? null));
  }
  return <MainWindow info={info} />;
}
