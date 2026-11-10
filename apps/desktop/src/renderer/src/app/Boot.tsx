import { useEffect, useRef } from 'react';
import { SETTINGS, type AppInfo } from '@learn/domain';
import { ApiError } from '../api';
import { FatalScreen } from '../components/FatalScreen';
import { useAppInfo, usePanes, usePrefs, usePrefsSync, useSavedTabs } from '../data/queries';
import { useSearchScopeSetting } from '../library/useBodySearch';
import { useImageBackgroundSetting } from '../viewers/image/useImageBackground';
import { usePageColorSetting } from '../viewers/pdf/usePageColor';
import { useReaderNavSetting } from '../viewers/pdf/useReaderNav';
import { parsePanes } from '../shell/layout';
import { useShell } from '../state/shell-store';
import { fromSaved, knownFromSaved } from '../state/tabs';
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
  const savedTabs = useSavedTabs();
  // The reader's page colour too: a reader restored at launch draws its first page in it (a failed read falls back to 앱 테마 따르기).
  const pageColor = usePageColorSetting();
  const imageBackground = useImageBackgroundSetting();
  // And the sidebar's list (thumbnails or outline): the segment is drawn with its saved choice from the first frame.
  const readerNav = useReaderNavSetting();
  // And the quick search's scope: the field's placeholder is the stored scope's from the first frame.
  const searchScope = useSearchScopeSetting();
  const seeded = useRef(false);
  if (panes.isPending || savedTabs.isPending || pageColor.isPending || imageBackground.isPending || readerNav.isPending || searchScope.isPending) return null;
  if (!seeded.current) {
    seeded.current = true; // a failed read falls back to the defaults
    // Both panes before the first paint: the item panel has its width in its first frame too.
    const seed = parsePanes(panes.data ?? null);
    useShell.getState().setSidebar(seed.sidebar);
    useShell.getState().setInspector(seed.inspector);
    // The tabs open at the last quit; a missing, unreadable or failed read opens on the library alone.
    const tabs = SETTINGS['ui.tabs'].safeParse(savedTabs.data);
    const saved = tabs.success ? tabs.data : undefined;
    useShell.getState().restoreTabs(fromSaved(saved), knownFromSaved(saved));
  }
  return (
    <RenderBoundary>
      <MainWindow info={info} />
    </RenderBoundary>
  );
}
