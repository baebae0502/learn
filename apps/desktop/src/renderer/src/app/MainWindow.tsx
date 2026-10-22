import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppInfo, Prefs, Result, StorageMode } from '@learn/domain';
import { api, unwrap } from '../api';
import { CommandProvider } from '../commands/CommandProvider';
import { useKeymap } from '../commands/keymap';
import { runCommand, runPicked, type CommandEnv } from '../commands/registry';
import { useReportContext } from '../commands/useReportContext';
import { useMenuCommands } from '../commands/useMenuCommands';
import { keys, useItems, useLibrarySync, usePrefs } from '../data/queries';
import { queryClient } from '../data/query-client';
import { freshTargets } from '../data/targets';
import { EmptyLibrary } from '../library/EmptyLibrary';
import { ImportMenuButton } from '../library/ImportMenuButton';
import { LibrarySidebar } from '../library/LibrarySidebar';
import { LibraryTable } from '../library/LibraryTable';
import { ListFailed } from '../library/ListFailed';
import { useImport } from '../library/useImport';
import { Palette, openPalette } from '../palette/Palette';
import { createTextSizeSetter } from '../settings/textSize';
import { useLearnEvent } from '../events';
import { useApplyPrefs } from '../settings/useApplyPrefs';
import { DemoOverlay } from '../shell/DemoOverlay';
import { DropOverlay } from '../shell/DropOverlay';
import { Launcher } from '../shell/Launcher';
import { focusPane } from '../shell/panes';
import { Shell } from '../shell/Shell';
import { Toolbar } from '../shell/Toolbar';
import { usePanePersistence, useSidebarHidden, useToggleSidebar } from '../shell/useSidebar';
import { useWindowState } from '../shell/useWindowState';
import { useShell } from '../state/shell-store';
import { t } from '../strings';
import { readWindowParams } from '../ui/platform';
import { Toasts, showToast } from '../ui/toasts';
import { ReaderToolbar } from '../viewers/ReaderToolbar';
import { ViewerHost } from '../viewers/ViewerHost';

/** A failed relink, context-menu or file call: the message comes from main and is already Korean (cause + next step). */
const actionFailed = (e: unknown) => showToast({ kind: 'error', title: t.toast.actionFailed, body: (e as Error).message, testId: 'action-error' });

/** Finder에서 보기 / 기본 앱으로 열기: main re-checks the file first; a failure is a toast. */
const fileAction = (run: () => Promise<Result<void>>): void => void unwrap(run()).catch(actionFailed);

