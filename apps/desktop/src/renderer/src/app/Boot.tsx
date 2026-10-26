import { useEffect, useRef } from 'react';
import type { AppInfo } from '@learn/domain';
import { ApiError } from '../api';
import { FatalScreen } from '../components/FatalScreen';
import { useAppInfo, usePanes, usePrefs, usePrefsSync } from '../data/queries';
import { parsePanes } from '../shell/layout';
import { useShell } from '../state/shell-store';
import { MainWindow } from './MainWindow';
import { RenderBoundary } from './RenderBoundary';

const codeOf = (e: unknown): string => (e instanceof ApiError ? e.code : 'INTERNAL');

/** Info, prefs and the pane layout before the first paint of the shell (no layout jump, no theme flash). */
export function Boot() {
  const info = useAppInfo();
  const prefs = usePrefs();
  usePrefsSync();
  const prefsFailure = prefs.isError ? codeOf(prefs.error) : null;
  useEffect(() => {
    // The window still opens: prefs consumers fall back to DEFAULT_PREFS until main pushes prefsChanged. Code only.
    if (prefsFailure) console.warn(`[prefs] reading prefs failed: ${prefsFailure}`);
  }, [prefsFailure]);
  // Code only: main's message can carry a path or engine text (C-8); FatalScreen says it in our own words.
  if (info.isError) return <FatalScreen code={codeOf(info.error)} />;
  if (info.isPending || prefs.isPending) return null;
  if (info.data.libraryError) {
    const { libraryError, libraryRoot, backupFile, homeDir } = info.data;
    return <FatalScreen code={libraryError.code} libraryRoot={libraryRoot} backupFile={backupFile} homeDir={homeDir} />;
  }
  return <PanesGate info={info.data} />;
}

function PanesGate({ info }: { info: AppInfo }) {
  const panes = usePanes();
  const seeded = useRef(false);
  if (panes.isPending) return null;
  if (!seeded.current) {
    seeded.current = true; // a failed read falls back to the defaults
    // Both panes before the first paint: the item panel has its width in its first frame too.
    const seed = parsePanes(panes.data ?? null);
    useShell.getState().setSidebar(seed.sidebar);
    useShell.getState().setInspector(seed.inspector);
  }
  return (
    <RenderBoundary>
      <MainWindow info={info} />
    </RenderBoundary>
  );
}