export function MainWindow(_props: { info: AppInfo }) {
  useApplyPrefs();
  useWindowState();
  useLibrarySync();
  usePanePersistence();
  const items = useItems();
  const prefs = usePrefs().data;
  const view = useShell((s) => s.view);
  const setView = useShell((s) => s.setView);
  const importing = useShell((s) => s.importing);
  const overlayOpen = useShell((s) => s.paletteOpen || s.dropOverlay);
  const toggleSidebar = useToggleSidebar();
  const sidebarHidden = useSidebarHidden();
  // Cold-start mark (Task 13 perf): the first render in which the library list has settled, not the mount (R-18).
  const readyAt = useRef(0);
  if (readyAt.current === 0 && (items.isSuccess || items.isError)) readyAt.current = Date.now();

  /** A duplicate question is up (its sheet is modal over this window). */
  const [questionOpen, setQuestionOpen] = useState(false);
  /** Each duplicate is asked in the native duplicate sheet (main); the import waits for the answer. */
  const confirm = useCallback(async (dup: { path: string; existingItemId: string }) => {
    setQuestionOpen(true);
    try {
      return (await unwrap(api().ui.confirmDuplicate(dup))).choice;
    } finally {
      setQuestionOpen(false);
    }
  }, []);
  const runImport = useImport(confirm);
  /** ⌘/ asked for and not answered yet: from the request until the sheet has closed. */
  const [sheetRequested, setSheetRequested] = useState(false);
  /** Main says one of our sheets hangs over this window: pushed when it shows (windowState.sheetOpen). */
  const [sheetShown, setSheetShown] = useState(false);
  useLearnEvent('windowState', (state) => setSheetShown(state.sheetOpen));
  /** The ⌘/ sheet is modal: commands (and drops) stay disabled until it closes. */
  const sheetOpen = sheetRequested && sheetShown;
  // T13M-n4: until the sheet is on screen nothing greys — the window would read as lagging — but every command is
  // refused already (env.held), main's menu included.
  const held = sheetRequested && !sheetShown;
  // Duplicate sheets wait inside the import, so `importing` covers them; the ⌘/ sheet has its own flag. The registry
  // (env.blocked), main's menu and the window's drop target follow this one value.
  const blocked = importing || sheetOpen;
  // The one modal predicate (Task 12 polish): a surface that owns the keyboard — a sheet (⌘/ or a duplicate question),
  // the palette, the drop overlay. Work in progress is not one: during an import F6 still moves between panes, and only
  // these stop it. The keymap's `active` and the registry's `duringWork` rule both read this value, so they cannot
  // drift apart.
  const modal = sheetOpen || questionOpen || overlayOpen;
  const showShortcuts = useCallback(async () => {
    setSheetRequested(true);
    try {
      await unwrap(api().ui.showShortcuts());
    } catch (e) {
      actionFailed(e);
    } finally {
      setSheetRequested(false);
    }
  }, []);

  // ⌘+ / ⌘− / ⌘0 step from the newest size (also before prefsChanged has come back); applied through prefsChanged
  // (useApplyPrefs), like a change made in the settings window; a refused write is a toast.
  const setTextSize = useMemo(
    () =>
      createTextSizeSetter({
        known: () => queryClient.getQueryData<Prefs>(keys.prefs)?.fontSize ?? 13,
        write: (fontSize) => unwrap(api().prefs.set({ fontSize })),
        failed: actionFailed,
      }),
    [],
  );

  const relink = useCallback(async (itemId: string) => {
    try {
      const item = await unwrap(api().library.get({ itemId }));
      if (item.storageMode !== 'linked') return;
      if (item.availability !== 'missing') {
        void queryClient.invalidateQueries({ queryKey: keys.items });
        return;
      }
      await unwrap(api().library.pickAndRelink({ assetId: item.assetId }));
    } catch (e) {
      actionFailed(e);
    }
  }, []);

  const onDrop = useCallback(
    (paths: string[], mode: StorageMode, unresolved: number) => {
      // Files without a location on disk are named in a toast; the others are still imported.
      if (unresolved > 0) showToast({ kind: 'error', title: t.toast.dropNoPathTitle(unresolved), body: t.toast.dropNoPathBody, testId: 'drop-failed' });
      if (paths.length > 0) void runImport(() => api().library.import({ paths, mode }), mode, paths.length);
    },
    [runImport],
  );

  // A failed refresh keeps the last list on screen and says so once (a StrictMode re-run sees the same error object).
  // A failed first read has no list to keep: the content column shows the list-failed notice instead (below).
  const shownListError = useRef<unknown>(null);
  const refreshFailed = items.isError && items.data !== undefined;
  useEffect(() => {
    if (!refreshFailed || shownListError.current === items.error) return;
    shownListError.current = items.error;
    showToast({ kind: 'error', title: t.shell.listFailed, body: items.error!.message, testId: 'list-error' });
  }, [refreshFailed, items.error]);

  // The failed first read stays on screen while 다시 시도 reads again: a refetch without data puts the query back to
  // pending (error cleared), which alone would blank the notice and drop its focused button.
  const [lastListFailure, setLastListFailure] = useState<string | null>(null);
  useEffect(() => {
    if (items.isError && items.data === undefined) setLastListFailure(items.error.message);
    else if (items.data !== undefined) setLastListFailure(null);
  }, [items.isError, items.data, items.error]);
  const listFailure = items.data !== undefined ? null : items.isError ? items.error.message : lastListFailure;

  const list = items.data ?? [];
  const env: CommandEnv = {
    view: view.kind === 'reader' ? 'viewer' : 'library',
    blocked,
    held,
    // The 보기 menu names what ⌃⌘S does now (사이드바 가리기 / 사이드바 보기).
    sidebar: sidebarHidden ? 'hidden' : 'shown',
    // ⌘+ / ⌘− stop at 15 / 12 and ⌘0 is off at 13 (prefs.fontSize; the default until prefs are read).
    textSize: prefs?.fontSize ?? 13,
    // The freshest fact: the item's own read while it is current (library.get re-checked the file), else the list row.
    targetsOf: (ids) => freshTargets(queryClient, list, ids),
    importFiles: (mode) => void runImport(() => api().library.pickAndImport({ mode }), mode),
    back: () => setView({ kind: 'library' }),
    open: (itemId) => setView({ kind: 'reader', itemId }),
    relink: (itemId) => void relink(itemId),
    toggleSidebar,
    showShortcuts: () => void showShortcuts(),
    openPalette,
    showInFolder: (itemId) => fileAction(() => api().library.showInFolder({ itemId })),
    openExternally: (itemId) => fileAction(() => api().library.openExternally({ itemId })),
    openSettings: () => void unwrap(api().ui.openSettings()).catch(actionFailed),
    setTextSize,
    focusPane,
    modal,
  };
  useMenuCommands(env);
  useReportContext(env);
  useKeymap(env, !modal);
  const envRef = useRef(env);
  useEffect(() => {
    envRef.current = env;
  });

  const showItemMenu = useCallback(async (itemId: string, x: number, y: number) => {
    try {
      const picked = await unwrap(api().ui.showContextMenu({ kind: 'item', itemIds: [itemId], x, y }));
      if (picked) runPicked(picked.commandId, envRef.current, [itemId]);
    } catch (e) {
      actionFailed(e);
    }
  }, []);

  /** Open from the list through the registry: refused while an import or a sheet holds the window (blocked). */
  const openFromList = useCallback((itemId: string) => runCommand('item.open', envRef.current, { itemIds: [itemId] }), []);

  const count = list.length;
  // The screen before the list (first run, or the list-failed notice) had focus and left with it, so focus fell to
  // <body>: hand it to the first title, where the list continues; keyboard users keep their place.
  const leftWithFocus = useRef(false);
  const firstTitle = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const hadFocus = leftWithFocus.current;
    leftWithFocus.current = false;
    if (!hadFocus || view.kind !== 'library' || count === 0) return;
    if (document.activeElement === null || document.activeElement === document.body) firstTitle.current?.focus();
  }, [view.kind, count]);

  const toolbar =
    view.kind === 'reader' ? (
      <ReaderToolbar itemId={view.itemId} />
    ) : (
      <Toolbar title={t.shell.myLibrary} count={count > 0 ? t.shell.count(count) : undefined} actions={<ImportMenuButton />} trailing={<Launcher />} />
    );
  // N-5: until the first list has arrived the count is unknown, not 0 — show neither the first-run screen nor the
  // list (no empty-library flash). A first read that failed says so where the list would be, with a retry.
  const library =
    items.data === undefined ? (
      listFailure !== null ? (
        <ListFailed message={listFailure} retrying={items.isFetching} onRetry={() => void items.refetch()} focusOnLeave={leftWithFocus} />
      ) : null
    ) : count === 0 ? (
      <EmptyLibrary focusOnLeave={leftWithFocus} />
    ) : (
      <LibraryTable items={list} firstTitleRef={firstTitle} onOpen={openFromList} onContextMenu={(itemId, x, y) => void showItemMenu(itemId, x, y)} />
    );

  return (
    <CommandProvider env={env}>
      <Shell
        sidebar={<LibrarySidebar count={count} />}
        launcher={<Launcher />}
        toolbar={toolbar}
        overlays={
          <>
            <Palette />
            {/* Finder → window while the library shows and nothing holds the window; a file drag closes the palette. */}
            <DropOverlay enabled={view.kind === 'library' && !blocked && !held} onDrop={onDrop} />
            <Toasts />
            {/* Demo recordings only (main sets demo=1 for LEARN_DEMO_OVERLAY=1 in an unpackaged build). */}
            {readWindowParams(location.search).demo && <DemoOverlay />}
          </>
        }
      >
        {view.kind === 'reader' ? <ViewerHost key={view.itemId} itemId={view.itemId} /> : library}
      </Shell>
      {(items.isSuccess || items.isError) && <div data-testid="app-ready" data-at={readyAt.current} hidden />}
    </CommandProvider>
  );
}
